/**
 * The examples in docs/campaigns/gemfall-authoring.md §5 must pass the gate.
 *
 * A guide that teaches a pattern the validator rejects is worse than no guide.
 * So the fenced blocks tagged `guide-variants` (an array of narration
 * variants) and `guide-choices` (an array of choices, `"goto": "NEXT"` meaning
 * "the next scene") are pulled out of the doc, dropped into a copy of the
 * Bramblewood fixture's entry scene, and run through `content:validate`.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const VALIDATOR = join(REPO, "tools", "content", "validate.mjs");
const GUIDE = readFileSync(join(REPO, "docs", "campaigns", "gemfall-authoring.md"), "utf8");
const CHAPTER = ["content", "chapters", "bramblewood-01.json"];

const temps = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), "kad-guide-"));
  temps.push(dir);
  cpSync(join(REPO, "content"), join(dir, "content"), { recursive: true });
  cpSync(join(REPO, "schemas"), join(dir, "schemas"), { recursive: true });
  cpSync(join(REPO, "assets", "world"), join(dir, "assets", "world"), { recursive: true });
  cpSync(join(REPO, "assets", "manifest.json"), join(dir, "assets", "manifest.json"));
  return dir;
}

function validate(dir) {
  try {
    const out = execFileSync(process.execPath, [VALIDATOR], {
      env: { ...process.env, KAD_CONTENT_ROOT: dir, NO_COLOR: "1" },
      encoding: "utf8",
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

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
    it(`example ${index + 1} (${example.kind}) passes content:validate`, { timeout: 60_000 }, () => {
      const dir = copyTree();
      const chapter = JSON.parse(readFileSync(join(dir, ...CHAPTER), "utf8"));
      const scene = chapter.scenes[chapter.entry];
      const next = scene.choices[0].goto;
      if (example.kind === "guide-variants") {
        scene.variants = example.json;
      } else {
        for (const choice of example.json) {
          scene.choices.push({ ...choice, goto: choice.goto === "NEXT" ? next : choice.goto });
        }
      }
      writeFileSync(join(dir, ...CHAPTER), JSON.stringify(chapter, null, 2));
      const result = validate(dir);
      expect(result.out).toContain("PASS");
      expect(result.code).toBe(0);
    }, 20_000);
  });
});
