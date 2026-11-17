/**
 * `npm run trivia:draft` (docs/trivia.md §3.1): drafts from a page's own
 * fields, wrong options from pages of its kind, `also` filled the way
 * content:validate reads it, and nothing written.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { draftQuestions, optionOf } from "./trivia-draft.mjs";
import { triviaBankProblems } from "./trivia-bank.mjs";

const GUIDE = JSON.parse(readFileSync(new URL("../../content/field-guide.json", import.meta.url), "utf8"));

describe("trivia:draft", () => {
  it("drafts a class page's gear, home and three moves", () => {
    const drafts = draftQuestions(GUIDE, "class.thornguard");
    expect(drafts.map((d) => d.id)).toEqual([
      "class.thornguard.gear",
      "class.thornguard.home",
      "class.thornguard.move_apprentice",
      "class.thornguard.move_expert",
      "class.thornguard.move_master",
    ]);
    expect(drafts[0]).toMatchObject({ ask: "What does a Thornguard carry?", answer: "A thorn bracer" });
    expect(drafts[2]).toMatchObject({ answer: "Shove" });
    expect(drafts[2].wrong).not.toContain("Shove");
  });

  it("names a creature by its hook on the shelf link, with other creatures as wrong options and in also", () => {
    const [hook] = draftQuestions(GUIDE, "creature.bone_crawler");
    expect(hook).toMatchObject({ id: "creature.bone_crawler.hook", answer: "Bone Crawler", link: "shelf" });
    expect(hook.wrong.length).toBeGreaterThanOrEqual(5);
    for (const w of hook.wrong) expect(Object.values(GUIDE.entries).some((e) => e.kind === "creature" && e.title === w)).toBe(true);
    expect(hook.also.length).toBe(hook.wrong.length);
  });

  it("is the same for a seed, and fills also so the spoiler rule holds", () => {
    expect(draftQuestions(GUIDE, "biome.plains", 3)).toEqual(draftQuestions(GUIDE, "biome.plains", 3));
    const drafts = draftQuestions(GUIDE, "creature.bone_crawler").map(({ _notes, ...d }) => d);
    const spoilers = triviaBankProblems({ files: [{ path: "x", data: { questions: drafts } }], ladder: null, guide: GUIDE, looks: null, exists: () => true }).filter((p) => p.problem.includes("not in also"));
    expect(spoilers).toEqual([]);
  });

  it("cuts a sentence to an option", () => {
    expect(optionOf("Shell-fitting, which is never finished. There is always one more.")).toBe("Shell-fitting");
    expect(optionOf("one two three four five six seven eight nine ten eleven")).toBe("One two three four five six seven eight nine");
  });

  it("refuses a page the guide does not have", () => {
    expect(() => draftQuestions(GUIDE, "creature.nobody")).toThrow("not a page");
  });
});
