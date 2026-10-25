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
import { balanceReady, interactionActor, playbackMs, playReady, precisionSuccess, relayHolder, supportsReady, trackedCover, SUPPORT_LEASE_MS } from "./interactions.js";
import type {
  Character,
  ClassDef,
  ClassId,
  InventoryEntry,
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
  NarrationVariant,
  RiftBehavior,
  Scene,
  SceneId,
} from "./types/chapter.js";
import {
  beginEncounter,
  encounterOutcome,
  endTurnWithEvents,
  moveTo,
  performAction,
  currentActor,
  currentActorId,
  legalActions,
  legalMoves,
  useItemInCombat,
  type AbilityCatalog,
  type CombatActionRequest,
  type EncounterState,
  type EncounterEvent,
  type EncounterOutcome,
  type EnemyPlacement,
  type PartyPlacement,
} from "./encounter.js";
import { captiveStatuses, captivesOf, objectivesDone, outcomeBranch, resolveEnvironment } from "./environment.js";
import { parseBoard, type Position } from "./grid.js";
import { planEnemyTurn } from "./enemy-ai.js";
import type {
  CampaignView,
  DiceRoll,
  EarnedBonus,
  HeroDeeds,
  PartyMember,
  Prompt,
  RankUp,
  RoomMode,
  RunState,
  TradeOffer,
} from "./types/state.js";
import type { ClientIntent, Presentation } from "./types/protocol.js";
import type { Rng } from "./dice.js";
import { isPracticeCampaign } from "./practice.js";
import { DEFAULT_HELP_DIE, resolveCheck } from "./dice.js";
import type { MatchupInput } from "./dice.js";
import type { MatchupRules } from "./types/matchups.js";
import { checkNotes, matchupTotal } from "./matchups.js";
import { sceneCreatures, type Bestiary } from "./bestiary.js";
import { newCharacter, resolveCharacter, withInventory, withMastery } from "./character.js";
import {
  actionCredits,
  addDeed,
  eventCredits,
  freshFightDeeds,
  heroDeedsOf,
  rankUp,
  rankUpLine,
  runCounted,
  setRunCounted,
  storyCredits,
  turnEndCredits,
  type DeedCredit,
} from "./deeds.js";
import { assignPlayerColors } from "./player-colors.js";
import { tierForLevel } from "./rules.js";
import { addItem, addQuestItem, freeSlots, hasItem, removeItem, swapItem, useConsumable } from "./inventory.js";
import { sceneChoices, visibleChoices } from "./chapter-graph.js";
import { combatTurnAway, readyWithoutAway, swapOwnerAway } from "./away.js";
import { composeNarration, fillTokens } from "./narration.js";
import { heardWith } from "./story-so-far.js";
import { loadDie, readDie } from "./playtest.js";
import type { CheckBuffOffer, RunBuff } from "./types/buffs.js";
import type { FactId, FactValue } from "./types/campaign-graph.js";
import { factTestHolds } from "./world-state.js";
import { checkBuffOffer, combatBuffsFor, expireRunBuffs, oneHeroSeat, spendCheckBuff, spendRunBuffs } from "./buffs.js";
import { sameHome } from "./visitors.js";
import { checkTypedName } from "./names.js";
import { seatedMembers, TABLE_FULL_MESSAGE } from "./seats.js";
import { classAnswerRefusal, classPlaceWaitingOn, openClassPlace } from "./class-place.js";

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
  /**
   * The saved character a SEAT_CHARACTER names, loaded from the household by
   * the server — the engine cannot reach the store. Null when there is no
   * such row; absent for every other intent.
   */
  savedCharacter?: Character | null;
  /**
   * Whether this server is allowed to cheat on the author's behalf — roadmap
   * chapter 6's playtest mode, and the lock everything else about it hangs off.
   *
   * Absent means no. Only `dev-server.ts` ever passes `true`; the Lambda
   * runtime passes a literal `false` so a deployed build has no path to it,
   * the same way `DevIdentity` is never constructible in prod. See
   * playtest.ts for the whole gate.
   */
  playtest?: boolean;
  /**
   * The roads this campaign attempt has already taken — the durable half of
   * `RunState.flags`, handed in by the authoritative handler.
   *
   * A chapter boundary clears the run's flags, and that is right for every
   * flag a chapter sets about itself. It is wrong for exactly one kind: the
   * flag that says which country the party is walking through. Gemfall's road
   * is chosen at the end of chapter 2 and read at the start of chapters 3, 4
   * and 5 — three chapters that are, by design, three different evenings in
   * three different rooms, each a fresh run whose flags start empty (spec
   * §8.1). Held only on the run, the choice would not survive the drive home.
   *
   * So the durable ones live on the campaign attempt
   * (`CampaignProgressRecord.routeFlags`) and are seeded back in here. The
   * engine stays pure: it is handed the flags, it never asks a store for them,
   * and a replay of the log replays with the same context it was given.
   *
   * Absent means an empty seed, which is every one-off chapter and every
   * campaign with no routed beat.
   */
  campaignFlags?: Readonly<Record<string, boolean>>;
  /**
   * The party's purse as the campaign attempt left it
   * (`CampaignProgressRecord.coins`), seeded into `RunState.coins` when a
   * chapter starts — for the same reason as `campaignFlags`: the coins earned
   * on one evening are still in the pack on the next. Absent keeps whatever
   * the run already holds.
   */
  campaignCoins?: number;
  /**
   * The temporary buffs a graph campaign's journey holds (#200), resolved
   * through the graph's declarations (`seedRunBuffs`), seeded into
   * `RunState.buffs` when a chapter starts — for `campaignFlags`' reason: the
   * engine is handed them and never asks a store. Seeding **replaces**: a
   * chapter started again from the same journey starts from the journey's
   * buffs, never from what an abandoned run had spent.
   *
   * Absent for every ordered campaign and every one-off chapter, which then
   * carries no buffs at all — so nothing a Gemfall fight computes can change.
   */
  campaignBuffs?: readonly RunBuff[];
  /**
   * A graph campaign's world facts (#198), read at chapter start and seeded
   * into `RunState.facts` (#220) so an environment can be keyed on them.
   * Absent for every run without declared facts.
   */
  campaignFacts?: Readonly<Record<FactId, FactValue>>;
  /**
   * Matchups (docs/matchups.md): `rules.matchups`, handed in by the server
   * only when `matchupsOn(rules, campaignId)` holds for the run's campaign.
   * Absent, fights and checks compute exactly what they did before matchups
   * (Gemfall is exempt and never gets it).
   */
  matchups?: MatchupRules;
  /**
   * `content/bestiary.json`, for the likes and dislikes of the creatures a
   * check scene shows (matchups' opinions). Read only with `matchups`.
   */
  bestiary?: Bestiary | null;
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
    coins: 0,
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

function party(state: RunState): {
  members: ResolvedCharacter[];
  flags: Record<string, boolean>;
  coins: number;
} {
  // The table as it is playing (#389): a gate, a variant or `{party}` never
  // reads the bag or the count of somebody the host took out.
  return { members: seatedMembers(state).map((m) => m.character), flags: state.flags, coins: state.coins ?? 0 };
}

function touch(draft: RunState, ctx: EngineContext): void {
  reconcileRunDeeds(draft, ctx);
  draft.seq += 1;
  draft.updatedAt = ctx.now;
}

// ---------------------------------------------------------------------------
// Deeds (#310) — counted here, kept on the run, folded into heroes by the server
// ---------------------------------------------------------------------------

/** A hero's worn class as this chapter has it: what the run counted, else their snapshot. */
function heroDeedsFor(draft: RunState, member: PartyMember): HeroDeeds {
  return runCounted(draft.deeds, member.character.id, member.character.class) ?? heroDeedsOf(member.character);
}

/**
 * Counts credits toward each hero's next rank. Only a deed the worn class asks
 * for moves anything (`addDeed`); the run's record is only grown when it does.
 */
function creditDeeds(draft: RunState, credits: readonly DeedCredit[], ctx: EngineContext): void {
  for (const c of credits) {
    const member = memberByCharacter(draft, c.heroId);
    if (!member) continue;
    const hero = heroDeedsFor(draft, member);
    const next = addDeed(hero, classDefOf(ctx, hero.class), c.deed, c.count);
    if (next === hero) continue;
    setRunCounted((draft.deeds ??= { heroes: {} }), c.heroId, next);
  }
}

function classDefOf(ctx: EngineContext, id: ClassId): ClassDef | undefined {
  return (ctx.rules.classes as Partial<Record<ClassId, ClassDef>>)[id];
}

/**
 * Lands every rank whose deeds are done (docs/class-mastery.md §5): at a
 * fight's end, or after a class-only choice. The new move is on the hero from
 * here, and so in the next fight; the line waits for the scene the table is
 * about to see (`announceRankUps`).
 */
function landRanks(draft: RunState, ctx: EngineContext): RankUp[] {
  const ups: RankUp[] = [];
  for (const member of draft.party) {
    const hero = heroDeedsFor(draft, member);
    const classDef = classDefOf(ctx, hero.class);
    const up = classDef ? rankUp(hero, classDef) : null;
    if (!up || !classDef || up.rank === "none") continue;
    setRunCounted((draft.deeds ??= { heroes: {} }), member.character.id, up);
    member.character = withMastery(member.character, up, ctx.rules);
    ups.push(rankUpLine(member.character.name, classDef, up.rank, member.character.id));
  }
  return ups;
}

/** Shows the ranks that just landed on the scene the table is now looking at. */
function announceRankUps(draft: RunState, ups: readonly RankUp[]): void {
  if (ups.length > 0) draft.rankUps = { sceneId: draft.sceneId, ups: [...ups] };
}

/**
 * Says what the table picked, on the scene it led to (`RunState.decision`), so
 * a room that voted can see its conclusion on the shared screen. A choice with
 * one way on is nothing decided, and is not said.
 */
function announceDecision(
  draft: RunState,
  prompt: Prompt & { kind: "choice" },
  choice: { label: string },
  playerId: string,
): void {
  if (prompt.options.length > 1) {
    draft.decision = { sceneId: draft.sceneId, label: choice.label, byPlayerId: playerId, vote: prompt.vote };
  }
}

/**
 * Keeps every hero's snapshot in step with what the run has counted. A hero
 * re-resolved from her stored row mid-chapter (seated again, say) would
 * otherwise lose a rank she earned an hour ago until the chapter is folded.
 */
function reconcileRunDeeds(draft: RunState, ctx: EngineContext): void {
  if (!draft.deeds) return;
  for (const member of draft.party) {
    const counted = runCounted(draft.deeds, member.character.id, member.character.class);
    if (!counted) continue;
    const now = heroDeedsOf(member.character);
    if (now.rank === counted.rank && JSON.stringify(now.deeds) === JSON.stringify(counted.deeds)) continue;
    member.character = withMastery(member.character, counted, ctx.rules);
  }
}

/**
 * Pays one hero for her own roll that went well (`RulesContent.rollXp`). Every
 * roll XP is individual: it goes to `heroRollXp` for her alone, not to the
 * party, and it stops at the chapter's cap for her. The practice pays nothing.
 */
