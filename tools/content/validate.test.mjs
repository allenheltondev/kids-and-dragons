/**
 * The content gate, from the other side.
 *
 * `npm run content:validate` runs in CI against the one corpus this repo ships,
 * and it passes. That proves the corpus has not changed. It says nothing about
 * whether the validator would *catch* anything — a gate that has only ever been
 * shown a valid tree is indistinguishable from `exit 0`, and this one is 1031
 * lines of rules that no test had ever exercised.
 *
 * So every case here takes a copy of the real content, breaks exactly one
 * thing, and requires a specific complaint about that thing. Breaking real
 * content rather than authoring a fixture tree is deliberate: the baseline is
 * known-good (CI says so), so a failure can only come from the mutation, and
 * the rules are checked against the shapes actually in play rather than against
 * a minimal stub that drifts.
 *
 * The first test is the load-bearing one. If the untouched copy did not pass,
 * every assertion below would be satisfied by the copy being broken rather than
 * by the rule working — which is the exact failure mode this file exists to fix,
 * reappearing one level up.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const VALIDATOR = join(REPO, "tools", "content", "validate.mjs");

const temps = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/**
 * A copy of the real tree: the content, the schemas that judge it, and the
 * asset manifest the biome check reads.
 */
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), "kad-content-"));
  temps.push(dir);
  cpSync(join(REPO, "content"), join(dir, "content"), { recursive: true });
  cpSync(join(REPO, "schemas"), join(dir, "schemas"), { recursive: true });
  cpSync(join(REPO, "assets", "manifest.json"), join(dir, "assets", "manifest.json"), {
    recursive: true,
  });
  return dir;
}

function readJson(dir, ...parts) {
  return JSON.parse(readFileSync(join(dir, ...parts), "utf8"));
}

function writeJson(dir, parts, value) {
  writeFileSync(join(dir, ...parts), JSON.stringify(value, null, 2));
}

