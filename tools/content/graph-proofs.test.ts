/**
 * Graph proofs as a cache (tools/content/graph-proofs.ts): nobody commits them, and everything
 * that needs one refreshes it. These run against a staged copy of the real tree, so the walk
 * that is refreshed is Riftlight's own.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ContentSet } from "./content-set.ts";
import { contentGateForBuild, ensureGraphProofs, staleGraphProofs } from "./graph-proofs.ts";
import { checkerFingerprint } from "./validate-content.ts";
import { REPO } from "./validate-harness.ts";

const PROOF = "content/graph-proofs/riftlight.json";
const CAMPAIGN = "content/campaigns/riftlight.json";
/** A chapter no graph names: breaking it fails the validator and leaves every graph sound. */
const OTHER_CHAPTER = "content/chapters/bramblewood-01.json";
const CLI = join(REPO, "tools", "content", "graph-proofs.ts");

describe("graph proofs", () => {
  let staged = "";
  const original = new Map<string, string>();

  /** A staged copy of the real tree, as validate-cli.test.ts stages it. */
  beforeAll(() => {
    staged = mkdtempSync(join(tmpdir(), "kad-graph-proofs-"));
    const real = ContentSet.load(REPO);
    for (const path of real.paths()) {
      mkdirSync(dirname(join(staged, path)), { recursive: true });
      writeFileSync(join(staged, path), real.text(path));
    }
    cpSync(join(REPO, "assets", "world"), join(staged, "assets", "world"), { recursive: true });
  }, 120_000);

  afterAll(() => rmSync(staged, { recursive: true, force: true }), 60_000);

  function write(path: string, text: string | null): void {
    const file = join(staged, path);
    if (!original.has(path) && existsSync(file)) original.set(path, readFileSync(file, "utf8"));
    if (text === null) rmSync(file, { force: true });
    else writeFileSync(file, text);
  }
  function restore(): void {
    for (const [path, text] of original) writeFileSync(join(staged, path), text);
    original.clear();
  }

  it("are current in this checkout by the time a test runs, because the test run refreshed them first", () => {
    expect(staleGraphProofs(REPO)).toEqual([]);
    expect(existsSync(join(REPO, PROOF))).toBe(true);
  });

  it("are not in git, and are ignored", () => {
    expect(execFileSync("git", ["ls-files", "content/graph-proofs"], { cwd: REPO, encoding: "utf8" }).trim()).toBe("");
    expect(execFileSync("git", ["check-ignore", PROOF], { cwd: REPO, encoding: "utf8" }).trim()).toBe(PROOF);
  });

  it("a missing proof is walked and recorded once, and trusted after that", () => {
    try {
      const shipped = JSON.parse(readFileSync(join(staged, PROOF), "utf8")) as { fingerprint: string; states: number };
      write(PROOF, null);
      expect(staleGraphProofs(staged)).toEqual(["riftlight"]);

      const first = ensureGraphProofs(staged);
      expect(first).toEqual({ stale: ["riftlight"], refreshed: ["riftlight"], failed: [], validator: 0, report: "" });
      expect(JSON.parse(readFileSync(join(staged, PROOF), "utf8"))).toMatchObject({ campaign: "riftlight", fingerprint: shipped.fingerprint, states: shipped.states });

      // Current now: nothing is stale, so the validator is not even started.
      const started = Date.now();
      expect(ensureGraphProofs(staged)).toEqual({ stale: [], refreshed: [], failed: [], validator: null, report: "" });
      expect(Date.now() - started).toBeLessThan(2000);
    } finally {
      restore();
    }
  }, 120_000);

  it("a proof made for other content is stale, and is replaced", () => {
    try {
      const proof = JSON.parse(readFileSync(join(staged, PROOF), "utf8")) as Record<string, unknown>;
      write(PROOF, JSON.stringify({ ...proof, fingerprint: "0".repeat(32) }));
      expect(staleGraphProofs(staged)).toEqual(["riftlight"]);

      expect(ensureGraphProofs(staged).refreshed).toEqual(["riftlight"]);
      expect(JSON.parse(readFileSync(join(staged, PROOF), "utf8"))).toMatchObject({ fingerprint: proof.fingerprint });
    } finally {
      restore();
    }
  }, 120_000);

  // Review on #751. The validator trusts a proof only from the checker that made it
  // (`proof.checker === rep.checker`), so a change to the route search re-walks every campaign.
  // The refresh paths compared the content's fingerprint alone, and kept an old proof.
  it("a proof made by another checker is stale, though the content has not changed, and is replaced", () => {
    try {
      const proof = JSON.parse(readFileSync(join(staged, PROOF), "utf8")) as { fingerprint: string; checker: string };
      expect(proof.checker).toBe(checkerFingerprint());
      write(PROOF, JSON.stringify({ ...proof, checker: "0".repeat(32) }));
      expect(staleGraphProofs(staged)).toEqual(["riftlight"]);

      const result = ensureGraphProofs(staged);
      expect(result).toMatchObject({ stale: ["riftlight"], refreshed: ["riftlight"], failed: [], validator: 0 });
      const rewritten = JSON.parse(readFileSync(join(staged, PROOF), "utf8")) as { fingerprint: string; checker: string };
      expect(rewritten).toMatchObject({ fingerprint: proof.fingerprint, checker: checkerFingerprint() });
      expect(staleGraphProofs(staged)).toEqual([]);
    } finally {
      restore();
    }
  }, 120_000);

  it("a proof with no checker at all is stale", () => {
    try {
      const { checker: _checker, ...rest } = JSON.parse(readFileSync(join(staged, PROOF), "utf8")) as Record<string, unknown>;
      write(PROOF, JSON.stringify(rest));
      expect(staleGraphProofs(staged)).toEqual(["riftlight"]);
    } finally {
      restore();
    }
  });

  it("rewording a chapter leaves its campaign's proof current: only the graph and the flags are in it", () => {
    try {
      const campaign = JSON.parse(readFileSync(join(staged, CAMPAIGN), "utf8")) as { graph: { nodes: Record<string, { chapter: string }> } };
      const chapterFile = `content/chapters/${Object.values(campaign.graph.nodes)[0]!.chapter}.json`;
      const chapter = JSON.parse(readFileSync(join(staged, chapterFile), "utf8")) as { title: string };
      write(chapterFile, JSON.stringify({ ...chapter, title: `${chapter.title} (reworded)` }));
      expect(staleGraphProofs(staged)).toEqual([]);
    } finally {
      restore();
    }
  });

  it("a graph that does not validate gets no proof, and says so without throwing", () => {
    try {
      const campaign = JSON.parse(readFileSync(join(staged, CAMPAIGN), "utf8")) as { graph: { edges: Record<string, { from: string; to: string }> } };
      const [edge] = Object.keys(campaign.graph.edges);
      campaign.graph.edges[edge!]!.to = "a-place-that-is-not-on-the-map";
      write(CAMPAIGN, JSON.stringify(campaign));
      write(PROOF, null);

      const result = ensureGraphProofs(staged);
      expect(result).toMatchObject({ stale: ["riftlight"], refreshed: [], failed: ["riftlight"] });
      expect(result.report).toMatch(/riftlight\.json/);
      expect(existsSync(join(staged, PROOF))).toBe(false);
    } finally {
      restore();
    }
  }, 120_000);
});

