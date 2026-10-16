/**
 * Numbing stings (#227) against the content gate.
 *
 * Like encounter-environment.test.mjs: the schema has to accept an enemy that
 * carries a sting and refuse the shapes that are not one, the shipped chapters
 * — none of which sting — must still pass untouched, and `content:validate`
 * has to catch a bad sting in real content, shown by bending a copy of the
 * tree and requiring a specific complaint.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const VALIDATOR = join(REPO, "tools", "content", "validate.mjs");
const read = (...parts) => JSON.parse(readFileSync(join(REPO, ...parts), "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
for (const file of readdirSync(join(REPO, "schemas")).filter((f) => f.endsWith(".schema.json"))) {
  ajv.addSchema(read("schemas", file));
}
const chapterSchema = ajv.getSchema(read("schemas", "chapter.schema.json").$id);

const CHAPTER = ["content", "chapters", "bramblewood-01.json"];
const SCENE = "encounter_bramblewisps";
const STING = { slow: { steps: 2, turns: 2 } };

/** The shipped Bramblewood chapter with its first enemy bent. */
function chapterWith(bend) {
  const chapter = read(...CHAPTER);
  bend(chapter.scenes[SCENE].enemies[0]);
  return chapter;
}

describe("the schema", () => {
  it("accepts an enemy that stings on a hit, strikes back, or both", () => {
    for (const bend of [
      (e) => (e.onHit = STING),
      (e) => (e.retaliation = STING),
      (e) => ((e.onHit = STING), (e.retaliation = { slow: { steps: 1, turns: 3 } })),
      (e) => (e.retaliation = { ...STING, puffTurns: 3 }),
    ]) {
      expect(chapterSchema(chapterWith(bend)), JSON.stringify(chapterSchema.errors)).toBe(true);
    }
  });

  it("still accepts every shipped chapter, and none of them stings", () => {
    const dir = join(REPO, "content", "chapters");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const chapter = read("content", "chapters", file);
      expect(chapterSchema(chapter), `${file}\n${JSON.stringify(chapterSchema.errors)}`).toBe(true);
      for (const scene of Object.values(chapter.scenes)) {
        for (const enemy of scene.enemies ?? []) {
          expect(enemy).not.toHaveProperty("onHit");
          expect(enemy).not.toHaveProperty("retaliation");
        }
      }
    }
  });

  it.each([
    ["no slow", (e) => (e.onHit = {})],
    ["a sting that does something else", (e) => (e.onHit = { root: true })],
    ["a slow of 3 steps", (e) => (e.onHit = { slow: { steps: 3, turns: 2 } })],
    ["a slow of 0 turns", (e) => (e.retaliation = { slow: { steps: 2, turns: 0 } })],
    ["a slow that lasts 6 turns", (e) => (e.onHit = { slow: { steps: 2, turns: 6 } })],
    ["a slow with a stray field", (e) => (e.onHit = { slow: { steps: 2, turns: 2, damage: 1 } })],
    ["a sting that is a bare number", (e) => (e.retaliation = 2)],
    ["a puff that lasts no turns", (e) => (e.retaliation = { ...STING, puffTurns: 0 })],
    ["a puff that lasts 6 turns", (e) => (e.retaliation = { ...STING, puffTurns: 6 })],
    ["puffTurns on an onHit sting", (e) => (e.onHit = { ...STING, puffTurns: 2 })],
  ])("refuses %s", (_name, bend) => {
    expect(chapterSchema(chapterWith(bend))).toBe(false);
  });
});

const temps = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function validateWith(bend) {
  const dir = mkdtempSync(join(tmpdir(), "kad-sting-"));
  temps.push(dir);
  cpSync(join(REPO, "content"), join(dir, "content"), { recursive: true });
  cpSync(join(REPO, "schemas"), join(dir, "schemas"), { recursive: true });
  cpSync(join(REPO, "assets", "world"), join(dir, "assets", "world"), { recursive: true });
  cpSync(join(REPO, "assets", "manifest.json"), join(dir, "assets", "manifest.json"));
  const path = join(dir, ...CHAPTER);
  const chapter = JSON.parse(readFileSync(path, "utf8"));
  bend(chapter.scenes[SCENE].enemies[0]);
  writeFileSync(path, JSON.stringify(chapter, null, 2));
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

describe("content:validate", { timeout: 60_000 }, () => {
  it("accepts a well-formed sting on a real fight", () => {
    const result = validateWith((e) => ((e.onHit = STING), (e.retaliation = { ...STING, puffTurns: 3 })));
    expect(result.out).not.toContain("onHit");
    expect(result.code).toBe(0);
  });

  it.each([
    ["a slow past the move limit", (e) => (e.onHit = { slow: { steps: 3, turns: 2 } }), "/onHit/slow/steps"],
    ["a retaliation that lasts no turns", (e) => (e.retaliation = { slow: { steps: 2, turns: 0 } }), "/retaliation/slow/turns"],
  ])("refuses %s", (_name, bend, complaint) => {
    const result = validateWith(bend);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(complaint);
  });
});
