/**
 * Temporary buffs (#200) — the shapes. docs/campaigns/graph-campaigns.md
 * ("Temporary buffs") is the authoring contract; `buffs.ts` is the arithmetic
 * that reads these.
 *
 * ---------------------------------------------------------------------------
 * WHY A BUFF IS NOT AN ITEM, AND NOT A STAT
 *
 * Rift energy in a graph campaign can leave the party stronger for a while:
 * steadier on their feet (Guard), harder-hitting, quicker, luckier. The game
 * already has two ways to make a hero better and neither is this one:
 *
 *   - **Stats** live on the stored `Character` and only ever go up by XP and
 *     level. A buff written there would be permanent stat creep — the one
 *     thing #200 must not do — and would follow the hero into Gemfall.
 *   - **Items and trinkets** are resolved into the character
 *     (`resolveCharacter`) wherever the hero is, in every campaign. A buff
 *     that rode that path would change item resolution for every campaign
 *     ever authored.
 *
 * So a buff is neither. It is declared by a graph campaign (`graph.buffs`),
 * granted by a graph effect (`grantBuff`), remembered on the attempt's
 * journey (`JourneyState.buffs` — this attempt and nowhere else), handed to a
 * chapter run beside the journey flags (`RunState.buffs`), and applied inside
 * a fight as an overlay on the combatants (`EncounterState.buffs`) that the
 * fight reads and nothing writes back. When it is used up it is gone; the
 * character row never knew it was there.
 *
 * Every shape here is optional where it is stored: a journey, a run or a
 * fight without `buffs` is one with none, which is every ordered campaign's
 * forever and every graph one saved before #200.
 */

import type { NodeId } from "./campaign-graph.js";

/** A buff's key in `CampaignGraph.buffs`. Stable: saves name it. */
export type BuffId = string;

/**
 * What a buff changes, in the engine's own terms — each one is a number the
 * fight already has (`encounter.ts`):
 *
 * - `"guard"` — the hero's Guard, the target number an attack on them must
 *   reach (`Combatant.guard`).
 * - `"damage"` — how hard the hero's Attack lands when it hits (the `attack`
 *   verb's damage). Not abilities that deal damage without a roll, not
 *   thrown items: "your hits land harder".
 * - `"move"` — the steps the hero gets at the start of each of their turns
 *   (`Combatant.steps` → `stepsLeft`).
 * - `"roll"` — the modifier on the hero's attack rolls (`attackMod`). Checks
 *   outside a fight are untouched: a buff is a combat thing, and its clock is
 *   counted in fights.
 */
export type BuffKind = "guard" | "damage" | "move" | "roll";

/**
 * How long a buff lasts, in the only clocks a fight has.
 *
 * - `{ scope: "turns", count }` — the holder's first `count` turns of the
 *   **next** fight, and no longer than that fight.
 * - `{ scope: "encounter" }` — the whole of the next fight.
 * - `{ scope: "encounters", count }` — the next `count` fights, wherever and
 *   whenever they come (another chapter, another evening).
 *
 * A buff waits, unspent, until a fight comes: a chapter with no encounter in
 * it costs nothing.
 */
export type BuffDuration =
  | { scope: "turns"; count: number }
  | { scope: "encounter" }
  | { scope: "encounters"; count: number };

/**
 * Granting a buff the party already has:
 *
 * - `"refresh"` (default) — its duration starts again; it does not get stronger.
 * - `"add"` — one more stack (up to `maxStacks`), and its duration starts again.
 * - `"ignore"` — nothing happens: the first one runs its course.
 */
export type BuffStacking = "refresh" | "add" | "ignore";

/**
 * What ends a buff early, beside its duration:
 *
 * - `"defeat"` — the party loses a fight (the whole party knocked down).
 * - `"setback"` — a chapter ends in a setback.
 * - `"rest"` — the party reaches a Rest scene.
 * - `"travel"` — the party takes an exit (any `CHOOSE_EXIT` that commits).
 */
