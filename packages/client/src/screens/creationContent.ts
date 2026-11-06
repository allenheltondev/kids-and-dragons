/**
 * The matchup lines the species and class cards show (docs/matchups.md), and
 * the name generator for character creation (hero-names.ts, re-exported).
 *
 * There used to be appearance options here too — palettes, accents, horn and
 * wing styles, markings. None of them was ever drawn on the creature, so they
 * are gone: colors are assigned by the server (shared player-colors.ts) and
 * the rest had nothing to show.
 */

import { edgesForHero } from "@kad/shared";
import type { ClassId, MatchupEdge, MatchupRules, SpeciesId } from "@kad/shared";

// Names live in hero-names.ts (the start screens import them without the matchups).
export { NAME_MAX_LENGTH, randomName, randomNames, sanitizeName } from "./hero-names";

// ---------------------------------------------------------------------------
// Matchup lines on the species and class cards
// ---------------------------------------------------------------------------

/** "+" helps the hero, "-" makes things harder: from the hero's side of the table. */
export type MatchupSign = "+" | "-";

export interface MatchupLine {
  text: string;
  sign: MatchupSign;
}

/** What a card says: strengths, weaknesses, and how the pair works together. */
export interface CardMatchups {
  good: MatchupLine[];
  watch: MatchupLine[];
  together: MatchupLine[];
}

/** Good at: at most two lines. Watch out: at most one. */
const GOOD_LIMIT = 2;
const WATCH_LIMIT = 1;

/**
 * Which way an edge pushes the hero. An `on: "defend"` edge's roll is the
 * foe's, so a negative number protects the hero: it is flipped here, as
 * matchups.ts does, before the sign is read.
 */
export function matchupSign(edge: MatchupEdge): MatchupSign | null {
  const roll = (edge.on === "defend" ? -1 : 1) * (edge.roll ?? 0);
  const damage = edge.damage ?? 0;
  if (roll > 0 || damage > 0) return "+";
  if (roll < 0 || damage < 0) return "-";
  return null;
}

function listOf<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? (value as readonly T[]) : [value as T];
}

function toLines(edges: readonly MatchupEdge[], sign: MatchupSign, limit: number): MatchupLine[] {
  const lines: MatchupLine[] = [];
  for (const edge of edges) {
    if (lines.length >= limit) break;
    if (matchupSign(edge) === sign) lines.push({ text: edge.text, sign });
  }
  return lines;
}

function pairLines(edges: readonly MatchupEdge[]): MatchupLine[] {
  const lines: MatchupLine[] = [];
  for (const edge of edges) {
    const sign = matchupSign(edge);
    if (sign !== null) lines.push({ text: edge.text, sign });
  }
  return lines;
}

/**
 * The lines for one card. A species card reads the edges on its species alone
 * (no class key), a class card the edges on its class alone (no species key).
 * With both picked, `together` holds every pairing edge for that species and
 * class. Missing `matchups`, or none that apply, gives empty lists, and the
 * card renders as it did before.
 */
function cardMatchups(
  matchups: MatchupRules | null | undefined,
  side: "species" | "class",
  hero: { species?: SpeciesId; klass?: ClassId },
): CardMatchups {
  const empty: CardMatchups = { good: [], watch: [], together: [] };
  if (!matchups) return empty;
  // edgesForHero takes a whole hero; a half not picked yet is passed as
  // undefined, which no edge with that key matches.
  const edges = edgesForHero(matchups, {
    species: hero.species as SpeciesId,
    class: hero.klass as ClassId,
  });
  const hasSpeciesKey = (edge: MatchupEdge): boolean => listOf(edge.hero.species).length > 0;
  const hasClassKey = (edge: MatchupEdge): boolean => listOf(edge.hero.class).length > 0;
  const alone = edges.filter((edge) =>
    side === "species"
      ? hasSpeciesKey(edge) && !hasClassKey(edge)
      : hasClassKey(edge) && !hasSpeciesKey(edge),
  );
  const together =
    hero.species !== undefined && hero.klass !== undefined
      ? edges.filter((edge) => hasSpeciesKey(edge) && hasClassKey(edge))
      : [];
  return {
    good: toLines(alone, "+", GOOD_LIMIT),
    watch: toLines(alone, "-", WATCH_LIMIT),
    together: pairLines(together),
  };
}

/** A species card's lines. `klass` is set when a class was picked before going back. */
export function speciesMatchups(
  matchups: MatchupRules | null | undefined,
  species: SpeciesId,
  klass?: ClassId | null,
): CardMatchups {
  return cardMatchups(matchups, "species", { species, klass: klass ?? undefined });
}

/** A class card's lines. `species` is the species already picked, when there is one. */
export function classMatchups(
  matchups: MatchupRules | null | undefined,
  klass: ClassId,
  species?: SpeciesId | null,
): CardMatchups {
  return cardMatchups(matchups, "class", { species: species ?? undefined, klass });
}
