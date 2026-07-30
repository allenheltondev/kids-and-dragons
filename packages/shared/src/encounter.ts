/**
 * Encounters — spec §7, roadmap chapter 4.
 *
 * grid.ts answered *where can I stand*. This module answers *whose turn is it*
 * and *what may I do*, and it is the other half of "tactical, but deliberately
 * shallow" (§7). Enemy AI, animation and the engine wiring are elsewhere;
 * nothing here reads a clock, a global, or `Math.random()`.
 *
 * Five decisions shape the whole file.
 *
 * **Abilities are content, effects are code.** §7.2 lists Attack, class action,
 * species action, Help Up and Ready, and `content/rules.json` decides which
 * class actions and species actions exist. So there is no switch on ability
 * names anywhere below: an ability is a `CombatAbility` record — who you may
 * point it at, and a list of effects — and `performAction` walks the record.
 * Adding Bramble Wall or a fifth species is a catalog entry, per the roadmap's
 * "content as data" rule. The boundary is honest and worth stating plainly: a
 * new *ability* is data, a new *kind of effect* is a code change, because
 * effects are the verbs the engine knows how to perform. The ten verbs here
 * were chosen by writing out all four class signatures and all six species
 * actions from `rules.json` and taking the union; the level-3 and level-6
 * unlocks then fell out of the same vocabulary for free, which is the evidence
 * that it is the right size. Two do not fit and are deliberately not built:
 * Bramble Wall grows terrain on two tiles at once (multi-tile targeting) and
 * Encore hands somebody an extra turn (a second cursor). Both are level-9,
 * both belong to the pass that owns level unlocks.
 *
 * **`legalActions` is the only gate.** §7.2: "PlayerView shows only the actions
 * that are currently legal ... Illegal moves are not presented, so they can't be
 * attempted." The phone renders from `legalActions` / `legalMoves`, and
 * `performAction` re-derives the exact same sets before it applies anything.
 * One function, used twice, so the UX promise and the server check can never
 * drift apart — a phone that fell behind the couch and sent a stale tap gets a
 * refusal, not a free hit.
 *
 * **Nobody dies, and a wipe is a result rather than a state.** §7.3: at 0 HP a
 * character is knocked down, lies on the grid, skips turns, and any ally who
 * spends an action next to them (or a Songkeeper's Rally from range) lifts them
 * at 1 HP. There is no `defeat` phase in `EncounterState` and no terminal flag,
 * because the engine header is explicit that a party wipe *branches the story*.
 * `encounterOutcome()` is a query over the current state; the engine reads it
 * and walks to `onVictory` or `onDefeat` (types/chapter.ts). Nothing here can
 * end a run.
 *
 * **Turn order is rolled, once, from the injected `Rng`.** §7.2: "Quick,
 * highest first, rerolled each encounter so it isn't always the same person
 * going first." Randomness enters exactly the way dice.ts describes
 * (architecture §4.1) so a replay re-rolls identically. Ties break by Quick,
 * then party before enemy, then id — see `rollInitiative` for why.
 *
 * **State is plain JSON and inputs are never mutated.** `EncounterState` rides
 * inside `RunState` and reaches phones as a JSON Patch (architecture §4.2), so
 * there are no Maps, no Sets, no class instances and no `undefined` where a
 * `null` will do. Every function returns a new state.
 *
 * Positions are the one thing this module does *not* own. They live on the
 * board's actors, exactly once, which is grid.ts's invariant — a `Combatant`
 * carries HP and initiative and nothing spatial, so the two can never disagree
 * about where somebody is standing.
 */

import type { Position, ReachableTile } from "./grid.js";
import type { ActorId, ActorSide, Actor, Board } from "./grid.js";
import {
  actorById,
  actorsAdjacentTo,
  areAdjacent,
  isOpen,
  moveActor,
  placeActor,
  reachableTiles,
  removeActor,
  samePosition,
  stepsBetween,
} from "./grid.js";
import type { Rng } from "./dice.js";
import { resolveAttack, rollD20 } from "./dice.js";
import type { ResolvedCharacter, RulesContent, StatId } from "./types/domain.js";
import type { EnemySpec } from "./types/chapter.js";
import type { DiceRoll } from "./types/state.js";

// ---------------------------------------------------------------------------
// Abilities as data
// ---------------------------------------------------------------------------

/**
 * When an ability happens. Only `"action"` is ever offered as a button.
 *
 * Duskrunner's First Strike ("Go before anybody else on the first round") is
 * the reason this field exists: it is a class *signature*, so it arrives in
 * `ResolvedCharacter.actions` alongside Brace and Burst, but tapping it on your
 * turn would do nothing. Without a timing it would show up as a dead button on
 * an eight-year-old's phone, which §7.2 forbids in as many words.
 */
export type AbilityTiming = "action" | "initiative";

/** Which side an effect collects when it targets a group rather than one figure. */
export type AbilitySide = "ally" | "enemy";

/**
 * Who you may point an ability at — the whole of its legality, and therefore
 * the whole of what PlayerView is allowed to offer.
 */
export interface TargetRule {
  /**
   * `"none"` — no target at all (Ready, Ground Smash: the effects find their
   * own audience). `"self"` — you. `"ally"` / `"enemy"` — one figure.
   * `"tile"` — a square of the board (Gliding Leap, Pounce).
   */
  readonly kind: "none" | "self" | "ally" | "enemy" | "tile";
  /**
   * `"adjacent"` is "standing next to you" — one step, all eight directions
   * (grid.ts). A number is the "within N steps" the ability text already uses,
   * measured straight across the board and ignoring walls. `"board"` is
   * Rally's "from across the board". Absent means adjacent, because reaching
   * further is the exception worth writing down.
   */
  readonly range?: number | "adjacent" | "board";
  /**
   * Which figures qualify. Help Up is `"down"`, Rally is `"any"`, everything
   * else defaults to `"standing"` — you cannot swing at a monster that is
   * already out of the fight, and Mending Light cannot be wasted on a friend
   * lying on the floor, because healing does not lift anybody (§7.3).
   */
  readonly state?: "down" | "standing" | "any";
  /** A tile target must be somewhere you could actually stand. */
  readonly openTileOnly?: boolean;
  /**
   * A second figure selected after landing on a tile. Pounce uses this to
   * pair one legal landing tile with one adjacent enemy rather than hitting
   * everyone nearby or allowing a jump that has nobody to attack.
   */
  readonly followUp?: {
    readonly kind: "ally" | "enemy";
    readonly range?: number | "adjacent" | "board";
    readonly state?: "down" | "standing" | "any";
  };
  /**
   * Side collected by the `"area"` and `"adjacent"` effect scopes. Defaults to
   * the opposite of `kind` when that says one ("ally" → ally), and to `"enemy"`
   * for `"none"` / `"self"` / `"tile"`.
   */
  readonly affects?: AbilitySide;
  /**
   * Side length of the square the `"area"` scope collects, anchored with its
   * top-left corner on the target tile. Burst is `2`, which is literally
   * "every enemy inside a 2x2 square of tiles". Defaults to 1.
   */
  readonly area?: number;
}

