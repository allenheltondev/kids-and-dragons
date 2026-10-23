/**
 * Story plates: paintings with the story told over them, before the table is asked to decide
 * anything. A campaign's **prologue** (three to six plates, before its opening chapter's first
 * scene) and a **chapter plate** (one, for a chapter that begins somewhere new).
 *
 * Which plates a chapter's start gets is picked here, from the two files every screen already
 * has, so the TV, a phone's pane and the tests all agree. Whether this device has already shown
 * them is the client's business (it keeps that per device); nothing here reads a run.
 */

import type { Campaign, Chapter, StoryPlate } from "./types/chapter.js";

/** A prologue is a series, not a slide and not a film. */
export const PROLOGUE_MIN_PLATES = 3;
export const PROLOGUE_MAX_PLATES = 6;

/**
 * The most words one plate says. It is read aloud from a TV to a child of about eight, over a
 * painting that is the point, so it is a breath or two: two or three short sentences.
 */
export const PLATE_MAX_WORDS = 45;

/** What a chapter start shows: which kind, the key the client remembers it by, and its plates. */
export interface StartPlates {
  kind: "prologue" | "chapter";
  /** Stable and unique: `prologue:<campaign>` or `plate:<campaign>:<chapter>`. */
  key: string;
  /** The title the first plate wears: the campaign's for a prologue, the chapter's for a plate. */
  ribbon: string;
  plates: StoryPlate[];
}

/**
 * Whether this is the chapter a fresh attempt at the campaign opens with. A graph campaign opens
 * at its entry node (or the chapter a variant of it plays); an ordered one at index 1, every
 * member of a routed index included.
 */
export function isOpeningChapter(campaign: Campaign, chapter: Pick<Chapter, "id" | "index">): boolean {
  const graph = campaign.graph;
  if (graph) {
    const entry = graph.nodes[graph.entry];
    if (!entry) return false;
    return entry.chapter === chapter.id || (entry.variants ?? []).some((variant) => variant.chapter === chapter.id);
  }
  return chapter.index === 1;
}

/**
 * The plates for the start of `chapter`: the campaign's prologue on its opening chapter, else
 * the chapter's own plate, else null. A campaign's opening chapter never shows a chapter plate
 * as well (content:validate refuses one), so a start is never two things in a row.
 */
export function startPlates(campaign: Campaign, chapter: Chapter): StartPlates | null {
  if (campaign.prologue && campaign.prologue.plates.length > 0 && isOpeningChapter(campaign, chapter)) {
    return { kind: "prologue", key: `prologue:${campaign.id}`, ribbon: campaign.title, plates: campaign.prologue.plates };
  }
  if (chapter.plate) {
    return { kind: "chapter", key: `plate:${campaign.id}:${chapter.id}`, ribbon: chapter.title, plates: [chapter.plate] };
  }
  return null;
}

/** Every plate a campaign and its chapters declare, in the order they are met (prologue first). */
export function campaignPlates(campaign: Campaign, chapters: readonly Chapter[]): StoryPlate[] {
  return [
    ...(campaign.prologue?.plates ?? []),
    ...chapters.filter((chapter) => chapter.campaignId === campaign.id && chapter.plate).map((chapter) => chapter.plate!),
  ];
}

/** The URL a plate's painting is served from. */
export function storyPlateUrl(art: string): string {
  return `/assets/${art}.webp`;
}

/** Words in a plate's narration, for its limit and for how long it stays up. */
export function plateWordCount(narration: string): number {
  return narration.split(/\s+/).filter((word) => word !== "").length;
}

/** One thing wrong with a campaign's plates: where, what, and (optionally) the fix. */
export interface PlateProblem {
  path: string;
  problem: string;
  hint?: string;
}

const PARTY_COUNT = /\b(?:all|both|each of)\s+(?:the\s+)?(?:two|three|four|2|3|4)\b/i;

function plateTextProblems(at: string, plate: StoryPlate, stoneNames: readonly string[]): PlateProblem[] {
  const out: PlateProblem[] = [];
  const text = plate.narration;
  const words = plateWordCount(text);
  if (words > PLATE_MAX_WORDS) {
    out.push({ path: `${at}/narration`, problem: `${String(words)} words; a plate says at most ${String(PLATE_MAX_WORDS)}`, hint: "It is read aloud over a painting to a child. Two or three short sentences." });
  }
  if (/[{}]/.test(text)) {
    out.push({ path: `${at}/narration`, problem: "has a {token}", hint: "A plate is the same words for every party, shown before the engine has anything to fill in." });
  }
  if (text.includes("—")) {
    out.push({ path: `${at}/narration`, problem: "has an em dash", hint: "House voice: short sentences, no em dashes." });
  }
  if (PARTY_COUNT.test(text)) {
    out.push({ path: `${at}/narration`, problem: "counts the party", hint: "A table seats one to four. Say \"all of you\"." });
  }
  const lower = text.toLowerCase();
  const stone = /\bgreat stones?\b/.test(lower) ? "a great stone" : stoneNames.find((name) => lower.includes(name));
  if (stone !== undefined) {
    out.push({ path: `${at}/narration`, problem: `names ${stone}`, hint: "No chapter guarantees a facet and a plate cannot read the inventory." });
  }
  return out;
}

/**
 * Everything that is wrong with a campaign's prologue and its chapters' plates, for
 * `content:validate`. `stoneNames` are the lowercase names of the catalog's great stones.
 *
 * - every plate's words are short, static, free of em dashes, and neither count the party nor
 *   name a great stone;
 * - every painting is `plates/<this campaign>/<name>`, and no painting is used twice;
 * - a campaign with a prologue gives its opening chapter no plate of its own, so a start is
 *   never two takes in a row.
 */
export function plateProblems(
  campaign: Campaign,
  chapters: ReadonlyMap<string, Chapter>,
  stoneNames: readonly string[] = [],
): PlateProblem[] {
  const out: PlateProblem[] = [];
  const used = new Map<string, string>();
  const check = (at: string, plate: StoryPlate): void => {
    if (!plate.art.startsWith(`plates/${campaign.id}/`)) {
      out.push({ path: `${at}/art`, problem: `"${plate.art}" is not under plates/${campaign.id}/`, hint: "A campaign's plates live in assets/plates/<campaign id>/." });
    }
    const first = used.get(plate.art);
    if (first !== undefined) out.push({ path: `${at}/art`, problem: `"${plate.art}" is already used at ${first}`, hint: "One painting per plate." });
    else used.set(plate.art, at);
    out.push(...plateTextProblems(at, plate, stoneNames));
  };

  campaign.prologue?.plates.forEach((plate, i) => check(`/prologue/plates/${String(i)}`, plate));

  for (const id of campaign.chapters) {
    const chapter = chapters.get(id);
    if (!chapter?.plate) continue;
    const at = `/chapters/${id}/plate`;
    check(at, chapter.plate);
    if (campaign.prologue && isOpeningChapter(campaign, chapter)) {
      out.push({ path: at, problem: "the opening chapter has the campaign's prologue, so it takes no plate of its own", hint: "Remove the plate, or the prologue." });
    }
  }
  return out;
}
