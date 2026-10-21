/**
 * The Story page in the adventure book (#358): each chapter a household has
 * played in a campaign, how it ended, its revelation in the scene's own words,
 * its goal, and the "Last time…" lines for the choices it decided.
 *
 * Two halves. `chapterStoryOf` runs when a chapter completes and keeps the few
 * ids the page needs (`ChapterStory`), because the trail and the chapter's own
 * flags die at the chapter boundary. `storyChapters` runs when the journal is
 * read and turns those ids back into authored words. Nothing is generated: the
 * lines are the campaign's `lastTime` (picked by chapter-preface.ts, the same
 * rules as the preface) and the scenes' own narration.
 */

import type { Campaign, Chapter, ChapterStory, Condition, NarrationVariant, SceneId } from "./types/chapter.js";
import type { ResolvedCharacter } from "./types/domain.js";
import type { JournalStoryChapter } from "./types/protocol.js";
import { partyItemIds, type ChoiceParty } from "./chapter-graph.js";
import { firstSentence, lastTimeLines } from "./chapter-preface.js";
import { composeNarration, fillTokens } from "./narration.js";

export type SceneWords = { type?: string; narration?: string; prompt?: string; variants?: NarrationVariant[]; outcome?: string; priority?: number };

function sceneOf(chapter: Pick<Chapter, "scenes">, id: SceneId): SceneWords | undefined {
  return chapter.scenes[id] as SceneWords | undefined;
}

/** A variant the page can read later: one that asks only what the party held. Flags and the purse are gone by then. */
function readsOnlyTheBag(when: Condition | undefined): boolean {
  return Object.keys(when ?? {}).every((key) => key === "item" || key === "notItem" || key === "count");
}

/** The item ids, and `*` patterns, a scene's words read. */
function itemsRead(scene: SceneWords | undefined, into: string[]): void {
  for (const variant of scene?.variants ?? []) {
    if (!readsOnlyTheBag(variant.when)) continue;
    const { item, notItem, count } = variant.when ?? {};
    if (item !== undefined) into.push(item);
    if (notItem !== undefined) into.push(notItem);
    if (count !== undefined) into.push(...(Array.isArray(count.of) ? count.of : [count.of]));
  }
  const words = [scene?.narration ?? "", ...(scene?.variants ?? []).map((v) => v.text)].join(" ");
  if (words.includes("{facets}")) into.push("facet_*");
}

function matches(pattern: string, id: string): boolean {
  return pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : pattern === id;
}

/** The items in `party`'s bag that any of `read` (ids and `*` patterns) names, sorted. */
function heldOf(party: ChoiceParty, read: readonly string[]): string[] {
  return [...partyItemIds(party)].filter((id) => read.some((pattern) => matches(pattern, id))).sort();
}

/**
 * What a priority-1 scene's words read of the bag as it opens, so the Story
 * page can later quote it as the table heard it, not against whatever the
 * party held by the chapter's end. Null when its words read nothing of the
 * bag (most scenes): there is nothing to keep. Called by the engine on the
 * scene's first arrival in a chapter (`RunState.revealHeld`).
 */
export function heardWith(scene: SceneWords, party: ChoiceParty): string[] | null {
  const read: string[] = [];
  itemsRead(scene, read);
  return read.length === 0 ? null : heldOf(party, read);
}

/**
 * What a completing chapter keeps for the Story page: its ending, the
 * priority-1 scenes on its trail, the route-set flags it decided (set now and
 * not carried in from `before`), and the items those words read that the
 * party held. Keys with nothing in them are left off, so the row stays small.
 */
export function chapterStoryOf(input: {
  campaign: Pick<Campaign, "routeSets" | "lastTime">;
  chapter: Pick<Chapter, "id" | "scenes">;
  ending: SceneId;
  visited: readonly SceneId[];
  flags: Readonly<Record<string, boolean>>;
  /** The route-set flags the attempt held before this chapter. */
  before: Readonly<Record<string, boolean>> | undefined;
  party: ChoiceParty;
  /** What each priority-1 scene's words read of the bag as it opened (`RunState.revealHeld`). */
  revealHeld?: Readonly<Record<SceneId, readonly string[]>>;
}): ChapterStory {
  const { campaign, chapter, ending } = input;
  const revealed: SceneId[] = [];
  for (const id of input.visited) {
    const scene = sceneOf(chapter, id);
    if (scene && scene.type !== "encounter" && scene.priority === 1 && !revealed.includes(id)) revealed.push(id);
  }
  const decided = Object.values(campaign.routeSets ?? {})
    .flat()
    .filter((flag) => input.flags[flag] === true && input.before?.[flag] !== true);

  // The bag as the chapter closes is the bag the ending was read with (its words are
  // composed after its own onEnter, and it settles in the same step), and the one
  // the next "Last time…" will read. A revelation was heard earlier, with its own.
  const read: string[] = [];
  itemsRead(sceneOf(chapter, ending), read);
  for (const flag of decided) {
    const line = campaign.lastTime?.lines[flag];
    if (line !== undefined && typeof line !== "string") read.push(line.holding);
  }
  const held = heldOf(input.party, read);
  const heard = Object.fromEntries(
    revealed.flatMap((id) => {
      const bag = input.revealHeld?.[id];
      return bag === undefined ? [] : [[id, [...bag]]];
    }),
  );

  return {
    chapterId: chapter.id,
    ending,
    ...(revealed.length > 0 ? { revealed } : {}),
    ...(Object.keys(heard).length > 0 ? { heard } : {}),
    ...(decided.length > 0 ? { decided } : {}),
    ...(held.length > 0 ? { held } : {}),
  };
}

