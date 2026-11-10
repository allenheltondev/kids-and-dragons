/**
 * The examples in docs/campaigns/gemfall-authoring.md §5 must pass the gate.
 *
 * A guide that teaches a pattern the validator rejects is worse than no guide.
 * So the fenced blocks tagged `guide-variants` (an array of narration
 * variants) and `guide-choices` (an array of choices, `"goto": "NEXT"` meaning
 * "the next scene") are pulled out of the doc, dropped into a copy of the
 * Bramblewood fixture's entry scene, and run through `content:validate`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyTree, readJson, REPO, validate, writeJson } from "./validate-harness.ts";

const GUIDE = readFileSync(join(REPO, "docs", "campaigns", "gemfall-authoring.md"), "utf8").replace(/\r\n/g, "\n");
const CHAPTER = ["content", "chapters", "bramblewood-01.json"];

/** The gate as `npm run content:validate` runs it, class places and all, over a copy of the tree in memory. */
const gate = (tree) => validate(tree, [], { classPlaces: true });

/** Every ```json guide-<kind> block, in document order. */
function examples() {
  const found = [];
  for (const match of GUIDE.matchAll(/```json (guide-variants|guide-choices)\n([\s\S]*?)```/g)) {
    found.push({ kind: match[1], json: JSON.parse(match[2]) });
  }
  return found;
}

describe("the authoring guide's examples", () => {
  const all = examples();

  it("has at least one of each kind", () => {
    expect(all.some((e) => e.kind === "guide-variants")).toBe(true);
    expect(all.some((e) => e.kind === "guide-choices")).toBe(true);
  });

  all.forEach((example, index) => {
    it(`example ${index + 1} (${example.kind}) passes content:validate`, () => {
      const tree = copyTree();
      const chapter = readJson(tree, ...CHAPTER);
      const scene = chapter.scenes[chapter.entry];
      const next = scene.choices[0].goto;
      if (example.kind === "guide-variants") {
        scene.variants = example.json;
      } else {
        for (const choice of example.json) {
          scene.choices.push({ ...choice, goto: choice.goto === "NEXT" ? next : choice.goto });
        }
      }
      writeJson(tree, CHAPTER, chapter);
      const result = gate(tree);
      expect(result.out).toContain("PASS");
      expect(result.code).toBe(0);
    }, 20_000);
  });
});