function creditRollXp(
  draft: RunState,
  ctx: EngineContext,
  characterId: string,
  kind: "check" | "attack" | "defeat" | "natural20",
  times = 1,
): void {
  const pay = ctx.rules.rollXp;
  if (!pay || times <= 0 || isPracticeCampaign(draft.campaignId)) return;
  // A chapter begun before roll XP was individual keeps its one shared pot
  // until it ends (`RunState.rollXp`), so no hero gets a fresh allowance on
  // top of what the party already earned this chapter.
  if (draft.rollXp !== undefined) {
    const room = Math.max(0, pay.chapterCap - draft.rollXp);
    const amount = Math.min(room, (pay[kind] ?? 0) * times);
    if (amount <= 0) return;
    draft.rollXp += amount;
    draft.xpEarned += amount;
    return;
  }
  const paid = draft.heroRollXp?.[characterId] ?? 0;
  const room = Math.max(0, pay.chapterCap - paid);
  const amount = Math.min(room, (pay[kind] ?? 0) * times);
  if (amount <= 0) return;
  draft.heroRollXp = { ...draft.heroRollXp, [characterId]: paid + amount };
}

/**
 * Pays the hero whose check it was: a success pays `check`, and a natural 20
 * pays `natural20` on top, success or not (it always succeeds anyway). Only a
 * seated hero's roll counts, and a group check pays each roller for her own die.
 */
function creditCheckXp(draft: RunState, ctx: EngineContext, roll: DiceRoll): void {
  if (roll.result === "success") creditRollXp(draft, ctx, roll.characterId, "check");
  if (roll.die === 20) creditRollXp(draft, ctx, roll.characterId, "natural20");
}

/**
 * Pays for a stretch of fight events, each hero for her own hits and her own
 * natural 20s. A foe the acting hero knocks out pays that hero. A party
 * member going down never pays, and nor does a monster's hit.
 */
function creditAttackXp(
  draft: RunState,
  events: readonly EncounterEvent[],
  ctx: EngineContext,
  actorId: string | null,
): void {
  const heroes = new Set(draft.party.map((m) => m.character.id));
  const hits = events.filter((e) => e.type === "roll" && e.roll.result === "hit" && heroes.has(e.roll.characterId));
  for (const e of hits) {
    if (e.type !== "roll") continue;
    creditRollXp(draft, ctx, e.roll.characterId, "attack");
    if (e.roll.die === 20) creditRollXp(draft, ctx, e.roll.characterId, "natural20");
  }
  // The downs in a hero's own action are the foe's or, rarely, a friend's, so
  // a party member going down never pays. The rest are the acting hero's.
  const foes = events.filter((e) => e.type === "down" && !heroes.has(e.actorId));
  if (actorId && heroes.has(actorId)) creditRollXp(draft, ctx, actorId, "defeat", foes.length);
}

/** Counts what a stretch of the fight did with nobody's action behind it. */
function countFightEvents(draft: RunState, events: readonly EncounterEvent[], ctx: EngineContext): void {
  const memo = draft.deeds?.fight;
  if (!memo || !draft.encounter || events.length === 0) return;
  const counted = eventCredits(memo, draft.encounter, events);
  draft.deeds!.fight = counted.memo;
  creditDeeds(draft, counted.credits, ctx);
}

/** A hero's turn is ending: where they stand is a deed (#310). */
function creditTurnEnd(draft: RunState, encounter: EncounterState, ctx: EngineContext): void {
  const actor = currentActor(encounter);
  if (!draft.deeds?.fight || !actor || actor.side !== "party") return;
  creditDeeds(draft, turnEndCredits(encounter, actor.id), ctx);
}

