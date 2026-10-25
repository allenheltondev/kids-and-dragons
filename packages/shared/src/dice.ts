/**
 * Dice — server-authoritative and deterministic.
 *
 * architecture §4.1: dice are rolled in Lambda, never in the browser. That only
 * buys fairness if the roll is also *reproducible*: the event log replays a run
 * (architecture §4.3), and a replay that re-rolls differently is not a replay.
 * So randomness enters the engine through one injected `Rng` seeded per run.
 *
 * The PRNG is mulberry32 — 32 bits of state, no dependencies, and stable across
 * Node versions, which `Math.random()` explicitly is not.
 */

import type { Difficulty, StatId, TierId } from "./types/domain.js";
import type { DiceRoll } from "./types/state.js";
import type { MatchupNote } from "./types/matchups.js";

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
}

/**
 * xmur3 string hash → mulberry32. Seeds are run ids and test names, so the
 * seed has to be a string; the hash spreads short similar strings apart.
 */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function makeRng(seed: string | number): Rng {
  let state = (typeof seed === "number" ? seed >>> 0 : hashSeed(seed)) >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** spec §4.1 — one die, always. 1..20 inclusive. */
export function rollD20(rng: Rng): number {
  return Math.floor(rng.next() * 20) + 1;
}

/**
 * Which difficulty band a target number sits in (spec §4.1: easy 8, normal 12,
 * hard 16). A bare "Needed 12" on every check makes them all feel the same; a
 * word says up front how much of a stretch this one is. Banded rather than
 * keyed to the exact values in content/rules.json so a TN between the bands
 * still reads sensibly.
 */
export function difficultyFor(tn: number): Difficulty {
  if (tn <= 9) return "easy";
  if (tn <= 13) return "normal";
  return "hard";
}

/** Any die: 1..sides inclusive. The helper's die, mostly. */
export function rollDie(rng: Rng, sides: number): number {
  return Math.floor(rng.next() * sides) + 1;
}

/** The helper's die by tier, when content/rules.json does not say. */
export const DEFAULT_HELP_DIE: Readonly<Record<TierId, number>> = {
  fledgling: 4,
  sworn: 6,
  radiant: 8,
  mythic: 10,
  ascendant: 10,
  eternal: 12,
  legendary: 12,
};

export interface HelpInput {
  characterId: string;
  sides: number;
}

export interface RollInput {
  mod: number;
  tn: number;
  /**
   * A friend's die added on top (spec §4.1 helping). Thrown after the d20, so
   * a roll with no helper draws exactly what it always drew.
   */
  help?: HelpInput;
  /** Who is rolling. Defaults to "" for previews that have no character yet. */
  characterId?: string;
  stat?: StatId;
  /**
   * A story-check buff spent on the roll (#222): a flat amount on the total,
   * never a die, so a roll with one draws exactly what it would without.
   */
  buff?: BuffInput;
  /**
   * Matchups on this roll (docs/matchups.md): a flat, already capped amount
   * on the total, like a buff, so a roll with one draws exactly what it would
   * without. Absent where matchups are off.
   */
  matchup?: MatchupInput;
}

export interface MatchupInput {
  amount: number;
  notes: MatchupNote[];
}

export interface BuffInput {
  id: string;
  label: string;
  amount: number;
}

/**
 * The die alone decides on its two ends: a natural 20 always succeeds and a
 * natural 1 always fails, whatever the modifier and the target. Everything in
 * between is `total >= tn`. It keeps both faces worth cheering (or groaning)
 * at, and it means no check is ever certain in either direction.
 */
export function clears(die: number, total: number, tn: number): boolean {
  if (die >= 20) return true;
  if (die <= 1) return false;
  return total >= tn;
}

/**
 * The raw roll. Prefer `resolveCheck` / `resolveAttack`, which name the outcome
 * in the vocabulary the presentation layer animates against.
 */
export function roll(rng: Rng, input: RollInput): DiceRoll {
  const die = rollD20(rng);
  const help =
    input.help === undefined
      ? undefined
      : { ...input.help, value: rollDie(rng, input.help.sides) };
  const total = die + input.mod + (help?.value ?? 0) + (input.buff?.amount ?? 0) + (input.matchup?.amount ?? 0);
  return {
    die,
    mod: input.mod,
    total,
    tn: input.tn,
    result: clears(die, total, input.tn) ? "success" : "failure",
    characterId: input.characterId ?? "",
    ...(input.stat === undefined ? {} : { stat: input.stat }),
    ...(help === undefined ? {} : { help }),
    ...(input.buff === undefined ? {} : { buff: { id: input.buff.id, label: input.buff.label, amount: input.buff.amount } }),
    ...(input.matchup === undefined ? {} : { matchup: { amount: input.matchup.amount, notes: input.matchup.notes.map((n) => ({ ...n })) } }),
  };
}

export interface CheckInput {
  characterId: string;
  stat: StatId;
  mod: number;
  tn: number;
  help?: HelpInput;
  /** A story-check buff the roller spends on it (#222). */
  buff?: BuffInput;
  /** Matchups on this check (docs/matchups.md). */
  matchup?: MatchupInput;
}

/** A check scene roll: d20 + stat vs. TN. Both outcomes continue the story. */
export function resolveCheck(rng: Rng, input: CheckInput): DiceRoll {
  return roll(rng, {
    mod: input.mod,
    tn: input.tn,
    characterId: input.characterId,
    stat: input.stat,
    ...(input.help === undefined ? {} : { help: input.help }),
    ...(input.buff === undefined ? {} : { buff: input.buff }),
    ...(input.matchup === undefined ? {} : { matchup: input.matchup }),
  });
}

export interface AttackInput {
  characterId: string;
  mod: number;
  guard: number;
  stat?: StatId;
  /** Matchups on this swing (docs/matchups.md). */
  matchup?: MatchupInput;
}

/** An attack: d20 + class stat vs. the target's Guard. spec §7.2. */
export function resolveAttack(rng: Rng, input: AttackInput): DiceRoll {
  const base = roll(rng, {
    mod: input.mod,
    tn: input.guard,
    characterId: input.characterId,
    ...(input.stat === undefined ? {} : { stat: input.stat }),
    ...(input.matchup === undefined ? {} : { matchup: input.matchup }),
  });
  return { ...base, result: base.result === "success" ? "hit" : "miss" };
}
