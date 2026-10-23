import { describe, expect, it } from "vitest";

import { castGaps, castNames, loadChapters, MAX_CAST } from "./cast-gaps.mjs";

const chapter = {
  id: "fixture",
  scenes: {
    meet: { type: "story", narration: "A sprite called Pib waves.", cast: [{ figure: "entities/pib", name: "Pib" }] },
    walk: { type: "story", narration: "You walk on. Pib's map is wet, and pib is gone." },
    wave: { type: "story", narration: "Pib waves again.", cast: [{ figure: "entities/pib", name: "Pib" }] },
    full: {
      type: "story",
      narration: "Pib is here too.",
      cast: [
        { figure: "entities/a", name: "Alder" },
        { figure: "entities/b", name: "Birch" },
        { figure: "entities/c", name: "Cedar" },
      ],
    },
    fight: { type: "encounter", narration: "Pib watches the fight." },
    choice: { type: "story", narration: "Quiet.", choices: [{ id: "ask", label: "Ask the Noodle seller", goto: "meet" }] },
    shop: { type: "story", narration: "A stall.", cast: [{ figure: "cast/soup_woman", name: "Noodle seller" }] },
    crowd: {
      type: "story",
      narration: "Pib hides behind the crates.",
      cast: [{ figure: "entities/goat" }, { figure: "entities/goat", count: 2 }, { figure: "entities/yeti" }],
    },
    mixed: {
      type: "story",
      narration: "Pib waves from the roof.",
      cast: [{ figure: "entities/goat" }, { figure: "cast/soup_woman", name: "Noodle seller" }],
    },
    roll: {
      type: "check",
      prompt: "Pull the rope",
      onSuccess: { goto: "meet", narration: "The Noodle seller cheers." },
      onFailure: { goto: "meet", narration: "It slips.", variants: [{ when: {}, text: "Pib laughs." }] },
    },
  },
};

describe("the cast report", () => {
  it("knows every name the chapter casts", () => {
    expect(castNames(chapter)).toEqual(["Pib", "Alder", "Birch", "Cedar", "Noodle seller"]);
  });

  it("flags a scene that names a cast member and does not cast them", () => {
    const gaps = castGaps(chapter);
    expect(gaps.find((gap) => gap.scene === "walk")).toEqual({ scene: "walk", names: ["Pib"], cast: [], room: MAX_CAST });
    expect(gaps.find((gap) => gap.scene === "choice")?.names).toEqual(["Noodle seller"]);
  });

  it("says when the stage has no room", () => {
    expect(castGaps(chapter).find((gap) => gap.scene === "full")?.room).toBe(0);
  });

  it("leaves alone scenes that cast them, and fights", () => {
    const scenes = castGaps(chapter).map((gap) => gap.scene);
    expect(scenes).not.toContain("meet");
    expect(scenes).not.toContain("wave");
    expect(scenes).not.toContain("fight");
  });

  it("runs over every shipped chapter", () => {
    for (const shipped of loadChapters()) expect(Array.isArray(castGaps(shipped))).toBe(true);
  });

  it("counts the stage in cast entries, not in names", () => {
    const gaps = castGaps(chapter);
    // Three unnamed entries (one a counted group) fill the stage and leave no name to show.
    expect(gaps.find((gap) => gap.scene === "crowd")).toEqual({ scene: "crowd", names: ["Pib"], cast: [], room: 0 });
    // One unnamed and one named: two slots taken, one free, and the nameplate list holds only the named.
    expect(gaps.find((gap) => gap.scene === "mixed")).toEqual({ scene: "mixed", names: ["Pib"], cast: ["Noodle seller"], room: 1 });
  });

  it("never puts a null in the JSON", () => {
    expect(JSON.stringify(castGaps(chapter))).not.toContain("null");
  });

  it("reads a check's result narration, and the variants on it", () => {
    const roll = castGaps(chapter).find((gap) => gap.scene === "roll");
    expect(roll?.names).toEqual(["Pib", "Noodle seller"]);
    // Only the result text names them: the prompt alone does not.
    expect(castGaps({ ...chapter, scenes: { ...chapter.scenes, roll: { ...chapter.scenes.roll, onSuccess: { goto: "meet" }, onFailure: { goto: "meet" } } } }).some((gap) => gap.scene === "roll")).toBe(false);
  });

  it("does not take a scene's own nameplates for a mention", () => {
    expect(castGaps(chapter).some((gap) => gap.scene === "shop")).toBe(false);
  });
});