/**
 * The party the page reads a scene against: nothing but what it held. One
 * member, so `{party}` reads "you", which is right at a table of any size.
 */
function heldParty(held: readonly string[]): ChoiceParty {
  // Only the bag is ever read (`readsOnlyTheBag`), so the rest of a hero is not needed.
  const member = { inventory: [], questItems: [...held] } as unknown as ResolvedCharacter;
  return { members: [member], flags: {}, coins: 0 };
}

/**
 * A scene's words as this party saw them, as near as the bag can say. `held`
 * null: the bag it was read with is not known (a revelation reached before the
 * bag was kept), so only the words every party heard are quoted, and a scene
 * that counts the stones (`{facets}`) is not quoted at all.
 */
function wordsOf(scene: SceneWords, held: readonly string[] | null): string {
  const party = heldParty(held ?? []);
  const base = scene.narration ?? scene.prompt ?? "";
  if (held === null) {
    if (base.includes("{facets}")) return "";
    return fillTokens(base, party).trim();
  }
  const variants = (scene.variants ?? []).filter((v) => readsOnlyTheBag(v.when));
  return fillTokens(composeNarration(base, variants, party), party).trim();
}

/** One chapter on the page, from what its attempt kept. `story` null: it kept nothing (played before #358). */
export function storyChapterView(
  campaign: Campaign,
  chapter: Chapter,
  story: ChapterStory | null,
): JournalStoryChapter {
  const view: JournalStoryChapter = {
    chapterId: chapter.id,
    title: chapter.title,
    ...(chapter.goal ? { goal: chapter.goal.text } : {}),
    revealed: [],
    lastTime: [],
  };
  if (!story) return view;
  const held = story.held ?? [];
  const ending = sceneOf(chapter, story.ending);
  if (ending) {
    view.outcome = ending.outcome === "setback" ? "setback" : "success";
    const line = firstSentence(wordsOf(ending, held));
    if (line !== "") view.ending = line;
  }
  for (const id of story.revealed ?? []) {
    const scene = sceneOf(chapter, id);
    // Read with the bag it was heard with. A scene whose words never read the bag needs none.
    const bag = story.heard?.[id] ?? (scene && heardWith(scene, heldParty([])) === null ? [] : null);
    const words = scene ? wordsOf(scene, bag) : "";
    if (words !== "") view.revealed.push(words);
  }
  // The preface's own picking: the decided flags, in story order, the newest few, read against the bag.
  const decided = Object.fromEntries((story.decided ?? []).map((flag) => [flag, true]));
  const lines = lastTimeLines(campaign, null, { flags: decided, held: new Set(held) });
  if (lines?.recap) view.lastTime = lines.lines;
  return view;
}

/** What the page reads of an attempt row. */
export interface StoryAttempt {
  story?: readonly ChapterStory[];
  lastIndex?: number;
  routeFlags?: Readonly<Record<string, boolean>>;
  journey?: { chaptersCompleted?: readonly string[] };
}

/**
 * Every chapter an attempt played, oldest first. A chapter it kept a story for
 * reads in full; one played before the page existed is still listed, by title
 * and goal, where the row can say which it was: a graph journey's completed
 * chapters, or an ordered campaign's beats up to `lastIndex` (a routed beat
 * only when exactly one of its roads is held, the rule `chapterFor` keeps).
 */
export function storyChapters(
  campaign: Campaign,
  attempt: StoryAttempt,
  chapterById: (id: string) => Chapter | null | undefined,
): JournalStoryChapter[] {
  const kept = attempt.story ?? [];
  const keptIds = new Set(kept.map((s) => s.chapterId));
  const earlier: Chapter[] = [];
  if (attempt.journey) {
    for (const id of attempt.journey.chaptersCompleted ?? []) {
      const chapter = keptIds.has(id) ? null : chapterById(id);
      if (chapter) earlier.push(chapter);
    }
  } else {
    const chapters = campaign.chapters.map(chapterById).filter((c): c is Chapter => !!c);
    const firstKept = Math.min(...kept.map((s) => chapterById(s.chapterId)?.index ?? Infinity));
    const last = Math.min(attempt.lastIndex ?? 0, firstKept - 1);
    for (let index = 1; index <= last; index++) {
      const at = chapters.filter((c) => c.index === index);
      const played = at.length === 1 ? at : at.filter((c) => c.route && attempt.routeFlags?.[c.route.flag] === true);
      if (played.length === 1) earlier.push(played[0]!);
    }
  }
  const out = earlier.map((chapter) => storyChapterView(campaign, chapter, null));
  for (const story of kept) {
    const chapter = chapterById(story.chapterId);
    if (chapter) out.push(storyChapterView(campaign, chapter, story));
  }
  return out;
}
