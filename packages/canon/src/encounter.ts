/**
 * What a creature does in a fight, and what it takes instead of one —
 * docs/canon-contract.md D9 and D10.
 *
 * Every number here is anchored to the engine rather than invented:
 * `ATTACK_DAMAGE = 3` for any plain swing (`encounter.ts`), heroes at
 * `baseMaxHp` 10 / `baseGuard` 11 / `baseSteps` 4 (`rules.json`), attacks
 * resolved as d20 + mod vs Guard (`dice.ts`), initiative as d20 + `quick`,
 * three players on a 10×8 board (spec §7.1).
 *
 * The arithmetic that fixes the bands: a level-1 hero swings at d20 + 2..4
 * against Guard 11 — about 65% — for 3 damage, so roughly 2 damage a round
 * each and ~6 for a party of three. §7.1 tunes for about four rounds, so a
 * whole encounter wants 18–30 total HP. Three Bramblewisps at 6 HP is 18, and
 * that shipped stat block is where the `skirmisher` row comes from.
 *
 * ---------------------------------------------------------------------------
 * WHY BANDS AND NOT FIVE INTEGERS
 *
 * A creature picks a band; it does not pick an `hp`. The numbers live in one
 * table, so retuning combat is one edit rather than seventeen, and a generator
 * choosing an encounter is choosing from four options rather than inventing a
 * stat line. `stats` exists as an override for the creature that genuinely
 * needs one, and `legend` has no row at all — a legendary beast is authored,
 * signed off, and never generated.
 */

import { z } from "zod";
import { Slug } from "./ids.js";

/**
 * The five stat-block numbers `EnemySpec` needs
 * (`packages/shared/src/types/chapter.ts`).
 *
 * `quick` is initiative and `guard` is armour, authored separately on purpose:
 * deriving one from the other would make a heavily-armoured brute necessarily
 * act *first*, which forbids the slow tank as an archetype.
 */
export const EncounterStats = z.strictObject({
  hp: z.number().int().positive(),
  guard: z.number().int().positive(),
  quick: z.number().int().min(0),
  steps: z.number().int().positive(),
  attack: z.number().int().min(0),
});
export type EncounterStats = z.infer<typeof EncounterStats>;

export const Band = z.enum(["skirmisher", "lurker", "brute", "sentinel", "legend"]);
export type Band = z.infer<typeof Band>;

export interface BandRow {
  readonly stats: EncounterStats | null;
  /** Paid to the whole party via a `grantXp` effect — never to an individual. */
  readonly xp: number;
  /** How many of these make one encounter, before the HP window is checked. */
  readonly usualCount: number;
}

/**
 * `legend` is deliberately `null`: a legendary beast is a designed encounter,
 * not a rolled one, so it must author its own `stats` and cannot inherit.
 */
export const BANDS: Readonly<Record<Band, BandRow>> = {
  skirmisher: { stats: { hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 }, xp: 5, usualCount: 3 },
  lurker: { stats: { hp: 9, guard: 13, quick: 4, steps: 4, attack: 3 }, xp: 8, usualCount: 2 },
  brute: { stats: { hp: 14, guard: 12, quick: 1, steps: 3, attack: 4 }, xp: 12, usualCount: 2 },
  sentinel: { stats: { hp: 20, guard: 14, quick: 0, steps: 3, attack: 4 }, xp: 20, usualCount: 1 },
  legend: { stats: null, xp: 50, usualCount: 1 },
};

/**
 * Which bands a `danger_level` may use, so the two cannot drift.
 *
 * `none` and `low` are absent on purpose. A creature that is not dangerous does
 * not get a stat block — meeting it is a scene, not a fight, and giving it
 * numbers invites an author to start one.
 */
export const BANDS_BY_DANGER: Readonly<Record<string, readonly Band[]>> = {
  moderate: ["skirmisher", "lurker", "brute"],
  high: ["brute", "sentinel"],
  legendary: ["legend"],
};