/** Whom a single effect lands on, once the ability's target is chosen. */
export type EffectScope =
  /** The one figure that was targeted. Nothing, if the target was a tile. */
  | "target"
  /** The actor taking the action. */
  | "self"
  /** Everyone on the actor's side who is still standing, the actor included. */
  | "allies"
  /** Everyone of `affects` side standing next to the actor. Ground Smash. */
  | "adjacent"
  /** Everyone of `affects` side inside the `area` square at the target. Burst. */
  | "area";

/**
 * The ten verbs. Each is something the engine already knows how to do to a
 * figure; an ability is a list of them.
 */
export type AbilityEffect =
  /** d20 + your class stat vs. the target's Guard (§4.1, §7.2), then damage. */
  | { readonly type: "attack"; readonly damage: number }
  /** Damage with no roll to make — Starfall's "every enemy takes 2". */
  | { readonly type: "damage"; readonly amount: number }
  /** HP back, capped at max. Never lifts the knocked-down (§7.3). */
  | { readonly type: "heal"; readonly amount: number }
  /** §7.3 — back on their feet at 1 HP. Help Up, Rally. */
  | { readonly type: "revive" }
  /** +N on the next roll. Ready, Sky Watch, Glimmer. */
  | { readonly type: "rollBonus"; readonly amount: number }
  /** The actor lands on the target tile. Gliding Leap, Pounce. */
  | { readonly type: "moveSelf" }
  /** Shoved directly away from the actor, as far as the board allows. */
  | { readonly type: "shove"; readonly steps: number }
  /** Too busy to act — Fox Fire. Costs exactly one turn. */
  | { readonly type: "skipTurn" }
  /** Brace — the next hit meant for the target lands on the actor instead. */
  | { readonly type: "protect" }
  /** First Strike. Read once, when order is rolled; never on a turn. */
  | { readonly type: "goFirst" };

export interface AbilityEffectSpec {
  readonly effect: AbilityEffect;
  /** Defaults to `"target"`. */
  readonly to?: EffectScope;
  /**
   * Skip this effect unless the recipient is in that state. Rally is one
   * ability with two readings — "Heal a friend, **or** lift a knocked-down
   * friend back up" — and this is how the data says so, rather than the
   * resolver growing a rule about heals not stacking onto a revive.
   */
  readonly when?: "down" | "standing";
}

/**
 * One entry in the combat ability catalog. `name` and `icon` live here because
 * the roadmap's "icons before text" rule means no tappable thing ships without
 * one, and the three universal actions of §7.2 have no `rules.json` entry to
 * borrow from.
 */
export interface CombatAbility {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly timing: AbilityTiming;
  readonly target: TargetRule;
  readonly effects: readonly AbilityEffectSpec[];
  /** §7.2 — species actions are once per encounter. */
  readonly oncePerEncounter?: boolean;
}

/**
 * Every combat ability, by id. Authored content, loaded and handed in, exactly
 * like `RulesContent` and the item catalog. An id in a character's action list
 * with no entry here is skipped rather than thrown on, for the same reason
 * `resolveCharacter` tolerates a stale `unlockedActions` entry: a save written
 * against older content must not take the table down on a Tuesday.
 */
export type AbilityCatalog = Record<string, CombatAbility>;

export const ATTACK_ID = "attack";
export const HELP_UP_ID = "help_up";
export const READY_ID = "ready";

/** §7.2 — "Ready: skip and gain +2 to your next roll." */
export const READY_BONUS = 2;

/**
 * Damage on a plain Attack. The spec gives target numbers (§4.1) and hit points
 * (rules.json `baseMaxHp`) but never says how hard a hit lands, so this is
 * chosen rather than quoted: 3 against a 10 HP character is four hits, which
 * puts a two-on-one fight at about the four rounds §7.1 tunes for. It is a
 * default, not a constant — an ability's `damage` is authored per effect, and a
 * catalog that redefines `attack` overrides this without a deploy.
 */
export const ATTACK_DAMAGE = 3;

/**
 * The three actions §7.2 marks "Available to: Everyone".
 *
 * These are code and not content on purpose, and the line is not arbitrary:
 * `rules.json` describes what a *species* or a *class* gives you, and these
 * three are given by the rules of the game to everybody who can hold a sword.
 * A catalog entry with the same id still wins (see `abilityFor`), so retuning
 * Attack is a content change; needing the party to exist first is not.
 *
 * Use item is the fourth row of that table and is deliberately absent: what a
 * consumable does already lives in inventory.ts and content/items.json, and the
 * engine pass that wires encounters into scenes is where the two meet.
 */
export const UNIVERSAL_ABILITIES: AbilityCatalog = {
  [ATTACK_ID]: {
    id: ATTACK_ID,
    name: "Attack",
    icon: "fist",
    timing: "action",
    target: { kind: "enemy", range: "adjacent" },
    effects: [{ effect: { type: "attack", damage: ATTACK_DAMAGE } }],
  },
  [HELP_UP_ID]: {
    id: HELP_UP_ID,
    name: "Help Up",
    icon: "hand",
    timing: "action",
    // §7.3 — "any ally who spends an action adjacent to them". The `down`
    // state filter is what keeps the button off the phone when there is
    // nobody on the floor next to you.
    target: { kind: "ally", range: "adjacent", state: "down" },
    effects: [{ effect: { type: "revive" }, when: "down" }],
  },
  [READY_ID]: {
    id: READY_ID,
    name: "Ready",
    icon: "shield",
    timing: "action",
    target: { kind: "none" },
    effects: [{ effect: { type: "rollBonus", amount: READY_BONUS }, to: "self" }],
  },
};

