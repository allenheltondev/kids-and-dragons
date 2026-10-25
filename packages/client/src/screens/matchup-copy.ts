/**
 * Matchup reminders in words (docs/matchups.md "Presentation"): the callout
 * beside a roll, the chips at the start of a fight, the badge on a check.
 *
 * The field guide is where matchups are learned; these only remind. So every
 * line is short, says no numbers, and tells a plus from a minus by its icon
 * (plus / minus, different shapes) and its lead words ("Strong here!" /
 * "Careful:"), never by colour alone (spec §11).
 *
 * Everything is pure and goes quiet when matchups are off: no rules table, an
 * exempt campaign (Gemfall) or no notes on the roll give back nothing, so the
 * screens draw what they drew before matchups.
 */

import {
  checkNotes,
  fightHints,
  matchupsOn,
  type DiceRoll,
  type ClassId,
  type EncounterState,
  type FightHint,
  type MatchupNote,
  type RulesContent,
  type SpeciesId,
} from "@kad/shared";

export type MatchupSign = "plus" | "minus";

/** One matchup, ready to draw or say. */
export interface Callout {
  readonly id: string;
  readonly sign: MatchupSign;
  /** The shape that carries the sign: the "plus" and "minus" glyphs. */
  readonly icon: MatchupSign;
  /** "Strong here!" or "Careful:". */
  readonly lead: string;
  /** The table's own sentence for the matchup. */
  readonly text: string;
  /** Lead and sentence together: the TV's line, the log's and the screen reader's. */
  readonly line: string;
}

export const PLUS_LEAD = "Strong here!";
export const MINUS_LEAD = "Careful:";

/** What moved a roll, from the hero's side: positive helps. Zero is not a matchup. */
export function signOf(note: Pick<MatchupNote, "roll" | "damage">): MatchupSign | null {
  const lean = note.roll !== 0 ? note.roll : note.damage;
  if (lean === 0) return null;
  return lean > 0 ? "plus" : "minus";
}

/** A note as a callout, or null when it moves nothing. */
export function calloutOf(note: Pick<MatchupNote, "id" | "text" | "roll" | "damage">): Callout | null {
  const sign = signOf(note);
  if (sign === null) return null;
  const lead = sign === "plus" ? PLUS_LEAD : MINUS_LEAD;
  return { id: note.id, sign, icon: sign, lead, text: note.text, line: `${lead} ${note.text}` };
}

/** The callouts of a list of notes, in order. */
export function calloutsOf(notes: readonly Pick<MatchupNote, "id" | "text" | "roll" | "damage">[]): Callout[] {
  return notes.flatMap((note) => {
    const callout = calloutOf(note);
    return callout === null ? [] : [callout];
  });
}

/** The callouts a roll carries (`DiceRoll.matchup`); none without it. */
export function calloutsOfRoll(roll: Pick<DiceRoll, "matchup">): Callout[] {
  return roll.matchup ? calloutsOf(roll.matchup.notes) : [];
}

/** What the read-aloud voice says for a swing's callouts: no icons, no colons. */
export function spokenCallouts(callouts: readonly Callout[]): string {
  return callouts
    .map((callout) => (callout.sign === "plus" ? `${callout.text} That is strong here!` : `Careful. ${callout.text}`))
    .join(" ");
}

/**
 * The chips for the start of a fight, or none when matchups are off for this
 * campaign. A rules table without `matchups`, an exempt campaign, or a fight
 * whose combatants carry no species and traits (every fight in Gemfall) all
 * give an empty list.
 */
export function fightChips(
  rules: RulesContent | null,
  campaignId: string | null | undefined,
  encounter: EncounterState,
  limit = 3,
): FightHint[] {
  if (!rules || !matchupsOn(rules, campaignId)) return [];
  return fightHints(rules, encounter, limit);
}

/** A chip that concerns one hero, and which way. */
export interface HeroChip {
  readonly hint: FightHint;
  readonly sign: MatchupSign;
}

/** The hints that name this hero (a combatant id), strongest first, at most `limit`. Good wins a tie. */
export function chipsForHero(
  rules: RulesContent | null,
  campaignId: string | null | undefined,
  encounter: EncounterState,
  heroId: string,
  limit = 2,
): HeroChip[] {
  const out: HeroChip[] = [];
  for (const hint of fightChips(rules, campaignId, encounter, 12)) {
    const good = hint.good.includes(heroId);
    const bad = hint.bad.includes(heroId);
    if (!good && !bad) continue;
    out.push({ hint, sign: good ? "plus" : "minus" });
    if (out.length === limit) break;
  }
  return out;
}

/** The badge on a check prompt: a sign, and "Sneak: Bigfoot are loud." */
export interface CheckBadge {
  readonly id: string;
  readonly sign: MatchupSign;
  readonly text: string;
}

/**
 * The matchups on this hero's own check, for the roll prompt. An edge on a tag
 * leads with the tag's name ("Sneak: ..."); a creature's opinion stands alone.
 * Nothing without matchups, tags or an edge for this hero.
 */
export function checkBadges(
  rules: RulesContent | null,
  campaignId: string | null | undefined,
  hero: { species: SpeciesId; class: ClassId },
  scene: { tags?: readonly string[] } | null | undefined,
  limit = 2,
): CheckBadge[] {
  if (!rules?.matchups || !matchupsOn(rules, campaignId) || !scene?.tags?.length) return [];
  const table = rules.matchups;
  const notes = checkNotes(table, hero, { tags: scene.tags });
  const badges: CheckBadge[] = [];
  for (const note of notes) {
    const sign = signOf(note);
    if (sign === null) continue;
    const edge = table.edges.find((e) => e.id === note.id);
    const tags = edge?.tag === undefined ? [] : Array.isArray(edge.tag) ? edge.tag : [edge.tag];
    const tag = tags.find((t) => scene.tags?.includes(t));
    const name = tag === undefined ? undefined : table.checkTags[tag]?.name;
    badges.push({ id: note.id, sign, text: name ? `${name}: ${note.text}` : note.text });
  }
  return badges.slice(0, limit);
}