// Review on #751. The validator judges all the content and its exit code was thrown away:
// with a sound graph and a broken chapter elsewhere it wrote the proof and returned 1, the
// proofs then read as current, and the build packaged content that had failed the gate.
describe("when the content fails a rule that is not a graph's", () => {
  let staged = "";

  beforeAll(() => {
    staged = mkdtempSync(join(tmpdir(), "kad-graph-proofs-gate-"));
    const real = ContentSet.load(REPO);
    for (const path of real.paths()) {
      mkdirSync(dirname(join(staged, path)), { recursive: true });
      writeFileSync(join(staged, path), real.text(path));
    }
    cpSync(join(REPO, "assets", "world"), join(staged, "assets", "world"), { recursive: true });
  }, 120_000);

  afterAll(() => rmSync(staged, { recursive: true, force: true }), 60_000);

  const breakOtherChapter = () => {
    const chapter = JSON.parse(readFileSync(join(staged, OTHER_CHAPTER), "utf8")) as { entry: string };
    writeFileSync(join(staged, OTHER_CHAPTER), JSON.stringify({ ...chapter, entry: "a_scene_that_is_not_there" }));
  };

  it("the staged tree passes the build's gate as it stands", () => {
    expect(contentGateForBuild(staged)).toEqual({ ok: true, refreshed: [], unproven: [], report: "" });
  }, 120_000);

  it("the build's gate fails even though every proof is current, because it does not skip the validator", () => {
    breakOtherChapter();
    expect(staleGraphProofs(staged)).toEqual([]);

    const gate = contentGateForBuild(staged);
    expect(gate.ok).toBe(false);
    expect(gate.unproven).toEqual([]);
    expect(gate.report).toMatch(/bramblewood-01\.json/);

    // The refresh has nothing to refresh, does not run the validator, and says so: null, not a pass.
    expect(ensureGraphProofs(staged)).toEqual({ stale: [], refreshed: [], failed: [], validator: null, report: "" });
  }, 120_000);

  it("a refresh records the proof and still reports that the validator failed", () => {
    rmSync(join(staged, PROOF));
    const result = ensureGraphProofs(staged);
    // The graph is sound, so its proof is written; the tree is not, and that is not hidden.
    expect(result).toMatchObject({ stale: ["riftlight"], refreshed: ["riftlight"], failed: [], validator: 1 });
    expect(result.report).toMatch(/bramblewood-01\.json/);
    expect(existsSync(join(staged, PROOF))).toBe(true);

    expect(contentGateForBuild(staged).ok).toBe(false);
  }, 120_000);

  it("the command exits 1 for it, says the proofs were recorded and the content was not passed, and exits 0 under --soft", () => {
    rmSync(join(staged, PROOF));
    const env = { ...process.env, KAD_CONTENT_ROOT: staged };
    const hard = spawnSync(process.execPath, [CLI], { encoding: "utf8", env });
    expect(hard.status).toBe(1);
    expect(hard.stderr).toMatch(/recorded, but the rest of the content does not pass npm run content:validate/);
    expect(hard.stderr).toMatch(/bramblewood-01\.json/);

    rmSync(join(staged, PROOF));
    const soft = spawnSync(process.execPath, [CLI, "--soft"], { encoding: "utf8", env });
    expect(soft.status).toBe(0);
    expect(soft.stderr).toMatch(/does not pass npm run content:validate/);
  }, 180_000);
});

