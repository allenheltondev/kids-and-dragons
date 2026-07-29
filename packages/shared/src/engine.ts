/**
 * The engine — a pure, authoritative state machine.
 *
 * architecture §4.1: clients send *intents*; the server validates, applies,
 * persists and broadcasts. This module is the "applies" step and nothing else.
 * It performs no I/O, reads no clock, and draws no randomness except through
 * the injected `Rng` (see dice.ts) — so a run replays exactly from its event
 * log, and the client can call the same function to preview what a tap *would*
 * do without ever being trusted with the answer.
 *
 * Two rules it will not let you break:
 *
 *   - **Illegal intents return an error, they do not throw.** A phone that fell
 *     behind the couch and sent a stale tap gets a code back and resyncs.
 *   - **There is no game over.** A party wipe branches the story (spec §7.3),
 *     an encounter loss goes to `onDefeat`, and no state here can terminate a
 *     run unhappily.
 *
 * Not in scope: tactical combat. Roadmap chapter 4 owns the grid, turn order
 * and enemy AI. Encounter scenes here resolve through a clearly marked
 * `TODO(chapter-4)` auto-victory so the chapter graph stays walkable end to end.
 */

import type {
  Character,
  ItemCatalog,
  ResolvedCharacter,
  RulesContent,
} from "./types/domain.js";
import type { Branch, Chapter, Choice, Effect, Scene, SceneId } from "./types/chapter.js";
import type {
  DiceRoll,
  PartyMember,
  Prompt,
  RoomMode,
  RunState,
} from "./types/state.js";
import type { ClientIntent, Presentation } from "./types/protocol.js";
import type { Rng } from "./dice.js";
import { resolveCheck } from "./dice.js";
import { newCharacter, resolveCharacter } from "./character.js";
import { addItem, addQuestItem, swapItem, useConsumable } from "./inventory.js";
import { sceneChoices, visibleChoices } from "./chapter-graph.js";

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export interface EngineContext {
  rules: RulesContent;
  items: ItemCatalog;
  /** The chapter in play. Null in the lobby and during character creation. */
  chapter?: Chapter | null;
  rng: Rng;
  /** ISO timestamp. Injected so the engine stays pure and replayable. */
  now: string;
  /** Used when a CREATE_CHARACTER intent builds a character. */
  householdId?: string;
}

export type EngineErrorCode = "STALE_SEQ" | "ILLEGAL" | "NOT_FOUND" | "FORBIDDEN";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

export interface EngineResult {
  state: RunState;
  presentation?: Presentation;
  error?: EngineError;
}

export interface IntentEnvelope {
  playerId: string;
  intent: ClientIntent;
  /** The client's last-seen seq. Checked only when provided. */
  seq?: number;
}

export interface CreateRunInput {
  runId: string;
  roomCode: string;
  mode: RoomMode;
  campaignId?: string | null;
  now: string;
}

