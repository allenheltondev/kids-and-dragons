/**
 * Which chapter the household plays next, decided on the phone from what it
 * already has (#467): the saved journal's Story (the campaigns played, newest
 * first, and in each the chapters played, in order) and the campaign's own
 * content. The worker's overnight refresh (`periodicsync`, sw.ts) warms that
 * chapter's art, so the next evening opens with every backdrop already saved.
 *
 * The server decides the real next chapter when the party presses Begin
 * (`nextChapter`, server handlers/action.ts), from the attempt's route flags
 * and journey. The phone does not hold those, so this is a best guess that
 * errs wide: a beat with several roads (Gemfall's 3a/3b/3c) warms each road
 * the journal cannot rule out, up to `SW_NEXT_CHAPTERS_MAX`, and a graph
 * campaign warms each way on out of where the party last played.
 *
 * Pure, and concatenated into `sw.js` by `sw-build.ts` (which drops the
 * `import`/`export` lines), so nothing here may import anything at runtime
 * but `chapter-art.ts`, and every name here is a global in the worker.
 */

import type { Campaign, Chapter, ChapterRoute, JournalResponse } from "@kad/shared";
import { chapterAssets, type FigureOf } from "./chapter-art";

/**
 * Where the page keeps the saved journal (store/journal-db.ts), read by the
 * worker, never written. Spelled out here because the worker cannot import
 * it; a test holds the two together.
 */
export const SW_JOURNAL_DB = { name: "kad", store: "journal", key: "current" } as const;

/** The most chapters one night gets ready. */
export const SW_NEXT_CHAPTERS_MAX = 3;

/** How many chapters past the last one played are read to find the next beat's roads. */
export const SW_NEXT_LOOKAHEAD = 5;

/** The most of this player's heroes whose figures are warmed (furthest-taken first). */
export const SW_NEXT_HEROES_MAX = 4;

export function swChapterPath(id: string): string {
  return `/content/chapters/${encodeURIComponent(id)}.json`;
}

export function swCampaignPath(id: string): string {
  return `/content/campaigns/${encodeURIComponent(id)}.json`;
}

/** The campaign the household is in the middle of, from the journal's Story. */
export interface SwActiveStory {
  campaignId: string;
  /** Chapter ids, in the order played. */
  played: string[];
  /** Every "Last time…" line those chapters decided. */
  lines: string[];
}

/**
 * The newest campaign whose attempt is still going. Null when the journal has
 * no Story (an older server, nobody has set out) or every campaign in it is
 * finished: nothing is guessed at then.
 */
export function swActiveStory(journal: Partial<Pick<JournalResponse, "story">> | null | undefined): SwActiveStory | null {
  const story = Array.isArray(journal?.story) ? journal.story : [];
  const active = story.find((campaign) => campaign && campaign.status === "active" && typeof campaign.campaignId === "string");
  if (!active) return null;
  const chapters = Array.isArray(active.chapters) ? active.chapters : [];
  return {
    campaignId: active.campaignId,
    played: chapters.map((chapter) => chapter?.chapterId).filter((id): id is string => typeof id === "string"),
    lines: chapters.flatMap((chapter) => (Array.isArray(chapter?.lastTime) ? chapter.lastTime : [])).filter((line): line is string => typeof line === "string"),
  };
}

/**
 * The route flags the party holds, as far as the journal says: a played
 * chapter's "Last time…" line that is exactly a flag's line names that flag,
 * in either of its wordings when it reads the inventory (`LastTimeLine`). A
 * line that matches none only leaves a beat's roads wider.
 */
export function swHeldFlags(campaign: Pick<Campaign, "lastTime">, lines: readonly string[]): Set<string> {
  const said = new Set(lines);
  const held = new Set<string>();
  for (const [flag, line] of Object.entries(campaign.lastTime?.lines ?? {})) {
    const wordings = typeof line === "string" ? [line] : line && typeof line === "object" ? [line.text, line.otherwise] : [];
    if (wordings.some((wording) => said.has(wording))) held.add(flag);
  }
  return held;
}

/**
 * The chapter files to read before `swNextChapters` can answer an ordered
 * campaign: the last one played (for its beat) and the few after it in the
 * campaign's list (for the next beat's roads). None for a graph campaign,
 * whose map alone says where the ways go.
 */
export function swChaptersToRead(campaign: Pick<Campaign, "chapters" | "graph">, played: readonly string[]): string[] {
  if (campaign.graph) return [];
  const members = Array.isArray(campaign.chapters) ? campaign.chapters : [];
  const last = lastMember(members, played);
  if (last === undefined) return members.slice(0, SW_NEXT_LOOKAHEAD);
  const at = members.indexOf(last);
  return [last, ...members.slice(at + 1, at + 1 + SW_NEXT_LOOKAHEAD)];
}

