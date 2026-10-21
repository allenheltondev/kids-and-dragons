/**
 * The words around a chapter (#357): "Last time…" before its first scene, and "Where you left
 * off" for a screen that comes back partway through.
 *
 * Both are picked here, from facts every screen already mirrors (the run's flags and trail, the
 * chapter and campaign files), so the TV, a phone's pane and the tests all pick the same lines.
 * Nothing is generated: every line is authored, in the campaign file (`Campaign.lastTime`) or in
 * a scene's own narration.
 */

import type { Campaign, Chapter, LastTimeLine, SceneId } from "./types/chapter.js";

/**
 * At most this many "Last time…" lines. The newest a party carries, in story order, so by the
 * last chapter the table hears the last few things it decided rather than the whole campaign,
 * and the preface stays short enough to read aloud before the story starts.
 */
export const LAST_TIME_MAX_LINES = 4;

/** At most this many scenes' lines in "Where you left off". */
export const LEFT_OFF_MAX_LINES = 3;

/** What the preface reads: the run's flags, and the item ids the party holds between them. */
export interface PrefaceFacts {
  flags: Readonly<Record<string, boolean>>;
  held?: ReadonlySet<string>;
}

/**
 * The route-set flags a party carried into this chapter: every member it holds, less any the
 * chapter's own entry scene sets as it opens (that is this chapter's doing, not last time's).
 * In the campaign's `routeSets` order.
 */
export function carriedRouteFlags(campaign: Campaign, chapter: Chapter | null, flags: Readonly<Record<string, boolean>>): string[] {
  const own = new Set<string>();
  const entry = chapter?.scenes[chapter.entry] as { onEnter?: { type: string; flag?: string; value?: boolean }[] } | undefined;
  for (const effect of entry?.onEnter ?? []) {
    if (effect.type === "setFlag" && effect.flag !== undefined && effect.value !== false) own.add(effect.flag);
  }
  return Object.values(campaign.routeSets ?? {})
    .flat()
    .filter((flag) => flags[flag] === true && !own.has(flag));
}

/** One authored line, read against what the party holds (the facet rule). */
export function lastTimeLineText(line: LastTimeLine, held: ReadonlySet<string> | undefined): string {
  if (typeof line === "string") return line;
  return held?.has(line.holding) === true ? line.text : line.otherwise;
}

/**
 * "Last time…": the lines for the flags this party carried in, newest last, or the opener for a
 * party that carried none. Null for a campaign with no `lastTime` (the practice, an older
 * reference campaign), which then simply starts.
 */
export function lastTimeLines(
  campaign: Campaign,
  chapter: Chapter | null,
  facts: PrefaceFacts,
): { recap: boolean; lines: string[] } | null {
  const lastTime = campaign.lastTime;
  if (!lastTime) return null;
  const carried = new Set(carriedRouteFlags(campaign, chapter, facts.flags));
  const lines = Object.entries(lastTime.lines)
    .filter(([flag]) => carried.has(flag))
    .map(([, line]) => lastTimeLineText(line, facts.held))
    .filter((text) => text.trim() !== "");
  if (lines.length === 0) return { recap: false, lines: [lastTime.opener] };
  return { recap: true, lines: lines.slice(-LAST_TIME_MAX_LINES) };
}

/**
 * The first sentence of a scene's words, or the first two when the first is only a word or two ("Splash!").
 * Sentences end at . ! or ?, with any closing quote kept.
 */
export function firstSentence(text: string): string {
  const pieces = text.trim().match(/[^.!?]+(?:[.!?]+["”']?|$)/g)?.map((s) => s.trim()).filter((s) => s !== "") ?? [];
  // A quote that ends in "!" and carries on (`"Hi!" says the troll.`) is one sentence.
  const sentences: string[] = [];
  for (const piece of pieces) {
    if (sentences.length > 0 && /^[a-z]/.test(piece)) sentences[sentences.length - 1] += ` ${piece}`;
    else sentences.push(piece);
  }
  if (sentences.length === 0) return "";
  const first = sentences[0]!;
  if (first.length < 12 && sentences.length > 1) return `${first} ${sentences[1]!}`;
  return first;
}

/**
 * "Where you left off": a line from each of the last few scenes this run walked through before
 * the one it stands in, oldest first. The run's trail (`RunState.visited`) is all it reads.
 *
 * A scene is only quoted when its words are the same for every party: one with narration
 * variants, or a `{token}` the engine fills, is passed over for the one before it, so a line
 * never tells this party about a stone it does not hold or count it wrong.
 */
export function leftOffLines(chapter: Chapter, visited: readonly SceneId[], max = LEFT_OFF_MAX_LINES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const before = visited.slice(0, -1);
  if (visited.length > 0) seen.add(visited[visited.length - 1]!);
  // Never further back than this: an old scene says less about now than no line at all.
  const oldest = Math.max(0, before.length - max * 3);
  for (let i = before.length - 1; i >= oldest && out.length < max; i--) {
    const id = before[i]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const scene = chapter.scenes[id] as { narration?: string; variants?: unknown[] } | undefined;
    const narration = scene?.narration ?? "";
    if (narration === "" || (scene?.variants?.length ?? 0) > 0 || narration.includes("{")) continue;
    const line = firstSentence(narration);
    if (line !== "") out.unshift(line);
  }
  return out;
}
