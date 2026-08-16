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
 *     run unhappily. A chapter *setback* (spec §8.2) is not a counterexample:
 *     it is an authored ending that pays half the award, with no retry, no
 *     losing phase, and the party intact on the other side of it.
 *
 * Tactical combat lives here now (roadmap chapter 4). The board comes from the
 * map the scene names, `encounter.ts` owns the rules, `enemy-ai.ts` drives the
 * monsters, and MOVE / COMBAT_ACTION / END_TURN are the three intents a phone
 * sends. `startEncounter` puts the board up once the party has readied, and
 * `settleEncounter` branches the story on the way out.
 *
 * The ability catalog is authored content (`content/abilities.json`) and
 * consumables work on both sides of the fight line: a heal anywhere, a roll
 * bonus or a thrown item as the turn's one action inside an encounter
 * (spec §7.2's fourth universal action), and either kind still refused where
 * it would do nothing.
 */

import { INVENTORY_SLOTS, MAX_PARTY } from "./types/domain.js";
import type {
  Character,
  ItemCatalog,
  ResolvedCharacter,
  RulesContent,
} from "./types/domain.js";
import type {
  Branch,
  Chapter,
  ChapterOutcome,
  Choice,
  Effect,
  EncounterMap,
  EndingScene,
  Scene,
  SceneId,
} from "./types/chapter.js";
import {
  beginEncounter,
  encounterOutcome,
  endTurn,
  moveTo,
  performAction,
  currentActor,
  currentActorId,
  legalActions,
  useItemInCombat,
  type AbilityCatalog,
  type CombatActionRequest,
  type EncounterState,
  type EncounterEvent,
  type EnemyPlacement,
  type PartyPlacement,
} from "./encounter.js";
import { parseBoard, type Position } from "./grid.js";
import { planEnemyTurn } from "./enemy-ai.js";
import type {
  DiceRoll,
  EarnedBonus,
  PartyMember,
  Prompt,
  RoomMode,
  RunState,
  TradeOffer,
} from "./types/state.js";
import type { ClientIntent, Presentation } from "./types/protocol.js";
import type { Rng } from "./dice.js";
import { resolveCheck } from "./dice.js";
import { newCharacter, resolveCharacter } from "./character.js";
import { tierForLevel } from "./rules.js";
import { addItem, addQuestItem, freeSlots, hasItem, removeItem, swapItem, useConsumable } from "./inventory.js";
import { sceneChoices, visibleChoices } from "./chapter-graph.js";

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

/**
 * A hard stop on the enemy-turn loop. Four rounds of at most four monsters is
 * sixteen; sixty is far past anything a real fight reaches and still finite, so
 * a bug in a plan cannot freeze the board with everybody watching.
 */
const MAX_ENEMY_TURNS = 60;

/** §7.2's Attack, the only ability a monster uses. */
const ATTACK_ABILITY = "attack";

export interface EngineContext {
  rules: RulesContent;
  items: ItemCatalog;
  /** The chapter in play. Null in the lobby and during character creation. */
  chapter?: Chapter | null;
  /**
   * The board an encounter scene names, by id. A lookup rather than a value
   * because a chapter can hold several fights, and the engine should not have
   * to be handed every map a chapter might reach.
   */
  map?: (id: string) => EncounterMap | null;
  /**
   * Combat abilities, by id. Authored content like the item catalog. Attack,
   * Help Up and Ready are built into `encounter.ts` and need no entry, so an
   * empty catalog still gives a playable fight — which is what lets combat land
   * before the ability content does.
   */
  abilities?: AbilityCatalog;
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
  /**
   * The unresolved `Character` built by CREATE_CHARACTER, for the persistence
   * layer to store.
   *
   * It has to travel beside the state rather than in it for the same reason
   * `completeChapter` defers `awardXp`: `RunState.party` holds **resolved**
   * characters, and a resolved character cannot be turned back into the one it
   * came from. The species passive is already folded into its stats, so saving
   * it as `committed` and resolving again would apply the passive twice — a
   * unicorn permanently a point of Heart better than she should be, with
   * nothing on screen to say so.
   */
  created?: Character;
}

/**
 * The out-channel for things persistence needs and `RunState` cannot carry.
 * Mutable, created per intent, and read only by the handler that applies it.
 */
interface EngineEffects {
  created?: Character;
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
    chapterOutcome: null,
    bonuses: [],
    trades: [],
    updatedAt: input.now,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * RunState is plain JSON by construction (it ships over the wire as one), so a
 * structured clone is a correct and dependency-free deep clone. Every exported
 * entry point clones once and mutates a draft; nothing observable is shared.
 * `structuredClone` rather than a JSON round trip: same semantics for a
 * JSON-only document, without serializing the whole encounter to a string and
 * back on every single tap.
 */
function draftOf(state: RunState): RunState {
  return structuredClone(state);
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
  return members.find((m) => m.character.inventory.length < INVENTORY_SLOTS) ?? members[0];
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

/**
 * Pays the chapter's bonus objectives, and returns them itemised.
 *
 * An objective is met when the flag it watches is set at the moment the chapter
 * completes (spec §8.2). It deliberately reuses the flag machinery the whole
 * chapter format already runs on, so "the party did the thing" has exactly one
 * spelling: `setFlag` wherever it happens, and an objective pointed at it.
 *
 * `!== true` rather than a truthiness test, because `setFlag` can carry
 * `value: false` — an author who explicitly *unsets* a flag later in the
 * chapter (the shrine you found and then lost) means the objective is not met,
 * and `flags[f]` being `false` must not read as met.
 *
 * The 25% ceiling is the same one tools/content/validate.mjs enforces at build
 * time, applied again here on purpose. Validation stops a malformed chapter
 * reaching the repo; this stops one that is already at the table — hand-edited
 * content, or a chapter served from cache after the cap changed — from
 * quietly distorting the pacing that spec §8.1 promises. The budget is shared
 * across every objective, not granted per objective, because four objectives
 * each paying a quarter would pay the whole award again.
 */
function awardObjectives(draft: RunState, chapter: Chapter): EarnedBonus[] {
  let budget = Math.floor(chapter.xpAward * 0.25);
  const earned: EarnedBonus[] = [];
  for (const objective of chapter.objectives ?? []) {
    if (draft.flags[objective.flag] !== true) continue;
    // Clamped, and still recorded even if the clamp takes it to nothing: the
    // party *did* the thing, and a completion screen that silently dropped it
    // would be lying about the evening. Only unvalidated content gets here.
    const xp = Math.max(0, Math.min(objective.xp, budget));
    budget -= xp;
    draft.xpEarned += xp;
    earned.push({ id: objective.id, label: objective.label, xp });
  }
  return earned;
}

function completeChapter(draft: RunState, scene: EndingScene, ctx: EngineContext): Presentation {
  const chapter = requireChapter(ctx);
  // Absent means success (spec §8.2). Every chapter authored before setbacks
  // existed ends successfully, and none of them should need editing to say so.
  const outcome: ChapterOutcome = scene.outcome ?? "success";

  draft.phase = "chapter_complete";
  draft.prompt = null;
  draft.chapterOutcome = outcome;

  // XP is per chapter, not per kill (spec §8.1). The engine only *records* it;
  // folding it into a character's provisional progress is the persistence
  // layer's job via character.awardXp(), because RunState holds resolved
  // characters and cannot express the committed/provisional split.
  //
  // A setback pays half, rounded down, rather than nothing (§8.2). That is the
  // whole point of the number: a family that hits two setbacks should fall
  // behind the pacing, not off it.
  draft.xpEarned += outcome === "setback" ? Math.floor(chapter.xpAward / 2) : chapter.xpAward;
  // Objectives pay on a setback too. §8.2 defines them by what the party did on
  // the way ("find the hidden shrine, finish with nobody knocked down"), not by
  // which ending they arrived at — and the evening a chapter goes wrong is the
  // worst one to also take away what did go right.
  draft.bonuses = awardObjectives(draft, chapter);

  return { kind: "CHAPTER_COMPLETE", chapterId: chapter.id, xp: draft.xpEarned, outcome };
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
        // A scene with no way out is the chapter's ending (see chapter-graph),
        // and a chapter may have several — which is why the scene, not the
        // chapter, says whether this one is a success or a setback (§8.2).
        return completeChapter(draft, scene, ctx);
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
      if (scene.autoResolve === "victory") {
        /*
         * The chapter-4 gate (types/chapter.ts). No phone can play a fight yet,
         * so a gated encounter flows through its victory branch the way the
         * old placeholder did — with the scene's own narration kept in front
         * of the branch's, so the beat still reads even though the board
         * never goes up.
         */
        const narration = [scene.narration, scene.onVictory.narration]
          .filter(Boolean)
          .join("\n\n");
        return takeBranch(
          draft,
          { ...scene.onVictory, ...(narration ? { narration } : {}) },
          ctx,
        );
      }
      // An encounter waits on a ready-up before the board goes up. That pause
      // is deliberate: three phones have to swap to a combat UI, and a fight
      // beginning around somebody still on their character sheet would have
      // their figure taking damage before they had looked up.
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
  /*
   * Offers do not travel (spec §9.4 — trading is a Rest-scene thing). An
   * unanswered offer left standing would be acceptable two scenes later in the
   * middle of a fight, which is the one place §7.2 says the bag is not open.
   * Unlike the swap prompt above there is nothing to carry: nothing has left
   * anybody's bag, so dropping the offer costs the party nothing.
   */
  draft.trades = [];
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
  const effects: EngineEffects = {};
  try {
    const presentation = dispatch(draft, envelope, ctx, effects);
    pruneTrades(draft);
    touch(draft, ctx);
    return {
      state: draft,
      ...(presentation ? { presentation } : {}),
      ...(effects.created ? { created: effects.created } : {}),
    };
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
  effects: EngineEffects,
): Presentation | undefined {
  const { playerId, intent } = envelope;
  switch (intent.type) {
    case "MOVE":
      return doCombatMove(draft, playerId, intent.to, ctx);

    case "COMBAT_ACTION":
      return doCombatAction(draft, playerId, intent, ctx);

    case "END_TURN":
      return doEndTurn(draft, playerId, ctx);

    case "SET_MODE":
      // Layout only (architecture §4.6). Legal at any point — the laptop dying
      // mid-encounter is exactly when you need it.
      draft.mode = intent.mode;
      return undefined;

    case "READY":
      return doReady(draft, playerId, intent.ready, ctx);

    case "CREATE_CHARACTER":
      return doCreateCharacter(draft, playerId, intent, ctx, effects);

    case "START_CHAPTER":
      return doStartChapter(draft, intent.chapterId, ctx);

    case "CHOOSE":
      return doChoose(draft, playerId, intent.choiceId, ctx);

    case "ROLL":
      return doRoll(draft, playerId, ctx);

    case "ADVANCE":
      return doAdvance(draft, ctx);

    case "USE_ITEM":
      return doUseItem(draft, playerId, intent.itemId, intent.targetId ?? null, ctx);

    case "RESOLVE_ITEM_SWAP":
      return doResolveItemSwap(draft, playerId, intent.dropItemId, ctx);

    case "OFFER_ITEM":
      return doOfferItem(draft, playerId, intent.itemId, intent.toPlayerId, ctx);

    case "RESOLVE_TRADE":
      return doResolveTrade(draft, playerId, intent.tradeId, intent.accept, intent.dropItemId, ctx);

    case "SPEND_STAT_POINT":
      throw new Illegal("ILLEGAL", "stat points are spent through the authoritative run handler");
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
    // Capture the board identity before settlement can branch away from the
    // encounter scene. Opening monster turns are part of this presentation,
    // not invisible mutations hidden inside its patch.
    const events = startEncounter(draft, ctx);
    const mapId = encounterMapId(draft, ctx);
    const firstActorId = draft.encounter ? currentActorId(draft.encounter) : null;
    const after = settleEncounter(draft, ctx);
    return {
      kind: "ENCOUNTER_BEGAN",
      mapId,
      firstActorId,
      ...(events.length > 0 ? { events } : {}),
      ...(after ? { after } : {}),
    };
  }
  return undefined;
}

function doCreateCharacter(
  draft: RunState,
  playerId: string,
  intent: Extract<ClientIntent, { type: "CREATE_CHARACTER" }>,
  ctx: EngineContext,
  effects: EngineEffects,
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

  /*
   * A ceiling, because nothing else is one. Every map budgets `partySpawns`
   * against this number (the content validator holds them to it), so a party
   * that outgrows it reaches an encounter it cannot start. The table this game
   * is built for seats three; six is "the cousins are visiting", not a raid.
   */
  if (draft.party.length >= MAX_PARTY) {
    throw new Illegal("ILLEGAL", `the party is full (${MAX_PARTY})`);
  }

  /*
   * `startingLevel` arrives from a phone and buys levels, actions and stat
   * points outright (spec §8.4), so it is checked against *this party* and not
   * merely against the tier floors the rules define. `newCharacter` enforces
   * "1 or a tier floor"; only the engine can enforce "and not a floor above the
   * people you are sitting down with", because only the engine has the party.
   *
   * Without this, a hand-written client in a level-1 party could ask for 10 and
   * get it — the joining rule is a convenience for a friend at the table, and a
   * convenience that hands out nine free stat points is a different feature.
   */
  const joinCap = partyTierFloor(draft, ctx);
  if (intent.startingLevel !== undefined && intent.startingLevel > joinCap) {
    throw new Illegal(
      "ILLEGAL",
      `startingLevel ${intent.startingLevel} is above this party's tier floor (${joinCap})`,
    );
  }

  const character: Character = newCharacter({
    /*
     * Scoped to the run, not just the player. `c_<playerId>` alone repeats for
     * every character that player ever makes, so a second hero in a later
     * campaign would collide with the first: the store would skip the write as
     * already-present, and the next chapter completion would load the *old*
     * character and quietly swap it into the party. Including the run id keeps
     * it unique while staying derived rather than random — the engine is pure
     * and a replay has to rebuild the same id (architecture §4.1).
     */
    id: `c_${draft.runId}_${playerId}`,
    householdId: ctx.householdId ?? "",
    ownerPlayerId: playerId,
    name: intent.name,
    species: intent.species,
    class: intent.class,
    stats: intent.stats,
    appearance: intent.appearance,
    // A late joiner seats at the party's tier floor rather than level 1, so a
    // friend who sits down in campaign three is playable rather than a
    // passenger (spec §8.4). `newCharacter` rejects anything that is not 1 or
    // a tier floor, so an arbitrary number from a phone cannot buy levels.
    ...(intent.startingLevel === undefined ? {} : { startingLevel: intent.startingLevel }),
    rules: ctx.rules,
    now: ctx.now,
  });

  // The persistence layer needs the unresolved character; `draft.party` is
  // about to hold only the resolved view of it. See `EngineResult.created`.
  effects.created = character;

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

/**
 * The highest level a newcomer may join at: the tier floor of the strongest
 * character already in the party, or 1 when nobody is here yet (spec §8.4).
 *
 * The *floor* rather than the party's actual level, deliberately — joining a
 * party of level-9 Radiants seats you at 7, with two levels still ahead of you
 * and the Mythic transformation yours to earn.
 */
function partyTierFloor(draft: RunState, ctx: EngineContext): number {
  if (draft.party.length === 0) return 1;
  // `committedLevel`, not `level`. The effective level includes gains from the
  // campaign in flight, and those can still be given back — capping on them
  // would let a newcomer bank a tier the party has not actually kept yet.
  const highest = Math.max(...draft.party.map((m) => m.character.committedLevel));
  return ctx.rules.tierLevels[tierForLevel(ctx.rules, highest)] ?? 1;
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
  // Cleared with the XP they belong to. Left behind, the previous chapter's
  // setback and its bonus list would still be on the state the moment this one
  // starts, so a phone that renders from `chapterOutcome` would open the
  // evening's second chapter under the first one's ending banner.
  draft.chapterOutcome = null;
  draft.bonuses = [];
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
    /*
     * A vote a disconnected player has not cast is not outstanding. The
     * ready-gate already tolerates absence (`m.ready || !m.connected`) for
     * exactly this reason; a vote that did not was a deadlock — one phone dies
     * mid-vote and the chapter waits forever on a tap that can never come.
     * Their vote still counts if it landed before the disconnect.
     */
    const outstanding = voters.filter((id) => {
      if (votes[id] !== undefined) return false;
      const member = draft.party.find((m) => m.playerId === id);
      return member ? member.connected : false;
    });
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
 * Combat proper: the board from `grid.ts`, the rules from `encounter.ts`, the
 * monsters from `enemy-ai.ts`. `startEncounter` sets it up, the three combat
 * intents drive it, and `settleEncounter` branches the story on the way out —
 * victory to `onVictory`, a wipe to `onDefeat`, and never to a game over.
 *
 * The `onDefeat` branch is already wired and deliberately left reachable in the
 * schema: a wipe branches the story, it is never a game over (spec §7.3).
 */
/**
 * Sets a fight up on the board the scene names.
 *
 * The party arrives as it is — hurt, and possibly with somebody already down
 * (`PartyPlacement` carries hp and down for exactly this). A chapter that beat
 * you up before the fight is a chapter you go into the fight beaten up.
 *
 * `EnemySpec.count` is flattened against the map's spawn points in order,
 * because the spec says how many and the map says where. More figures than
 * spawn points is an authoring error the content validator already refuses, so
 * running out here means the deployed bundle and the deployed content disagree.
 */
function startEncounter(draft: RunState, ctx: EngineContext): readonly EncounterEvent[] {
  const { scene } = currentScene(draft, ctx);
  if (scene.type !== "encounter") throw new Illegal("ILLEGAL", "not on an encounter scene");

  const map = ctx.map?.(scene.map) ?? null;
  if (!map) throw new Illegal("NOT_FOUND", `map "${scene.map}" is not loaded`);

  const party: PartyPlacement[] = draft.party.map((member, i) => {
    /*
     * No modulo. Wrapping member 4 onto spawn 0 read as graceful and was the
     * opposite: two figures on one tile is a state `placeActor` refuses with a
     * plain `Error`, which escapes `applyIntent`'s Illegal-only catch as a 500
     * — and then does so again on every retry, so a 5th phone joining before
     * READY bricked the chapter with no in-game recovery. Refusing the fight
     * loudly here keeps it a visible error a table can react to.
     */
    const at = map.partySpawns[i];
    if (!at) {
      throw new Illegal(
        "ILLEGAL",
        `map "${map.id}" has ${map.partySpawns.length} party spawns, the party is ${draft.party.length}`,
      );
    }
    return { character: member.character, at, hp: member.hp, down: member.down };
  });

  const enemies: EnemyPlacement[] = [];
  for (const spec of scene.enemies) {
    for (let n = 0; n < spec.count; n++) {
      const at = map.enemySpawns[enemies.length];
      if (!at) {
        throw new Illegal(
          "ILLEGAL",
          `map "${map.id}" has ${map.enemySpawns.length} enemy spawns, the scene wants more`,
        );
      }
      enemies.push({ spec, at });
    }
  }

  draft.encounter = beginEncounter(
    { board: parseBoard(map.rows), party, enemies },
    combatCtx(ctx),
  );
  // Whoever the initiative roll put first might be a monster, so the fight has
  // to be walked forward before anybody's phone is asked for anything.
  return runEnemyTurns(draft, ctx);
}

/**
 * The figure whose turn it is, if this player owns it.
 *
 * Every combat intent goes through here, and it is the whole authority check:
 * a phone may only ever act as the character it owns, on that character's turn.
 * Without it, any player could drive anybody's figure — including a monster's.
 */
function requireTurn(draft: RunState, playerId: string): EncounterState {
  const encounter = draft.encounter;
  if (!encounter) throw new Illegal("ILLEGAL", "there is no fight going on");
  const actor = currentActor(encounter);
  if (!actor) throw new Illegal("ILLEGAL", "nobody can act");
  if (actor.side !== "party") throw new Illegal("FORBIDDEN", "it is not your turn");

  const member = draft.party.find((m) => m.character.id === actor.id);
  if (!member) throw new Illegal("ILLEGAL", `no party member for actor "${actor.id}"`);
  if (member.playerId !== playerId) {
    throw new Illegal("FORBIDDEN", `it is ${member.character.name}'s turn, not yours`);
  }
  return encounter;
}

function doCombatMove(
  draft: RunState,
  playerId: string,
  to: Position,
  _ctx: EngineContext,
): Presentation | undefined {
  const encounter = requireTurn(draft, playerId);
  const result = moveTo(encounter, to);
  // A refusal is a stale phone, not a cheat: the highlight it tapped was drawn
  // from a board that has since moved on. Say so and let it resync.
  if (!result.ok) throw new Illegal("ILLEGAL", result.reason);
  draft.encounter = result.state;
  return combatPresentation(result.events);
}

function doCombatAction(
  draft: RunState,
  playerId: string,
  intent: Extract<ClientIntent, { type: "COMBAT_ACTION" }>,
  ctx: EngineContext,
): Presentation | undefined {
  const encounter = requireTurn(draft, playerId);
  const request: CombatActionRequest = {
    abilityId: intent.abilityId,
    ...(intent.targetId ? { targetId: intent.targetId } : {}),
    ...(intent.targetTile ? { targetTile: intent.targetTile } : {}),
    ...(intent.targetIds ? { targetIds: intent.targetIds } : {}),
    ...(intent.targetTiles ? { targetTiles: intent.targetTiles } : {}),
  };
  const result = performAction(encounter, combatCtx(ctx), request);
  if (!result.ok) throw new Illegal("ILLEGAL", result.reason);
  draft.encounter = result.state;
  // The fight may have just ended on that swing. The branch waits behind
  // the ordered roll/damage/down events rather than replacing them.
  return combatPresentation(result.events, settleEncounter(draft, ctx));
}

function doEndTurn(draft: RunState, playerId: string, ctx: EngineContext): Presentation | undefined {
  const encounter = requireTurn(draft, playerId);
  draft.encounter = endTurn(encounter);
  // Handing over may hand over to a monster, and monsters do not wait to be
  // asked. Their entire run is one ordered animation queue.
  const events = runEnemyTurns(draft, ctx);
  return combatPresentation(events, settleEncounter(draft, ctx));
}

/** The slice of `EngineContext` a combat call needs. */
function combatCtx(ctx: EngineContext) {
  return { rules: ctx.rules, abilities: ctx.abilities ?? {}, rng: ctx.rng };
}

/** Keeps combat spectacle ordered without making it authoritative state. */
function combatPresentation(
  events: readonly EncounterEvent[],
  after?: Presentation,
): Presentation | undefined {
  if (events.length === 0) return after;
  return {
    kind: "COMBAT_SEQUENCE",
    events,
    ...(after ? { after } : {}),
  };
}

/**
 * Plays every consecutive enemy turn, stopping the moment it is a player's turn
 * again or the fight is over.
 *
 * The server drives monsters rather than waiting to be asked, because there is
 * nobody to ask: a monster has no phone. The whole run of them lands in one
 * patch, which is also what the client wants — three wisps moving is one
 * animation queue, not three round trips.
 *
 * Bounded rather than looped to exhaustion. A plan that somehow fails to end a
 * turn would otherwise spin here forever with the table watching a frozen
 * board; a cap turns that into a fight that carries on slightly wrong.
 */
function runEnemyTurns(draft: RunState, ctx: EngineContext): readonly EncounterEvent[] {
  let encounter = draft.encounter;
  const events: EncounterEvent[] = [];
  if (!encounter) return events;

  for (let guard = 0; guard < MAX_ENEMY_TURNS; guard++) {
    if (encounterOutcome(encounter) !== "ongoing") break;
    const actor = currentActor(encounter);
    if (!actor || actor.side !== "enemy") break;

    const plan = planEnemyTurn({
      board: encounter.board,
      // `stepsLeft`, not the spec's allowance: a Tanglelit monster starts its
      // turn with zero steps, and a plan drawn against the full budget would
      // walk to a tile `moveTo` then refuses — and swing at a hero it never
      // actually reached.
      enemy: { id: actor.id, at: positionOfActor(encounter, actor.id), steps: encounter.stepsLeft },
      party: encounter.combatants
        .filter((c) => c.side === "party")
        .map((c) => ({
          id: c.id,
          at: positionOfActor(encounter!, c.id),
          hp: c.hp,
          maxHp: c.maxHp,
          down: c.down,
        })),
    });

    if (plan.moveTo) {
      const moved = moveTo(encounter, plan.moveTo);
      // A refusal is the AI and the grid disagreeing, which is a bug rather
      // than a decision — but it must not strand the turn.
      if (moved.ok) {
        encounter = moved.state;
        events.push(...moved.events);
      }
    }
    if (plan.attack) {
      const swung = performAction(encounter, combatCtx(ctx), {
        abilityId: ATTACK_ABILITY,
        targetId: plan.attack,
      });
      if (swung.ok) {
        encounter = swung.state;
        events.push(...swung.events);
      }
    }
    encounter = endTurn(encounter);
  }

  draft.encounter = encounter;
  return events;
}

/** The map the scene in play names. Only called where the scene is an encounter. */
function encounterMapId(draft: RunState, ctx: EngineContext): string {
  const { scene } = currentScene(draft, ctx);
  return scene.type === "encounter" ? scene.map : "";
}

function positionOfActor(encounter: EncounterState, id: string): Position {
  const actor = encounter.board.actors.find((a) => a.id === id);
  if (!actor) throw new Illegal("ILLEGAL", `actor "${id}" is not on the board`);
  return { x: actor.x, y: actor.y };
}

/**
 * Ends the fight if it is over, branching the story either way.
 *
 * **A wipe is not a game over** (spec §7.3, and the header): it takes
 * `onDefeat`, which is an authored scene like any other, and the party carries
 * on from there. There is deliberately no losing phase for this to put the run
 * into.
 */
function settleEncounter(draft: RunState, ctx: EngineContext): Presentation | undefined {
  const encounter = draft.encounter;
  if (!encounter) return undefined;
  const outcome = encounterOutcome(encounter);
  if (outcome === "ongoing") return undefined;

  // Carry the damage out with them. A fight that cost her six hit points is a
  // fight she is still six hit points down from at the next scene.
  for (const member of draft.party) {
    const combatant = encounter.combatants.find((c) => c.id === member.character.id);
    if (!combatant) continue;
    member.hp = combatant.hp;
    member.down = combatant.down;
    member.ready = false;
  }

  const { scene } = currentScene(draft, ctx);
  if (scene.type !== "encounter") throw new Illegal("ILLEGAL", "no encounter is running");
  draft.encounter = null;
  return takeBranch(draft, outcome === "victory" ? scene.onVictory : scene.onDefeat, ctx);
}

function doAdvance(draft: RunState, ctx: EngineContext): Presentation | undefined {
  if (draft.phase === "encounter") {
    // ADVANCE is the "next" button, and during a fight there is nothing to
    // advance to — the turn order decides what happens next, not a tap. The one
    // exception is a fight that has already finished and is waiting to be
    // cleared, which `settleEncounter` handles.
    const settled = settleEncounter(draft, ctx);
    if (settled) return settled;
    throw new Illegal("ILLEGAL", "the fight is still going — take your turn");
  }
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
  targetId: string | null,
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

  if (draft.encounter) {
    /*
     * §7.2's fourth universal action: using an item in a fight is your turn's
     * one action. `requireTurn` is the same authority check every combat
     * intent passes — only the active figure's own phone may spend it.
     *
     * Validate first, consume second. `useItemInCombat` refuses a spent
     * action or an illegal throw *before* the bag changes, so a refusal
     * never costs the item — the same "lost it for nothing is worse" rule
     * the out-of-combat path has always had.
     */
    const encounter = requireTurn(draft, playerId);
    const held = useConsumable(member.character.inventory, itemId, ctx.items);
    if (held.status === "not_held") {
      throw new Illegal("NOT_FOUND", `${member.character.name} is not carrying "${itemId}"`);
    }
    if (held.status === "not_consumable") {
      throw new Illegal("ILLEGAL", `"${def.name}" is always on — there is nothing to use`);
    }
    const applied = useItemInCombat(encounter, {
      actorId: member.character.id,
      effect: held.effect,
      ...(targetId ? { targetId } : {}),
    });
    if (!applied.ok) throw new Illegal("ILLEGAL", applied.reason);

    member.character.inventory = held.inventory;
    draft.encounter = applied.state;
    // The throw may have felled the last wisp; the branch waits behind the
    // damage beats, exactly as it does for an attack.
    return combatPresentation(applied.events, settleEncounter(draft, ctx));
  }

  if (def.effect && def.effect.type !== "heal") {
    /*
     * A combat-only item outside a fight. `rollBonus` and thrown damage need a
     * target and a round to land in, and both live in `encounter.ts` — out
     * here there is nothing to apply them to.
     *
     * Rejected rather than consumed: losing an item for nothing is worse than
     * being told you cannot use it yet.
     */
    throw new Illegal("ILLEGAL", `"${def.name}" can only be used in a fight`);
  }

  const result = useConsumable(member.character.inventory, itemId, ctx.items);
  if (result.status === "not_held") {
    throw new Illegal("NOT_FOUND", `${member.character.name} is not carrying "${itemId}"`);
  }
  if (result.status === "not_consumable") {
    throw new Illegal("ILLEGAL", `"${def.name}" is always on — there is nothing to use`);
  }

  // The same no-op rule the combat path enforces, in the same order
  // (useItemInCombat: held-ness first, then the refusal, consume last): a use
  // that would change nothing is refused, never absorbed. Assigning the
  // reduced inventory and healing zero destroyed the potion for nothing — the
  // exact failure the "rejected rather than consumed" comment above promises
  // against.
  if (result.effect.type === "heal" && member.hp >= member.character.maxHp) {
    throw new Illegal("ILLEGAL", "already at full health");
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
// Trading — spec §9.4
// ---------------------------------------------------------------------------

/** Stable across a replay of the event log; see `TradeOffer.id`. */
function tradeId(fromPlayerId: string, toPlayerId: string, itemId: string): string {
  return `t:${fromPlayerId}>${toPlayerId}:${itemId}`;
}

/**
 * Drops every offer whose giver is no longer holding the thing.
 *
 * Runs after *every* intent rather than at the two or three call sites that
 * happen to empty a bag today, and that placement is the whole point: a bag
 * changes under a standing offer in more ways than trading knows about — the
 * potion gets drunk, a swap prompt drops it to make room for a grant, a later
 * feature moves it somewhere nobody here has thought of. Pruning at the seam
 * means an offer cannot outlive its item whatever did the emptying.
 *
 * It also cannot be done from the refusal path instead. `applyIntent` returns
 * the *original* state when a handler throws, so an offer dropped on the way
 * out of a rejected accept is dropped into a discarded draft: the receiver's
 * phone would go on showing a gift that is not there, refusing every tap.
 * Removing it here means they never get the chance to tap it.
 */
function pruneTrades(draft: RunState): void {
  const trades = draft.trades ?? [];
  if (trades.length === 0) return;
  draft.trades = trades.filter((offer) => {
    const from = memberByPlayer(draft, offer.fromPlayerId);
    return (
      from !== undefined &&
      memberByPlayer(draft, offer.toPlayerId) !== undefined &&
      hasItem(from.character.inventory, offer.itemId)
    );
  });
}

/**
 * The one gate both trade intents share, and the same one `prepareStatPointSpend`
 * applies to a banked point: a Rest scene, with the run still in play.
 *
 * Not merely a UI convention. Passing an item mid-fight would move a
 * consumable across an open turn order — the thrower and the holder are
 * different figures with different turns — and mid-story it would put a bag in
 * front of an unanswered question.
 */
function requireRestScene(draft: RunState, what: string): void {
  if (draft.phase !== "scene" || draft.sceneType !== "rest") {
    throw new Illegal("ILLEGAL", `${what} only at a Rest scene`);
  }
}

function doOfferItem(
  draft: RunState,
  playerId: string,
  itemId: string,
  toPlayerId: string,
  ctx: EngineContext,
): Presentation | undefined {
  requireRestScene(draft, "items are passed around");

  const from = memberByPlayer(draft, playerId);
  if (!from) throw new Illegal("NOT_FOUND", `player "${playerId}" is not in this run`);
  const to = memberByPlayer(draft, toPlayerId);
  if (!to) throw new Illegal("NOT_FOUND", `player "${toPlayerId}" is not in this run`);
  if (to.playerId === from.playerId) {
    throw new Illegal("ILLEGAL", "you already have it");
  }

  const def = ctx.items[itemId];
  if (!def) throw new Illegal("NOT_FOUND", `unknown item "${itemId}"`);
  /*
   * §9.2 — a quest item costs no slot and `itemMatches` is satisfied by
   * *anyone* in the party, so handing a story key across the table can never
   * unlock a choice that was not already open. There is nothing to trade for,
   * and the same refusal `doUseItem` gives is the honest answer here.
   */
  if (def.kind === "quest") {
    throw new Illegal("ILLEGAL", `"${def.name}" belongs to the whole party's story`);
  }
  if (!hasItem(from.character.inventory, itemId)) {
    throw new Illegal("NOT_FOUND", `${from.character.name} is not carrying "${itemId}"`);
  }
  /*
   * A full bag is deliberately *not* a refusal here. It is the case §9.1
   * already has an answer for — "keep it and drop one, or leave it" — and the
   * receiver answers it on the accept, in the same shape she already knows
   * from finding something with six slots full. Hiding the offer instead would
   * teach a second, worse answer ("that name is just not there") for a
   * situation the game has already taught her once.
   */

  const id = tradeId(from.playerId, to.playerId, itemId);
  const trades = draft.trades ?? [];
  if (trades.some((offer) => offer.id === id)) {
    // A second tap on the same button, or two phones racing. Loud rather than
    // silent: two identical offers would need two answers to clear one item.
    throw new Illegal("ILLEGAL", `${to.character.name} already has that offer`);
  }

  draft.trades = [...trades, { id, fromPlayerId: from.playerId, toPlayerId: to.playerId, itemId }];
  return undefined;
}

function doResolveTrade(
  draft: RunState,
  playerId: string,
  id: string,
  accept: boolean,
  dropItemId: string | undefined,
  ctx: EngineContext,
): Presentation | undefined {
  requireRestScene(draft, "items are passed around");

  const trades = draft.trades ?? [];
  const offer = trades.find((candidate) => candidate.id === id);
  if (!offer) throw new Illegal("NOT_FOUND", "that offer is no longer on the table");

  if (!accept) {
    // Declining and taking it back are the same event from opposite ends, and
    // both are always allowed: nothing has moved, so nothing is at stake.
    if (playerId !== offer.toPlayerId && playerId !== offer.fromPlayerId) {
      throw new Illegal("FORBIDDEN", "that offer is between two other people");
    }
    draft.trades = (draft.trades ?? []).filter((candidate) => candidate.id !== offer.id);
    return undefined;
  }

  if (playerId !== offer.toPlayerId) {
    throw new Illegal("FORBIDDEN", "only the person being offered it can take it");
  }

  const from = memberByPlayer(draft, offer.fromPlayerId);
  const to = memberByPlayer(draft, offer.toPlayerId);
  /*
   * Both of these are belt-and-braces: `pruneTrades` has already removed any
   * offer whose giver has left or is no longer holding the thing, so a stale
   * offer is gone from the receiver's phone before they can tap it rather than
   * refused after. They stay because this function must not depend on a
   * caller's housekeeping to avoid taking an item out of a bag that no longer
   * has it — the failure that puts an item in nobody's hands.
   */
  if (!from || !to) {
    throw new Illegal("NOT_FOUND", "one of them has left the party");
  }
  if (!hasItem(from.character.inventory, offer.itemId)) {
    throw new Illegal("NOT_FOUND", `${from.character.name} does not have it any more`);
  }
  /*
   * The receiver's room is settled here and nowhere else, because it is the
   * one thing that genuinely moves between the offer and the tap — she may
   * have taken somebody else's offer into her last slot since this arrived.
   *
   * Six slots full is §9.1's question, and it is answered in this same intent:
   * `dropItemId` names what goes down. Splitting it into a second prompt would
   * leave the item in limbo — off the giver, not yet on her — for as long as
   * the prompt stood.
   */
  const full = freeSlots(to.character.inventory) === 0;
  if (full && dropItemId === undefined) {
    throw new Illegal("ILLEGAL", `${to.character.name}'s bag is full — something has to go down`);
  }
  if (dropItemId !== undefined && !hasItem(to.character.inventory, dropItemId)) {
    throw new Illegal("ILLEGAL", `${to.character.name} is not carrying "${dropItemId}"`);
  }

  /*
   * The giver's side is the same either way, and it happens *after* both
   * refusals above: a hand-off that cannot complete must not have already
   * emptied one bag. That is the one failure this whole design exists to make
   * impossible — an item in nobody's hands.
   */
  const received =
    dropItemId === undefined
      ? addItem(to.character.inventory, offer.itemId, ctx.items)
      : { status: "added" as const, inventory: swapItem(to.character.inventory, offer.itemId, dropItemId, ctx.items) };
  /*
   * `needs_swap` is unreachable — a full bag has already been sent down the
   * `swapItem` branch — and `quest` is unreachable because the offer refused a
   * quest item. Neither is silently tolerated: falling through on either would
   * lose the item having already taken it off the giver.
   */
  if (received.status !== "added") {
    throw new Illegal("ILLEGAL", "that cannot be handed over");
  }
  from.character.inventory = removeItem(from.character.inventory, offer.itemId);
  to.character.inventory = received.inventory;

  /*
   * Every other offer of this item from this giver dies with it — they only
   * had the one. Leaving them up would show two people a gift that one tap
   * already spent, and the loser would find out by being refused.
   */
  draft.trades = (draft.trades ?? []).filter(
    (candidate) =>
      !(candidate.fromPlayerId === offer.fromPlayerId && candidate.itemId === offer.itemId),
  );
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
