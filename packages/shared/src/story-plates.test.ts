import { describe, expect, it } from "vitest";
import type { Campaign, Chapter } from "./types/chapter.js";
import {
  PLATE_MAX_WORDS,
  campaignPlates,
  isOpeningChapter,
  plateProblems,
  plateWordCount,
  startPlates,
  storyPlateUrl,
} from "./story-plates.js";

const plate = (n: number) => ({ art: `plates/c/prologue-${String(n)}`, narration: `Plate ${String(n)}.` });

const ordered = {
  id: "c",
  title: "The Walk",
  blurb: "A walk.",
  chapters: ["c-1", "c-2a", "c-2b"],
  prologue: { plates: [plate(1), plate(2), plate(3)] },
} as Campaign;

const graph = {
  id: "g",
  title: "The Graph",
  blurb: "A graph.",
  chapters: ["g-start", "g-start-late", "g-other"],
  graph: {
    version: 1,
    entry: "start",
    nodes: {
      start: { chapter: "g-start", variants: [{ chapter: "g-start-late", when: { flag: "late" } }] },
      other: { chapter: "g-other" },
    },
    edges: {},
  },
  prologue: { plates: [plate(1), plate(2), plate(3)] },
} as unknown as Campaign;

const chapter = (id: string, campaignId: string, index: number, extra: Partial<Chapter> = {}): Chapter =>
  ({ id, campaignId, index, title: `Title of ${id}`, biome: "plains", entry: "s", scenes: {}, ...extra }) as unknown as Chapter;

describe("isOpeningChapter", () => {
  it("is index 1 in an ordered campaign, every routed member included", () => {
    expect(isOpeningChapter(ordered, chapter("c-1", "c", 1))).toBe(true);
    expect(isOpeningChapter(ordered, chapter("c-2a", "c", 2))).toBe(false);
  });

  it("is the entry node's chapter, or a variant of it, in a graph campaign", () => {
    expect(isOpeningChapter(graph, chapter("g-start", "g", 1))).toBe(true);
    expect(isOpeningChapter(graph, chapter("g-start-late", "g", 1))).toBe(true);
    // Index means nothing in a graph campaign.
    expect(isOpeningChapter(graph, chapter("g-other", "g", 1))).toBe(false);
  });
});

describe("startPlates", () => {
  it("gives the opening chapter the prologue, wearing the campaign's title", () => {
    const picked = startPlates(ordered, chapter("c-1", "c", 1));
    expect(picked).toMatchObject({ kind: "prologue", key: "prologue:c", ribbon: "The Walk" });
    expect(picked?.plates).toHaveLength(3);
  });

  it("gives another chapter its own plate, wearing the chapter's title", () => {
    const own = { art: "plates/c/c-2a", narration: "A lake." };
    const picked = startPlates(ordered, chapter("c-2a", "c", 2, { plate: own }));
    expect(picked).toEqual({ kind: "chapter", key: "plate:c:c-2a", ribbon: "Title of c-2a", plates: [own] });
  });

  it("gives a chapter with neither nothing", () => {
    expect(startPlates(ordered, chapter("c-2b", "c", 2))).toBeNull();
    expect(startPlates({ ...ordered, prologue: undefined }, chapter("c-1", "c", 1))).toBeNull();
  });

  it("never gives a campaign without a prologue a prologue", () => {
    const own = { art: "plates/c/c-1", narration: "Hello." };
    expect(startPlates({ ...ordered, prologue: undefined }, chapter("c-1", "c", 1, { plate: own }))?.kind).toBe("chapter");
  });
});

describe("the small helpers", () => {
  it("collects a campaign's plates, prologue first", () => {
    const own = { art: "plates/c/c-2a", narration: "A lake." };
    const all = campaignPlates(ordered, [chapter("c-1", "c", 1), chapter("c-2a", "c", 2, { plate: own }), chapter("x-1", "x", 1, { plate: own })]);
    expect(all.map((p) => p.art)).toEqual(["plates/c/prologue-1", "plates/c/prologue-2", "plates/c/prologue-3", "plates/c/c-2a"]);
  });

  it("serves a plate from /assets as webp and counts its words", () => {
    expect(storyPlateUrl("plates/c/prologue-1")).toBe("/assets/plates/c/prologue-1.webp");
    expect(plateWordCount("  Snow  falls on\nthe quay. ")).toBe(5);
    expect(PLATE_MAX_WORDS).toBeGreaterThan(20);
  });
});

describe("plateProblems", () => {
  const chapters = (...list: Chapter[]) => new Map(list.map((c) => [c.id, c]));
  const clean = { ...ordered, prologue: { plates: [0, 1, 2].map((n) => ({ art: `plates/c/prologue-${String(n + 1)}`, narration: "Snow falls on the quay. A bell rings." })) } } as Campaign;

  it("passes a prologue and a plate that follow the rules", () => {
    const own = { art: "plates/c/c-2a", narration: "A lake lies still." };
    expect(plateProblems(clean, chapters(chapter("c-1", "c", 1), chapter("c-2a", "c", 2, { plate: own })))).toEqual([]);
  });

  it("refuses long, templated, dashed, party-counting and stone-naming words", () => {
    const bad = (narration: string) =>
      plateProblems({ ...clean, prologue: { plates: [{ art: "plates/c/prologue-1", narration }, ...clean.prologue!.plates.slice(1)] } }, chapters()).map((p) => p.problem);
    expect(bad(Array(PLATE_MAX_WORDS + 1).fill("word").join(" "))[0]).toMatch(/words/);
    expect(bad("Hello {party}.")[0]).toMatch(/token/);
    expect(bad("A bell — far off.")[0]).toMatch(/em dash/);
    expect(bad("All three of you hear it.")[0]).toMatch(/counts the party/);
    expect(bad("The great stones hum.")[0]).toMatch(/great stone/);
    expect(plateProblems(clean, chapters(chapter("c-2a", "c", 2, { plate: { art: "plates/c/c-2a", narration: "The Ember Stone glows." } })), ["ember stone"]).map((p) => p.problem)[0]).toMatch(/names ember stone/);
  });

  it("keeps a campaign's plates in its own folder, each used once", () => {
    const elsewhere = chapter("c-2a", "c", 2, { plate: { art: "plates/other/lake", narration: "A lake." } });
    expect(plateProblems(clean, chapters(elsewhere)).map((p) => p.problem)[0]).toMatch(/not under plates\/c\//);
    const twice = chapter("c-2a", "c", 2, { plate: { art: "plates/c/prologue-1", narration: "A lake." } });
    expect(plateProblems(clean, chapters(twice)).map((p) => p.problem)[0]).toMatch(/already used/);
  });

  it("gives the opening chapter the prologue or a plate, never both", () => {
    const both = chapter("c-1", "c", 1, { plate: { art: "plates/c/c-1", narration: "A door." } });
    expect(plateProblems(clean, chapters(both)).map((p) => p.problem)[0]).toMatch(/takes no plate/);
    expect(plateProblems({ ...clean, prologue: undefined }, chapters(both))).toEqual([]);
  });
});
