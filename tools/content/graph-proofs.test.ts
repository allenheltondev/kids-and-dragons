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
import { ensureGraphProofs, staleGraphProofs } from "./graph-proofs.ts";
import { REPO } from "./validate-harness.ts";

const PROOF = "content/graph-proofs/riftlight.json";
const CAMPAIGN = "content/campaigns/riftlight.json";
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
      expect(first).toMatchObject({ stale: ["riftlight"], refreshed: ["riftlight"], failed: [], report: "" });
      expect(JSON.parse(readFileSync(join(staged, PROOF), "utf8"))).toMatchObject({ campaign: "riftlight", fingerprint: shipped.fingerprint, states: shipped.states });

      // Current now: nothing is stale, so the validator is not even started.
      const started = Date.now();
      expect(ensureGraphProofs(staged)).toEqual({ stale: [], refreshed: [], failed: [], report: "" });
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

describe("graph proofs, run as a command", () => {
  it("--check says the proofs are current here and exits 0", () => {
    const result = spawnSync(process.execPath, [CLI, "--check"], { encoding: "utf8" });
    expect(result.stdout).toMatch(/graph proofs: all current/);
    expect(result.status, result.stderr).toBe(0);
  }, 60_000);
});

describe("where the proofs get made", () => {
  const read = (file: string) => readFileSync(join(REPO, file), "utf8");

  it("the build refreshes them, refuses content that has none, and checks the package itself", () => {
    const build = read("infra/build.mjs");
    expect(build).toMatch(/ensureGraphProofs\(ROOT\)/);
    expect(build).toMatch(/proofs\.failed\.length > 0\) \{[\s\S]*?throw new Error/);
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
