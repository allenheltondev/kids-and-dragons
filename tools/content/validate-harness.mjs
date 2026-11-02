/**
 * Shared harness for the validate.*.test.mjs files: a copy of the real content
 * tree, one thing broken, the gate run over it. See validate-core.test.mjs for
 * why the cases break real content rather than a fixture.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../..", import.meta.url));
const VALIDATOR = join(REPO, "tools", "content", "validate.mjs");

const temps = [];
/** Removes the temp trees; each test file registers it with `afterAll(cleanup, 60_000)`. */
export function cleanup() {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
}

/**
 * A copy of the real tree: the content, the schemas that judge it, and the
 * asset manifest the biome check reads.
 */
export function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), "kad-content-"));
  temps.push(dir);
  cpSync(join(REPO, "content"), join(dir, "content"), { recursive: true });
  cpSync(join(REPO, "schemas"), join(dir, "schemas"), { recursive: true });
  // The world map's painting is checked for presence, like the manifest.
  cpSync(join(REPO, "assets", "world"), join(dir, "assets", "world"), { recursive: true });
  cpSync(join(REPO, "assets", "manifest.json"), join(dir, "assets", "manifest.json"), {
    recursive: true,
  });
  return dir;
}

export function readJson(dir, ...parts) {
  return JSON.parse(readFileSync(join(dir, ...parts), "utf8"));
}

export function writeJson(dir, parts, value) {
  writeFileSync(join(dir, ...parts), JSON.stringify(value, null, 2));
}

/** Run the gate over `dir`. Never throws — the exit code is the result. */
export function validate(dir, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [VALIDATOR, ...args], {
      env: { ...process.env, KAD_CONTENT_ROOT: dir, KAD_CLASS_PLACES: "off", NO_COLOR: "1" },
      encoding: "utf8",
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** The chapter every graph case below bends, and its file name. */
export const CHAPTER = ["content", "chapters", "bramblewood-01.json"];

/** Break one thing in the chapter, then run the gate. */
export function withChapter(mutate) {
  const dir = copyTree();
  const chapter = readJson(dir, ...CHAPTER);
  mutate(chapter);
  writeJson(dir, CHAPTER, chapter);
  return validate(dir);
}

export function withFirstSteps(mutate) {
  const dir = copyTree();
  const path = ["content", "chapters", "first-steps-01.json"];
  const chapter = readJson(dir, ...path);
  mutate(chapter);
  writeJson(dir, path, chapter);
  return validate(dir);
}

/** The id of some scene that is not the entry — a safe thing to orphan. */
export function laterSceneOf(chapter) {
  const id = Object.keys(chapter.scenes).find((s) => s !== chapter.entry);
  if (!id) throw new Error("fixture: the chapter has only an entry scene");
  return id;
}