/**
 * The total-HP window a whole encounter should land in for a three-hero
 * fledgling party. Checked per *encounter* rather than per creature — one brute
 * or three skirmishers are both fine, and only the sum says which.
 */
export const ENCOUNTER_HP_WINDOW = { min: 18, max: 30 } as const;

// ---------------------------------------------------------------------------
// D10 — the ways out that are not a fight
// ---------------------------------------------------------------------------

/**
 * The eight verbs `creatures.yaml` `agent_instructions` already names. The
 * vocabulary is canon's, not this module's:
 *
 * > Encounters should usually permit more than combat. Appropriate alternatives
 * > include observation, conversation, bargaining, rescue, distraction, escape,
 * > environmental problem-solving, and restoring a damaged habitat.
 */
export const ResolutionKind = z.enum([
  "observation",
  "conversation",
  "bargaining",
  "rescue",
  "distraction",
  "escape",
  "environmental_problem_solving",
  "restoring_habitat",
]);
export type ResolutionKind = z.infer<typeof ResolutionKind>;

/**
 * `difficulty`, not `tn`.
 *
 * It resolves through `rules.json` `difficultyTn` (easy 8 / normal 12 /
 * hard 16), and `tools/content/validate.mjs` already rejects a `check` scene
 * whose `tn` is outside that table. Writing raw numbers here would create a
 * second place to retune difficulty and a way to author an unreachable one.
 */
export const Difficulty = z.enum(["easy", "normal", "hard"]);

/**
 * One non-combat way past a creature.
 *
 * Maps onto a `CheckScene` with no translation: `stat` → `stat`, `difficulty`
 * → `tn`, `text` → the author's hint for `prompt`. What *happens* on success
 * stays with the chapter, because that is scene-specific — canon says what a
 * creature responds to, content says what responding gets you.
 */
export const Resolution = z.strictObject({
  kind: ResolutionKind,
  stat: z.enum(["might", "quick", "clever", "heart"]),
  difficulty: Difficulty,
  /** Why this works on *this* creature. Traceable to its `canon_constraints`. */
  text: z.string().min(1).optional(),
});
export type Resolution = z.infer<typeof Resolution>;

// ---------------------------------------------------------------------------

export const Encounter = z.strictObject({
  band: Band,
  /**
   * Overrides the band's numbers. Required for `legend`, which has none, and
   * otherwise the exception — the band is the dial, and a creature that needs
   * its own stat line should be able to say why in `canon_constraints`.
   */
  stats: EncounterStats.partial().optional(),
  /** Defaults to the band's. Paid to the whole party (spec §8.2). */
  xp: z.number().int().min(0).optional(),
  /**
   * Tiles occupied. **Advisory today**: `EnemySpec` carries no footprint and
   * `grid.ts` seats one actor per tile, so nothing reads this yet. It is here
   * because it is a true fact about the creature, and because an encounter
   * generator needs it to cap `count` and to keep something colossal out of a
   * three-wide corridor.
   */
  footprint: z.number().int().positive().optional(),
  /**
   * A *second sentence* for the enemy AI, and almost always absent.
   *
   * `enemy-ai.ts` is deliberately one sentence — "a monster walks at the
   * nearest hero it can reach and hits them" — and argues at length that an AI
   * a child cannot predict turns positioning from a decision into a guess. It
   * names exactly one extension, which is this field. Each value costs a
   * reviewed sentence in that module, so the set stays small on purpose.
   */
  behavior: Slug.optional(),
  /** D10. Required for a dangerous creature; the whole point of the block. */
  resolutions: z.array(Resolution).default([]),
});
export type Encounter = z.infer<typeof Encounter>;

/** The band's numbers with any per-creature override applied. */
export function resolveStats(encounter: Encounter): EncounterStats | null {
  const base = BANDS[encounter.band].stats;
  if (!base) return encounter.stats ? (encounter.stats as EncounterStats) : null;
  return { ...base, ...encounter.stats };
}

export function resolveXp(encounter: Encounter): number {
  return encounter.xp ?? BANDS[encounter.band].xp;
}
