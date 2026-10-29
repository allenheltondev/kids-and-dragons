import { describe, expect, it } from "vitest";
import type { Campaign, Chapter } from "./types/chapter.js";
import {
  PLATE_MAX_WORDS,
  campaignPlates,
  endPlates,
  epilogueFor,
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

describe("epilogues", () => {
  const ending = (narration: string) => ({ type: "story", narration, choices: [] });
  const last = chapter("c-3", "c", 3, {
    scenes: {
      s: { type: "story", narration: "Two doors.", choices: [{ id: "a", label: "A", goto: "door_a" }, { id: "b", label: "B", goto: "lead_b" }] },
      door_a: ending("You open the door. History calls you the Door Folk."),
      lead_b: { type: "story", narration: "Mabel the heron waves goodbye.", choices: [{ id: "go", label: "Go on", goto: "door_b" }] },
      door_b: ending("You leave by the other door."),
    },
  } as unknown as Partial<Chapter>);
  const epi = (id: string, endings: string[], narration: string[]) => ({
    id,
    title: `Title ${id}`,
    chapter: "c-3",
    endings,
    plates: narration.map((n, i) => ({ art: `plates/c/epilogue-${id}-${String(i + 1)}`, narration: n })),
  });
  const withEpilogues = (...epilogues: ReturnType<typeof epi>[]) => ({ ...ordered, chapters: ["c-1", "c-3"], prologue: undefined, epilogues }) as Campaign;
  const chapters = new Map([["c-1", chapter("c-1", "c", 1)], ["c-3", last]]);

  it("picks the epilogue of the ending the party reached, only when the campaign ended", () => {
    const campaign = withEpilogues(epi("a", ["door_a"], ["You leave.", "You open the door."]), epi("b", ["door_b"], ["You leave by the door.", "You open it."]));
    expect(epilogueFor(campaign, "c-3", "door_b")?.id).toBe("b");
    expect(epilogueFor(campaign, "c-1", "door_b")).toBeNull();
    expect(endPlates(campaign, "c-3", "door_a", "complete")).toEqual({
      kind: "epilogue",
      key: "epilogue:c:a",
      ribbon: "Title a",
      plates: campaign.epilogues![0]!.plates,
    });
    expect(endPlates(campaign, "c-3", "door_a", undefined)).toBeNull();
    expect(endPlates(campaign, "c-3", "s", "complete")).toBeNull();
  });

  it("counts epilogue paintings among the campaign's plates, last", () => {
    const campaign = withEpilogues(epi("a", ["door_a"], ["You leave.", "You open the door."]));
    expect(campaignPlates(campaign, []).map((p) => p.art)).toEqual(["plates/c/epilogue-a-1", "plates/c/epilogue-a-2"]);
  });

  it("passes epilogues that follow the rules", () => {
    const campaign = withEpilogues(
      epi("a", ["door_a"], ["The Door Folk go home.", "You leave."]),
      epi("b", ["door_b"], ["You see Mabel waves again.", "The door stays open."]),
    );
    expect(plateProblems(campaign, chapters)).toEqual([]);
  });

  it("refuses an epilogue on a scene that is not a last ending, or on an ending already taken", () => {
    const problems = (e: ReturnType<typeof epi>[]) => plateProblems(withEpilogues(...e), chapters).map((p) => p.problem);
    expect(problems([epi("a", ["s"], ["You leave.", "You open the door."])])).toEqual([`"s" is not an ending scene of c-3`]);
    expect(problems([epi("a", ["door_a"], ["You leave.", "You open the door."]), epi("b", ["door_a"], ["You leave by the door.", "You open it."])])).toEqual([`"door_a" already leads into a`]);
    expect(problems([{ ...epi("a", ["door_a"], ["You leave.", "You open the door."]), chapter: "c-1" }])).toEqual([`"door_a" is not an ending scene of c-1`]);
    expect(problems([epi("a", ["door_a"], ["You leave."])])).toEqual(["1 plates; an epilogue has 2 to 4"]);
    const early = new Map([["c-1", chapter("c-1", "c", 1, { scenes: { e: ending("The end.") } } as unknown as Partial<Chapter>)], ["c-3", last]]);
    const onFirst = withEpilogues({ ...epi("a", ["e"], ["You leave.", "You open the door."]), chapter: "c-1" });
    expect(plateProblems(onFirst, early).map((p) => p.problem)).toEqual([`"e" does not end the campaign`]);
  });

  it("refuses a name its endings never said, wherever it stands in the sentence", () => {
    const named = (narration: string) => plateProblems(withEpilogues(epi("a", ["door_a"], [narration, "You leave."])), chapters).map((p) => p.problem);
    expect(named("Pellam waves.")).toEqual([`names "Pellam", which its endings never say`]);
    expect(named("You see Pellam waves.")).toEqual([`names "Pellam", which its endings never say`]);
    // Mabel is only met on the way to the other door.
    expect(named("Mabel waves.")).toEqual([`names "Mabel", which its endings never say`]);
    // An ordinary word that opens a sentence is no name, and the ending's own names are heard.
    expect(named("History smiles at the Door Folk.")).toEqual([]);
  });
});