/** Run the gate over `dir`. Never throws — the exit code is the result. */
function validate(dir) {
  try {
    const stdout = execFileSync(process.execPath, [VALIDATOR], {
      env: { ...process.env, KAD_CONTENT_ROOT: dir, NO_COLOR: "1" },
      encoding: "utf8",
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** The chapter every graph case below bends, and its file name. */
const CHAPTER = ["content", "chapters", "bramblewood-01.json"];

/** Break one thing in the chapter, then run the gate. */
function withChapter(mutate) {
  const dir = copyTree();
  const chapter = readJson(dir, ...CHAPTER);
  mutate(chapter);
  writeJson(dir, CHAPTER, chapter);
  return validate(dir);
}

/** The id of some scene that is not the entry — a safe thing to orphan. */
function laterSceneOf(chapter) {
  const id = Object.keys(chapter.scenes).find((s) => s !== chapter.entry);
  if (!id) throw new Error("fixture: the chapter has only an entry scene");
  return id;
}

// ---------------------------------------------------------------------------

describe("the harness itself", () => {
  it("passes an untouched copy of the real content", () => {
    /*
     * Without this, a copy that was subtly wrong — a missed directory, a
     * schema that did not come along — would make every case below pass for
     * the wrong reason, reporting a working gate on the strength of a broken
     * fixture.
     */
    const result = validate(copyTree());
    expect(result.out).toContain("PASS");
    expect(result.code).toBe(0);
  }, 15_000);

  it("fails the build with a non-zero exit, not just a printed complaint", () => {
    // CI reads the exit code and nothing else. A validator that describes
    // every problem beautifully and exits 0 is not a gate.
    const result = withChapter((chapter) => {
      chapter.entry = "no_such_scene";
    });
    expect(result.code).not.toBe(0);
  });
});

describe("the scene graph — the rules a schema cannot express", () => {
  it("catches an entry that names no scene", () => {
    const result = withChapter((chapter) => {
      chapter.entry = "no_such_scene";
    });
    expect(result.out).toContain('entry scene "no_such_scene" does not exist');
    expect(result.code).not.toBe(0);
  });

  it("catches a goto that points nowhere", () => {
    /*
     * The typo that ends a session: the party taps a choice and the engine
     * looks up a scene that was never authored. It has to fail the build,
     * never the play session (architecture §5).
     */
    const result = withChapter((chapter) => {
      const scene = chapter.scenes[chapter.entry];
      const choice = scene.choices?.[0];
      if (!choice) throw new Error("fixture: the entry scene has no choices");
      choice.goto = "definitely_not_a_scene";
    });
    expect(result.out).toContain('goto "definitely_not_a_scene" is not a scene in this chapter');
    expect(result.code).not.toBe(0);
  });

  it("catches a scene nothing leads to", () => {
    /*
     * An orphan is either a typo in a goto or content nobody will ever see,
     * and both are worth failing over — the second is a chapter that is
     * quietly shorter than it was written to be.
     */
    const result = withChapter((chapter) => {
      const orphan = laterSceneOf(chapter);
      for (const scene of Object.values(chapter.scenes)) {
        for (const choice of scene.choices ?? []) {
          if (choice.goto === orphan) choice.goto = chapter.entry;
        }
        if (scene.goto === orphan) scene.goto = chapter.entry;
        if (scene.onSuccess?.goto === orphan) scene.onSuccess.goto = chapter.entry;
        if (scene.onFailure?.goto === orphan) scene.onFailure.goto = chapter.entry;
        if (scene.onVictory?.goto === orphan) scene.onVictory.goto = chapter.entry;
        if (scene.onDefeat?.goto === orphan) scene.onDefeat.goto = chapter.entry;
      }
    });
    expect(result.out).toContain("unreachable from entry");
    expect(result.code).not.toBe(0);
  });

  it("catches a chapter whose id disagrees with its filename", () => {
    // The loader resolves chapters by filename, so this is a chapter that
    // cannot be started by the id the campaign uses to name it.
    const result = withChapter((chapter) => {
      chapter.id = "renamed-in-the-file-only";
    });
    expect(result.out).toContain("does not match filename");
    expect(result.code).not.toBe(0);
  });
});

describe("cross-file rules", () => {
  it("catches a grant of an item that is not in the catalog", () => {
    /*
     * Aimed at the rule rather than at the catalog. Deleting an entry from
     * items.json only breaks something if a chapter happens to reference that
     * entry, so the first cut of this test deleted an unreferenced item and
     * passed a perfectly valid tree — proving nothing. Renaming the *grant*
     * always trips the rule.
     */
    const result = withChapter((chapter) => {
      const grant = Object.values(chapter.scenes)
        .flatMap((scene) =>
          [scene.effects, scene.onSuccess?.effects, scene.onFailure?.effects,
           scene.onVictory?.effects, scene.onDefeat?.effects].flat(),
        )
        .find((effect) => effect?.type === "grantItem");
      if (!grant) throw new Error("fixture: no chapter scene grants an item");
      grant.itemId = "a_potion_nobody_wrote";
    });

    expect(result.out).toContain('item "a_potion_nobody_wrote" is not in content/items.json');
    expect(result.code).not.toBe(0);
  });

  it("catches a chapter set in a biome the art contract has never heard of", () => {
    // Content and art must not drift apart: the biome picks the tile sheet,
    // and an unknown one is a fight drawn on a flat colour.
    const result = withChapter((chapter) => {
      chapter.biome = "the_moon";
    });
    expect(result.out).toContain('biome "the_moon" is not in assets/manifest.json');
    expect(result.code).not.toBe(0);
  });

  it("catches a campaign listing a chapter that does not exist", () => {
    const dir = copyTree();
    const campaign = readJson(dir, "content", "campaigns", "the-hollow-crown.json");
    campaign.chapters = [...campaign.chapters, "a-chapter-nobody-wrote"];
    writeJson(dir, ["content", "campaigns", "the-hollow-crown.json"], campaign);

    const result = validate(dir);
    expect(result.out).toContain("a-chapter-nobody-wrote");
    expect(result.code).not.toBe(0);
  });

  it("catches two maps claiming the same id", () => {
    const dir = copyTree();
    const map = readJson(dir, "content", "maps", "thicket.json");
    writeJson(dir, ["content", "maps", "thicket-copy.json"], map);

    const result = validate(dir);
    expect(result.out).toContain(`duplicate map id "${map.id}"`);
    expect(result.code).not.toBe(0);
  });
});

describe("the files themselves", () => {
  it("catches content that is not valid JSON at all", () => {
    // A half-saved file is the most ordinary way content breaks, and the one
    // where a stack trace instead of a message costs the most time.
    const dir = copyTree();
    writeFileSync(join(dir, "content", "rules.json"), "{ this is not json");

    const result = validate(dir);
    expect(result.out).toContain("not valid JSON");
    expect(result.code).not.toBe(0);
  });

  it("catches a missing rules.json rather than crashing on it", () => {
    const dir = copyTree();
    rmSync(join(dir, "content", "rules.json"));

    const result = validate(dir);
    expect(result.out).toContain("content/rules.json is missing");
    expect(result.code).not.toBe(0);
  });

  it("catches a schema violation, not only the hand-written rules", () => {
    /*
     * The two halves of the gate are independent: ajv judges shape, the
     * functions judge meaning. This one is shape — a required field given the
     * wrong type — and it has to fail before the cross-file rules ever run.
     */
    const result = withChapter((chapter) => {
      chapter.title = 42;
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain("chapters/bramblewood-01.json");
  });
});
