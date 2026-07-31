/**
 * What a creature does in a fight, and what it takes instead of one —
 * docs/canon-contract.md D9 and D10.
 *
 * The shapes live here; the *numbers* live in `content/rules.json`
 * `encounterBands`, beside the hero-side ones they are balanced against. See
 * the `Band` doc below for why the split falls there.
 *
 * ---------------------------------------------------------------------------
 * WHY BANDS AND NOT FIVE INTEGERS
 *
 * A creature picks a band; it does not pick an `hp`. The numbers live in one
 * table, so retuning combat is one edit rather than seventeen, and a generator
 * choosing an encounter is choosing from a handful of options rather than
 * inventing a stat line. `stats` exists as an override for the creature that
 * genuinely needs one, and `legend` has no default at all — a legendary beast
 * is authored, signed off, and never generated.
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

/**
 * The name of a stat block, defined in `content/rules.json` `encounterBands`.
 *
 * **The numbers are deliberately not here.** Canon says which band a creature
 * is — a judgement about the world, and a fact about the creature. What a band
 * is *worth* is a judgement about balance, and it belongs beside the hero-side
 * numbers it is balanced against (`baseMaxHp`, `baseGuard`, `baseSteps`), in
 * the file the server already loads and the schema already validates. Retuning
 * every fight in the game is then a content edit rather than a deploy.
 *
 * The consequence is that this package cannot check a band on its own: the
 * name is a slug here, and `tools/canon/check.ts` — which can read both files —
 * verifies it exists, that it suits the creature's `danger_level`, and that a
 * usual-count encounter lands in the round budget.
 */
export const Band = Slug;
export type Band = string;

/** One row of `content/rules.json` `encounterBands`. */
export interface BandRow {
  /** `null` for a band with no default — the creature must author its own. */
  readonly stats: EncounterStats | null;
  /** Paid to the whole party via a `grantXp` effect — never to an individual. */
  readonly xp: number;
  /** How many make one encounter, before the HP window is checked. */
  readonly usualCount: number;
  /** Which `danger_level` values may use this band, so the two cannot drift. */
  readonly dangerLevels: readonly string[];
}

export type BandTable = Readonly<Record<string, BandRow>>;

/**
 * The total-HP window a whole encounter should land in for a three-hero
 * fledgling party — the check `tools/canon/check.ts` runs over the band table.
 *
 * Derived, not chosen: a level-1 hero swings d20 + 2..4 against Guard 11 —
 * about 65% — for 3 damage (`ATTACK_DAMAGE`), so roughly 2 damage a round each
 * and ~6 for a party of three. Spec §7.1 tunes for about four rounds.
 *
 * Checked per *encounter* rather than per creature: one brute or three
 * skirmishers are both fine, and only the sum says which.
 */
export const ENCOUNTER_HP_WINDOW = { min: 18, max: 30 } as const;

/** Reads the band table off a loaded `rules.json`. */
export function bandTable(rules: unknown): BandTable {
  const table = (rules as { encounterBands?: Record<string, unknown> })?.encounterBands ?? {};
  const out: Record<string, BandRow> = {};
  for (const [name, row] of Object.entries(table)) {
    if (name.startsWith("$") || typeof row !== "object" || row === null) continue;
    out[name] = row as BandRow;
  }
  return out;
}

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
  /** Names a row of `content/rules.json` `encounterBands`. */
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
export function resolveStats(encounter: Encounter, bands: BandTable): EncounterStats | null {
  const base = bands[encounter.band]?.stats ?? null;
  if (!base) {
    const own = encounter.stats;
    // A band with no default (legend) needs a complete authored block.
    return own && EncounterStats.safeParse(own).success ? (own as EncounterStats) : null;
  }
  return { ...base, ...encounter.stats };
}

export function resolveXp(encounter: Encounter, bands: BandTable): number {
  return encounter.xp ?? bands[encounter.band]?.xp ?? 0;
}