export type BuffExpiry = "defeat" | "rest" | "travel" | "setback";

/**
 * Who a buff lands on, decided when a fight begins:
 *
 * - `"party"` (default) — every hero.
 * - `"one"` — one hero: whoever holds the story turn when the fight begins
 *   (`RunState.storyTurn`'s seat — the marker that already takes the story in
 *   turns). The journey never names a hero (it reads no party), so a buff
 *   that lasts several fights may land on a different friend in each.
 */
export type BuffTarget = "party" | "one";

/**
 * One declared buff (`CampaignGraph.buffs`). Bounded on purpose, like world
 * facts: small whole numbers, a ceiling per kind (`BUFF_LIMITS`), and a
 * duration counted in fights — never "for the rest of the campaign".
 */
export interface BuffDef {
  /** What the screens call it, for an 8-year-old: "Rift Shield". */
  label: string;
  kind: BuffKind;
  /**
   * Per stack: a non-zero whole number within the kind's limit
   * (`BUFF_LIMITS`). **Negative is a burden** — the cost side of a tactical
   * tradeoff, granted beside the boon it pays for (`effects: [grantBuff
   * fury, grantBuff fray]`).
   */
  amount: number;
  /** Default `"party"`. */
  target?: BuffTarget;
  duration: BuffDuration;
  /** Default `"refresh"`. */
  stack?: BuffStacking;
  /** With `stack: "add"` only: the most stacks it can reach, 2–5. Default 3. */
  maxStacks?: number;
  /**
   * The most this buff can add (or take away), however it stacks: 1 up to
   * its kind's limit. Default: the kind's limit.
   */
  cap?: number;
  /** What ends it early. Absent: only its duration. */
  expiresOn?: BuffExpiry[];
}

/**
 * A buff the party holds between fights — what the journey stores
 * (`JourneyState.buffs`) and what the chapter run carries (`RunBuff`).
 * Only counters: what the buff *is* stays in the declaration, so content can
 * be retuned under a save without rewriting it.
 */
export interface ActiveBuff {
  id: BuffId;
  /** 1, or more for a `stack: "add"` buff granted again. */
  stacks: number;
  /**
   * Fights left before it is spent. A `"turns"` or `"encounter"` buff has 1;
   * an `"encounters"` one counts down from its `count`.
   */
  encountersLeft: number;
  /** The visit that granted it (or last refreshed it), for the inspection tools (#202). */
  grantedAt?: { node: NodeId; visit: number };
}

/**
 * A buff as a chapter run carries it (`RunState.buffs`): the journey's
 * `ActiveBuff` with its declaration resolved, so the engine — which never
 * sees the graph — and the phones can both read it.
 */
export interface RunBuff extends ActiveBuff {
  label: string;
  kind: BuffKind;
  /** Per stack, as declared. */
  amount: number;
  target: BuffTarget;
  /** For a `"turns"` buff: how many of the holder's turns it covers. */
  turns?: number;
  cap?: number;
  expiresOn?: BuffExpiry[];
}

/**
 * A buff on one hero inside one fight (`EncounterState.buffs`). A party-wide
 * buff is one entry per hero, so a turn clock can run out for one friend and
 * not another.
 */
export interface CombatBuff {
  id: BuffId;
  label: string;
  kind: BuffKind;
  /** The combatant it is on (a hero's character id). */
  heroId: string;
  /** What it adds, stacks and `cap` already applied. */
  amount: number;
  /** For a `"turns"` buff: the holder's turns it still covers. Absent: the whole fight. */
  turnsLeft?: number;
}

/** One active buff as the screens show it (`JourneyView.buffs`). */
export interface JourneyBuffView {
  id: BuffId;
  label: string;
  kind: BuffKind;
  /** What it adds now (stacks and `cap` applied); negative for a burden. */
  amount: number;
  stacks: number;
  target: BuffTarget;
  /** How long it has left: fights, and for a `"turns"` buff the turns in its fight. */
  remaining: { encounters: number; turns?: number };
  expiresOn?: BuffExpiry[];
}