export function createRunState(input: CreateRunInput): RunState {
  return {
    runId: input.runId,
    roomCode: input.roomCode,
    mode: input.mode,
    seq: 0,
    phase: "lobby",
    campaignId: input.campaignId ?? null,
    chapterId: null,
    sceneId: null,
    sceneType: null,
    narration: "",
    art: null,
    party: [],
    prompt: null,
    lastRoll: null,
    flags: {},
    xpEarned: 0,
    updatedAt: input.now,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * RunState is plain JSON by construction (it ships over the wire as one), so a
 * round trip is a correct and dependency-free deep clone. Every exported entry
 * point clones once and mutates a draft; nothing observable is shared.
 */
function draftOf(state: RunState): RunState {
  return JSON.parse(JSON.stringify(state)) as RunState;
}

/** Internal control flow for "this intent cannot be applied". Never escapes. */
class Illegal extends Error {
  readonly code: EngineErrorCode;
  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function err(state: RunState, code: EngineErrorCode, message: string): EngineResult {
  return { state, error: { code, message } };
}

function memberByPlayer(state: RunState, playerId: string): PartyMember | undefined {
  return state.party.find((m) => m.playerId === playerId);
}

function memberByCharacter(state: RunState, characterId: string): PartyMember | undefined {
  return state.party.find((m) => m.character.id === characterId);
}

function requireChapter(ctx: EngineContext): Chapter {
  if (!ctx.chapter) throw new Illegal("NOT_FOUND", "no chapter is loaded");
  return ctx.chapter;
}

function requireScene(chapter: Chapter, sceneId: SceneId): Scene {
  const scene = chapter.scenes[sceneId];
  if (!scene) {
    throw new Illegal("NOT_FOUND", `chapter "${chapter.id}" has no scene "${sceneId}"`);
  }
  return scene;
}

function party(state: RunState): { members: ResolvedCharacter[]; flags: Record<string, boolean> } {
  return { members: state.party.map((m) => m.character), flags: state.flags };
}

function touch(draft: RunState, ctx: EngineContext): void {
  draft.seq += 1;
  draft.updatedAt = ctx.now;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/**
 * Resolves an effect's `to` field to concrete party members.
 *
 * `undefined` deliberately means "the roller if there is one, otherwise the
 * whole party": an `onEnter` effect has no roller and reads as a party-wide
 * event, while a check branch's effect is about the character who just rolled
 * (architecture §5's example grants to `"roller"` explicitly for that reason).
 */
function targetsFor(
  draft: RunState,
  to: string | undefined,
  rollerCharacterId?: string,
): PartyMember[] {
  if (to === undefined) {
    if (rollerCharacterId) {
      const roller = memberByCharacter(draft, rollerCharacterId);
      if (roller) return [roller];
    }
    return [...draft.party];
  }
  if (to === "party") return [...draft.party];
  if (to === "roller") {
    const roller = rollerCharacterId ? memberByCharacter(draft, rollerCharacterId) : undefined;
    return roller ? [roller] : [...draft.party];
  }
  const named =
    draft.party.find((m) => m.playerId === to) ?? draft.party.find((m) => m.character.id === to);
  return named ? [named] : [];
}

/**
 * Picks who receives a `grantItem` with `to: "party"`. The schema calls for a
 * prompt to choose a holder; there is no prompt kind for that yet, so the item
 * goes to the first character with room — which is the answer the party would
 * give anyway — and falls through to the swap prompt when nobody has room.
 */
function preferredHolder(members: PartyMember[]): PartyMember | undefined {
  return members.find((m) => m.character.inventory.length < 6) ?? members[0];
}

function damage(member: PartyMember, amount: number): void {
  member.hp = Math.max(0, member.hp - amount);
  // spec §7.3 — knocked down, never dead. Even a full-party wipe is a story
  // branch, so there is deliberately nothing here that ends a run.
  if (member.hp === 0) member.down = true;
}

function heal(member: PartyMember, amount: number): void {
  member.hp = Math.min(member.character.maxHp, member.hp + amount);
  if (member.hp > 0) member.down = false;
}

function applyEffectsDraft(
  draft: RunState,
  effects: readonly Effect[] | undefined,
  ctx: EngineContext,
  rollerCharacterId?: string,
): void {
  for (const effect of effects ?? []) {
    switch (effect.type) {
      case "setFlag":
        draft.flags[effect.flag] = effect.value ?? true;
        break;

      case "grantXp":
        draft.xpEarned += effect.amount;
        break;

      case "damage":
        for (const m of targetsFor(draft, effect.to, rollerCharacterId)) {
          damage(m, effect.amount);
        }
        break;

      case "heal":
        for (const m of targetsFor(draft, effect.to, rollerCharacterId)) {
          heal(m, effect.amount);
        }
        break;

      case "grantQuestItem": {
        // §9.2 — slot-free and idempotent. A story gate is never blocked by a
        // full bag, and two branches granting the same key yield one key.
        const holder = targetsFor(draft, undefined, rollerCharacterId)[0];
        if (holder) {
          holder.character.questItems = addQuestItem(holder.character.questItems, effect.itemId);
        }
        break;
      }

      case "grantItem": {
        const candidates =
          effect.to === undefined || effect.to === "party"
            ? [preferredHolder(targetsFor(draft, effect.to, rollerCharacterId))].filter(
                (m): m is PartyMember => Boolean(m),
              )
            : targetsFor(draft, effect.to, rollerCharacterId);
        for (const member of candidates) {
          const result = addItem(member.character.inventory, effect.itemId, ctx.items);
          if (result.status === "added") {
            member.character.inventory = result.inventory;
          } else if (result.status === "quest") {
            member.character.questItems = addQuestItem(
              member.character.questItems,
              effect.itemId,
            );
          } else if (!draft.prompt || draft.prompt.kind !== "item_swap") {
            // Full bag: never silently dropped (§9.1). One prompt, one decision.
            // Only one swap can be open at a time; a single scene granting two
            // items into two full bags is an authoring smell, and the second
            // grant is left in the world rather than forced in.
            draft.prompt = {
              kind: "item_swap",
              characterId: member.character.id,
              incomingItemId: result.incomingItemId,
            };
          }
        }
        break;
      }
    }
  }
}

/** Public wrapper. Clones; never mutates the state you hand it. */
export function applyEffects(
  state: RunState,
  effects: readonly Effect[] | undefined,
  ctx: EngineContext,
  rollerCharacterId?: string,
): RunState {
  const draft = draftOf(state);
  applyEffectsDraft(draft, effects, ctx, rollerCharacterId);
  draft.updatedAt = ctx.now;
  return draft;
}

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

/** Who rolls a check. `roller: "party"` has no pick-a-roller prompt yet, so it
 * behaves like "best" — the party would nominate them anyway. */
function pickRoller(draft: RunState, scene: Scene & { type: "check" }): PartyMember {
  const standing = draft.party.filter((m) => !m.down);
  const pool = standing.length > 0 ? standing : draft.party;
  const first = pool[0];
  if (!first) throw new Illegal("ILLEGAL", "nobody is in the party to roll");
  if (scene.roller === "active") return first;
  return pool.reduce(
    (best, m) => (m.character.stats[scene.stat] > best.character.stats[scene.stat] ? m : best),
    first,
  );
}

function completeChapter(draft: RunState, ctx: EngineContext): Presentation {
  const chapter = requireChapter(ctx);
  draft.phase = "chapter_complete";
  draft.prompt = null;
  // XP is per chapter, not per kill (spec §8.1). The engine only *records* it;
  // folding it into a character's provisional progress is the persistence
  // layer's job via character.awardXp(), because RunState holds resolved
  // characters and cannot express the committed/provisional split.
  draft.xpEarned += chapter.xpAward;
  return { kind: "CHAPTER_COMPLETE", chapterId: chapter.id, xp: draft.xpEarned };
}

/** Opens the prompt a scene is waiting on. Returns a completion presentation
 * when the scene turns out to end the chapter. */
function openScenePrompt(
  draft: RunState,
  scene: Scene,
  sceneId: SceneId,
  ctx: EngineContext,
): Presentation | undefined {
  switch (scene.type) {
    case "story":
    case "rest":
    case "choice_point": {
      if (scene.choices.length === 0) {
        // A scene with no way out is the chapter's ending (see chapter-graph).
        return completeChapter(draft, ctx);
      }
      // Hidden, never disabled (architecture §5). A scene where this comes back
      // empty is an authoring bug that validateChapter reports as a DEAD_END.
      const options = visibleChoices(scene.choices, party(draft));
      const isVote = scene.type === "choice_point";
      draft.prompt = {
        kind: "choice",
        sceneId,
        options: options.map((c) => ({ id: c.id, label: c.label, icon: c.icon })),
        // choice_point puts it to the party (spec §6.1); story and rest take
        // the first answer, so anyone may tap.
        forPlayerIds: isVote ? draft.party.map((m) => m.playerId) : [],
        vote: isVote,
        ...(isVote ? { votes: {} } : {}),
      };
      return undefined;
    }

    case "check": {
      const roller = pickRoller(draft, scene);
      draft.prompt = {
        kind: "roll",
        sceneId,
        stat: scene.stat,
        tn: scene.tn,
        prompt: scene.prompt,
        characterId: roller.character.id,
      };
      return undefined;
    }

    case "encounter": {
      // TODO(chapter-4): tactical combat. Until the grid exists, an encounter
      // waits on a ready-up and then resolves as an auto-victory (see
      // resolveEncounter) so a chapter is walkable end to end.
      draft.prompt = { kind: "ready", forPlayerIds: draft.party.map((m) => m.playerId) };
      return undefined;
    }
  }
}

function enterSceneDraft(
  draft: RunState,
  sceneId: SceneId,
  ctx: EngineContext,
  transitionNarration?: string,
): Presentation | undefined {
  const chapter = requireChapter(ctx);
  const scene = requireScene(chapter, sceneId);

  // A swap prompt raised by the *departing* choice's effects survives the
  // transition. It is a decision the player still owes, and dropping it would
  // silently lose the item the whole prompt exists to protect (§9.1).
  const carriedSwap = draft.prompt?.kind === "item_swap" ? draft.prompt : undefined;

  draft.sceneId = sceneId;
  draft.sceneType = scene.type;
  draft.art = scene.art ?? null;
  draft.prompt = carriedSwap ?? null;
  draft.phase = scene.type === "encounter" ? "encounter" : scene.type === "check" ? "check" : "scene";

  const authored =
    scene.type === "check" ? (scene.narration ?? scene.prompt) : (scene.narration ?? "");
  // A branch's narration is the line that explains *how you got here*; showing
  // it above the destination's text is how it reads at the table.
  draft.narration = transitionNarration ? `${transitionNarration}\n\n${authored}`.trim() : authored;

  applyEffectsDraft(draft, scene.onEnter, ctx);

  // Rest scenes heal on arrival (spec §6.1) — the natural end-of-session beat.
  if (scene.type === "rest" && scene.heal) {
    for (const member of draft.party) heal(member, scene.heal);
  }

  const enter: Presentation = {
    kind: "SCENE_ENTER",
    sceneId,
    ...(scene.art ? { art: scene.art } : {}),
  };

  // A pending swap outranks the scene's own prompt — only one prompt is ever
  // open. RESOLVE_ITEM_SWAP opens the scene prompt once it is answered.
  if (draft.prompt?.kind === "item_swap") return enter;

  const completion = openScenePrompt(draft, scene, sceneId, ctx);
  return completion ?? enter;
}

/** Public wrapper — applies `onEnter`, sets narration/art, opens the prompt. */
export function enterScene(state: RunState, sceneId: SceneId, ctx: EngineContext): EngineResult {
  const draft = draftOf(state);
  try {
    const presentation = enterSceneDraft(draft, sceneId, ctx);
    draft.updatedAt = ctx.now;
    return presentation ? { state: draft, presentation } : { state: draft };
  } catch (e) {
    if (e instanceof Illegal) return err(state, e.code, e.message);
    throw e;
  }
}

/** Follows a branch: its effects, then its destination. */
function takeBranch(
  draft: RunState,
  branch: Branch,
  ctx: EngineContext,
  rollerCharacterId?: string,
): Presentation | undefined {
  applyEffectsDraft(draft, branch.effects, ctx, rollerCharacterId);
  return enterSceneDraft(draft, branch.goto, ctx, branch.narration);
}

// ---------------------------------------------------------------------------
// Intents
// ---------------------------------------------------------------------------

export function applyIntent(
  state: RunState,
  envelope: IntentEnvelope,
  ctx: EngineContext,
): EngineResult {
  if (envelope.seq !== undefined && envelope.seq < state.seq) {
    return err(
      state,
      "STALE_SEQ",
      `intent was built against seq ${envelope.seq}, server is at ${state.seq}`,
    );
  }

  const draft = draftOf(state);
  try {
    const presentation = dispatch(draft, envelope, ctx);
    touch(draft, ctx);
    return presentation ? { state: draft, presentation } : { state: draft };
  } catch (e) {
    if (e instanceof Illegal) return err(state, e.code, e.message);
    // A rules violation from character.ts (a hand-rolled creation payload, say)
    // is the player's problem, not a crash.
    if (e instanceof Error && e.name === "CharacterRuleError") {
      return err(state, "ILLEGAL", e.message);
    }
    throw e;
  }
}

function dispatch(
  draft: RunState,
  envelope: IntentEnvelope,
  ctx: EngineContext,
): Presentation | undefined {
  const { playerId, intent } = envelope;
  switch (intent.type) {
    case "SET_MODE":
      // Layout only (architecture §4.6). Legal at any point — the laptop dying
      // mid-encounter is exactly when you need it.
      draft.mode = intent.mode;
      return undefined;

    case "READY":
      return doReady(draft, playerId, intent.ready, ctx);

    case "CREATE_CHARACTER":
      return doCreateCharacter(draft, playerId, intent, ctx);

    case "START_CHAPTER":
      return doStartChapter(draft, intent.chapterId, ctx);

    case "CHOOSE":
      return doChoose(draft, playerId, intent.choiceId, ctx);

    case "ROLL":
      return doRoll(draft, playerId, ctx);

    case "ADVANCE":
      return doAdvance(draft, ctx);

    case "USE_ITEM":
      return doUseItem(draft, playerId, intent.itemId, ctx);

    case "RESOLVE_ITEM_SWAP":
      return doResolveItemSwap(draft, playerId, intent.dropItemId, ctx);
  }
}

function doReady(
  draft: RunState,
  playerId: string,
  ready: boolean,
  ctx: EngineContext,
): Presentation | undefined {
  const member = memberByPlayer(draft, playerId);
  if (!member) throw new Illegal("NOT_FOUND", `player "${playerId}" is not in this run`);
  member.ready = ready;

  if (
    draft.phase === "encounter" &&
    draft.prompt?.kind === "ready" &&
    draft.party.every((m) => m.ready || !m.connected)
  ) {
    return resolveEncounter(draft, ctx);
  }
  return undefined;
}

function doCreateCharacter(
  draft: RunState,
  playerId: string,
  intent: Extract<ClientIntent, { type: "CREATE_CHARACTER" }>,
  ctx: EngineContext,
): Presentation | undefined {
  /*
   * Deliberately allowed at any phase. Refusing once the chapter has started
   * strands anyone who joins late — their phone has no character, so it offers
   * the creation flow, and the server then refuses the only thing they can do.
   * Someone arriving mid-chapter walking on as a new party member is a much
   * better answer than a phone that says "finding your character" forever.
   */
  if (memberByPlayer(draft, playerId)) {
    throw new Illegal("ILLEGAL", `player "${playerId}" already has a character in this run`);
  }

  const character: Character = newCharacter({
    // The run assigns a stable placeholder id; persistence may re-key it when
    // the character is written to the household (architecture §3).
    id: `c_${playerId}`,
    householdId: ctx.householdId ?? "",
    ownerPlayerId: playerId,
    name: intent.name,
    species: intent.species,
    class: intent.class,
    stats: intent.stats,
    appearance: intent.appearance,
    rules: ctx.rules,
    now: ctx.now,
  });

  const resolved = resolveCharacter(character, ctx.rules, ctx.items);
  draft.party.push({
    character: resolved,
    playerId,
    hp: resolved.maxHp,
    down: false,
    connected: true,
    ready: false,
  });
  /*
   * Only the lobby becomes "creation". A late joiner seats mid-chapter, and
   * flipping the whole run to `creation` there would drag every other phone
   * off the scene it is playing — while leaving `sceneId` and the open prompt
   * in place, so the party would be answering a question nothing is showing.
   * Their arrival is their business; the run keeps doing what it was doing.
   */
  if (draft.phase === "lobby") draft.phase = "creation";
  return undefined;
}

function doStartChapter(
  draft: RunState,
  chapterId: string,
  ctx: EngineContext,
): Presentation | undefined {
  const chapter = requireChapter(ctx);
  if (chapter.id !== chapterId) {
    throw new Illegal("NOT_FOUND", `chapter "${chapterId}" is not loaded`);
  }
  if (draft.party.length === 0) {
    throw new Illegal("ILLEGAL", "a chapter needs at least one character");
  }
  /*
   * The UI only offers "Begin the adventure" from a ready lobby, but the UI is
   * not the authority (architecture §4.1). Without these two guards a stale
   * tap — or any hand-rolled client — could restart the chapter from the
   * middle of a scene, resetting flags and XP and throwing away the evening's
   * progress.
   */
  if (draft.phase !== "lobby" && draft.phase !== "creation") {
    throw new Illegal("ILLEGAL", "a chapter starts from the lobby");
  }
  if (!draft.party.every((member) => member.ready)) {
    throw new Illegal("ILLEGAL", "everybody has to be ready first");
  }

  draft.campaignId = chapter.campaignId;
  draft.chapterId = chapter.id;
  draft.xpEarned = 0;
  draft.flags = {};
  draft.lastRoll = null;
  for (const member of draft.party) member.ready = false;

  return enterSceneDraft(draft, chapter.entry, ctx);
}

function currentScene(draft: RunState, ctx: EngineContext): { scene: Scene; sceneId: SceneId } {
  const chapter = requireChapter(ctx);
  if (!draft.sceneId) throw new Illegal("ILLEGAL", "no scene is open");
  return { scene: requireScene(chapter, draft.sceneId), sceneId: draft.sceneId };
}

function doChoose(
  draft: RunState,
  playerId: string,
  choiceId: string,
  ctx: EngineContext,
): Presentation | undefined {
  const prompt = draft.prompt;
  if (!prompt || prompt.kind !== "choice") {
    throw new Illegal("ILLEGAL", "nothing is waiting on a choice");
  }
  if (prompt.forPlayerIds.length > 0 && !prompt.forPlayerIds.includes(playerId)) {
    throw new Illegal("FORBIDDEN", `this choice is not player "${playerId}" to make`);
  }
  if (!prompt.options.some((o) => o.id === choiceId)) {
    // Includes choices hidden by an unmet requirement — the client never showed
    // it, so a request for it is either stale or forged.
    throw new Illegal("ILLEGAL", `"${choiceId}" is not an available choice here`);
  }

  const { scene, sceneId } = currentScene(draft, ctx);
  let winning = choiceId;

  if (prompt.vote) {
    const votes = { ...(prompt.votes ?? {}), [playerId]: choiceId };
    prompt.votes = votes;
    const voters = prompt.forPlayerIds.length > 0
      ? prompt.forPlayerIds
      : draft.party.map((m) => m.playerId);
    const outstanding = voters.filter((id) => votes[id] === undefined);
    if (outstanding.length > 0) {
      return { kind: "CHOICE_MADE", choiceId, byPlayerId: playerId };
    }
    winning = tallyVotes(draft, votes);
  }

  const choice = sceneChoices(scene).find((c) => c.id === winning);
  if (!choice) throw new Illegal("NOT_FOUND", `scene "${sceneId}" has no choice "${winning}"`);

  applyEffectsDraft(draft, choice.effects, ctx);
  const entered = enterSceneDraft(draft, choice.goto, ctx);
  // Only one presentation rides on a transition. Finishing the chapter is a
  // bigger beat than the tap that got you there, so it wins.
  if (entered?.kind === "CHAPTER_COMPLETE") return entered;
  return { kind: "CHOICE_MADE", choiceId: winning, byPlayerId: playerId };
}

/**
 * Most votes wins. Ties break toward the active turn marker (spec §6.1); with
 * no combat turn order outside an encounter, the first player in party order
 * stands in for it — deterministic, and it stops one player steamrolling.
 */
function tallyVotes(draft: RunState, votes: Record<string, string>): string {
  const counts = new Map<string, number>();
  for (const choiceId of Object.values(votes)) {
    counts.set(choiceId, (counts.get(choiceId) ?? 0) + 1);
  }
  let best = 0;
  for (const n of counts.values()) best = Math.max(best, n);
  const tied = [...counts.entries()].filter(([, n]) => n === best).map(([id]) => id);
  if (tied.length === 1) return tied[0] as string;
  for (const member of draft.party) {
    const vote = votes[member.playerId];
    if (vote !== undefined && tied.includes(vote)) return vote;
  }
  return tied[0] as string;
}

function doRoll(draft: RunState, playerId: string, ctx: EngineContext): Presentation | undefined {
  const prompt = draft.prompt;
  if (!prompt || prompt.kind !== "roll") {
    throw new Illegal("ILLEGAL", "nothing is waiting on a roll");
  }
  const roller = memberByCharacter(draft, prompt.characterId);
  if (!roller) throw new Illegal("NOT_FOUND", "the nominated roller has left the run");
  if (roller.playerId !== playerId) {
    throw new Illegal("FORBIDDEN", `it is ${roller.character.name}'s roll`);
  }

  const { scene } = currentScene(draft, ctx);
  if (scene.type !== "check") throw new Illegal("ILLEGAL", "the current scene is not a check");

  // Rolled here, in the engine, on the server. Never in the browser
  // (architecture §4.1).
  const result: DiceRoll = resolveCheck(ctx.rng, {
    characterId: roller.character.id,
    stat: scene.stat,
    mod: roller.character.stats[scene.stat],
    tn: scene.tn,
  });
  draft.lastRoll = result;
  draft.prompt = null;

  // Both outcomes continue the story down different paths (spec §6.1).
  const branch = result.result === "success" ? scene.onSuccess : scene.onFailure;
  takeBranch(draft, branch, ctx, roller.character.id);
  // The dice keep the presentation slot even when the branch ends the chapter:
  // the roll is the centerpiece of the screen (roadmap chapter 3) and the
  // completion is legible from `phase` in the same patch.
  return { kind: "ROLL", roll: result };
}

/**
 * TODO(chapter-4): tactical combat lives in roadmap chapter 4 — grid, turn
 * order, enemy AI, knock-downs, revives. Until then an encounter resolves as an
 * auto-victory placeholder so a chapter can be walked end to end and the rest
 * of the engine can be tested against real content.
 *
 * The `onDefeat` branch is already wired and deliberately left reachable in the
 * schema: a wipe branches the story, it is never a game over (spec §7.3).
 */
function resolveEncounter(draft: RunState, ctx: EngineContext): Presentation | undefined {
  const { scene } = currentScene(draft, ctx);
  if (scene.type !== "encounter") throw new Illegal("ILLEGAL", "no encounter is running");
  for (const member of draft.party) member.ready = false;
  return takeBranch(draft, scene.onVictory, ctx);
}

function doAdvance(draft: RunState, ctx: EngineContext): Presentation | undefined {
  if (draft.phase === "encounter") return resolveEncounter(draft, ctx);
  if (draft.phase === "chapter_complete") {
    /*
     * Back to the lobby. Picking the *next* chapter is roadmap Chapter 5 (it
     * rides on the same commitment machinery as levelling), so there is
     * nowhere else to advance to yet — but the completion screen offers a
     * button, and a button that does nothing is worse than no button. The
     * lobby is somewhere real: the party is intact, everyone re-readies, and
     * the run can start a chapter again.
     */
    draft.phase = "lobby";
    draft.chapterId = null;
    draft.sceneId = null;
    draft.sceneType = null;
    draft.narration = "";
    draft.art = null;
    draft.prompt = null;
    draft.lastRoll = null;
    for (const member of draft.party) member.ready = false;
    return undefined;
  }
  if (draft.prompt) {
    throw new Illegal("ILLEGAL", "the scene is waiting on a decision, not an advance");
  }
  return undefined;
}

function doUseItem(
  draft: RunState,
  playerId: string,
  itemId: string,
  ctx: EngineContext,
): Presentation | undefined {
  const member = memberByPlayer(draft, playerId);
  if (!member) throw new Illegal("NOT_FOUND", `player "${playerId}" is not in this run`);

  const def = ctx.items[itemId];
  if (!def) throw new Illegal("NOT_FOUND", `unknown item "${itemId}"`);
  if (def.kind === "quest") {
    // §9.2 — story keys are never usable in combat or out of it.
    throw new Illegal("ILLEGAL", `"${def.name}" is a quest item; it opens something, somewhere`);
  }
  if (def.effect && def.effect.type !== "heal") {
    // TODO(chapter-4): rollBonus and thrown damage need a target and a combat
    // round to land in. Rejected rather than consumed — losing an item for
    // nothing is worse than not being allowed to use it yet.
    throw new Illegal("ILLEGAL", `"${def.name}" can only be used in an encounter (chapter 4)`);
  }

  const result = useConsumable(member.character.inventory, itemId, ctx.items);
  if (result.status === "not_held") {
    throw new Illegal("NOT_FOUND", `${member.character.name} is not carrying "${itemId}"`);
  }
  if (result.status === "not_consumable") {
    throw new Illegal("ILLEGAL", `"${def.name}" is always on — there is nothing to use`);
  }

  member.character.inventory = result.inventory;
  if (result.effect.type === "heal") {
    heal(member, result.effect.amount);
    return { kind: "HEAL", targetId: member.character.id, amount: result.effect.amount };
  }
  return undefined;
}

function doResolveItemSwap(
  draft: RunState,
  playerId: string,
  dropItemId: string | null,
  ctx: EngineContext,
): Presentation | undefined {
  const prompt = draft.prompt;
  if (!prompt || prompt.kind !== "item_swap") {
    throw new Illegal("ILLEGAL", "no item is waiting on a swap");
  }
  const member = memberByCharacter(draft, prompt.characterId);
  if (!member) throw new Illegal("NOT_FOUND", "the character holding the prompt has left");
  if (member.playerId !== playerId) {
    throw new Illegal("FORBIDDEN", `this is ${member.character.name}'s bag`);
  }

  if (dropItemId !== null) {
    if (!member.character.inventory.some((e) => e.itemId === dropItemId)) {
      throw new Illegal("ILLEGAL", `${member.character.name} is not carrying "${dropItemId}"`);
    }
    member.character.inventory = swapItem(
      member.character.inventory,
      prompt.incomingItemId,
      dropItemId,
      ctx.items,
    );
  }
  // dropItemId === null → "leave it". One decision, no menu (§9.1).

  draft.prompt = null;
  if (draft.sceneId && ctx.chapter) {
    const { scene, sceneId } = currentScene(draft, ctx);
    // Prompts are derived from the scene, so reopening is a recompute. An
    // in-flight vote is the one thing lost, which is why grants land on entry
    // rather than mid-vote.
    const completion = openScenePrompt(draft, scene, sceneId, ctx);
    if (completion) return completion;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Read helpers — used by the client to preview, never to decide
// ---------------------------------------------------------------------------

/** The choices this party can currently see. Hidden, never disabled (§5). */
export function currentChoices(state: RunState, chapter: Chapter): Choice[] {
  if (!state.sceneId) return [];
  const scene = chapter.scenes[state.sceneId];
  if (!scene) return [];
  return visibleChoices(sceneChoices(scene), party(state));
}

/** True when every character is knocked down. Branches the story; never ends it. */
export function isPartyDown(state: RunState): boolean {
  return state.party.length > 0 && state.party.every((m) => m.down);
}
