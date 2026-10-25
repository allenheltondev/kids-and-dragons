/**
 * The name generator for character creation (spec §5.5), and the matchup
 * lines the species and class cards show (docs/matchups.md).
 *
 * There used to be appearance options here too — palettes, accents, horn and
 * wing styles, markings. None of them was ever drawn on the creature, so they
 * are gone: colors are assigned by the server (shared player-colors.ts) and
 * the rest had nothing to show.
 */

import { edgesForHero } from "@kad/shared";
import type { ClassId, MatchupEdge, MatchupRules, SpeciesId } from "@kad/shared";

// ---------------------------------------------------------------------------
// Names — spec §5.5: typing must be optional, never required (spec §1.1)
// ---------------------------------------------------------------------------

const FIRST_PARTS: readonly string[] = [
  "Ember", "Moon", "Thistle", "Bramble", "Frost", "Sun", "Storm", "Pebble",
  "Clover", "Cinder", "Willow", "Dusk", "Star", "River", "Honey", "Aspen",
];

const SECOND_PARTS: readonly string[] = [
  "wing", "hoof", "song", "spark", "paw", "leaf", "mane", "dash",
  "whisker", "bloom", "tail", "glow", "step", "heart", "horn", "hop",
];

function pick(list: readonly string[]): string {
  const index = Math.floor(Math.random() * list.length);
  return list[index] ?? list[0] ?? "";
}

/** One generated name. Compound so it always reads as a creature's name. */
export function randomName(): string {
  return `${pick(FIRST_PARTS)}${pick(SECOND_PARTS)}`;
}

/**
 * `count` distinct suggestions, offered as tappable chips: choosing a name is
 * then a tap like every other decision, and the keyboard is opt-in.
 */
export function randomNames(count: number): string[] {
  const out = new Set<string>();
  // Bounded: never spin on an unlucky run of duplicates.
  for (let i = 0; i < count * 12 && out.size < count; i += 1) out.add(randomName());
  return [...out];
}

/** Names are shown on a TV across the room, so keep them short and clean. */
export const NAME_MAX_LENGTH = 16;

export function sanitizeName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} '-]/gu, "").slice(0, NAME_MAX_LENGTH);
}

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
 * The lines for one card. `species` alone (no `klass`) gives the species card's
 * own edges; `klass` alone gives the class card's. With both, `together` holds
 * every pairing edge for that species and class. Missing `matchups`, or none
 * that apply, gives empty lists, and the card renders as it did before.
 */
function cardMatchups(
  matchups: MatchupRules | null | undefined,
  hero: { species?: SpeciesId; klass?: ClassId },
): CardMatchups {
  const empty: CardMatchups = { good: [], watch: [], together: [] };
  if (!matchups) return empty;
  // edgesForHero takes a whole hero; the half not picked yet is passed as
  // undefined, which no edge with that key matches.
  const edges = edgesForHero(matchups, {
    species: hero.species as SpeciesId,
    class: hero.klass as ClassId,
  });
  const hasSpecies = hero.species !== undefined;
  const hasClass = hero.klass !== undefined;
  const alone = edges.filter((edge) => {
    const species = listOf(edge.hero.species).length > 0;
    const klass = listOf(edge.hero.class).length > 0;
    return species !== klass && (hasSpecies ? species : klass);
  });
  const together = hasSpecies && hasClass
    ? edges.filter((edge) => listOf(edge.hero.species).length > 0 && listOf(edge.hero.class).length > 0)
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
  return cardMatchups(matchups, { species, klass: klass ?? undefined });
}

/** A class card's lines. `species` is the species already picked, when there is one. */
export function classMatchups(
  matchups: MatchupRules | null | undefined,
  klass: ClassId,
  species?: SpeciesId | null,
): CardMatchups {
  return cardMatchups(matchups, { species: species ?? undefined, klass });
}