/** Drops the fight's memory, and the run's record with it if nothing else is in it. */
function forgetFight(draft: RunState): void {
  if (!draft.deeds) return;
  delete draft.deeds.fight;
  if (Object.keys(draft.deeds.heroes).length === 0) delete draft.deeds;
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
  // "The party" is the members still in the game (#389): a reward, a heal or a
  // cost never lands on somebody the host took out, who keeps a place in
  // `party` only so a fight in progress can still point at them.
  if (to === undefined) {
    if (rollerCharacterId) {
      const roller = memberByCharacter(draft, rollerCharacterId);
      if (roller) return [roller];
    }
    return seatedMembers(draft);
  }
  if (to === "party") return seatedMembers(draft);
  if (to === "roller") {
    const roller = rollerCharacterId ? memberByCharacter(draft, rollerCharacterId) : undefined;
    return roller ? [roller] : seatedMembers(draft);
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

/**
 * The one way a bag changes on a run.
 *
 * Every trinket-dependent number is re-derived through `withInventory`, and the
 * HP clamp lives here rather than there because hit points are on the member
 * and not on the character. Handing out a +2 max-HP trinket and then taking it
 * back would otherwise leave somebody standing above their own ceiling.
 *
 * Centralised so no future path can change an inventory without both. That is
 * exactly how trinkets came to be inert for the length of a chapter: four
 * places assigned `character.inventory` directly and none of them owed
 * anything else.
 */
function setBag(member: PartyMember, next: readonly InventoryEntry[], ctx: EngineContext): void {
  member.character = withInventory(member.character, next, ctx.rules, ctx.items);
  member.hp = Math.min(member.hp, member.character.maxHp);
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

/**
 * Removes one copy of the first of `ids` anybody in the party holds, slotted
 * bag first and quest items second, through `setBag` so a trinket handed over
 * takes its bonus with it. Holding none of them is a no-op.
 */
function takeItem(draft: RunState, ids: string | readonly string[], ctx: EngineContext): void {
  // Paid by the table that is playing (#389), the same members `party()`
  // read the gate from.
  const seated = seatedMembers(draft);
  for (const itemId of typeof ids === "string" ? [ids] : ids) {
    const bagHolder = seated.find((m) => hasItem(m.character.inventory, itemId));
    if (bagHolder) {
      setBag(bagHolder, removeItem(bagHolder.character.inventory, itemId), ctx);
      return;
    }
    const questHolder = seated.find((m) => m.character.questItems.includes(itemId));
    if (questHolder) {
      questHolder.character.questItems = questHolder.character.questItems.filter((id) => id !== itemId);
      return;
    }
  }
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
          damage(m, effect.nonlethal ? Math.min(effect.amount, Math.max(0, m.hp - 1)) : effect.amount);
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

      case "grantCoins":
        draft.coins = (draft.coins ?? 0) + effect.amount;
        break;

      case "spendCoins":
        // Never below zero. The choice is gated on affording it; if it was not,
        // the party pays what it has rather than going into debt.
        draft.coins = Math.max(0, (draft.coins ?? 0) - effect.amount);
        break;

      case "takeItem":
        takeItem(draft, effect.itemId, ctx);
        break;

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
            setBag(member, result.inventory, ctx);
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

/**
 * Who may be handed the die: standing and connected. A phone that has dropped
 * is never nominated, because nobody else could roll for it and the check
 * would wait on a player who is not there.
 */
function rollerPool(draft: RunState): PartyMember[] {
  const standing = draft.party.filter((m) => !m.down);
  const here = standing.filter((m) => m.connected);
  return here.length > 0 ? here : standing.length > 0 ? standing : draft.party;
}

/**
 * Who rolls a check.
 *
 * `"active"` is whoever is first in the party, `"best"` is the highest score
 * in the check's stat, and `"party"` (the default) takes turns: whoever has
 * rolled the fewest checks this run goes next, so every kid gets the die in
 * their hands. Ties go to the higher stat, then party order, so among those
 * who are due the one most likely to succeed still steps up.
 */
function pickRoller(draft: RunState, scene: Scene & { type: "check" }): PartyMember {
  const pool = rollerPool(draft);
  const first = pool[0];
  if (!first) throw new Illegal("ILLEGAL", "nobody is in the party to roll");
  if (scene.roller === "active") return first;
  const stat = (m: PartyMember): number => m.character.stats[scene.stat];
  if (scene.roller === "best") {
    return pool.reduce((best, m) => (stat(m) > stat(best) ? m : best), first);
  }
  const rolled = (m: PartyMember): number => draft.checkRolls?.[m.character.id] ?? 0;
  return pool.reduce((pick, m) => {
    if (rolled(m) !== rolled(pick)) return rolled(m) < rolled(pick) ? m : pick;
    return stat(m) > stat(pick) ? m : pick;
  }, first);
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
  // Leaving is a vote (doReady), counted from nobody.
  for (const member of draft.party) member.ready = false;
  // A setback ends the temporary buffs (#200) that end on one, before the run
  // hands its buffs back to the journey.
  if (outcome === "setback" && draft.buffs !== undefined) draft.buffs = expireRunBuffs(draft.buffs, "setback");
  // And any ending ends the ones that last only until the chapter played
  // ends (#222's `"chapter"`): an unspent Riftspark is gone with it.
  if (draft.buffs !== undefined) draft.buffs = expireRunBuffs(draft.buffs, "chapter");

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
/**
 * Re-gates an open choice prompt against the party as it is now.
 *
 * `openScenePrompt` filters the choices once, when the scene opens, but the
 * party can change while the prompt waits: a player eats the only supper
 * bundle (USE_ITEM), trades the honeycake away, or a member leaves. An option
 * whose cost is no longer covered would otherwise still be tappable, and its
 * `takeItem` / `spendCoins` would quietly do nothing while the story narrates
 * the gift. So after every intent the options are recomputed, and a vote cast
 * for an option that has gone is withdrawn, leaving that player to vote again.
 */
function refreshChoicePrompt(draft: RunState, ctx: EngineContext): void {
  const prompt = draft.prompt;
  if (!prompt || prompt.kind !== "choice" || prompt.sceneId !== draft.sceneId) return;
  const scene = ctx.chapter && ctx.chapter.id === draft.chapterId ? ctx.chapter.scenes[prompt.sceneId] : undefined;
  if (!scene || (scene.type !== "story" && scene.type !== "rest" && scene.type !== "choice_point")) return;
  const who = party(draft);
  const live = visibleChoices(scene.choices, who);
  const liveIds = new Set(live.map((c) => c.id));
  if (prompt.options.length === live.length && prompt.options.every((o) => liveIds.has(o.id))) return;
  prompt.options = live.map((c) => ({ id: c.id, label: fillTokens(c.label, who), icon: c.icon }));
  if (prompt.votes) {
    prompt.votes = Object.fromEntries(Object.entries(prompt.votes).filter(([, id]) => liveIds.has(id)));
  }
}

function openScenePrompt(
  draft: RunState,
  scene: Scene,
  sceneId: SceneId,
  ctx: EngineContext,
): Presentation | undefined {
  // A rest is where help recharges (doHelp).
  if (scene.type === "rest") draft.helpSpent = [];
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
      const who = party(draft);
      const options = visibleChoices(scene.choices, who);
      const isVote = scene.type === "choice_point";
      // choice_point puts it to the party (spec §6.1). A story beat is one
      // player's call, taken in turns, so it is not a race to the first tap.
      // Rest stays open to anyone: its way out is "move on", which is the
      // table's call, and nobody should wait on one phone to leave camp.
      const turn = scene.type === "story" ? storyTurnHolder(draft) : null;
      draft.prompt = {
        kind: "choice",
        sceneId,
        // Labels take tokens (never variants), filled here so the phones
        // render the prompt as-is and a reload shows the same words (#159).
        options: options.map((c) => ({ id: c.id, label: fillTokens(c.label, who), icon: c.icon })),
        forPlayerIds: isVote
          ? draft.party.map((m) => m.playerId)
          : turn
            ? [turn.playerId]
            : [],
        vote: isVote,
        ...(isVote ? { votes: {} } : {}),
      };
      return undefined;
    }

    case "interaction": {
      const members = draft.party.filter((member) => member.connected);
      const players = (members.length ? members : draft.party).map((member) => member.playerId);
      draft.prompt = {
        kind: "interaction", sceneId, openedSeq: draft.seq + 1, attempt: 0,
        spec: structuredClone(scene.interaction), playerIds: players,
        actorId: storyTurnHolder(draft)?.playerId ?? "",
        phase: "ready", relaxed: false, supports: {},
      };
      return undefined;
    }
    case "check": {
      if (scene.roller === "all") {
        const everyone = rollerPool(draft).map((m) => m.character.id);
        draft.prompt = {
          kind: "roll",
          sceneId,
          stat: scene.stat,
          tn: scene.tn,
          prompt: fillTokens(scene.prompt, party(draft)),
          characterId: everyone[0] as string,
          group: { pending: everyone, rolls: [] },
        };
        offerCheckBuff(draft.prompt, draft);
        return undefined;
      }
      const roller = pickRoller(draft, scene);
      draft.prompt = {
        kind: "roll",
        sceneId,
        stat: scene.stat,
        tn: scene.tn,
        prompt: fillTokens(scene.prompt, party(draft)),
        characterId: roller.character.id,
      };
      offerCheckBuff(draft.prompt, draft);
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
        return takeBranch(draft, scene.onVictory, ctx, undefined, scene.narration);
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

/**
 * The line that explains *how you got here*: a branch's narration and its
 * variants, plus (for an auto-resolved fight) the encounter's own text in
 * front of it.
 */
interface Transition {
  narration?: string;
  variants?: NarrationVariant[];
  /** Shown before the branch's text, unconditionally. */
  lead?: string;
}

/**
 * The scene's narration as the table reads it (#159): the branch's line (with
 * its variants) above the scene's own text (with its variants), then the
 * `{facets}` / `{party}` tokens filled. Evaluated against the party as it is
 * now — the caller runs this after the scene's `onEnter`.
 */
function composeSceneNarration(draft: RunState, scene: Scene, transition?: Transition): string {
  const who = party(draft);
  const base =
    scene.type === "check" ? (scene.narration ?? scene.prompt) : (scene.narration ?? "");
  const authored = scene.type === "encounter" ? base : composeNarration(base, scene.variants, who);
  const branchLine = transition
    ? [transition.lead, composeNarration(transition.narration ?? "", transition.variants, who)]
        .filter((part): part is string => !!part)
        .join("\n\n")
    : "";
  // A branch's narration is the line that explains *how you got here*; showing
  // it above the destination's text is how it reads at the table.
  const whole = branchLine ? `${branchLine}\n\n${authored}`.trim() : authored;
  return fillTokens(whole, who);
}

function enterSceneDraft(
  draft: RunState,
  sceneId: SceneId,
  ctx: EngineContext,
  transition?: Transition,
): Presentation | undefined {
  const chapter = requireChapter(ctx);
  const scene = requireScene(chapter, sceneId);
  // A rank-up line belongs to the scene it landed on, and goes with it.
  if (draft.rankUps && draft.rankUps.sceneId !== sceneId) delete draft.rankUps;
  // So does the line saying what was picked to get here.
  if (draft.decision && draft.decision.sceneId !== sceneId) delete draft.decision;

  // A swap prompt raised by the *departing* choice's effects survives the
  // transition. It is a decision the player still owes, and dropping it would
  // silently lose the item the whole prompt exists to protect (§9.1).
  const carriedSwap = draft.prompt?.kind === "item_swap" ? draft.prompt : undefined;

  draft.sceneId = sceneId;
  draft.sceneType = scene.type;
  draft.art = scene.art ?? null;
  draft.scenePriority = scene.type === "encounter" ? null : scene.priority ?? null;
  // The practice's one line of what to tap (#255). Absent, not null, on every
  // other scene, so a run that never meets a hint never grows the key.
  if (scene.hint !== undefined) draft.hint = scene.hint;
  else delete draft.hint;
  // A class place (#311), its answers fresh on every arrival. Absent, not
  // null, on every other scene, like the hint. The fitting stall (#312) opens
  // the same way where the rules say it stands, while somebody here is new.
  const place = openClassPlace(scene, { rules: ctx.rules, chapterId: chapter.id, sceneId, party: draft.party });
  if (place) draft.classPlace = place;
  else delete draft.classPlace;
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

  /*
   * The trail, for the end-of-chapter recap of priority-1 scenes.
   *
   * Appended here because this is the one function every arrival goes through —
   * a choice, a branch off a roll, a fight ending, a playtest jump. Coalesced
   * rather than assumed, because `RunState` is persisted plain JSON and a run
   * that started before this field existed has to keep playing.
   *
   * Consecutive duplicates are dropped: re-entering the scene you are already
   * on is not a step in the story, and a recap that says the same room twice in
   * a row reads like a bug.
   */
  const trail = draft.visited ?? [];
  if (trail.at(-1) !== sceneId) draft.visited = [...trail, sceneId];

  applyEffectsDraft(draft, scene.onEnter, ctx);

  // Rest scenes heal on arrival (spec §6.1) — the natural end-of-session beat.
  if (scene.type === "rest" && scene.heal) {
    for (const member of draft.party) heal(member, scene.heal);
  }
  // A rest ends the temporary buffs (#200) that end on one — whether or not
  // the scene heals: a rest is the party standing down.
  if (scene.type === "rest" && draft.buffs !== undefined) draft.buffs = expireRunBuffs(draft.buffs, "rest");

  // Composed after `onEnter`, on purpose: variants and tokens read the party
  // as it is when the scene opens, so an item this scene grants counts (#159).
  // Stored rather than recomputed, so a reload mid-scene reads the same words.
  draft.narration = composeSceneNarration(draft, scene, transition);
  // A revelation that reads the bag keeps the bag it was heard with, once a chapter (#358).
  if (scene.type !== "encounter" && scene.priority === 1 && draft.revealHeld?.[sceneId] === undefined) {
    const held = heardWith(scene, party(draft));
    if (held !== null) draft.revealHeld = { ...draft.revealHeld, [sceneId]: held };
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
  lead?: string,
): Presentation | undefined {
  applyEffectsDraft(draft, branch.effects, ctx, rollerCharacterId);
  return enterSceneDraft(draft, branch.goto, ctx, {
    ...(lead ? { lead } : {}),
    ...(branch.narration !== undefined ? { narration: branch.narration } : {}),
    ...(branch.variants ? { variants: branch.variants } : {}),
  });
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

  /*
   * A die the author loaded, if this server is one that lets them (playtest.ts).
   * Read here rather than inside the roll because this is where `ctx` is
   * assembled for the whole intent, and because the die has to be *spent* on
   * the way back out — a forced 20 that stayed loaded would turn the rest of
   * the evening into a straight line.
   */
  const loaded =
    ctx.playtest === true && typeof draft.playtestDie === "number"
      ? loadDie(ctx.rng, draft.playtestDie)
      : null;
  const rolling = loaded ? { ...ctx, rng: loaded.rng } : ctx;

  try {
    const presentation = dispatch(draft, envelope, rolling, effects);
    if (loaded?.spent()) draft.playtestDie = null;
    pruneTrades(draft);
    refreshChoicePrompt(draft, ctx);
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

const isTile = (value: unknown): value is { x: number; y: number } =>
  typeof value === "object" &&
  value !== null &&
  Number.isInteger((value as { x?: unknown }).x) &&
  Number.isInteger((value as { y?: unknown }).y);

/**
 * The intent's fields that are stored, or walked, before any handler checks
 * them. An intent arrives as JSON from a phone, typed only by the server's
 * cast, so without this a `MOVE` with no `to` threw a TypeError deep in the
 * encounter (a 500 every retry), `targetIds: "a"` slipped past the length
 * check, and `mode` or `ready` stored whatever was sent and broadcast it to
 * every screen (`ready: "yes"` counted as ready; `accept: "no"` accepted).
 */
function doInteract(draft: RunState, playerId: string, intent: Extract<ClientIntent, { type: "INTERACT" }>, ctx: EngineContext): Presentation | undefined {
  const prompt = draft.prompt;
  if (!prompt || prompt.kind !== "interaction" || prompt.openedSeq !== intent.openedSeq || prompt.attempt !== intent.attempt) {
    throw new Illegal("ILLEGAL", "This interaction has moved on.");
  }
  const scene = ctx.chapter?.scenes[prompt.sceneId];
  if (!scene || scene.type !== "interaction") throw new Illegal("ILLEGAL", "No interaction scene.");
  const connected = draft.party.filter((member) => member.connected).map((member) => member.playerId);
  if (!connected.includes(playerId)) throw new Illegal("FORBIDDEN", "Only a connected hero may act.");
  const actor = interactionActor(prompt, connected);
  const result = (outcome: "success" | "failure" | "assisted") => {
    prompt.phase = "result";
    prompt.outcome = outcome;
    prompt.resolvedActorId = actor ?? playerId;
    prompt.supports = {};
  };
  if (intent.action === "continue") {
    if (prompt.phase !== "result" || !prompt.outcome) throw new Illegal("ILLEGAL", "Finish the interaction first.");
    const branch = prompt.outcome === "failure" ? scene.onFailure : prompt.outcome === "assisted" ? (scene.onAssisted ?? scene.onSuccess) : scene.onSuccess;
    const owner = prompt.resolvedActorId ?? actor;
    if (owner) passStoryTurn(draft, owner);
    return takeBranch(draft, branch, ctx, draft.party.find((member) => member.playerId === owner)?.character.id);
  }
  if (intent.action === "retry") {
    if (playerId !== actor || (prompt.phase !== "result" && prompt.phase !== "active")) throw new Illegal("ILLEGAL", "Only the acting hero can start again.");
    prompt.attempt += 1; prompt.phase = "ready"; prompt.supports = {};
    delete prompt.outcome; delete prompt.resolvedActorId; delete prompt.startedAt;
    delete prompt.levels; delete prompt.passed; delete prompt.caughtBy;
    delete prompt.contributions; delete prompt.reactions; delete prompt.taps;
    return undefined;
  }
  if (prompt.phase === "result") throw new Illegal("ILLEGAL", "This attempt is complete.");
  if (intent.action === "assist") { result("assisted"); return undefined; }
  if (intent.action === "start") {
    if (playerId !== actor || prompt.phase !== "ready" || typeof intent.relaxed !== "boolean") throw new Illegal("ILLEGAL", "Not ready to start.");
    prompt.relaxed = intent.relaxed; prompt.startedAt = ctx.now; prompt.phase = "active";
    return undefined;
  }
  if (prompt.phase !== "active") throw new Illegal("ILLEGAL", "Start when everyone is ready.");
  switch (intent.action) {
    case "stop":
      if ((prompt.spec.kind !== "precision" && prompt.spec.kind !== "timing") || playerId !== actor || typeof intent.position !== "number" || !Number.isFinite(intent.position) || intent.position < 0 || intent.position > 1) throw new Illegal("ILLEGAL", "Invalid precision input.");
      // Score the displayed phone position, not network arrival time. This is
      // a cooperative family game; a modified client can forge its own timing.
      result(precisionSuccess(prompt.spec, intent.position, prompt.relaxed) ? "success" : "failure");
      return undefined;
    case "support":
      if (prompt.spec.kind !== "cooperate" || !["hold", "prop", "release"].includes(intent.mode)) throw new Illegal("ILLEGAL", "Invalid support input.");
      if (intent.mode === "release") delete prompt.supports[playerId];
      else if (intent.mode === "prop") prompt.supports[playerId] = null;
      else prompt.supports[playerId] = new Date(Date.parse(ctx.now) + SUPPORT_LEASE_MS).toISOString();
      return undefined;
    case "complete":
      if (playerId !== actor || !(prompt.spec.kind === "cooperate" ? supportsReady(prompt, connected, ctx.now) : prompt.spec.kind === "balance" ? balanceReady(prompt, connected) : prompt.spec.kind === "play" ? playReady(prompt, connected) : prompt.spec.kind === "relay" ? !relayHolder(prompt, connected) : false)) throw new Illegal("ILLEGAL", "Finish working together first.");
      result("success");
      return undefined;
    case "answer":
      if (prompt.spec.kind === "tracking") {
        if (playerId !== actor || !Array.isArray(intent.answer) || intent.answer.length !== 1 || !prompt.spec.covers.some((_, index) => String(index) === intent.answer[0]) || (!prompt.relaxed && Date.parse(ctx.now) - Date.parse(prompt.startedAt ?? "") < playbackMs(prompt.spec, prompt.relaxed))) throw new Illegal("ILLEGAL", "Watch the trick before choosing a cover.");
        result(intent.answer[0] === String(trackedCover(prompt.spec)) ? "success" : "failure");
        return undefined;
      }
      if (prompt.spec.kind === "memory") {
        const spec = prompt.spec;
        if (playerId !== actor || !Array.isArray(intent.answer) || intent.answer.length !== spec.answer.length || !intent.answer.every((id) => typeof id === "string" && spec.options.some((option) => option.id === id)) || (!prompt.relaxed && Date.parse(ctx.now) - Date.parse(prompt.startedAt ?? "") < playbackMs(spec, prompt.relaxed))) throw new Illegal("ILLEGAL", "Watch the magic before answering.");
        result(intent.answer.every((id, index) => id === spec.answer[index]) ? "success" : "failure");
        return undefined;
      }
      if (prompt.spec.kind !== "sequence" || playerId !== actor || !Array.isArray(intent.answer) || intent.answer.length !== prompt.spec.answer.length || !intent.answer.every((id) => typeof id === "string" && prompt.spec.kind === "sequence" && prompt.spec.options.some((option) => option.id === id))) throw new Illegal("ILLEGAL", "Choose a complete path.");
      result(intent.answer.every((id, index) => prompt.spec.kind === "sequence" && id === prompt.spec.answer[index]) ? "success" : "failure");
      return undefined;
    case "adjust": {
      if (prompt.spec.kind !== "balance" || (intent.direction !== "up" && intent.direction !== "down")) throw new Illegal("ILLEGAL", "Invalid balance input.");
      const levels = prompt.levels ??= {};
      levels[playerId] = Math.max(0, Math.min(1, (levels[playerId] ?? 0) + (intent.direction === "up" ? 0.25 : -0.25)));
      return undefined;
    }
    case "catch":
    case "pass": {
      if (prompt.spec.kind !== "relay" || relayHolder(prompt, connected) !== playerId) throw new Illegal("ILLEGAL", "The spark belongs to another friend.");
      if (intent.action === "catch") {
        if (prompt.caughtBy === playerId) throw new Illegal("ILLEGAL", "Already caught.");
        prompt.caughtBy = playerId;
      } else {
        if (prompt.caughtBy !== playerId) throw new Illegal("ILLEGAL", "Catch it first.");
        (prompt.passed ??= []).push(playerId); delete prompt.caughtBy;
        if (!relayHolder(prompt, connected)) result("success");
      }
      return undefined;
    }
    case "play": {
      if (prompt.spec.kind !== "play") throw new Illegal("ILLEGAL", "Not a playful interaction.");
      const option = prompt.spec.options.find((option) => option.id === intent.optionId);
      if (!option) throw new Illegal("ILLEGAL", "Choose an offered action.");
      (prompt.contributions ??= {})[playerId] = option.id;
      prompt.taps = Math.min(1000, (prompt.taps ?? 0) + 1);
      const stage = prompt.spec.stages?.[Math.min(prompt.taps - 1, prompt.spec.stages.length - 1)];
      prompt.reactions = [...(prompt.reactions ?? []), { playerId, text: stage ?? option.reaction }].slice(-12);
      return undefined;
    }
    default:
      throw new Illegal("ILLEGAL", "Unknown interaction action.");
  }
}

function checkIntentShape(intent: ClientIntent): void {
  const malformed = (field: string): never => {
    throw new Illegal("ILLEGAL", `malformed ${intent.type}: ${field}`);
  };
  switch (intent.type) {
    case "MOVE":
      if (!isTile(intent.to)) malformed("to");
      return;
    case "COMBAT_ACTION":
      if (typeof intent.abilityId !== "string") malformed("abilityId");
      if (intent.targetId !== undefined && typeof intent.targetId !== "string") malformed("targetId");
      if (intent.targetTile !== undefined && !isTile(intent.targetTile)) malformed("targetTile");
      if (
        intent.targetIds !== undefined &&
        !(Array.isArray(intent.targetIds) && intent.targetIds.every((id) => typeof id === "string"))
      ) malformed("targetIds");
      if (
        intent.targetTiles !== undefined &&
        !(Array.isArray(intent.targetTiles) && intent.targetTiles.every(isTile))
      ) malformed("targetTiles");
      return;
    case "SET_MODE":
      if (intent.mode !== "party" && intent.mode !== "travel") malformed("mode");
      return;
    case "READY":
      if (typeof intent.ready !== "boolean") malformed("ready");
      return;
    case "RESOLVE_TRADE":
      if (typeof intent.accept !== "boolean") malformed("accept");
      return;
  }
}

function dispatch(
  draft: RunState,
  envelope: IntentEnvelope,
  ctx: EngineContext,
  effects: EngineEffects,
): Presentation | undefined {
  const { playerId, intent } = envelope;
  checkIntentShape(intent);

  /*
   * The playtest gate, in one place rather than in each handler. A second
   * cheat added later gets the check for free, and there is exactly one line
   * to read when the question is "can a deployed server do this" (playtest.ts).
   */
  if (intent.type === "PLAYTEST_GOTO" || intent.type === "PLAYTEST_SET_DIE") {
    if (ctx.playtest !== true) {
      throw new Illegal("FORBIDDEN", "playtest mode is not enabled on this server");
    }
  }

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

    case "SEAT_CHARACTER":
      return doSeatCharacter(draft, playerId, intent.characterId, ctx);

    case "START_CHAPTER":
      return doStartChapter(draft, intent.chapterId, ctx);

    case "CONTINUE_CAMPAIGN":
      // Resolved by the server into a START_CHAPTER (handlers/action.ts):
      // which chapter comes next is a fact about the household's campaign
      // attempt, which the engine never sees.
      throw new Illegal("ILLEGAL", "continuing a campaign is resolved by the server");

    case "START_PRACTICE":
      // The server's too (handlers/action.ts): who is new is a fact about the
      // stored heroes, and which chapter is the practice is content.
      throw new Illegal("ILLEGAL", "starting the practice is resolved by the server");

    case "CHOOSE_EXIT":
      // Moves the household's journey (handlers/action.ts, shared journey.ts),
      // which the engine never sees — the same reason as CONTINUE_CAMPAIGN.
      throw new Illegal("ILLEGAL", "choosing a way on is resolved by the server");

    case "RIFT_ACTION":
      // Acts on the household's journey (#197, shared journey.ts
      // `takeRiftAction`) — CHOOSE_EXIT's sibling, for CHOOSE_EXIT's reason.
      throw new Illegal("ILLEGAL", "acting on a rift is resolved by the server");

    case "VOTE_CAMPAIGN":
      return doVoteCampaign(draft, playerId, intent.campaignId);

    case "CHOOSE":
      return doChoose(draft, playerId, intent.choiceId, ctx);

    case "ROLL":
      return doRoll(draft, playerId, ctx, intent.spendBuff);

    case "INTERACT":
      return doInteract(draft, playerId, intent, ctx);

    case "HELP":
      return doHelp(draft, playerId, ctx);

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

    case "SWITCH_CLASS":
      throw new Illegal("ILLEGAL", "a class is switched through the authoritative run handler");

    case "KEEP_CLASS":
      return doKeepClass(draft, playerId, intent.classId, intent.stall === true);

    case "PLAYTEST_GOTO":
      return doPlaytestGoto(draft, intent.sceneId, ctx);

    case "PLAYTEST_SET_DIE":
      draft.playtestDie = readDie(intent.die);
      return undefined;

    default: {
      // Exhaustive at compile time; at run time, a type no client sends. It
      // was accepted as a no-op before, and still moved the run's seq.
      const unknown: never = intent;
      throw new Illegal("ILLEGAL", `no such intent: ${String((unknown as { type?: unknown }).type)}`);
    }
  }
}

/**
 * Warps the run to a scene — roadmap chapter 6, gated in `dispatch` above.
 *
 * `enterSceneDraft` and nothing else, because a jump that skipped `onEnter`
 * would be showing the author a scene the game never produces (playtest.ts).
 * The two things it does on top are both about leaving the *old* scene in a
 * state a jump can legally depart from:
 *
 *   - An encounter in progress is dropped — but its damage is carried out onto
 *     the party first, exactly as `settleEncounter` does after a win or a loss.
 *     A fight is the one thing on the run that outlives a scene change, and a
 *     board left standing after a warp would put the party in a fight belonging
 *     to a scene they are no longer in. Dropping it without the carry-out would
 *     be worse than leaving it: `combatants` is where current hit points live
 *     while the board is up, so the jump would quietly hand back a party healed
 *     to full — and an author who jumped out of a fight to check whether the
 *     boss is survivable at half health would be testing it at full health
 *     without being told.
 *   - Ready flags are cleared, because the next scene may be an encounter, and
 *     three phones still holding a ready from before the jump would start it
 *     before anybody had looked up.
 *
 * Damage is therefore never undone, mid-fight or between scenes. An author
 * checking whether the boss is survivable at half health wants the party they
 * have, not a fresh one; healing is what a Rest scene is for.
 */
function doPlaytestGoto(
  draft: RunState,
  sceneId: SceneId,
  ctx: EngineContext,
): Presentation | undefined {
  requireScene(requireChapter(ctx), sceneId);
  if (draft.encounter) {
    carryDamageOut(draft, draft.encounter);
    spendBuffs(draft, "ongoing");
  }
  draft.encounter = null;
  forgetFight(draft);
  for (const member of draft.party) member.ready = false;
  return enterSceneDraft(draft, sceneId, ctx);
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
  if (chapterEndVoteCarried(draft)) returnToLobby(draft);
  return undefined;
}

/**
 * The chapter's end is read at each phone's own pace: the recap, the bag, who
 * grew. One player's "done" used to be ADVANCE and pulled every phone off that
 * screen mid-read, so leaving is the table's vote, like starting a fight:
 * everyone still at the table has said they're done, and at least one of them
 * is here to have said it (a room whose phones all drop stays where it is).
 * ADVANCE still leaves at once, for the tools that drive a whole run.
 */
function chapterEndVoteCarried(state: RunState): boolean {
  return (
    state.phase === "chapter_complete" &&
    state.party.some((m) => m.ready && m.connected) &&
    state.party.every((m) => m.ready || !m.connected)
  );
}

/**
 * The chapter-end vote, recounted after something other than a READY changed
 * who counts: a phone dropping off (server handlers/presence.ts) can be the
 * last one still reading. The same state back when the vote has not carried.
 */
export function settleChapterEndVote(state: RunState): RunState {
  if (!chapterEndVoteCarried(state)) return state;
  const draft = draftOf(state);
  returnToLobby(draft);
  return draft;
}

function doCreateCharacter(
  draft: RunState,
  playerId: string,
  intent: Extract<ClientIntent, { type: "CREATE_CHARACTER" }>,
  ctx: EngineContext,
  effects: EngineEffects,
): Presentation | undefined {
  assertSeatOpen(draft, playerId);

  /*
   * Deliberately allowed at any phase. Refusing once the chapter has started
   * strands anyone who joins late — their phone has no character, so it offers
   * the creation flow, and the server then refuses the only thing they can do.
   * Someone arriving mid-chapter walking on as a new party member is a much
   * better answer than a phone that says "finding your character" forever.
   */
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

  // A typed name is vetted here, not only on the phone (#253): this is the one
  // place every hero's name passes, so a hand-written client gets no way round.
  const vetted = checkTypedName(intent.name);
  if (!vetted.ok) throw new Illegal("ILLEGAL", vetted.message);

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
    // The table's pick, not the phone's: unique at this table, then frozen
    // on the character for every game after (player-colors.ts).
    appearance: assignPlayerColors(
      `${draft.runId}:${playerId}:colors`,
      draft.party.map((member) => member.character.appearance),
    ),
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

/** The two rules every way of sitting down shares: one seat each, and a ceiling. */
function assertSeatOpen(draft: RunState, playerId: string): void {
  if (memberByPlayer(draft, playerId)) {
    throw new Illegal("ILLEGAL", `player "${playerId}" already has a character in this run`);
  }
  /*
   * A ceiling, because nothing else is one. Every map budgets `partySpawns`
   * against this number (the content validator holds them to it), so a party
   * that outgrows it reaches an encounter it cannot start. The table this game
   * is built for seats three; six is "the cousins are visiting", not a raid.
   */
  // Somebody the host took out keeps their place in `party` but not their
  // seat (#389), so it is the seated members that count.
  if (seatedMembers(draft).length >= MAX_PARTY) {
    throw new Illegal("ILLEGAL", TABLE_FULL_MESSAGE);
  }
}

/**
 * A returning hero sits down as they are: their level, their bag, their
 * souvenirs — the household row, resolved, exactly as CREATE_CHARACTER would
 * have left a new one. Nothing is written: the row already exists, and the
 * chapter-end fold reads it back by id like any other member's.
 *
 * Only your own. A character belongs to the player who made it, and a phone
 * that could seat a sibling's hero could also walk off with their level.
 */
function doSeatCharacter(
  draft: RunState,
  playerId: string,
  characterId: string,
  ctx: EngineContext,
): Presentation | undefined {
  assertSeatOpen(draft, playerId);

  const saved = ctx.savedCharacter ?? null;
  if (!saved || saved.id !== characterId || saved.householdId !== (ctx.householdId ?? "")) {
    throw new Illegal("NOT_FOUND", `no saved character "${characterId}" in this household`);
  }
  if (saved.ownerPlayerId !== playerId) {
    throw new Illegal("FORBIDDEN", `character "${characterId}" belongs to another player`);
  }
  if (memberByCharacter(draft, characterId)) {
    throw new Illegal("ILLEGAL", `character "${characterId}" is already at this table`);
  }

  const resolved = resolveCharacter(saved, ctx.rules, ctx.items);
  draft.party.push({
    character: resolved,
    playerId,
    hp: resolved.maxHp,
    down: false,
    connected: true,
    ready: false,
  });
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
  // Everybody at the table, that is: a player who stepped away (#258) is not
  // waited on, and their hero comes along. With everybody present this is
  // exactly "every member is ready".
  if (!readyWithoutAway(draft.party)) {
    throw new Illegal("ILLEGAL", "everybody has to be ready first");
  }

  draft.campaignId = chapter.campaignId;
  draft.chapterId = chapter.id;
  draft.chapterInfo = { index: chapter.index, title: chapter.title };
  draft.xpEarned = 0;
  delete draft.heroRollXp;
  delete draft.rollXp;
  // Cleared with the XP they belong to. Left behind, the previous chapter's
  // setback and its bonus list would still be on the state the moment this one
  // starts, so a phone that renders from `chapterOutcome` would open the
  // evening's second chapter under the first one's ending banner.
  draft.chapterOutcome = null;
  draft.bonuses = [];
  delete draft.fightEndings;
  delete draft.xpAlreadyPaid;
  // Deeds counted last chapter were folded into the heroes when it ended.
  delete draft.deeds;
  delete draft.rankUps;
  delete draft.decision;
  // Not `{}` — see `EngineContext.campaignFlags`. Everything a chapter said
  // about itself dies here; the road the party is on does not.
  draft.flags = { ...(ctx.campaignFlags ?? {}) };
  // The purse is not chapter-scoped: see `EngineContext.campaignCoins`.
  draft.coins = ctx.campaignCoins ?? draft.coins ?? 0;
  // Temporary buffs (#200) come only from a graph campaign's journey. Any
  // other start clears what an earlier graph chapter in this room left.
  if (ctx.campaignBuffs !== undefined) draft.buffs = structuredClone([...ctx.campaignBuffs]);
  else delete draft.buffs;
  // World facts (#220), the same way: only a graph campaign's start has any.
  if (ctx.campaignFacts !== undefined) draft.facts = { ...ctx.campaignFacts };
  else delete draft.facts;
  draft.lastRoll = null;
  // A new chapter is a new day on the road: everyone's help is back.
  draft.helpSpent = [];
  /*
   * The trail, cleared for exactly the reason above it. `visited` is the spine
   * of the end-of-chapter recap, so a trail carried across the boundary makes
   * the second chapter's recap retell the first one's scenes, naming rooms
   * that are not in this chapter at all. This function is the chapter
   * boundary, and anything scoped to a chapter dies here.
   */
  draft.visited = [];
  delete draft.revealHeld;
  // The lobby's decision is spent: back in the lobby, the party decides again.
  draft.campaignVotes = {};
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
  if (
    prompt.forPlayerIds.length > 0 &&
    !prompt.forPlayerIds.includes(playerId) &&
    !turnHolderAway(draft.party, prompt)
  ) {
    throw new Illegal("FORBIDDEN", `this choice is not player "${playerId}" to make`);
  }
  // A class place holds its way on until every kid there has answered (#311),
  // votes included: a vote cast now could close the room on a friend still
  // reading their "are you sure?".
  const deciding = classPlaceWaitingOn(draft);
  if (deciding.length > 0) {
    const names = deciding.map((m) => m.character.name).join(", ");
    throw new Illegal("ILLEGAL", `still waiting for ${names} to decide about their class`);
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
  // The prompt's options are re-gated after every intent (refreshChoicePrompt),
  // so this only fires if that ever misses a path. A choice whose item or
  // coins are gone must not run its effects for nothing and narrate the gift.
  if (!visibleChoices([choice], party(draft)).length) {
    throw new Illegal("ILLEGAL", `"${winning}" is no longer something this party can do`);
  }

  // The marker moves on from whoever just had it — the chooser on a Story
  // beat (who may have stood in for an absent turn holder), the holder on a
  // vote — before the next scene opens its prompt against it. A Rest's way
  // out is open to anyone and is nobody's turn, so it leaves the marker be.
  // So does a Story beat with only one way on: "Go on" is not a decision, and
  // spending a turn on it would leave that player nothing to decide (§6.1).
  if (prompt.vote) passStoryTurn(draft, storyTurnHolder(draft)?.playerId ?? playerId);
  else if (prompt.forPlayerIds.length > 0 && prompt.options.length > 1) {
    passStoryTurn(draft, playerId);
  }

  applyEffectsDraft(draft, choice.effects, ctx);
  // A class-only choice is that class's story deed (#310), for everyone seated
  // wearing it; a rank it completes lands now, ready for the next fight.
  creditDeeds(draft, storyCredits(draft.party.map((m) => m.character), choice.requiresClass), ctx);
  const ups = landRanks(draft, ctx);
  const entered = enterSceneDraft(draft, choice.goto, ctx);
  announceRankUps(draft, ups);
  announceDecision(draft, prompt, choice, playerId);
  // Only one presentation rides on a transition. Finishing the chapter is a
  // bigger beat than the tap that got you there, so it wins.
  if (entered?.kind === "CHAPTER_COMPLETE") return entered;
  return { kind: "CHOICE_MADE", choiceId: winning, byPlayerId: playerId };
}

/**
 * A kid at a class place or the fitting stall keeping the class they wear
 * (#311, #312). Only a record of the answer, so the way on stops waiting for
 * them; nothing about the hero changes, which is why the engine can take it
 * while a switch, which writes the hero's row, goes through the server
 * (`prepareClassSwitch`).
 */
function doKeepClass(draft: RunState, playerId: string, classId: unknown, stall: boolean): Presentation | undefined {
  const refusal = classAnswerRefusal(draft, playerId, classId, false, stall);
  if (refusal) throw new Illegal("ILLEGAL", refusal);
  const place = draft.classPlace;
  // classAnswerRefusal has already said no to a run without one.
  if (!place) return undefined;
  place.answers = { ...place.answers, [playerId]: { switched: false } };
  return undefined;
}

/**
 * Whose turn it is to pick a Story choice (spec §6.1): the seat the marker
 * points at, or the next connected seat after it. A phone that has dropped
 * keeps its place in the rotation but is never handed a turn it cannot take.
 * Null only for an empty party, which leaves the choice open to anyone.
 */
export function storyTurnHolder(state: RunState): PartyMember | null {
  const n = state.party.length;
  if (n === 0) return null;
  const start = (((state.storyTurn ?? 0) % n) + n) % n;
  for (let i = 0; i < n; i++) {
    const member = state.party[(start + i) % n] as PartyMember;
    if (member.connected) return member;
  }
  return state.party[start] ?? null;
}

/**
 * A turn-held Story choice whose holder has since dropped is open to anyone.
 * The prompt names the holder when it opens; if their phone dies before they
 * tap, the chapter must not wait forever on them — the same reasoning that
 * lets a vote close without a disconnected voter.
 */
export function turnHolderAway(
  party: readonly PartyMember[],
  prompt: Prompt & { kind: "choice" },
): boolean {
  if (prompt.vote || prompt.forPlayerIds.length === 0) return false;
  return prompt.forPlayerIds.every((id) => {
    const member = party.find((m) => m.playerId === id);
    return !member || !member.connected;
  });
}

/**
 * A check whose nominated roller has dropped (or left) is open to anyone, for
 * the same reason as `turnHolderAway`: the chapter must not wait on a phone
 * that is not there.
 */
export function rollerAway(
  party: readonly PartyMember[],
  prompt: Prompt & { kind: "roll" },
): boolean {
  const away = (id: string): boolean => {
    const member = party.find((m) => m.character.id === id);
    return !member || !member.connected;
  };
  // A whole-party check is stuck only once *everybody* still to roll is away.
  return prompt.group ? prompt.group.pending.every(away) : away(prompt.characterId);
}

function passStoryTurn(draft: RunState, fromPlayerId: string): void {
  const at = draft.party.findIndex((m) => m.playerId === fromPlayerId);
  draft.storyTurn = (at === -1 ? (draft.storyTurn ?? 0) : at) + 1;
}

/**
 * A lobby vote for which campaign to play. Only a seated player votes — the
 * same people whose READY the chapter start waits on — and only for one of the
 * campaigns the server offered this room. `campaign` follows the leader, so the
 * TV's "Chapter 3 of 8" line and the Begin button always name the campaign
 * that a tap would start.
 */
function doVoteCampaign(draft: RunState, playerId: string, campaignId: string): undefined {
  // "creation" is the lobby too — see doStartChapter: the engine sets it on
  // the first character and never clears it.
  if (draft.phase !== "lobby" && draft.phase !== "creation") {
    throw new Illegal("ILLEGAL", "the campaign is picked in the lobby");
  }
  if (!memberByPlayer(draft, playerId)) {
    throw new Illegal("NOT_FOUND", `player "${playerId}" is not in this run`);
  }
  const options = draft.campaignOptions ?? [];
  const voted = options.find((option) => option.id === campaignId);
  if (!voted) {
    throw new Illegal("ILLEGAL", `"${campaignId}" is not one of this room's campaigns`);
  }
  // A locked campaign (#221) is shown, not choosable: a vote for it could only
  // win a Begin the server then refuses.
  if (voted.locked) {
    throw new Illegal("ILLEGAL", `"${voted.title}" is locked: ${voted.locked.reason}`);
  }
  draft.campaignVotes = { ...(draft.campaignVotes ?? {}), [playerId]: campaignId };
  const leader = lobbyCampaign(draft).leader;
  if (leader) draft.campaign = leader;
  return undefined;
}

/** Where the lobby's campaign decision stands. */
export interface LobbyCampaignChoice {
  /**
   * The campaign a Begin tap would play right now: the only option, or the
   * vote's leader. Before anybody has voted, it is the campaign the screens
   * already show (`RunState.campaign`), else the first option. Null only on a
   * run with neither options nor a campaign.
   */
  leader: CampaignView | null;
  /** Seated, connected players who have not voted yet. Empty with one option. */
  waitingOn: PartyMember[];
  /**
   * True when the room has a real choice to make: two or more options it could
   * start. A locked option (#221) is shown, never voted for, so Gemfall beside
   * a locked sequel is no question at all.
   */
  contested: boolean;
}

/**
 * The lobby's campaign decision, as the server enforces it and the screens show
 * it — one function so the two can never disagree.
 *
 * One startable option is no decision at all: it is picked without a vote,
 * whatever locked options sit beside it. Two or more, and every connected seat votes before the chapter can start; a phone that has
 * dropped is not waited on, exactly as a Choice point does not wait on it. The
 * count is `tallyVotes`, so a tie breaks toward the story turn marker.
 */
export function lobbyCampaign(state: RunState): LobbyCampaignChoice {
  const options = state.campaignOptions ?? [];
  const unlocked = (option: CampaignView) => option.locked === undefined;
  const open = options.filter(unlocked);
  if (open.length <= 1) {
    // With every option locked, the one the screens already show, so they
    // give its reason instead of a Begin.
    const leader =
      open[0] ?? options.find((option) => option.id === state.campaign?.id) ?? options[0] ?? state.campaign ?? null;
    return { leader, waitingOn: [], contested: false };
  }
  const votes: Record<string, string> = {};
  for (const member of state.party) {
    const vote = state.campaignVotes?.[member.playerId];
    if (vote !== undefined && open.some((option) => option.id === vote)) {
      votes[member.playerId] = vote;
    }
  }
  const waitingOn = state.party.filter((m) => m.connected && votes[m.playerId] === undefined);
  const leaderId = Object.keys(votes).length > 0 ? tallyVotes(state, votes) : null;
  // Before anybody votes, the leader is whatever the screens already show
  // (the room's campaign, or the one this room just played), else the first —
  // skipping a locked campaign (#221), which a Begin could only be refused on.
  const shownId = state.campaign?.id;
  const leader =
    open.find((option) => option.id === leaderId) ??
    open.find((option) => option.id === shownId) ??
    open[0] ??
    null;
  return { leader, waitingOn, contested: true };
}

/**
 * Most votes wins. Ties break toward the story turn marker (spec §6.1): the
 * player whose turn it is gets their way if their vote is among the tied, and
 * otherwise the first tied vote after them in turn order does.
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
  const n = draft.party.length;
  const holder = storyTurnHolder(draft);
  const from = holder ? draft.party.indexOf(holder) : 0;
  for (let i = 0; i < n; i++) {
    const member = draft.party[(from + i) % n] as PartyMember;
    const vote = votes[member.playerId];
    if (vote !== undefined && tied.includes(vote)) return vote;
  }
  return tied[0] as string;
}

/**
 * Puts the party's story-check buff (#222) on a roll prompt — the one the
 * next roll would spend (`checkBuffOffer`) — or takes it off when there is
 * none left. The key is written only while there is an offer, so a check in
 * a run without check buffs (every ordered campaign's) keeps its shape.
 */
function offerCheckBuff(prompt: Prompt & { kind: "roll" }, draft: RunState): void {
  const offer = checkBuffOffer(draft.buffs);
  if (offer) prompt.buff = offer;
  else delete prompt.buff;
}

/**
 * The story-check buff (#222) this roll spends, if any: the prompt's offer
 * when it is `"auto"`, or when the roller said yes to it (`ROLL.spendBuff`).
 *
 * A yes to a buff that is no longer on offer — a stale phone, a friend in a
 * whole-party check spent it first — is a plain roll: the die goes with the
 * tap, without the bonus, and nothing else is ever spent in its place. Only a
 * `spendBuff` that is not a buff id at all (no phone sends one) is refused,
 * before a die is thrown, as the malformed intent it is.
 */
function checkBuffSpent(prompt: Prompt & { kind: "roll" }, spendBuff: unknown): CheckBuffOffer | undefined {
  if (spendBuff !== undefined && typeof spendBuff !== "string") {
    throw new Illegal("ILLEGAL", "spendBuff names a buff by its id");
  }
  const offer = prompt.buff;
  if (!offer) return undefined;
  return offer.spend === "auto" || spendBuff === offer.id ? offer : undefined;
}

/** The run's buffs once `spent` has been spent on a roll (#222). */
function spendOnRoll(draft: RunState, spent: CheckBuffOffer | undefined): void {
  if (spent && draft.buffs !== undefined) draft.buffs = spendCheckBuff(draft.buffs, spent.id);
}

/**
 * One roll toward a whole-party check (`roller: "all"`). Everyone still pending
 * rolls their own d20 + stat; once nobody is, half or more succeeding takes
 * the success branch. Each roll gets its own dice card, and the last one also
 * carries the party's tally.
 *
 * A pending player whose phone has dropped can be rolled for: once everybody
 * still pending is away, any seated player's tap rolls (as themselves) in the
 * first absent player's place, so the check cannot stall on an empty chair.
 */
function doGroupRoll(
  draft: RunState,
  playerId: string,
  ctx: EngineContext,
  prompt: Prompt & { kind: "roll" },
  group: { pending: string[]; rolls: DiceRoll[] },
  spendBuff: unknown,
): Presentation | undefined {
  const me = memberByPlayer(draft, playerId);
  if (!me) throw new Illegal("FORBIDDEN", "only a seated player can roll");
  const slot = group.pending.includes(me.character.id)
    ? me.character.id
    : rollerAway(draft.party, prompt)
      ? group.pending[0]
      : undefined;
  if (slot === undefined) {
    throw new Illegal("ILLEGAL", `${me.character.name} has already rolled`);
  }

  const { scene } = currentScene(draft, ctx);
  if (scene.type !== "check") throw new Illegal("ILLEGAL", "the current scene is not a check");

  // One story-check buff is one die's worth (#222): whoever spends it, it is
  // on their roll alone, and the next roller is offered whatever is left.
  const spent = checkBuffSpent(prompt, spendBuff);
  const matchup = checkMatchup(ctx, me.character, scene);
  const result = resolveCheck(ctx.rng, {
    characterId: me.character.id,
    stat: scene.stat,
    mod: me.character.stats[scene.stat],
    tn: scene.tn,
    ...(spent === undefined ? {} : { buff: spent }),
    ...(matchup === undefined ? {} : { matchup }),
  });
  spendOnRoll(draft, spent);
  group.rolls.push(result);
  creditCheckXp(draft, ctx, result);
  group.pending = group.pending.filter((id) => id !== slot);
  // A die rolled in a group check is a turn rolled like any other: it counts
  // toward the "fewest checks" rotation for whoever actually threw it, a
  // stand-in for an absent friend included.
  draft.checkRolls = {
    ...draft.checkRolls,
    [me.character.id]: (draft.checkRolls?.[me.character.id] ?? 0) + 1,
  };

  if (group.pending.length > 0) {
    prompt.characterId = group.pending[0] as string;
    if (spent) offerCheckBuff(prompt, draft);
    draft.lastRoll = result;
    return { kind: "ROLL", roll: result };
  }

  const made = group.rolls.filter((r) => r.result === "success").length;
  const of = group.rolls.length;
  const outcome = made * 2 >= of ? "success" : "failure";
  const last: DiceRoll = { ...result, group: { made, of, result: outcome } };
  draft.lastRoll = last;
  draft.prompt = null;
  // No single roller: a branch effect aimed at "the roller" lands on the party.
  takeBranch(draft, outcome === "success" ? scene.onSuccess : scene.onFailure, ctx);
  return { kind: "ROLL", roll: last };
}

/**
 * Offer a friend your die on their check. One helper per check, never the
 * roller, and once per rest: the helper's die joins the roll when the roller
 * taps, sized by the helper's tier (content/rules.json `helpDie`).
 */
function doHelp(draft: RunState, playerId: string, ctx: EngineContext): Presentation | undefined {
  const prompt = draft.prompt;
  if (!prompt || prompt.kind !== "roll") {
    throw new Illegal("ILLEGAL", "there is no check to help with");
  }
  const helper = memberByPlayer(draft, playerId);
  if (!helper) throw new Illegal("FORBIDDEN", "only a seated player can help");
  if (prompt.group) throw new Illegal("ILLEGAL", "everyone is rolling this one");
  if (helper.character.id === prompt.characterId) {
    throw new Illegal("ILLEGAL", "you cannot help your own roll");
  }
  if (helper.down) throw new Illegal("ILLEGAL", `${helper.character.name} is knocked down`);
  if (prompt.helper) throw new Illegal("ILLEGAL", "someone is already helping");
  if (draft.helpSpent?.includes(helper.character.id)) {
    throw new Illegal("ILLEGAL", `${helper.character.name} has already helped since the last rest`);
  }
  const sides = (ctx.rules.helpDie ?? DEFAULT_HELP_DIE)[helper.character.tier];
  prompt.helper = { characterId: helper.character.id, sides };
  draft.helpSpent = [...(draft.helpSpent ?? []), helper.character.id];
  return undefined;
}

/**
 * The matchups on a hero's check (docs/matchups.md): edges on the scene's
 * `tags`, and the opinions of the creatures it `discovers` or `cast`s.
 * Undefined without `ctx.matchups` or when nothing applies, so the roll
 * carries no `matchup` key and totals what it always did.
 */
function checkMatchup(
  ctx: EngineContext,
  character: ResolvedCharacter,
  scene: { tags?: string[]; discovers?: string[]; cast?: { figure: string }[] },
): MatchupInput | undefined {
  if (!ctx.matchups) return undefined;
  const notes = checkNotes(ctx.matchups, { species: character.species, class: character.class }, {
    ...(scene.tags ? { tags: scene.tags } : {}),
    creatures: sceneCreatures(scene, ctx.bestiary),
  });
  if (notes.length === 0) return undefined;
  return { amount: matchupTotal(notes).roll, notes };
}

function doRoll(draft: RunState, playerId: string, ctx: EngineContext, spendBuff?: unknown): Presentation | undefined {
  const prompt = draft.prompt;
  if (!prompt || prompt.kind !== "roll") {
    throw new Illegal("ILLEGAL", "nothing is waiting on a roll");
  }
  if (prompt.group) return doGroupRoll(draft, playerId, ctx, prompt, prompt.group, spendBuff);
  const nominated = memberByCharacter(draft, prompt.characterId);
  // The nominee's phone can drop after the prompt opens (presence changes do
  // not run through the engine). Then the check is open to anyone, and whoever
  // taps rolls as themselves: their stat, their turn counted.
  const roller =
    nominated?.playerId === playerId
      ? nominated
      : rollerAway(draft.party, prompt)
        ? memberByPlayer(draft, playerId)
        : undefined;
  if (!roller) {
    throw new Illegal("FORBIDDEN", `it is ${nominated?.character.name ?? "someone else"}'s roll`);
  }

  const { scene } = currentScene(draft, ctx);
  if (scene.type !== "check") throw new Illegal("ILLEGAL", "the current scene is not a check");

  // Rolled here, in the engine, on the server. Never in the browser
  // (architecture §4.1).
  // Nobody helps themselves: a helper who ends up rolling (their nominee's
  // phone dropped) gets the help back instead of adding their own die.
  const helper = prompt.helper?.characterId === roller.character.id ? undefined : prompt.helper;
  // The party's story-check buff (#222): spent if it is automatic or the
  // roller said yes to the one on offer; a yes to one no longer on offer is
  // a plain roll.
  const spent = checkBuffSpent(prompt, spendBuff);
  if (prompt.helper && !helper) {
    draft.helpSpent = (draft.helpSpent ?? []).filter((id) => id !== roller.character.id);
  }
  const matchup = checkMatchup(ctx, roller.character, scene);
  const result: DiceRoll = resolveCheck(ctx.rng, {
    characterId: roller.character.id,
    stat: scene.stat,
    mod: roller.character.stats[scene.stat],
    tn: scene.tn,
    ...(helper === undefined ? {} : { help: helper }),
    ...(spent === undefined ? {} : { buff: spent }),
    ...(matchup === undefined ? {} : { matchup }),
  });
  spendOnRoll(draft, spent);
  draft.lastRoll = result;
  draft.prompt = null;
  draft.checkRolls = {
    ...draft.checkRolls,
    [roller.character.id]: (draft.checkRolls?.[roller.character.id] ?? 0) + 1,
  };

  creditCheckXp(draft, ctx, result);
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
/**
 * Who starts a `friendDown` fight knocked down (#255): the first hero after
 * the story-turn holder, preferring one whose phone is here, so the kid who
 * is helped up sees it happen. Null with fewer than two heroes seated.
 */
function friendToHelpUp(draft: RunState): string | null {
  const seated = seatedMembers(draft);
  const n = seated.length;
  if (n < 2) return null;
  const holder = storyTurnHolder(draft);
  const start = holder ? Math.max(seated.indexOf(holder), 0) : 0;
  const others = Array.from({ length: n - 1 }, (_, i) => seated[(start + 1 + i) % n]!);
  return (others.find((member) => member.connected) ?? others[0]!).character.id;
}

function startEncounter(draft: RunState, ctx: EngineContext): readonly EncounterEvent[] {
  const { scene } = currentScene(draft, ctx);
  if (scene.type !== "encounter") throw new Illegal("ILLEGAL", "not on an encounter scene");

  const map = ctx.map?.(scene.map) ?? null;
  if (!map) throw new Illegal("NOT_FOUND", `map "${scene.map}" is not loaded`);

  // Only the members still in the game take the field (#389): somebody the
  // host took out keeps their place in `party`, not a spawn tile, so a new kid
  // in the seat they freed has one.
  const seated = seatedMembers(draft);
  if (seated.length === 0) throw new Illegal("ILLEGAL", "nobody is left at the table to fight");
  /*
   * A party that walks in with every hero already down would lose before
   * anybody had a turn (#389): the monsters act, nobody can, the fight is
   * over. That happens after a lost fight whose `onDefeat` road leads to
   * another fight with no rest between. The loss already took its cost (that
   * fight's road, and every hit point), so this fight is not a second one: the
   * heroes scramble up at 1 hp, as a rest would stand them, only barely. One
   * hero still standing, or a friend the practice knocks down on purpose, is a
   * table that can play, and walks in exactly as it is.
   */
  if (seated.every((member) => member.down || member.hp <= 0)) {
    for (const member of seated) {
      member.hp = Math.max(member.hp, 1);
      member.down = false;
    }
  }
  // The practice's Help Up lesson (#255): one friend walks in knocked down.
  const downId = scene.friendDown ? friendToHelpUp(draft) : null;
  const party: PartyPlacement[] = seated.map((member, i) => {
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
        `map "${map.id}" has ${map.partySpawns.length} party spawns, the party is ${seated.length}`,
      );
    }
    // Luckstone charges come from the bag (content/items.json `rerollOnes`).
    const rerollOnes = member.character.inventory.reduce((n, entry) => {
      const passive = ctx.items[entry.itemId]?.passive;
      return passive?.type === "rerollOnes" ? n + passive.perEncounter : n;
    }, 0);
    const helpMeUp = member.character.id === downId;
    return {
      character: member.character,
      at,
      hp: helpMeUp ? 0 : member.hp,
      down: helpMeUp || member.down,
      ...(rerollOnes > 0 ? { rerollOnes } : {}),
    };
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

  // Temporary buffs (#200): the run's, on the heroes they target. Only a
  // graph campaign's run holds any; for every other fight there is no
  // `buffs` in the setup and none on the state.
  const held = draft.buffs ?? [];
  const heroIds = seated.map((member) => member.character.id);
  const buffs =
    held.length > 0
      ? combatBuffsFor(held, heroIds, heroIds[oneHeroSeat(draft.storyTurn, heroIds.length)] ?? null)
      : [];

  draft.encounter = {
    ...beginEncounter(
      {
        board: parseBoard(map.rows),
        party,
        enemies,
        ...(buffs.length > 0 ? { buffs } : {}),
        // The place fighting back (#201) — only a scene that declared one —
        // as the world has left it (#220): the first variant the run's facts
        // satisfy. No variants, the scene's own object.
        ...(scene.environment
          ? {
              environment: resolveEnvironment(scene.environment, (when) =>
                Object.entries(when.facts).every(([id, test]) => factTestHolds(test, draft.facts?.[id])),
              ),
            }
          : {}),
      },
      combatCtx(ctx),
    ),
    // The step this fight began on. Unique per fight and replayed identically
    // from the event log, so it is the fight's identity (EncounterState).
    startedAt: draft.seq,
  };

  /*
   * The ready-up has been answered — close it.
   *
   * `enterSceneDraft` opens a `ready` prompt in front of every encounter so
   * three phones can swap to a combat UI before anybody's figure takes a hit.
   * Its whole job is to gate this moment, and this is the moment; leaving it
   * open means the board goes up *and* the ready prompt is still standing.
   *
   * That is not cosmetic. Only one prompt is ever open at a time, and a stale
   * one is a control that outlives its question: for the rest of the fight
   * every phone renders "You're ready / Wait, not yet" beside the combat UI,
   * and tapping it un-readies a player in the middle of a round it has no
   * business touching. It also gives anything driving the game by what is on
   * screen — a test, or a person — a prompt to answer forever instead of a
   * turn to take, which is exactly how it was found: a fight stuck in round 2
   * with a ready prompt still open and all three players already ready.
   */
  draft.prompt = null;
  // A new fight: nobody has been down in it, hit anything or grown a wall.
  (draft.deeds ??= { heroes: {} }).fight = freshFightDeeds();
  delete draft.rankUps;

  // Whoever the initiative roll put first might be a monster, so the fight has
  // to be walked forward before anybody's phone is asked for anything.
  const opening = runEnemyTurns(draft, ctx);
  countFightEvents(draft, opening, ctx);
  return opening;
}

/**
 * The figure whose turn it is, if this player owns it.
 *
 * Every combat intent goes through here, and it is the whole authority check:
 * a phone may only ever act as the character it owns, on that character's turn.
 * Without it, any player could drive anybody's figure — including a monster's.
 */
function requireTurn(draft: RunState, playerId: string, standIn = false): EncounterState {
  const encounter = draft.encounter;
  if (!encounter) throw new Illegal("ILLEGAL", "there is no fight going on");
  const actor = currentActor(encounter);
  if (!actor) throw new Illegal("ILLEGAL", "nobody can act");
  if (actor.side !== "party") throw new Illegal("FORBIDDEN", "it is not your turn");

  const member = draft.party.find((m) => m.character.id === actor.id);
  if (!member) throw new Illegal("ILLEGAL", `no party member for actor "${actor.id}"`);
  // Passing the turn of a hero whose player has stepped away (#258) is the
  // one thing a stand-in may do: never their move, never their action.
  if (member.playerId !== playerId && !(standIn && combatTurnAway(draft) && memberByPlayer(draft, playerId))) {
    throw new Illegal("FORBIDDEN", `it is ${member.character.name}'s turn, not yours`);
  }
  return encounter;
}

function doCombatMove(
  draft: RunState,
  playerId: string,
  to: Position,
  ctx: EngineContext,
): Presentation | undefined {
  const encounter = requireTurn(draft, playerId);
  const result = moveTo(encounter, to);
  // A refusal is a stale phone, not a cheat: the highlight it tapped was drawn
  // from a board that has since moved on. Say so and let it resync.
  if (!result.ok) throw new Illegal("ILLEGAL", result.reason);
  draft.encounter = result.state;
  countFightEvents(draft, result.events, ctx);
  // Twin Step's second walk is the only move that can be a turn's last act;
  // when it is, the turn ends here rather than waiting to be told.
  return finishTurnIfSpent(draft, ctx, result.events);
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
  creditAttackXp(draft, result.events, ctx, currentActorId(encounter));
  // Deeds (#310): who did it, with what, to a fight as it stood before.
  const memo = draft.deeds?.fight;
  const actorId = currentActorId(encounter);
  if (memo && actorId) {
    const counted = actionCredits(
      memo,
      {
        actorId,
        abilityId: intent.abilityId,
        ability: (ctx.abilities ?? {})[intent.abilityId] ?? null,
        targetIds: request.targetIds ?? (request.targetId ? [request.targetId] : []),
        targetTiles: request.targetTiles ?? (request.targetTile ? [request.targetTile] : []),
        before: encounter,
      },
      result.state,
      result.events,
    );
    draft.deeds!.fight = counted.memo;
    creditDeeds(draft, counted.credits, ctx);
  }
  return finishTurnIfSpent(draft, ctx, result.events);
}

function doEndTurn(draft: RunState, playerId: string, ctx: EngineContext): Presentation | undefined {
  const encounter = requireTurn(draft, playerId, true);
  creditTurnEnd(draft, encounter, ctx);
  // What the place did as the turn ended (#201) — nothing, without an
  // environment — goes first in the queue, before the monsters' answer.
  const ended = endTurnWithEvents(encounter);
  draft.encounter = ended.state;
  // Handing over may hand over to a monster, and monsters do not wait to be
  // asked. Their entire run is one ordered animation queue.
  const events = [...ended.events, ...runEnemyTurns(draft, ctx)];
  countFightEvents(draft, events, ctx);
  return combatPresentation(events, settleEncounter(draft, ctx));
}

/** The slice of `EngineContext` a combat call needs. */
function combatCtx(ctx: EngineContext) {
  return {
    rules: ctx.rules,
    abilities: ctx.abilities ?? {},
    rng: ctx.rng,
    ...(ctx.matchups ? { matchups: ctx.matchups } : {}),
  };
}

/**
 * Closes out a turn that has nothing left in it.
 *
 * §7.2 is "move up to your steps, then take one action", and once the action
 * is spent the only thing a phone could still send is END_TURN. Asking for
 * that tap was two more taps on every turn (the button, then its confirm), so
 * the engine now hands the clock on itself the moment the active hero has
 * neither an action nor a legal step left: the action is taken and
 * `legalMoves` is empty, which already knows about Twin Step's extra walk.
 *
 * It runs the monsters' turns in the same intent, so what reaches the table
 * is one ordered sequence: the hero's swing, then the wisps' answer, then any
 * branch the fight's end takes. END_TURN stays for the turn a player chooses
 * to give up early (steps left after acting, or nothing worth doing).
 *
 * The fight may have ended on the action itself. `settleEncounter` runs
 * either way, after the enemy turns when there were any, and the branch waits
 * behind the ordered roll/damage/down events rather than replacing them.
 */
function finishTurnIfSpent(
  draft: RunState,
  ctx: EngineContext,
  events: readonly EncounterEvent[],
): Presentation | undefined {
  const encounter = draft.encounter;
  let all = events;
  if (
    encounter &&
    encounterOutcome(encounter) === "ongoing" &&
    encounter.actionTaken &&
    legalMoves(encounter).length === 0
  ) {
    creditTurnEnd(draft, encounter, ctx);
    const ended = endTurnWithEvents(encounter);
    draft.encounter = ended.state;
    const after = [...ended.events, ...runEnemyTurns(draft, ctx)];
    // `events` were the action's own, counted by its caller.
    countFightEvents(draft, after, ctx);
    all = [...events, ...after];
  }
  return combatPresentation(all, settleEncounter(draft, ctx));
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
      enemy: {
        id: actor.id,
        at: positionOfActor(encounter, actor.id),
        steps: encounter.stepsLeft,
        // Its own way with the place (#220), only where it has one.
        ...(actor.rift ? { rift: actor.rift } : {}),
      },
      // A hero through a rift exit (#201) is off the board, and no target.
      party: encounter.combatants
        .filter((c) => c.side === "party" && !c.escaped)
        .map((c) => ({
          id: c.id,
          at: positionOfActor(encounter!, c.id),
          hp: c.hp,
          maxHp: c.maxHp,
          down: c.down,
        })),
      // The place, only when the fight has one (#201): the round this turn is
      // played in and whether the captive still waits. A fight without an
      // environment hands nothing over, and its monsters plan exactly as
      // they always did.
      ...(encounter.environment
        ? {
            environment: {
              spec: encounter.environment.spec,
              round: encounter.round,
              ...(encounter.environment.rescue ? { rescue: encounter.environment.rescue } : {}),
              ...riftBehaviors(encounter),
            },
          }
        : {}),
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
    const ended = endTurnWithEvents(encounter);
    encounter = ended.state;
    events.push(...ended.events);
  }

  draft.encounter = encounter;
  return events;
}

/** Every monster's `rift` behaviour (#220), by id — or nothing, when none has one. */
function riftBehaviors(encounter: EncounterState): { behaviors?: Record<string, RiftBehavior> } {
  const behaviors: Record<string, RiftBehavior> = {};
  for (const c of encounter.combatants) if (c.side === "enemy" && c.rift) behaviors[c.id] = c.rift;
  return Object.keys(behaviors).length > 0 ? { behaviors } : {};
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
/**
 * Carries a fight's damage out onto the party.
 *
 * A fight that cost her six hit points is a fight she is still six hit points
 * down from at the next scene. While the board is up, `combatants` is where a
 * hero's current hit points live and `draft.party` still holds what they walked
 * in with — so this has to run before `draft.encounter` is dropped, on **every**
 * path that drops it. There are two, and the second one is easy to miss: a
 * playtest jump also ends a fight, just not by winning or losing it.
 */
function carryDamageOut(draft: RunState, encounter: EncounterState): void {
  for (const member of draft.party) {
    const combatant = encounter.combatants.find((c) => c.id === member.character.id);
    if (!combatant) continue;
    member.hp = combatant.hp;
    member.down = combatant.down;
    member.ready = false;
  }
}

/**
 * A fight is over, however it ended: the run's temporary buffs (#200) are one
 * fight nearer spent, and a lost one ends those that end on defeat
 * (`spendRunBuffs`). Like `carryDamageOut`, it runs on every path that drops
 * `draft.encounter`. A run without buffs — every ordered campaign's — is left
 * without the key.
 */
function spendBuffs(draft: RunState, outcome: EncounterOutcome): void {
  if (draft.buffs === undefined) return;
  // Getting out through a rift exit, or being thrown out when it collapses
  // (#201), ends the fight without losing it: not a defeat, so a buff that
  // ends on defeat survives a retreat.
  draft.buffs = spendRunBuffs(draft.buffs, outcome === "defeat" ? "defeat" : outcome === "ongoing" ? "ongoing" : "victory");
}

function settleEncounter(draft: RunState, ctx: EngineContext): Presentation | undefined {
  const encounter = draft.encounter;
  if (!encounter) return undefined;
  const outcome = encounterOutcome(encounter);
  if (outcome === "ongoing") return undefined;

  carryDamageOut(draft, encounter);
  spendBuffs(draft, outcome);
  // The fight is over: the ranks it earned land (#310).
  forgetFight(draft);
  const ups = landRanks(draft, ctx);

  const { scene } = currentScene(draft, ctx);
  if (scene.type !== "encounter") throw new Illegal("ILLEGAL", "no encounter is running");
  draft.encounter = null;
  // A captive freed during the fight (#201) is a story fact however the fight
  // ended — won, lost, escaped or collapsed — so the rescue's own effects land
  // before the branch's, and the branch (and its narration variants) can read
  // them. A captive still waiting, or lost, is simply left behind.
  // The place as it was fought (#220): the resolved spec the fight carries.
  const place = encounter.environment?.spec;
  if (place && encounter.environment) recordFightEnding(draft, encounter, outcome);
  if (place && encounter.environment) {
    const statuses = captiveStatuses(encounter.environment);
    captivesOf(place).forEach((captive, i) => {
      if (captive.effects && statuses[i] === "freed") applyEffectsDraft(draft, captive.effects, ctx);
    });
    // An objective done (#220) is a story fact the same way.
    const done = objectivesDone(encounter.environment);
    (place.objectives ?? []).forEach((objective, i) => {
      if (objective.effects && done[i]) applyEffectsDraft(draft, objective.effects, ctx);
    });
  }
  const branched = takeBranch(draft, outcomeBranch(scene, outcome), ctx);
  announceRankUps(draft, ups);
  return branched;
}

/**
 * What the completion screen will say about a fight that fought back (#220):
 * how it ended, who was freed or lost, what got done. Only an environmental
 * fight is recorded, so a run without one never grows the key.
 */
function recordFightEnding(draft: RunState, encounter: EncounterState, outcome: Exclude<EncounterOutcome, "ongoing">): void {
  const env = encounter.environment;
  if (!env) return;
  const captives = captivesOf(env.spec);
  const statuses = captiveStatuses(env);
  const done = objectivesDone(env);
  const objectives = env.spec.objectives ?? [];
  const winner = objectives.find((o, i) => o.endsFight && done[i]);
  const monstersStanding = encounter.combatants.some((c) => c.side === "enemy" && !c.down);
  (draft.fightEndings ??= []).push({
    outcome,
    ...(outcome === "victory" && winner && monstersStanding ? { byObjective: winner.label } : {}),
    freed: captives.filter((_, i) => statuses[i] === "freed").map((c) => c.name),
    lost: captives.filter((_, i) => statuses[i] === "lost").map((c) => c.name),
    done: objectives.filter((_, i) => done[i]).map((o) => o.label),
  });
}

/**
 * Back to the lobby. The party is intact, everyone re-readies, and the
 * lobby's button continues the campaign — the server picks the next chapter
 * from the household's attempt (CONTINUE_CAMPAIGN), so playing on tonight and
 * playing on next week are the same tap.
 */
function returnToLobby(draft: RunState): void {
  draft.phase = "lobby";
  draft.chapterId = null;
  draft.chapterInfo = null;
  draft.sceneId = null;
  draft.sceneType = null;
  draft.narration = "";
  draft.art = null;
  draft.scenePriority = null;
  delete draft.hint;
  draft.prompt = null;
  draft.lastRoll = null;
  delete draft.deeds;
  delete draft.rankUps;
  for (const member of draft.party) member.ready = false;
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
    returnToLobby(draft);
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

    setBag(member, held.inventory, ctx);
    draft.encounter = applied.state;
    countFightEvents(draft, applied.events, ctx);
    // A consumable spends the same one action an attack does, and so ends
    // the turn the same way.
    return finishTurnIfSpent(draft, ctx, applied.events);
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

  setBag(member, result.inventory, ctx);
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
    // Its owner stepped away mid-find (#258): anyone seated may let it go, so
    // the scene behind the prompt can open. Only "leave it": nobody empties a
    // friend's bag for them, and they come back to the hero they left.
    if (!(swapOwnerAway(draft.party, prompt) && memberByPlayer(draft, playerId) && dropItemId === null)) {
      throw new Illegal("FORBIDDEN", `this is ${member.character.name}'s bag`);
    }
  }

  if (dropItemId !== null) {
    if (!member.character.inventory.some((e) => e.itemId === dropItemId)) {
      throw new Illegal("ILLEGAL", `${member.character.name} is not carrying "${dropItemId}"`);
    }
    setBag(
      member,
      swapItem(member.character.inventory, prompt.incomingItemId, dropItemId, ctx.items),
      ctx,
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
  // A visitor's hero lives in another household (#249), and nothing moves
  // between households in v1: the bag it went home in would not be theirs.
  if (!sameHome(from, to)) {
    throw new Illegal("FORBIDDEN", `${to.character.name} is from another home, and items can only be passed within one`);
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
  /*
   * A drop named when there is room is refused, not honoured. `dropItemId`
   * means one thing — "make room" — and there is no room to make, so obeying
   * it would destroy an item for nothing. That is the rule `doUseItem` already
   * states in the other direction: rejected rather than consumed, because
   * losing a thing for nothing is worse than being told no.
   *
   * Reachable without a bad client: she picks what to put down while her bag
   * is full, then frees a slot before tapping accept.
   */
  if (!full && dropItemId !== undefined) {
    throw new Illegal("ILLEGAL", `${to.character.name} has room — nothing needs to go down`);
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
  setBag(from, removeItem(from.character.inventory, offer.itemId), ctx);
  setBag(to, received.inventory, ctx);

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
  const seated = seatedMembers(state);
  return seated.length > 0 && seated.every((m) => m.down);
}
