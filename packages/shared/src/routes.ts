/**
 * Which chapter a party actually enters at a routed beat.
 *
 * ---------------------------------------------------------------------------
 * WHAT A ROUTED INDEX IS
 *
 * A campaign's story beats are fixed; its geography need not be. Gemfall's
 * middle is three roads north — the same three beats on each, in three
 * different countries — so beats 3, 4 and 5 are *triples*: three chapter
 * files sharing an index, one per road, selected by a flag the party set when
 * they chose at Bramblewood. Chapter 7 is a triple on a different axis
 * (the pursuit the party has been playing toward), which is why the set a
 * variant belongs to is named rather than assumed.
 *
 * The alternative — one enormous chapter whose graph forks three ways — does
 * not work, and not for reasons of taste: `biome` is a property of the
 * chapter, and it drives the backdrop, the palette, the tiles and the music.
 * A marsh, a plain and a forest cannot be one biome, so they cannot be one
 * chapter file however the scenes are arranged.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SELECTION LIVES HERE
 *
 * Pure, in shared, next to the types — because three things have to agree
 * about it and none of them should own it: the server picks the member when a
 * party starts a beat, `content:validate` checks a routed index is complete,
 * and the authoring tools draw the graph. A rule implemented three times is a
 * rule with three answers.
 */

import type { Chapter } from "./types/chapter.js";

/** Chapters grouped by the beat they are, in play order. */
export function chaptersByIndex(chapters: readonly Chapter[]): Map<number, Chapter[]> {
  const beats = new Map<number, Chapter[]>();
  for (const chapter of chapters) {
    const members = beats.get(chapter.index) ?? [];
    members.push(chapter);
    beats.set(chapter.index, members);
  }
  // Stable within a beat, so every caller sees the same order and a report
  // reads the same way twice.
  for (const members of beats.values()) members.sort((a, b) => a.id.localeCompare(b.id));
  return beats;
}

/**
 * The chapter a party with these flags plays at this beat, or null.
 *
 * Null is a real answer with two causes, and the caller has to tell them
 * apart: there is no such beat, or the party has not yet set the flag that
 * chooses one. The second is not an error at authoring time — a party is
 * *supposed* to reach the end of chapter 2 without a road yet — it is only an
 * error if it happens when they are about to enter the beat, which is why
 * this reports rather than throws.
 */
export function chapterFor(
  chapters: readonly Chapter[],
  index: number,
  flags: Readonly<Record<string, boolean>>,
): Chapter | null {
  const members = chaptersByIndex(chapters).get(index) ?? [];
  if (members.length === 0) return null;

  // An unrouted beat has exactly one chapter and no flag to read. This is
  // every chapter authored before routing existed, and it stays the common
  // case: only a branching middle needs any of the above.
  const routed = members.filter((chapter) => chapter.route);
  if (routed.length === 0) return members[0] ?? null;

  const chosen = routed.filter((chapter) => flags[chapter.route!.flag] === true);
  // Exactly one road, or none yet. Two set at once is a content bug that
  // `content:validate` cannot see — flags are set by scenes at runtime — so
  // it resolves to nothing rather than to whichever file sorted first: a
  // party sent down a road they did not pick would be worse than a party
  // stopped at a beat with a message.
  return chosen.length === 1 ? (chosen[0] ?? null) : null;
}

/** Every flag that selects a member at this beat — what the party may choose from. */
export function routeFlagsAt(chapters: readonly Chapter[], index: number): string[] {
  return (chaptersByIndex(chapters).get(index) ?? [])
    .map((chapter) => chapter.route?.flag)
    .filter((flag): flag is string => flag !== undefined);
}

/** How many beats a playthrough visits — indexes, not files. */
export function beatCount(chapters: readonly Chapter[]): number {
  return chaptersByIndex(chapters).size;
}
