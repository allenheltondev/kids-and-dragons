/**
 * The content gate's command line, end to end.
 *
 * Every rule of the gate is tested by calling `validateContent` on a tree in
 * memory (validate-harness.ts), which is fast and proves nothing about the
 * process CI actually runs. These few cases spawn that process,
 * `node tools/content/validate.mjs`, over trees on disk, and hold it to the
 * three things only it does: it judges the tree it is pointed at, it prints
 * the function's report and nothing else, and it exits 0 or 1 on the result.
 * `--write-proofs` is here too, because writing to disk is the wrapper's.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContentSet } from "./content-set.ts";
import { renderReport, validateContent } from "./validate-content.ts";
import { REPO } from "./validate-harness.ts";

const VALIDATOR = join(REPO, "tools", "content", "validate.mjs");
const CHAPTER = "content/chapters/bramblewood-01.json";
const PROOF = "content/graph-proofs/riftlight.json";

/** Runs the command line. `root` null judges this repo, as `npm run content:validate` does. */
function run(root: string | null, args: readonly string[] = []): { code: number | null; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env.KAD_CONTENT_ROOT;
  delete env.KAD_CLASS_PLACES;
  if (root) env.KAD_CONTENT_ROOT = root;
  const result = spawnSync(process.execPath, [VALIDATOR, ...args], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** What the function says about the tree at `root`, as text. */
function expected(root: string): { code: number; out: string } {
  const result = validateContent(ContentSet.load(root));
  return { code: result.code, out: renderReport(result) };
}

describe("node tools/content/validate.mjs", () => {
  let staged = "";
  const original = new Map<string, string>();

  /** A staged copy of the real tree: what the gate reads, and the world map's painting it looks for. */
  beforeAll(() => {
    staged = mkdtempSync(join(tmpdir(), "kad-validate-cli-"));
    const real = ContentSet.load(REPO);
    for (const path of real.paths()) {
      mkdirSync(dirname(join(staged, path)), { recursive: true });
      writeFileSync(join(staged, path), real.text(path));
    }
    cpSync(join(REPO, "assets", "world"), join(staged, "assets", "world"), { recursive: true });
  }, 60_000);

  afterAll(() => rmSync(staged, { recursive: true, force: true }), 60_000);

  /** Changes a staged file for one case; `restore` puts every changed file back. */
  function write(path: string, text: string | null): void {
    const file = join(staged, path);
    if (!original.has(path)) original.set(path, readFileSync(file, "utf8"));
    if (text === null) rmSync(file);
    else writeFileSync(file, text);
  }
  function restore(): void {
    for (const [path, text] of original) writeFileSync(join(staged, path), text);
    original.clear();
  }

  it("passes this repo, printing the function's report and exiting 0", () => {
    const { code, stdout, stderr } = run(null);
    const want = expected(REPO);
    expect(want.code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(want.out);
    expect(stdout.endsWith("\nPASS - schemas and scene graphs are clean.\n")).toBe(true);
    // Piped, so no color: a report that parsed in a terminal and not in CI would be the worst bug a gate could have.
    expect(stdout).not.toContain("\u001b[");
    expect(code).toBe(0);
  }, 60_000);

  it("judges the tree KAD_CONTENT_ROOT names, and fails it with exit 1 and a FAIL block per problem", () => {
    try {
      const chapter = JSON.parse(readFileSync(join(staged, CHAPTER), "utf8")) as { entry: string };
      chapter.entry = "no_such_scene";
      write(CHAPTER, JSON.stringify(chapter, null, 2));

      const { code, stdout, stderr } = run(staged);
      const want = expected(staged);
      expect(want.code).toBe(1);
      expect(stderr).toBe("");
      expect(stdout).toBe(want.out);
      // The block run-validator.ts and every reader of a CI log parse: file, pointer, problem.
      expect(stdout).toContain(`  FAIL  ${CHAPTER}\n        at:      /entry\n        problem: entry scene "no_such_scene" does not exist\n`);
      expect(stdout).toMatch(/\n\d+ passed {3}\d+ warnings {3}\d+ FAILED\n\nFAILED - content is broken\. A malformed chapter fails the build, never the play session\.\n$/);
      expect(code).toBe(1);
    } finally {
      restore();
    }
  }, 60_000);

  it("reports a file that is not JSON as a failure, not a stack trace", () => {
    try {
      write("content/items.json", "{ this is not json");
      const { code, stdout, stderr } = run(staged);
      expect(stdout).toContain("  FAIL  content/items.json\n        at:      /\n        problem: not valid JSON - ");
      expect(stderr).toBe("");
      expect(code).toBe(1);
    } finally {
      restore();
    }
  }, 60_000);

  it("refuses a graph campaign with no proof, writes one to disk under --write-proofs, and trusts it afterwards", () => {
    try {
      const shipped = JSON.parse(readFileSync(join(staged, PROOF), "utf8")) as unknown;
      write(PROOF, null);

      const refused = run(staged);
      expect(refused.stdout).toMatch(/no graph proof \(content\/graph-proofs\/riftlight\.json\)/);
      expect(refused.code).toBe(1);
      expect(existsSync(join(staged, PROOF))).toBe(false);

      const written = run(staged, ["--write-proofs"]);
      expect(written.stdout).toMatch(/riftlight\.json {2}campaign .*proof written\)/);
      expect(written.code).toBe(0);
      expect(JSON.parse(readFileSync(join(staged, PROOF), "utf8"))).toEqual(shipped);

      const trusted = run(staged);
      expect(trusted.stdout).toMatch(/riftlight\.json {2}campaign .*proven\)/);
      expect(trusted.code).toBe(0);
    } finally {
      restore();
    }
  }, 120_000);

  it("exits non-zero when it cannot run at all", () => {
    // No asset manifest: the gate cannot start, and a gate that cannot start must not pass.
    try {
      write("assets/manifest.json", null);
      const { code, stdout, stderr } = run(staged);
      expect(stdout).not.toContain("PASS");
      expect(stderr).toContain("assets/manifest.json");
      expect(code).not.toBe(0);
    } finally {
      restore();
    }
  }, 60_000);
});