/** Catalog first, universal actions as the fallback. */
function abilityFor(ctx: EncounterContext, id: string): CombatAbility | null {
  return ctx.abilities[id] ?? UNIVERSAL_ABILITIES[id] ?? null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * A figure in the fight. No `x`/`y`: positions live once, on the board's
 * actors (grid.ts), so there is no second copy to drift out of agreement after
 * a shove.
 */
export interface Combatant {
  readonly id: ActorId;
  readonly side: ActorSide;
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly guard: number;
  /** Steps per turn — 4 for most, 6 for a Duskrunner (§7.1). */
  readonly steps: number;
  /** The modifier on an attack roll: the class stat, or an enemy's `attack`. */
  readonly attackMod: number;
  /** Which stat that is, for the roll animation. Absent for enemies. */
  readonly attackStat?: StatId;
  /**
   * §7.3 — knocked down, never dead. A downed *character* stays on the board
   * and waits to be lifted. A downed *enemy* is taken off it: there is no Help
   * Up for monsters, and grid.ts's crossing rule would otherwise turn a beaten
   * wisp into permanent terrain in a doorway that nobody can ask to move.
   */
  readonly down: boolean;
  /** Ability ids this figure may use. */
  readonly actions: readonly string[];
  /** Once-per-encounter ids already used (§7.2, species actions). */
  readonly spent: readonly string[];
  /** Pending bonus on the next roll, from Ready and friends. */
  readonly rollBonus: number;
  /** Fox Fire — this figure's next turn passes them by. */
  readonly skipNextTurn: boolean;
  /** Brace — who is standing in front of this figure, if anyone. */
  readonly protectedBy: ActorId | null;
  /** The initiative roll, kept so the client can show the order it produced. */
  readonly initiative: number;
}

export interface EncounterState {
  readonly board: Board;
  readonly combatants: readonly Combatant[];
  /** Initiative order, rolled once (§7.2). Ids only; stats live above. */
  readonly order: readonly ActorId[];
  /**
   * Round one's order, which is `order` with First Strike pulled to the front.
   * Stored rather than recomputed because deriving it needs the ability
   * catalog, and `EncounterState` has to survive a round trip through JSON on
   * its own. Both arrays hold the same ids, so `turnIndex` means the same thing
   * in either.
   */
  readonly openingOrder: readonly ActorId[];
  /** 1-based. §7.1 tunes encounters to resolve in about four of these. */
  readonly round: number;
  /** Cursor into the round's order. */
  readonly turnIndex: number;
  /** Steps the active figure has left. §7.2: move, *then* act. */
  readonly stepsLeft: number;
  readonly actionTaken: boolean;
}

/** Something worth animating or narrating. Returned, never stored in state. */
export type EncounterEvent =
  | { readonly type: "roll"; readonly roll: DiceRoll }
  | { readonly type: "damage"; readonly actorId: ActorId; readonly amount: number; readonly hp: number }
  | { readonly type: "heal"; readonly actorId: ActorId; readonly amount: number; readonly hp: number }
  | { readonly type: "down"; readonly actorId: ActorId }
  | { readonly type: "revived"; readonly actorId: ActorId; readonly hp: number }
  | { readonly type: "moved"; readonly actorId: ActorId; readonly to: Position }
  | { readonly type: "shoved"; readonly actorId: ActorId; readonly to: Position }
  | { readonly type: "protected"; readonly actorId: ActorId; readonly byId: ActorId }
  | { readonly type: "bonus"; readonly actorId: ActorId; readonly amount: number }
  | { readonly type: "dazed"; readonly actorId: ActorId };

/**
 * How the encounter stands *right now*. A query, never a phase.
 *
 * `"defeat"` is spec §7.3's whole-party knockdown, and it maps to
 * `EncounterScene.onDefeat` — "lost, not fatal ... the story branches". The
 * engine reads this and walks; no state in this module can end a run, and
 * there is deliberately nowhere to put a game-over flag.
 */
export type EncounterOutcome = "ongoing" | "victory" | "defeat";

export interface EncounterContext {
  readonly rules: RulesContent;
  readonly abilities: AbilityCatalog;
  readonly rng: Rng;
}

/** Illegal requests come back as a refusal; only setup bugs throw. */
export type CombatActionResult =
  | {
      readonly ok: true;
      readonly state: EncounterState;
      readonly events: readonly EncounterEvent[];
      readonly outcome: EncounterOutcome;
    }
  | { readonly ok: false; readonly reason: string };

// ---------------------------------------------------------------------------
// Starting an encounter
// ---------------------------------------------------------------------------

export interface PartyPlacement {
  readonly character: ResolvedCharacter;
  readonly at: Position;
  /** Carried in from `RunState` — a party arrives from the last scene hurt. */
  readonly hp?: number;
  readonly down?: boolean;
}

export interface EnemyPlacement {
  readonly spec: EnemySpec;
  readonly at: Position;
}

export interface EncounterSetup {
  /** Terrain, with nobody on it yet — `beginEncounter` does the placing. */
  readonly board: Board;
  readonly party: readonly PartyPlacement[];
  /**
   * One entry per figure, already flattened. `EnemySpec.count` is expanded by
   * whoever reads the map's spawn points, because the spec never says where a
   * monster starts and this module refuses to guess a formation.
   */
  readonly enemies: readonly EnemyPlacement[];
}

/**
 * Enemy ids are derived, not authored: `wisp#1`, `wisp#2`, in placement order.
 * A replay rebuilds the same setup and therefore the same ids, which is what
 * lets an event log name a target three rounds later and still mean the same
 * wisp.
 */
function enemyId(specId: string, ordinal: number): ActorId {
  return `${specId}#${ordinal}`;
}

/**
 * How nimble a monster is — authored on `EnemySpec`, on the same scale as a
 * character's Quick so both roll the same initiative.
 *
 * This used to be inferred as `guard - baseGuard`, on the reasoning that
 * `resolveCharacter` builds Guard that way so an authored Guard had already
 * said it. It had not: that makes armour and speed one dial, so an armoured
 * brute necessarily acts first and a slow tank cannot be authored. The
 * Bramblewisp showed the other end of it — 5 steps, guard 11, and therefore an
 * inferred Quick of 0, making the fastest thing in the chapter the last to
 * move. Clamped at 0 so a flimsy enemy does not roll negative.
 */
function enemyQuick(spec: EnemySpec): number {
  return Math.max(0, Math.floor(spec.quick));
}

/**
 * Rolls initiative and seats everybody. §7.2: "Quick, highest first, rerolled
 * each encounter so it isn't always the same person going first."
 *
 * One `rollD20` per combatant, in setup order, drawn from the injected `Rng` —
 * so a replay of the same run draws the same numbers in the same sequence and
 * seats the same order (architecture §4.1).
 *
 * Ties break by, in order: the Quick that fed the roll, then party before
 * enemy, then id ascending.
 *
 *   - *Quick first*, because a tie on the total between a quick figure and a
 *     slow one is not really a tie — the faster one was ahead before the die
 *     landed, and that is the stat the spec named.
 *   - *Party before enemy*, because the ties that get noticed at this table are
 *     hers, and "if you tie, you go first" is a rule an eight-year-old can be
 *     told once and never mind again.
 *   - *Id last*, because it is a total order and it is stable. Falling back to
 *     array position would work today and quietly reorder the moment somebody
 *     rebuilds the party list in a different order, which is exactly the class
 *     of bug a replay is supposed to catch and would not.
 */
export function rollInitiative(
  rng: Rng,
  entries: readonly { id: ActorId; side: ActorSide; quick: number }[],
): readonly { id: ActorId; initiative: number }[] {
  const rolled = entries.map((entry) => ({
    ...entry,
    initiative: rollD20(rng) + entry.quick,
  }));
  return [...rolled]
    .sort(
      (a, b) =>
        b.initiative - a.initiative ||
        b.quick - a.quick ||
        sideRank(a.side) - sideRank(b.side) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((entry) => ({ id: entry.id, initiative: entry.initiative }));
}

function sideRank(side: ActorSide): number {
  return side === "party" ? 0 : 1;
}

/**
 * Builds the opening state: everyone on the board, initiative rolled, the first
 * figure who can act on the clock.
 *
 * Throws on a malformed setup — two figures on one tile, a spawn point in a
 * wall, an empty side. Those are authoring or wiring bugs that CI should catch
 * (roadmap: "a malformed chapter fails the build, never the play session"), not
 * conditions to branch on at the table.
 */
export function beginEncounter(setup: EncounterSetup, ctx: EncounterContext): EncounterState {
  if (setup.party.length === 0) throw new Error("encounter: no party");
  if (setup.enemies.length === 0) throw new Error("encounter: no enemies");
  if (setup.board.actors.length > 0) {
    throw new Error("encounter: beginEncounter places the figures — hand it an empty board");
  }

  const combatants: Combatant[] = [];
  const actors: Actor[] = [];
  const seats: { id: ActorId; side: ActorSide; quick: number }[] = [];

  for (const placement of setup.party) {
    const character = placement.character;
    const maxHp = character.maxHp;
    const hp = clamp(placement.hp ?? maxHp, 0, maxHp);
    combatants.push({
      id: character.id,
      side: "party",
      name: character.name,
      hp,
      maxHp,
      guard: character.guard,
      steps: character.steps,
      attackMod: character.stats[character.attackStat],
      attackStat: character.attackStat,
      // A party that walked in already knocked down stays down until somebody
      // lifts them: entering a fight is not a rest (§6.1).
      down: placement.down ?? hp <= 0,
      actions: [...new Set([...UNIVERSAL_ACTION_IDS, ...character.actions])],
      spent: [],
      rollBonus: 0,
      skipNextTurn: false,
      protectedBy: null,
      initiative: 0,
    });
    actors.push({ id: character.id, side: "party", x: placement.at.x, y: placement.at.y });
    seats.push({ id: character.id, side: "party", quick: character.stats.quick });
  }

  const ordinals = new Map<string, number>();
  for (const placement of setup.enemies) {
    const spec = placement.spec;
    const ordinal = (ordinals.get(spec.id) ?? 0) + 1;
    ordinals.set(spec.id, ordinal);
    const id = enemyId(spec.id, ordinal);
    combatants.push({
      id,
      side: "enemy",
      name: spec.name ?? spec.id,
      hp: spec.hp,
      maxHp: spec.hp,
      guard: spec.guard,
      steps: spec.steps,
      attackMod: spec.attack,
      down: false,
      // Monsters swing and nothing else. Help Up is a party rule (§7.3) and
      // Ready is a tactic; enemy AI (roadmap chapter 4) owns the rest.
      actions: [ATTACK_ID],
      spent: [],
      rollBonus: 0,
      skipNextTurn: false,
      protectedBy: null,
      initiative: 0,
    });
    actors.push({ id, side: "enemy", x: placement.at.x, y: placement.at.y });
    seats.push({ id, side: "enemy", quick: enemyQuick(spec) });
  }

  // placeActor is the one that refuses two figures on a tile or a spawn in a
  // wall, so the board is built through it rather than by hand.
  const board = actors.reduce(placeActor, setup.board);

  const rolled = rollInitiative(ctx.rng, seats);
  const initiativeById = new Map(rolled.map((entry) => [entry.id, entry.initiative]));
  const seated = combatants.map((c) => ({ ...c, initiative: initiativeById.get(c.id) ?? 0 }));
  const order = rolled.map((entry) => entry.id);

  const base: EncounterState = {
    board,
    combatants: seated,
    order,
    openingOrder: openingOrderFor(order, seated, ctx),
    round: 1,
    turnIndex: 0,
    stepsLeft: 0,
    actionTaken: false,
  };
  // The first seat may be a character who walked in knocked down (§7.3).
  return startTurnAt(settleCursor(base));
}

const UNIVERSAL_ACTION_IDS: readonly string[] = [ATTACK_ID, HELP_UP_ID, READY_ID];

/**
 * Round one only, First Strike goes first — "Go before anybody else on the
 * first round", the Duskrunner signature. Everyone else keeps their rolled
 * order, and the promotion is stable, so two Duskrunners settle between
 * themselves on initiative exactly as they would have anyway.
 */
function openingOrderFor(
  order: readonly ActorId[],
  combatants: readonly Combatant[],
  ctx: EncounterContext,
): readonly ActorId[] {
  const byId = new Map(combatants.map((c) => [c.id, c]));
  const goesFirst = (id: ActorId): boolean => {
    const combatant = byId.get(id);
    if (!combatant) return false;
    return combatant.actions.some((abilityId) => {
      const ability = abilityFor(ctx, abilityId);
      return (
        ability?.timing === "initiative" &&
        ability.effects.some((spec) => spec.effect.type === "goFirst")
      );
    });
  };
  const first = order.filter(goesFirst);
  if (first.length === 0) return order;
  return [...first, ...order.filter((id) => !goesFirst(id))];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// ---------------------------------------------------------------------------
// Reading the state
// ---------------------------------------------------------------------------

/** The order in play this round — round one's, or the rolled one. */
export function turnOrder(state: EncounterState): readonly ActorId[] {
  return state.round === 1 ? state.openingOrder : state.order;
}

export function combatantById(state: EncounterState, id: ActorId): Combatant | null {
  return state.combatants.find((c) => c.id === id) ?? null;
}

/** Where a figure is standing, or null once a beaten enemy has left the board. */
export function positionOf(state: EncounterState, id: ActorId): Position | null {
  const actor = actorById(state.board, id);
  return actor ? { x: actor.x, y: actor.y } : null;
}

export function currentActorId(state: EncounterState): ActorId | null {
  return turnOrder(state)[state.turnIndex] ?? null;
}

/** Whose turn it is, or null when nobody left standing can take one. */
export function currentActor(state: EncounterState): Combatant | null {
  const id = currentActorId(state);
  if (id === null) return null;
  const combatant = combatantById(state, id);
  if (!combatant || combatant.down) return null;
  return combatant;
}

export function partyMembers(state: EncounterState): readonly Combatant[] {
  return state.combatants.filter((c) => c.side === "party");
}

export function enemies(state: EncounterState): readonly Combatant[] {
  return state.combatants.filter((c) => c.side === "enemy");
}

/** §7.3 — "if the whole party is knocked down". Not a loss; a branch. */
export function isPartyWiped(state: EncounterState): boolean {
  const party = partyMembers(state);
  return party.length > 0 && party.every((c) => c.down);
}

/**
 * Victory is checked before a wipe. Both can land in the same instant — the
 * last wisp falls to a Burst that the last standing hero was already dying
 * from — and a fight with nobody left to lose it is won. It is also the answer
 * the table wants: the story branches either way (§7.3), and this is the branch
 * that matches what everybody just watched happen.
 */
export function encounterOutcome(state: EncounterState): EncounterOutcome {
  if (enemies(state).every((c) => c.down)) return "victory";
  if (isPartyWiped(state)) return "defeat";
  return "ongoing";
}

// ---------------------------------------------------------------------------
// Legality — the one gate, used by the phone and by the server
// ---------------------------------------------------------------------------

/** An action as PlayerView renders it: a button, and what it may be aimed at. */
export interface LegalAction {
  readonly abilityId: string;
  readonly name: string;
  readonly icon: string;
  /** Figures it may be pointed at. Empty when it needs no figure. */
  readonly targets: readonly ActorId[];
  /** Tiles it may be pointed at. Empty unless the ability targets a tile. */
  readonly tiles: readonly Position[];
  /**
   * Figure choices paired with a tile. Present only when an action requires
   * both, so the client cannot combine a legal tile with the wrong target.
   */
  readonly tileTargets?: readonly {
    readonly tile: Position;
    readonly targets: readonly ActorId[];
  }[];
  /** True when the request must carry a target. Some actions require both. */
  readonly needsTarget: boolean;
}

/**
 * Tiles the active figure may finish a move on — §7.2's "reachable tiles
 * highlighted", straight out of grid.ts.
 *
 * Empty once the action is spent: §7.2 is "move up to your steps, **then** take
 * one action", and the reason to be strict about the order rather than
 * generous is sitting in `rules.json` — Duskrunner's level-6 Twin Step is
 * "Move, attack, and then move again", which is only a thing worth unlocking if
 * everybody else has to move first.
 */
export function legalMoves(state: EncounterState): readonly ReachableTile[] {
  const actor = currentActor(state);
  if (!actor || state.actionTaken || state.stepsLeft < 1) return [];
  const from = positionOf(state, actor.id);
  if (!from) return [];
  return reachableTiles(state.board, from, state.stepsLeft);
}

/**
 * Everything the active figure may do right now. §7.2: PlayerView renders
 * exactly this and nothing else, so an illegal action is never on screen to be
 * tapped — and `performAction` re-derives it before applying anything, so this
 * is the security boundary as much as the interface.
 *
 * An ability whose every target list comes back empty is omitted rather than
 * disabled: Help Up with nobody on the floor beside you, Ground Smash with
 * nothing standing next to you, Attack with the last wisp four tiles away. A
 * greyed-out button is a question an eight-year-old has to ask somebody.
 */
export function legalActions(state: EncounterState, ctx: EncounterContext): readonly LegalAction[] {
  const actor = currentActor(state);
  if (!actor || state.actionTaken) return [];

  const out: LegalAction[] = [];
  for (const abilityId of actor.actions) {
    const ability = abilityFor(ctx, abilityId);
    if (!ability) continue;
    // First Strike is a signature, not a button (see AbilityTiming).
    if (ability.timing !== "action") continue;
    if (ability.oncePerEncounter && actor.spent.includes(abilityId)) continue;

    const directTargets = legalTargetsFor(state, actor, ability.target).filter((targetId) =>
      wouldAbilityDoAnything(state, actor, ability, targetId, positionOf(state, targetId)),
    );
    const tileTargets = legalTileTargetsFor(state, actor, ability);
    const tiles = tileTargets.map((option) => option.tile);
    const targets = ability.target.followUp
      ? [...new Set(tileTargets.flatMap((option) => option.targets))]
      : directTargets;
    const needsTarget = ability.target.kind !== "none" && ability.target.kind !== "self";
    if (needsTarget && targets.length === 0 && tiles.length === 0) continue;
    if (!needsTarget && !hasAnyAudience(state, actor, ability, positionOf(state, actor.id))) {
      continue;
    }

    out.push({
      abilityId,
      name: ability.name,
      icon: ability.icon,
      targets,
      tiles,
      ...(ability.target.followUp ? { tileTargets } : {}),
      needsTarget,
    });
  }
  return out;
}

function rangeOf(rule: TargetRule): number | "board" {
  const range = rule.range ?? "adjacent";
  if (range === "adjacent") return 1;
  if (range === "board") return "board";
  return Math.max(0, Math.floor(range));
}

function inRange(from: Position | null, to: Position | null, rule: TargetRule): boolean {
  const range = rangeOf(rule);
  if (range === "board") return true;
  if (!from || !to) return false;
  return stepsBetween(from, to) <= range;
}

function matchesState(combatant: Combatant, rule: TargetRule): boolean {
  const want = rule.state ?? "standing";
  if (want === "any") return true;
  return want === "down" ? combatant.down : !combatant.down;
}

/** Which side a group-scoped effect collects. See `TargetRule.affects`. */
function affectedSide(rule: TargetRule): AbilitySide {
  if (rule.affects) return rule.affects;
  if (rule.kind === "ally") return "ally";
  return "enemy";
}

function isFriendly(actor: Combatant, other: Combatant, side: AbilitySide): boolean {
  return side === "ally" ? other.side === actor.side : other.side !== actor.side;
}

function legalTargetsFor(
  state: EncounterState,
  actor: Combatant,
  rule: TargetRule,
): readonly ActorId[] {
  if (rule.kind === "self") return [actor.id];
  if (rule.kind !== "ally" && rule.kind !== "enemy") return [];

  const from = positionOf(state, actor.id);
  const want: AbilitySide = rule.kind === "ally" ? "ally" : "enemy";
  return state.combatants
    .filter((c) => {
      if (c.id === actor.id) return false;
      if (!isFriendly(actor, c, want)) return false;
      if (!matchesState(c, rule)) return false;
      return inRange(from, positionOf(state, c.id), rule);
    })
    .map((c) => c.id);
}

function legalTilesFor(
  state: EncounterState,
  actor: Combatant,
  ability: CombatAbility,
): readonly Position[] {
  const rule = ability.target;
  if (rule.kind !== "tile") return [];
  const from = positionOf(state, actor.id);
  if (!from) return [];
  const range = rangeOf(rule);
  const out: Position[] = [];
  for (let y = 0; y < state.board.height; y++) {
    for (let x = 0; x < state.board.width; x++) {
      const at = { x, y };
      if (samePosition(at, from)) continue;
      if (range !== "board" && stepsBetween(from, at) > range) continue;
      if (rule.openTileOnly !== false && !isOpen(state.board, at)) continue;
      out.push(at);
    }
  }
  return out;
}

function legalTileTargetsFor(
  state: EncounterState,
  actor: Combatant,
  ability: CombatAbility,
): readonly { readonly tile: Position; readonly targets: readonly ActorId[] }[] {
  if (ability.target.kind !== "tile") return [];
  const followUp = ability.target.followUp;

  return legalTilesFor(state, actor, ability).flatMap((tile) => {
    if (!followUp) {
      return wouldAbilityDoAnything(state, actor, ability, null, tile)
        ? [{ tile, targets: [] }]
        : [];
    }

    const preview = previewStateForTile(state, actor.id, ability, tile);
    const previewActor = combatantById(preview, actor.id);
    if (!previewActor) return [];
    const followRule: TargetRule = {
      kind: followUp.kind,
      ...(followUp.range === undefined ? {} : { range: followUp.range }),
      ...(followUp.state === undefined ? {} : { state: followUp.state }),
    };
    const targets = legalTargetsFor(preview, previewActor, followRule).filter((targetId) =>
      wouldAbilityDoAnything(state, actor, ability, targetId, tile),
    );
    return targets.length > 0 ? [{ tile, targets }] : [];
  });
}

function canMoveSelf(state: EncounterState, actorId: ActorId, point: Position | null): boolean {
  const from = positionOf(state, actorId);
  return Boolean(point && from && !samePosition(from, point) && isOpen(state.board, point));
}

function previewStateForTile(
  state: EncounterState,
  actorId: ActorId,
  ability: CombatAbility,
  point: Position | null,
): EncounterState {
  const moves = ability.effects.some((spec) => spec.effect.type === "moveSelf");
  if (!moves || !canMoveSelf(state, actorId, point) || !point) return state;
  return { ...state, board: moveActor(state.board, actorId, point) };
}

function effectWouldChange(
  state: EncounterState,
  actorId: ActorId,
  recipientId: ActorId,
  effect: AbilityEffect,
  point: Position | null,
): boolean {
  const recipient = combatantById(state, recipientId);
  if (!recipient) return false;

  switch (effect.type) {
    case "attack":
      return !recipient.down && effect.damage > 0;
    case "damage":
      return !recipient.down && effect.amount > 0;
    case "heal":
      return !recipient.down && recipient.hp < recipient.maxHp && effect.amount > 0;
    case "revive":
      return recipient.down;
    case "rollBonus":
      return effect.amount > 0;
    case "moveSelf":
      return canMoveSelf(state, actorId, point);
    case "skipTurn":
      return !recipient.down && !recipient.skipNextTurn;
    case "protect":
      return !recipient.down && recipient.protectedBy !== actorId;
    case "goFirst":
      return false;
    case "shove": {
      const from = positionOf(state, actorId);
      const start = positionOf(state, recipientId);
      if (!from || !start || effect.steps < 1) return false;
      const dx = Math.sign(start.x - from.x);
      const dy = Math.sign(start.y - from.y);
      if (dx === 0 && dy === 0) return false;
      return isOpen(state.board, { x: start.x + dx, y: start.y + dy });
    }
  }
}

/** Would this ability make a meaningful state change for this selection? */
function wouldAbilityDoAnything(
  state: EncounterState,
  actor: Combatant,
  ability: CombatAbility,
  targetId: ActorId | null,
  point: Position | null,
): boolean {
  const nonMovement = ability.effects.filter((spec) => spec.effect.type !== "moveSelf");
  if (nonMovement.length === 0) {
    return ability.effects.some((spec) => spec.effect.type === "moveSelf") &&
      canMoveSelf(state, actor.id, point);
  }

  const preview = previewStateForTile(state, actor.id, ability, point);
  return nonMovement.some((spec) =>
    audienceFor(preview, actor.id, ability, spec, targetId, point).some((recipientId) => {
      const recipient = combatantById(preview, recipientId);
      if (!recipient) return false;
      if (spec.when === "down" && !recipient.down) return false;
      if (spec.when === "standing" && recipient.down) return false;
      return effectWouldChange(preview, actor.id, recipientId, spec.effect, point);
    }),
  );
}

/**
 * Everyone a single effect lands on. Recomputed at the moment the effect is
 * applied rather than up front, which is what makes Pounce ("jump ... and
 * attack the moment you land") a two-effect list and not a special case: the
 * `moveSelf` runs, and the `attack` that follows collects from where the
 * actor now stands.
 */
function audienceFor(
  state: EncounterState,
  actorId: ActorId,
  ability: CombatAbility,
  spec: AbilityEffectSpec,
  targetId: ActorId | null,
  point: Position | null,
): readonly ActorId[] {
  const actor = combatantById(state, actorId);
  if (!actor) return [];
  const side = affectedSide(ability.target);
  // `moveSelf` moves the actor by definition, so it ignores `to` rather than
  // letting a catalog entry write the nonsense of gliding somebody else.
  const scope: EffectScope = spec.effect.type === "moveSelf" ? "self" : (spec.to ?? "target");

  switch (scope) {
    case "self":
      return [actor.id];
    case "target":
      if (ability.target.kind === "self") return [actor.id];
      return targetId === null ? [] : [targetId];
    case "allies":
      // "Every friend" — the caster included. Excluding them would mean a
      // Songkeeper can never be healed by their own Chorus, which is a rule
      // somebody would have to explain.
      return state.combatants.filter((c) => c.side === actor.side && !c.down).map((c) => c.id);
    case "adjacent": {
      const from = positionOf(state, actor.id);
      if (!from) return [];
      return actorsAdjacentTo(state.board, from)
        .map((a) => combatantById(state, a.id))
        .filter((c): c is Combatant => c !== null && !c.down && isFriendly(actor, c, side))
        .map((c) => c.id);
    }
    case "area": {
      if (!point) return [];
      const size = Math.max(1, Math.floor(ability.target.area ?? 1));
      return state.combatants
        .filter((c) => {
          if (c.down || !isFriendly(actor, c, side)) return false;
          const at = positionOf(state, c.id);
          if (!at) return false;
          // Anchored top-left, so `area: 2` is literally the 2×2 square of
          // tiles Burst is written as.
          return (
            at.x >= point.x && at.x < point.x + size && at.y >= point.y && at.y < point.y + size
          );
        })
        .map((c) => c.id);
    }
  }
}

/** Would this ability do anything at all from where the actor stands? */
function hasAnyAudience(
  state: EncounterState,
  actor: Combatant,
  ability: CombatAbility,
  point: Position | null,
): boolean {
  return wouldAbilityDoAnything(state, actor, ability, null, point);
}

// ---------------------------------------------------------------------------
// Taking a turn

// ---------------------------------------------------------------------------
// Taking a turn
// ---------------------------------------------------------------------------

/**
 * Walks the active figure to a tile. Refuses anything `legalMoves` would not
 * have highlighted, which is the same set the phone drew from — so a stale tap
 * costs a resync and nothing else.
 */
export function moveTo(state: EncounterState, to: Position): CombatActionResult {
  const actor = currentActor(state);
  if (!actor) return { ok: false, reason: "nobody can act" };
  if (state.actionTaken) return { ok: false, reason: "the action is already spent" };

  const reachable = legalMoves(state).find((tile) => samePosition(tile, to));
  if (!reachable) return { ok: false, reason: "that tile is out of reach" };

  const next: EncounterState = {
    ...state,
    board: moveActor(state.board, actor.id, to),
    stepsLeft: state.stepsLeft - reachable.cost,
  };
  return {
    ok: true,
    state: next,
    events: [{ type: "moved", actorId: actor.id, to: { x: to.x, y: to.y } }],
    outcome: encounterOutcome(next),
  };
}

export interface CombatActionRequest {
  readonly abilityId: string;
  readonly targetId?: ActorId;
  readonly targetTile?: Position;
}

/**
 * Spends the active figure's one action (§7.2).
 *
 * Validation re-derives `legalActions`, deliberately: the phone already used it
 * to decide what to draw, and running the same function again server-side is
 * what makes "illegal actions are not presented" a guarantee rather than a
 * convention. A request that names an ability, a target or a tile the list did
 * not offer comes back `ok: false`.
 *
 * The turn is *not* ended here. The client has a hit to animate and a damage
 * number to show before the marker moves on, so `endTurn` stays separate.
 */
export function performAction(
  state: EncounterState,
  ctx: EncounterContext,
  request: CombatActionRequest,
): CombatActionResult {
  const actor = currentActor(state);
  if (!actor) return { ok: false, reason: "nobody can act" };
  if (state.actionTaken) return { ok: false, reason: "the action is already spent" };

  const offered = legalActions(state, ctx).find((a) => a.abilityId === request.abilityId);
  if (!offered) return { ok: false, reason: `"${request.abilityId}" is not available right now` };

  const ability = abilityFor(ctx, request.abilityId);
  // Unreachable: `legalActions` only ever offers abilities it resolved.
  if (!ability) return { ok: false, reason: `unknown ability "${request.abilityId}"` };

  let targetId: ActorId | null = null;
  let point: Position | null = positionOf(state, actor.id);

  if (ability.target.kind === "self") {
    targetId = actor.id;
  } else if (ability.target.kind === "ally" || ability.target.kind === "enemy") {
    if (!request.targetId || !offered.targets.includes(request.targetId)) {
      return { ok: false, reason: "that is not a legal target" };
    }
    targetId = request.targetId;
    point = positionOf(state, targetId);
  } else if (ability.target.kind === "tile") {
  const tile = request.targetTile;
  if (!tile || !offered.tiles.some((t) => samePosition(t, tile))) {
    return { ok: false, reason: "that is not a legal tile" };
  }
  point = { x: tile.x, y: tile.y };
  if (ability.target.followUp) {
    const option = offered.tileTargets?.find((entry) => samePosition(entry.tile, tile));
    if (!request.targetId || !option?.targets.includes(request.targetId)) {
      return { ok: false, reason: "that is not a legal target from that tile" };
    }
    targetId = request.targetId;
  }
}

  const events: EncounterEvent[] = [];
  let working = state;

  // §7.2's "+2 to your next roll" is spent on the *action*, not on the first
  // die of it: Burst rolls once per enemy, and "the +2 only counted for the
  // first wisp" is not a sentence anybody is going to say out loud at this
  // table. Read once here, cleared once at the end.
  const bonus = actor.rollBonus;
  let rolled = false;

  for (const spec of ability.effects) {
    const audience = audienceFor(working, actor.id, ability, spec, targetId, point);
    for (const recipientId of audience) {
      // `when` reads the state the recipient was in when the ability was
      // *pointed at them*, not the state it has been dragged into halfway
      // through resolving. Rally is "heal a friend, **or** lift a knocked-down
      // friend", and against the working state its own revive would flip the
      // friend to standing and let the heal fire too — a lift that lands at 4
      // HP instead of the 1 HP §7.3 promises.
      const recipient = combatantById(state, recipientId);
      if (!recipient) continue;
      if (spec.when === "down" && !recipient.down) continue;
      if (spec.when === "standing" && recipient.down) continue;
      const applied = applyEffect(working, ctx, {
        actorId: actor.id,
        recipientId,
        effect: spec.effect,
        point,
        bonus,
        events,
      });
      working = applied.state;
      rolled = rolled || applied.rolled;
    }
  }

  working = updateCombatant(working, actor.id, (c) => ({
    ...c,
    rollBonus: rolled ? 0 : c.rollBonus,
    // Recorded under the id the *action list* uses, not the `id` inside the
    // catalog entry. Those are normally the same string; when a content typo
    // makes them differ, spending under the entry's id would leave the key
    // `legalActions` checks unspent and hand out a once-per-encounter species
    // action every round for the rest of the fight.
    spent:
      ability.oncePerEncounter && !c.spent.includes(request.abilityId)
        ? [...c.spent, request.abilityId]
        : c.spent,
  }));
  working = { ...working, actionTaken: true };

  return { ok: true, state: working, events, outcome: encounterOutcome(working) };
}

interface EffectApplication {
  readonly actorId: ActorId;
  readonly recipientId: ActorId;
  readonly effect: AbilityEffect;
  readonly point: Position | null;
  readonly bonus: number;
  readonly events: EncounterEvent[];
}

function applyEffect(
  state: EncounterState,
  ctx: EncounterContext,
  input: EffectApplication,
): { state: EncounterState; rolled: boolean } {
  const { actorId, recipientId, effect, events } = input;
  const actor = combatantById(state, actorId);
  const recipient = combatantById(state, recipientId);
  if (!actor || !recipient) return { state, rolled: false };

  switch (effect.type) {
    case "attack": {
      const roll = resolveAttack(ctx.rng, {
        characterId: actor.id,
        mod: actor.attackMod + input.bonus,
        guard: recipient.guard,
        ...(actor.attackStat === undefined ? {} : { stat: actor.attackStat }),
      });
      events.push({ type: "roll", roll });
      if (roll.result !== "hit") return { state, rolled: true };
      return { state: dealDamage(state, recipientId, effect.damage, events), rolled: true };
    }

    case "damage":
      return { state: dealDamage(state, recipientId, effect.amount, events), rolled: false };

    case "heal": {
      // §7.3 — healing never lifts anybody. Only Help Up and Rally do that,
      // which is what makes the no-death rule read as a hero move (§4.3)
      // rather than a number going up.
      if (recipient.down) return { state, rolled: false };
      const hp = Math.min(recipient.maxHp, recipient.hp + effect.amount);
      const healed = hp - recipient.hp;
      if (healed <= 0) return { state, rolled: false };
      events.push({ type: "heal", actorId: recipientId, amount: healed, hp });
      return { state: updateCombatant(state, recipientId, (c) => ({ ...c, hp })), rolled: false };
    }

    case "revive": {
      if (!recipient.down) return { state, rolled: false };
      events.push({ type: "revived", actorId: recipientId, hp: 1 });
      return {
        state: updateCombatant(state, recipientId, (c) => ({ ...c, hp: 1, down: false })),
        rolled: false,
      };
    }

    case "rollBonus": {
      // Bonuses take the larger rather than piling up: §4.1 promises one die
      // plus one number, and adding two bonuses together is the arithmetic the
      // whole resolution mechanic exists to avoid.
      const amount = Math.max(recipient.rollBonus, effect.amount);
      if (amount === recipient.rollBonus) return { state, rolled: false };
      events.push({ type: "bonus", actorId: recipientId, amount });
      return {
        state: updateCombatant(state, recipientId, (c) => ({ ...c, rollBonus: amount })),
        rolled: false,
      };
    }

    case "moveSelf": {
      const to = input.point;
      if (!to || !isOpen(state.board, to)) return { state, rolled: false };
      events.push({ type: "moved", actorId: actorId, to: { x: to.x, y: to.y } });
      return { state: { ...state, board: moveActor(state.board, actorId, to) }, rolled: false };
    }

    case "shove":
      return { state: shove(state, actorId, recipientId, effect.steps, events), rolled: false };

    case "skipTurn": {
      if (recipient.skipNextTurn) return { state, rolled: false };
      events.push({ type: "dazed", actorId: recipientId });
      return {
        state: updateCombatant(state, recipientId, (c) => ({ ...c, skipNextTurn: true })),
        rolled: false,
      };
    }

    case "protect": {
      events.push({ type: "protected", actorId: recipientId, byId: actorId });
      return {
        state: updateCombatant(state, recipientId, (c) => ({ ...c, protectedBy: actorId })),
        rolled: false,
      };
    }

    case "goFirst":
      // Read by `openingOrderFor` when order is rolled; nothing to do on a turn.
      return { state, rolled: false };
  }
}

/**
 * Damage, with Brace in the way.
 *
 * "Take a hit that was meant for a friend standing next to you" — so the
 * redirect is checked at the moment the hit lands, not when Brace was declared:
 * a Thornguard who was shoved out of the way in between is no longer standing
 * in front of anybody, and the hit goes where it was aimed. It absorbs one hit
 * and then clears, and `startTurnAt` clears whatever is left when the
 * Thornguard's next turn comes round — the spec is silent on the duration, and
 * "until your next turn" is the wording `rules.json` already uses for
 * Unbreakable, so it is the one this game teaches.
 */
function dealDamage(
  state: EncounterState,
  targetId: ActorId,
  amount: number,
  events: EncounterEvent[],
): EncounterState {
  const target = combatantById(state, targetId);
  if (!target || target.down || amount <= 0) return state;

  let working = state;
  let victimId = targetId;

  const protectorId = target.protectedBy;
  if (protectorId) {
    const protector = combatantById(state, protectorId);
    const here = positionOf(state, targetId);
    const there = positionOf(state, protectorId);
    working = updateCombatant(working, targetId, (c) => ({ ...c, protectedBy: null }));
    if (protector && !protector.down && here && there && areAdjacent(here, there)) {
      events.push({ type: "protected", actorId: targetId, byId: protectorId });
      victimId = protectorId;
    }
  }

  const victim = combatantById(working, victimId);
  if (!victim || victim.down) return working;

  const hp = Math.max(0, victim.hp - amount);
  events.push({ type: "damage", actorId: victimId, amount: victim.hp - hp, hp });
  if (hp > 0) {
    return updateCombatant(working, victimId, (c) => ({ ...c, hp }));
  }

  // §7.3 — knocked down, not dead. A character lies where they fell and waits
  // for a hand up. A monster leaves, because grid.ts will not let anybody cross
  // an enemy and nobody can Help Up a wisp: leaving it there would make a
  // beaten enemy into a wall in a doorway with no in-game way to shift it.
  events.push({ type: "down", actorId: victimId });
  working = updateCombatant(working, victimId, (c) => ({
    ...c,
    hp: 0,
    down: true,
    protectedBy: null,
  }));
  if (victim.side === "enemy") {
    working = { ...working, board: removeActor(working.board, victimId) };
  }
  // Anybody this figure was standing in front of is on their own now.
  return {
    ...working,
    combatants: working.combatants.map((c) =>
      c.protectedBy === victimId ? { ...c, protectedBy: null } : c,
    ),
  };
}

/**
 * Pushes a figure directly away from the shover, one tile at a time, stopping
 * at the first wall or figure. Partial shoves are the point: "Every enemy next
 * to you is shoved back 2 steps" against a wall should pin it, not fail
 * silently and not throw.
 */
function shove(
  state: EncounterState,
  actorId: ActorId,
  targetId: ActorId,
  steps: number,
  events: EncounterEvent[],
): EncounterState {
  const from = positionOf(state, actorId);
  const start = positionOf(state, targetId);
  if (!from || !start || steps < 1) return state;

  const dx = Math.sign(start.x - from.x);
  const dy = Math.sign(start.y - from.y);
  if (dx === 0 && dy === 0) return state;

  let at = start;
  for (let i = 0; i < Math.floor(steps); i++) {
    const next = { x: at.x + dx, y: at.y + dy };
    if (!isOpen(state.board, next)) break;
    at = next;
  }
  if (samePosition(at, start)) return state;

  events.push({ type: "shoved", actorId: targetId, to: at });
  return { ...state, board: moveActor(state.board, targetId, at) };
}

function updateCombatant(
  state: EncounterState,
  id: ActorId,
  change: (c: Combatant) => Combatant,
): EncounterState {
  return {
    ...state,
    combatants: state.combatants.map((c) => (c.id === id ? change(c) : c)),
  };
}

// ---------------------------------------------------------------------------
// The round loop
// ---------------------------------------------------------------------------

/**
 * Hands the turn on. Advances the round when the order wraps, skips whoever is
 * knocked down (§7.3) or dazed, and hands back the state unchanged when there
 * is nobody left who could take a turn.
 *
 * The knocked-down check happens *here*, at the moment the marker arrives —
 * never at the moment the marker left. That ordering is the whole point: a
 * Songkeeper earlier in the order can Rally a fallen friend who is next up, and
 * that friend takes their turn. Deciding the skip list at the top of the round
 * would silently steal it, which is precisely the beat §7.3 exists to create
 * ("someone goes down, someone else picks them up" — roadmap chapter 4's
 * definition of done).
 */
export function endTurn(state: EncounterState): EncounterState {
  // With nobody standing on either side there is no next turn, and advancing
  // would tick the round counter forever behind a client that keeps asking.
  if (!state.combatants.some((c) => !c.down)) return state;
  return startTurnAt(settleCursor(advanceCursor(state)));
}

/** One seat forward, rolling into the next round at the end of the order. */
function advanceCursor(state: EncounterState): EncounterState {
  const next = state.turnIndex + 1;
  if (next < turnOrder(state).length) return { ...state, turnIndex: next };
  return { ...state, round: state.round + 1, turnIndex: 0 };
}

/**
 * Moves the cursor forward until it lands on somebody who can act.
 *
 * Bounded, not "until it finds one": with the whole party down and the last
 * wisp gone, or every survivor dazed at once, an unbounded search is an
 * infinite loop at the table. Two laps is enough to be sure — one to burn off
 * every pending daze (each is consumed as it is passed) and one to look again —
 * and if nothing turns up the cursor is left where it is. `currentActor` then
 * reads null and `encounterOutcome` explains why.
 */
function settleCursor(state: EncounterState): EncounterState {
  let working = state;
  const laps = Math.max(1, turnOrder(state).length) * 2 + 1;

  for (let step = 0; step <= laps; step++) {
    const id = currentActorId(working);
    const combatant = id === null ? null : combatantById(working, id);
    if (!combatant || combatant.down) {
      working = advanceCursor(working);
      continue;
    }
    if (combatant.skipNextTurn) {
      working = updateCombatant(working, combatant.id, (c) => ({ ...c, skipNextTurn: false }));
      working = advanceCursor(working);
      continue;
    }
    return working;
  }
  return working;
}

/** Fresh steps, a fresh action, and Brace expires where it was declared. */
function startTurnAt(state: EncounterState): EncounterState {
  const actor = currentActor(state);
  if (!actor) return { ...state, stepsLeft: 0, actionTaken: false };
  return {
    ...state,
    stepsLeft: actor.steps,
    actionTaken: false,
    combatants: state.combatants.map((c) =>
      c.protectedBy === actor.id ? { ...c, protectedBy: null } : c,
    ),
  };
}