/** What `swNextChapters` needs of a chapter it read: its beat and its road. */
export type SwChapterFacts = Readonly<Record<string, { index: number; route?: ChapterRoute } | undefined>>;

/**
 * The chapters the party may play next, at most `SW_NEXT_CHAPTERS_MAX`.
 *
 * Ordered campaign: the beat after the last one played, every chapter at it
 * (`index`), narrowed to the roads the party holds when the journal says
 * which (a "Last time…" line, or the road of the chapter just played); the first beat when none is played yet; nothing past the last beat.
 *
 * Graph campaign: the chapters the ways out of the last played node lead to
 * (forward first, then sideways; never a way back or a locked one), leaving
 * out a closed place already played; the entry's chapter when none is
 * played.
 */
export function swNextChapters(
  campaign: Pick<Campaign, "chapters" | "graph" | "lastTime">,
  story: Pick<SwActiveStory, "played" | "lines">,
  facts: SwChapterFacts,
): string[] {
  if (campaign.graph) return graphNext(campaign.graph, story.played).slice(0, SW_NEXT_CHAPTERS_MAX);
  const members = Array.isArray(campaign.chapters) ? campaign.chapters : [];
  const last = lastMember(members, story.played);
  const beat = last === undefined ? 1 : (facts[last]?.index ?? Number.NaN) + 1;
  if (!Number.isFinite(beat)) return [];
  const roads = members.filter((id) => facts[id]?.index === beat);
  const held = swHeldFlags(campaign, story.lines);
  // A chapter on a road was played because the party held that road's flag.
  const road = last === undefined ? undefined : facts[last]?.route;
  if (road) held.add(road.flag);
  const taken = roads.filter((id) => {
    const route = facts[id]?.route;
    return route === undefined || held.has(route.flag);
  });
  return (taken.length > 0 ? taken : roads).slice(0, SW_NEXT_CHAPTERS_MAX);
}

function graphNext(graph: NonNullable<Campaign["graph"]>, played: readonly string[]): string[] {
  const nodes = graph.nodes ?? {};
  const last = played.at(-1);
  if (last === undefined) {
    const entry = nodes[graph.entry]?.chapter;
    return entry ? [entry] : [];
  }
  const here = new Set(
    Object.entries(nodes)
      .filter(([, node]) => node.chapter === last || (node.variants ?? []).some((variant) => variant.chapter === last))
      .map(([id]) => id),
  );
  const rank = { forward: 0, sideways: 1 } as Record<string, number | undefined>;
  const ways = Object.values(graph.edges ?? {})
    .filter((edge) => here.has(edge.from) && rank[edge.kind] !== undefined && !edge.locked)
    .sort((a, b) => (rank[a.kind] ?? 0) - (rank[b.kind] ?? 0));
  const out: string[] = [];
  for (const edge of ways) {
    const node = nodes[edge.to];
    if (!node || out.includes(node.chapter)) continue;
    if (node.revisit === "closed" && played.includes(node.chapter)) continue;
    out.push(node.chapter);
  }
  return out;
}

function lastMember(members: readonly string[], played: readonly string[]): string | undefined {
  for (let i = played.length - 1; i >= 0; i -= 1) if (members.includes(played[i]!)) return played[i];
  return undefined;
}

/** This player's heroes as figures, furthest-taken first, at most `SW_NEXT_HEROES_MAX`. */
export function swHeroesOf(journal: Partial<Pick<JournalResponse, "heroes">> | null | undefined): FigureOf[] {
  const heroes = Array.isArray(journal?.heroes) ? journal.heroes : [];
  return heroes
    .filter((hero) => hero && typeof hero.species === "string" && typeof hero.tier === "string")
    .slice(0, SW_NEXT_HEROES_MAX)
    .map((hero) => ({ character: { species: hero.species, tier: hero.tier, class: hero.class } }));
}

/**
 * The art to warm for the chapters ahead, nearest first: each chapter's
 * story plate (`storyPlateUrl`, the first thing it shows), then everything it
 * can draw (`chapterAssets`), with the heroes' figures. No duplicates.
 */
export function swNextChapterArt(chapters: readonly Chapter[], heroes: readonly FigureOf[]): string[] {
  const urls = new Set<string>();
  for (const chapter of chapters) {
    if (chapter.plate?.art) urls.add(`/assets/${chapter.plate.art}.webp`);
    for (const url of chapterAssets(chapter, heroes)) urls.add(url);
  }
  return [...urls];
}
