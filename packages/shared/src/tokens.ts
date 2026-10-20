/**
 * Class tokens — the gear a class's power is in (#314, docs/class-mastery.md §4).
 *
 * A hero wears one: a thorn bracer, a dusk hood, a star circlet or a song bell
 * on a cord. Two worn together argue and neither works, which is why a hero has
 * one class at a time. Ranks show as notches on the token, and the tokens of
 * classes taken off ride in the pack, notches and all, without a slot.
 *
 * "Class token" is the word in code and docs only. On screen it is always the
 * token's own name ("your thorn bracer"), so the names live here, beside the
 * one helper that says how far along the next rank a hero is.
 */

import { CLASS_RANKS } from "./types/domain.js";
import type { ClassDef, ClassId, ClassRank, DeedId } from "./types/domain.js";
import { DEED_LABELS, nextRank, nextRankDeeds } from "./deeds.js";

export const CLASS_TOKENS: Record<ClassId, { name: string }> = {
  thornguard: { name: "thorn bracer" },
  duskrunner: { name: "dusk hood" },
  starweaver: { name: "star circlet" },
  songkeeper: { name: "song bell" },
};

/** How many notches a token has room for: one per rank above none. */
export const TOKEN_NOTCHES = CLASS_RANKS.length - 1;

/** The notches a rank has cut into its token: none 0, Apprentice 1, Expert 2, Master 3. */
export function notchesFor(rank: ClassRank | undefined): number {
  return Math.max(0, CLASS_RANKS.indexOf(rank ?? "none"));
}

/** "Starweaver Apprentice", or the class name alone with no rank yet (spec §4.3). */
export function rankTitle(classDef: Pick<ClassDef, "name">, rank: ClassRank | undefined): string {
  if (!rank || rank === "none") return classDef.name;
  return `${classDef.name} ${rank[0]!.toUpperCase()}${rank.slice(1)}`;
}

/** One deed on the way to the next rank: what it is, and how many of how many. */
export interface DeedStep {
  deed: DeedId;
  label: string;
  have: number;
  need: number;
}

/**
 * The one track a hero sees toward their next rank (docs/class-mastery.md §6,
 * rule 6: "one visible track per hero, no menu of deeds"). Either of a rank's
 * tracks completes it, so this shows the one further along; when they are
 * level, a hero alone sees the alone track and a table sees the friends one.
 * Null at Master, or for a class with no deeds authored.
 */
export function deedTrack(
  classDef: ClassDef | undefined,
  rank: ClassRank | undefined,
  deeds: Readonly<Record<string, number>> | undefined,
  partySize: number,
): { next: Exclude<ClassRank, "none">; steps: DeedStep[] } | null {
  const req = nextRankDeeds(classDef, rank ?? "none");
  const next = nextRank(rank ?? "none");
  if (!req || !next) return null;
  const have = deeds ?? {};
  const stepsOf = (track: Partial<Record<DeedId, number>>): DeedStep[] =>
    (Object.entries(track) as [DeedId, number][]).map(([deed, need]) => ({
      deed,
      label: DEED_LABELS[deed],
      have: Math.min(need, have[deed] ?? 0),
      need,
    }));
  const done = (steps: DeedStep[]): number =>
    steps.length === 0 ? 0 : steps.reduce((sum, s) => sum + s.have / s.need, 0) / steps.length;
  const friends = stepsOf(req.withFriends);
  if (!req.alone) return { next, steps: friends };
  const alone = stepsOf(req.alone);
  const lead = done(alone) - done(friends);
  return { next, steps: lead > 0 || (lead === 0 && partySize <= 1) ? alone : friends };
}
