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

import type { StatId } from "./types/domain.js";
import type { DiceRoll } from "./types/state.js";

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

export interface RollInput {
  mod: number;
  tn: number;
  /** Who is rolling. Defaults to "" for previews that have no character yet. */
  characterId?: string;
  stat?: StatId;
}

/**
 * The raw roll. Prefer `resolveCheck` / `resolveAttack`, which name the outcome
 * in the vocabulary the presentation layer animates against.
 */
export function roll(rng: Rng, input: RollInput): DiceRoll {
  const die = rollD20(rng);
  const total = die + input.mod;
  return {
    die,
    mod: input.mod,
    total,
    tn: input.tn,
    result: total >= input.tn ? "success" : "failure",
    characterId: input.characterId ?? "",
    ...(input.stat === undefined ? {} : { stat: input.stat }),
  };
}

export interface CheckInput {
  characterId: string;
  stat: StatId;
  mod: number;
  tn: number;
}

/** A check scene roll: d20 + stat vs. TN. Both outcomes continue the story. */
export function resolveCheck(rng: Rng, input: CheckInput): DiceRoll {
  return roll(rng, {
    mod: input.mod,
    tn: input.tn,
    characterId: input.characterId,
    stat: input.stat,
  });
}

export interface AttackInput {
  characterId: string;
  mod: number;
  guard: number;
  stat?: StatId;
}

/** An attack: d20 + class stat vs. the target's Guard. spec §7.2. */
export function resolveAttack(rng: Rng, input: AttackInput): DiceRoll {
  const base = roll(rng, {
    mod: input.mod,
    tn: input.guard,
    characterId: input.characterId,
    ...(input.stat === undefined ? {} : { stat: input.stat }),
  });
  return { ...base, result: base.result === "success" ? "hit" : "miss" };
}
