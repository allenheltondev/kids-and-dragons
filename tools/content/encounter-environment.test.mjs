/**
 * Environmental combat (#201) against the content gate.
 *
 * Two halves, like validate.test.mjs. The schema — the half an editor sees —
 * has to accept the sandbox chapter the authoring doc teaches from and refuse
 * the shapes it says do not exist; the shipped chapters, none of which
 * declare an environment, must still pass untouched. And `content:validate`
 * itself has to *catch* a broken environment in real content, which is shown
 * the only way that means anything: a copy of the real tree with exactly one
 * thing bent, and a specific complaint required (validate.test.mjs explains
 * why that is the shape of these tests).
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
const FIXTURES = ["packages", "shared", "src", "fixtures"];

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats(ajv);
// The chapter schema refers into its siblings (an item prop is an items.json
// item), so every schema goes in first, as content:validate does it.
for (const file of readdirSync(join(REPO, "schemas")).filter((f) => f.endsWith(".schema.json"))) {
  ajv.addSchema(read("schemas", file));
}
const schemaOf = (file) => ajv.getSchema(read("schemas", file).$id);
const chapterSchema = schemaOf("chapter.schema.json");
const mapSchema = schemaOf("map.schema.json");

function judge(validate, doc) {
  const ok = validate(doc);
  return { ok, errors: (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`) };
}

const sandbox = () => read(...FIXTURES, "rift-skirmish.chapter.json");

describe("the schema", () => {
  it("accepts the sandbox chapter and its map", () => {
    const chapter = judge(chapterSchema, sandbox());
    expect(chapter.ok, chapter.errors.join("\n")).toBe(true);
    const map = judge(mapSchema, read(...FIXTURES, "rift-skirmish.map.json"));
    expect(map.ok, map.errors.join("\n")).toBe(true);
  });

  it("still accepts every shipped chapter — and none of them declares an environment", () => {
    const dir = join(REPO, "content", "chapters");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const chapter = read("content", "chapters", file);
      const { ok, errors } = judge(chapterSchema, chapter);
      expect(ok, `${file}\n${errors.join("\n")}`).toBe(true);
      for (const scene of Object.values(chapter.scenes)) {
        expect(scene).not.toHaveProperty("environment");
        expect(scene).not.toHaveProperty("onEscape");
        expect(scene).not.toHaveProperty("onTimeout");
      }
    }
  });

  it.each([
    ["an unknown environment key", (s) => (s.environment.weather = "rain")],
    ["an empty environment", (s) => (s.environment = {})],
    ["an unknown hazard kind", (s) => (s.environment.hazards[0].kind = "lava")],
    ["a clock that runs too long", (s) => (s.environment.clock.rounds = 13)],
    ["an unknown clock ending", (s) => (s.environment.clock.onExpire = "explode")],
    ["a tile off the board", (s) => (s.environment.exits[0].tiles[0] = { x: 10, y: 0 })],
    ["a relocation in round one", (s) => (s.environment.relocate[0].round = 1)],
    ["a relocation naming no ordinal", (s) => (s.environment.relocate[0].enemy = "shade")],
    ["a branch with no goto", (s) => (s.onEscape = { narration: "Away!" })],
  ])("refuses %s", (_name, bend) => {
    const chapter = sandbox();
    bend(chapter.scenes.fight_rift);
    expect(judge(chapterSchema, chapter).ok).toBe(false);
  });

  it("is not content: neither fixture lives where the loader or the gate reads", () => {
    expect(readdirSync(join(REPO, "content", "chapters"))).not.toContain("rift-skirmish.json");
    expect(readdirSync(join(REPO, "content", "maps"))).not.toContain("rift_ferry.json");
  });
});

// ---------------------------------------------------------------------------
// content:validate, on a copy of the real tree
// ---------------------------------------------------------------------------

const temps = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), "kad-env-"));
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

const CHAPTER = ["content", "chapters", "bramblewood-01.json"];
const SCENE = "encounter_bramblewisps";

/**
 * The Bramblewood fight (map "thicket": brambles at x=2 and x=7, rows 1-2
 * and 5-6; the party spawns on the left at x 0-1) given an environment.
 */
function withEnvironment(bend) {
  const dir = copyTree();
  const path = join(dir, ...CHAPTER);
  const chapter = JSON.parse(readFileSync(path, "utf8"));
  const scene = chapter.scenes[SCENE];
  scene.environment = {
    clock: { rounds: 4, label: "The thicket closes", onExpire: "collapse" },
    hazards: [{ id: "nettles", kind: "thorns", label: "Stinging nettles", tiles: [{ x: 4, y: 3 }], damage: 1 }],
    exits: [{ id: "gap", label: "A gap in the hedge", tiles: [{ x: 4, y: 0 }], opensRound: 2 }],
  };
  scene.onEscape = { goto: scene.onDefeat.goto };
  scene.onTimeout = { goto: scene.onDefeat.goto };
  bend?.(scene);
  writeFileSync(path, JSON.stringify(chapter, null, 2));
  return validate(dir);
}

describe("content:validate", { timeout: 60_000 }, () => {
  it("accepts a well-formed environment on a real fight", () => {
    const result = withEnvironment();
    expect(result.out).not.toContain("environment");
    expect(result.code).toBe(0);
  });

  it.each([
    ["an exit in the brambles", (s) => (s.environment.exits[0].tiles[0] = { x: 2, y: 1 }), "blocked tile on the map"],
    ["exits with no onEscape", (s) => delete s.onEscape, "needs an onEscape branch"],
    ["a collapse with no onTimeout", (s) => delete s.onTimeout, "needs an onTimeout branch"],
    ["a hazard on a party spawn", (s) => (s.environment.hazards[0].tiles[0] = { x: 0, y: 3 }), "party spawn"],
    ["an onEscape that goes nowhere", (s) => (s.onEscape = { goto: "scene_nowhere" }), "scene_nowhere"],
  ])("refuses %s", (_name, bend, complaint) => {
    const result = withEnvironment(bend);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain(complaint);
  });
});