describe("graph proofs, run as a command", () => {
  it("--check says the proofs are current here and exits 0", () => {
    const result = spawnSync(process.execPath, [CLI, "--check"], { encoding: "utf8" });
    expect(result.stdout).toMatch(/graph proofs: all current/);
    expect(result.status, result.stderr).toBe(0);
  }, 60_000);
});

describe("where the proofs get made", () => {
  const read = (file: string) => readFileSync(join(REPO, file), "utf8");

  it("the build runs the whole gate, stops on any failure, and checks the package itself", () => {
    const build = read("infra/build.mjs");
    expect(build).toMatch(/contentGateForBuild\(ROOT\)/);
    expect(build).toMatch(/if \(!gate\.ok\) \{[\s\S]*?throw new Error/);
    // Not the refresh, which skips the validator when the proofs are current and would let
    // a package be made from content nobody checked.
    expect(build).not.toMatch(/ensureGraphProofs/);
    // After the copy, on the copy: what ships, not what was on disk before.
    expect(build.indexOf("staleGraphProofs(dir)")).toBeGreaterThan(build.indexOf('cp(path.join(ROOT, "content")'));
  });

  it("the test run refreshes them before any worker starts", () => {
    expect(read("vitest.config.ts")).toMatch(/globalSetup: \["\.\/tools\/content\/graph-proofs\.ts"\]/);
  });

  it("the dev server's start refreshes them, and starts even on content that does not validate", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["predev:server"]).toBe("node tools/content/graph-proofs.ts --soft");
    expect(scripts["content:proofs"]).toBe("node tools/content/graph-proofs.ts");
  });

  it("setup refreshes them", () => {
    expect(read("scripts/setup.mjs")).toMatch(/"tools\/content\/graph-proofs\.ts", "--soft"/);
  });
});
