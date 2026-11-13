import { describe, expect, it } from "vitest";
import type { Chapter } from "@kad/shared";
import { nextNarration, upcomingNarration } from "./voice-prefetch";

/** a → b → c → d, with a second road a → e that skips b. */
const chapter = {
  id: "ch",
  entry: "a",
  scenes: {
    a: { type: "story", narration: "a", choices: [{ id: "x", label: "x", goto: "b" }, { id: "y", label: "y", goto: "e" }] },
    b: { type: "story", narration: "b", choices: [{ id: "x", label: "x", goto: "c" }] },
    c: { type: "story", narration: "c", choices: [{ id: "x", label: "x", goto: "d" }] },
    d: { type: "story", narration: "d", choices: [] },
    e: { type: "story", narration: "e", choices: [{ id: "x", label: "x", goto: "c" }] },
  },
} as unknown as Chapter;

describe("the narration ahead", () => {
  it("starts a chapter with its plate and goal and the scenes two steps from the entry", () => {
    expect(upcomingNarration(chapter, null)).toEqual(["ch/@plate", "ch/@goal", "ch/a/", "ch/b/", "ch/e/", "ch/c/"]);
  });

  it("takes the scene the party is in and two steps beyond it, nearest first, without the chapter's goal", () => {
    expect(upcomingNarration(chapter, "b")).toEqual(["ch/b/", "ch/c/", "ch/d/"]);
  });

  it("says a scene once however many roads lead to it", () => {
    const prefixes = upcomingNarration(chapter, "a");
    expect(prefixes.filter((prefix) => prefix === "ch/c/")).toHaveLength(1);
  });

  it("keeps to the depth asked for", () => {
    expect(upcomingNarration(chapter, "a", 0)).toEqual(["ch/@plate", "ch/@goal", "ch/a/"]);
  });

  it("starts at the entry for a scene the chapter does not have", () => {
    expect(upcomingNarration(chapter, "gone")[0]).toBe("ch/@plate");
  });
});

describe("the lines decoded ahead", () => {
  it("names the scene the party is in and the scenes one step from it, never two", () => {
    expect(nextNarration(chapter, "a")).toEqual({ here: "ch/a/", next: ["ch/b/", "ch/e/"] });
  });

  it("before the first scene, the entry is the step ahead", () => {
    expect(nextNarration(chapter, null)).toEqual({ next: ["ch/a/"] });
    expect(nextNarration(chapter, "gone")).toEqual({ next: ["ch/a/"] });
  });
});
