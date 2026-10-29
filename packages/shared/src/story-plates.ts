/**
 * Story plates: paintings with the story told over them. A campaign's **prologue** (three to six
 * plates, before its opening chapter's first scene), a **chapter plate** (one, for a chapter that
 * begins somewhere new), and its **epilogues** (two to four plates for each way it can end, after
 * the ending scene's words and before the summary).
 *
 * Which plates a chapter's start or a campaign's end gets is picked here, from the files every
 * screen already has, so the TV, a phone's pane and the tests all agree. Whether this device has
 * already shown them is the client's business (it keeps that per device).
 */

import type { Campaign, Chapter, Epilogue, StoryPlate } from "./types/chapter.js";

/** A prologue is a series, not a slide and not a film. */
export const PROLOGUE_MIN_PLATES = 3;
export const PROLOGUE_MAX_PLATES = 6;

/** An epilogue is shorter: what came after, not a second story. */
export const EPILOGUE_MIN_PLATES = 2;
export const EPILOGUE_MAX_PLATES = 4;

/**
 * The most words one plate says. It is read aloud from a TV to a child of about eight, over a
 * painting that is the point, so it is a breath or two: two or three short sentences.
 */
export const PLATE_MAX_WORDS = 45;

/** What a chapter start (or a campaign's end) shows: which kind, the key the client remembers it by, and its plates. */
export interface StartPlates {
  kind: "prologue" | "chapter" | "epilogue";
  /** Stable and unique: `prologue:<campaign>`, `plate:<campaign>:<chapter>` or `epilogue:<campaign>:<epilogue>`. */
  key: string;
  /**
   * The title the first plate wears: the campaign's for a prologue, the chapter's for a plate,
   * the name history gives the party for an epilogue.
   */
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

/** The epilogue that follows the ending scene `sceneId` of `chapterId`, if the campaign has one. */
export function epilogueFor(campaign: Campaign, chapterId: string | null, sceneId: string | null): Epilogue | null {
  if (chapterId === null || sceneId === null) return null;
  return campaign.epilogues?.find((epilogue) => epilogue.chapter === chapterId && epilogue.endings.includes(sceneId)) ?? null;
}

/**
 * The plates for the end of a campaign: the epilogue of the ending scene the party reached, or
 * null. Only for the completion that ended the campaign (`ended`); a chapter's ordinary ending,
 * or the same scene reached in a playtest jump, gets none.
 */
export function endPlates(
  campaign: Campaign,
  chapterId: string | null,
  sceneId: string | null,
  ended: "complete" | "failed" | undefined,
): StartPlates | null {
  if (ended === undefined) return null;
  const epilogue = epilogueFor(campaign, chapterId, sceneId);
  if (epilogue === null || epilogue.plates.length === 0) return null;
  return { kind: "epilogue", key: `epilogue:${campaign.id}:${epilogue.id}`, ribbon: epilogue.title, plates: epilogue.plates };
}

/** Every plate a campaign and its chapters declare, in the order they are met (prologue first, epilogues last). */
export function campaignPlates(campaign: Campaign, chapters: readonly Chapter[]): StoryPlate[] {
  return [
    ...(campaign.prologue?.plates ?? []),
    ...chapters.filter((chapter) => chapter.campaignId === campaign.id && chapter.plate).map((chapter) => chapter.plate!),
    ...(campaign.epilogues ?? []).flatMap((epilogue) => epilogue.plates),
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
 * Capitalised words an epilogue's words use as names: every capitalised word that does not open a
 * sentence, and one that does when `ordinary` (the campaign's lowercase words) never has it in
 * lowercase. "Nobody" opens sentences; "Pellam" is a name wherever it stands.
 */
function namesIn(text: string, ordinary: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/[A-Z][a-zA-Z'-]*/g)) {
    const word = match[0].replace(/'s$/, "");
    const before = text.slice(0, match.index).trimEnd();
    const opens = before === "" || /[.!?]["”]?$/.test(before) || /["“]$/.test(before);
    if (word === "I" || (opens && ordinary.has(word.toLowerCase()))) continue;
    out.push(word);
  }
  return out;
}

const READ = new Set(["narration", "text", "prompt", "label"]);

/** The words players read in some content: its narration, variant text, prompts and labels (never an id). */
function readWords(value: unknown, key = ""): string[] {
  if (typeof value === "string") return READ.has(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((each) => readWords(each, key));
  if (value !== null && typeof value === "object") return Object.entries(value).flatMap(([k, each]) => readWords(each, k));
  return [];
}

/** Every lowercase word in some texts. */
function lowercaseWords(texts: readonly string[]): Set<string> {
  return new Set(texts.flatMap((text) => text.split(/[^a-zA-Z'-]+/)).filter((word) => /^[a-z]/.test(word)).map((word) => word.replace(/'s$/, "")));
}

/**
 * What a party that reached `sceneId` has certainly heard, as alternatives: the
 * ending's own words (without variants), or else the words of every scene that leads into it. A
 * name is heard if the first says it, or all of the rest do.
 */
function endingHeard(chapter: Chapter, sceneId: string): string[] {
  const words = (id: string): string => {
    const scene = chapter.scenes[id];
    return scene && "narration" in scene && typeof scene.narration === "string" ? scene.narration : "";
  };
  const into = Object.entries(chapter.scenes)
    .filter(([id, scene]) => id !== sceneId && JSON.stringify(scene).includes(`"goto":"${sceneId}"`))
    .map(([id]) => words(id));
  return [words(sceneId), into.length > 0 ? into.reduce((shared, text) => commonWords(shared, text)) : ""];
}

/** The words two texts share, as a text, so "says it on every way in" is one `includes`. */
function commonWords(a: string, b: string): string {
  const inB = new Set(b.split(/[^a-zA-Z'-]+/));
  return a.split(/[^a-zA-Z'-]+/).filter((word) => word !== "" && inB.has(word)).join(" ");
}

function epilogueProblems(campaign: Campaign, chapters: ReadonlyMap<string, Chapter>): PlateProblem[] {
  const out: PlateProblem[] = [];
  const ids = new Set<string>();
  const claimed = new Map<string, string>();
  if ((campaign.epilogues ?? []).length === 0) return out;
  // The campaign's own vocabulary: a capitalised word that opens a sentence is an ordinary word
  // if the campaign's chapters ever write it in lowercase.
  const ordinary = lowercaseWords(campaign.chapters.flatMap((id) => readWords(chapters.get(id)?.scenes)));
  (campaign.epilogues ?? []).forEach((epilogue, i) => {
    const at = `/epilogues/${String(i)}`;
    if (ids.has(epilogue.id)) out.push({ path: `${at}/id`, problem: `"${epilogue.id}" is used by another epilogue`, hint: "The device remembers an epilogue by its id." });
    ids.add(epilogue.id);
    if (epilogue.plates.length < EPILOGUE_MIN_PLATES || epilogue.plates.length > EPILOGUE_MAX_PLATES) {
      out.push({ path: `${at}/plates`, problem: `${String(epilogue.plates.length)} plates; an epilogue has ${String(EPILOGUE_MIN_PLATES)} to ${String(EPILOGUE_MAX_PLATES)}` });
    }
    const chapter = campaign.chapters.includes(epilogue.chapter) ? chapters.get(epilogue.chapter) : undefined;
    if (!chapter) {
      out.push({ path: `${at}/chapter`, problem: `"${epilogue.chapter}" is not a chapter of ${campaign.id}` });
      return;
    }
    // What every party that reached one of these endings has heard: the epilogue's title, the
    // prologue, and for each ending its own words or the words of every scene that leads into it.
    // A name from anywhere else may be news to somebody.
    const always = [epilogue.title, ...(campaign.prologue?.plates ?? []).map((plate) => plate.narration)].join(" ");
    const perEnding: string[][] = [];
    epilogue.endings.forEach((sceneId, j) => {
      const scene = chapter.scenes[sceneId];
      const choices = scene && "choices" in scene ? scene.choices : undefined;
      if (!scene || !Array.isArray(choices) || choices.length > 0) {
        out.push({ path: `${at}/endings/${String(j)}`, problem: `"${sceneId}" is not an ending scene of ${chapter.id}`, hint: "An ending is a scene with \"choices\": []." });
        return;
      }
      if (!("endsCampaign" in scene && scene.endsCampaign) && !isLastBeat(campaign, chapter, chapters)) {
        out.push({ path: `${at}/endings/${String(j)}`, problem: `"${sceneId}" does not end the campaign`, hint: "An epilogue follows the campaign's last chapter." });
      }
      const first = claimed.get(sceneId);
      if (first !== undefined) out.push({ path: `${at}/endings/${String(j)}`, problem: `"${sceneId}" already leads into ${first}`, hint: "One ending, one epilogue." });
      else claimed.set(sceneId, epilogue.id);
      perEnding.push(endingHeard(chapter, sceneId));
    });
    // Names are matched as written: "Long" is not heard because somebody waited a long time.
    const said = (text: string, name: string): boolean => new RegExp(`\\b${name}\\b`).test(text);
    const heard = (name: string): boolean => said(always, name) || perEnding.every((texts) => texts.some((text) => said(text, name)));
    epilogue.plates.forEach((plate, j) => {
      for (const name of new Set(namesIn(plate.narration, ordinary))) {
        if (!heard(name)) {
          out.push({ path: `${at}/plates/${String(j)}/narration`, problem: `names "${name}", which its endings never say`, hint: "An epilogue names only who and what its endings (or the scenes into them, or the prologue) have shown every party." });
        }
      }
    });
  });
  return out;
}

/** An ordered campaign's last beat: its highest index. A graph campaign says so with `endsCampaign` on the scene. */
function isLastBeat(campaign: Campaign, chapter: Chapter, chapters: ReadonlyMap<string, Chapter>): boolean {
  if (campaign.graph) return false;
  const last = Math.max(...campaign.chapters.map((id) => chapters.get(id)?.index ?? 0));
  return chapter.index === last;
}

/**
 * Everything that is wrong with a campaign's prologue, its chapters' plates and its epilogues,
 * for `content:validate`. `stoneNames` are the lowercase names of the catalog's great stones.
 *
 * - every plate's words are short, static, free of em dashes, and neither count the party nor
 *   name a great stone;
 * - every painting is `plates/<this campaign>/<name>`, and no painting is used twice;
 * - a campaign with a prologue gives its opening chapter no plate of its own, so a start is
 *   never two takes in a row;
 * - an epilogue follows ending scenes of the campaign's last chapter, each ending leads into at
 *   most one, and its words name nobody its endings have not shown.
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

  (campaign.epilogues ?? []).forEach((epilogue, i) => {
    epilogue.plates.forEach((plate, j) => check(`/epilogues/${String(i)}/plates/${String(j)}`, plate));
  });
  out.push(...epilogueProblems(campaign, chapters));
  return out;
}
