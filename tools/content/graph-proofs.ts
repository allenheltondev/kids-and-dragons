#!/usr/bin/env node
/**
 * Graph proofs are a cache, and this keeps it warm.
 *
 * A graph campaign's route search takes seconds (Riftlight: over two hundred thousand
 * states, about five seconds). A proof in `content/graph-proofs/` records that the search
 * was run clean over exactly this graph and these chapters' flags, so the server's loader
 * can skip it (packages/shared/src/graph-proof.ts): 88 ms to load the content with a
 * proof, over five seconds without.
 *
 * The proofs used to be committed. Every change to Riftlight's graph, or to a flag one of
 * its chapters sets, rewrote the same two lines of the same file, so any two Riftlight
 * branches conflicted there, and the one that merged second had to walk again anyway:
 * 63 commits to that file in a month. They are now ignored by git and made where they are
 * needed, by whoever needs them:
 *
 *   - `npm run content:validate` records every clean walk as it goes;
 *   - the test run refreshes them once before any test file loads content (`setup()` below,
 *     vitest's globalSetup);
 *   - `infra/build.mjs` runs the whole content gate before it copies `content/` into the
 *     API's package (`contentGateForBuild`), so a package is never made from content that
 *     fails it, and never without a current proof: a Lambda does not walk at a cold start;
 *   - `npm run setup` and `npm run dev:server` refresh them, so a dev server starts fast.
 *
 *   node tools/content/graph-proofs.ts            refresh what is stale, say what happened
 *   node tools/content/graph-proofs.ts --soft     the same, but exit 0 whatever happened
 *   node tools/content/graph-proofs.ts --check    say what is stale, exit 1 if anything is
 *
 * A proof is current when it was made for this content (its `fingerprint`) by this checker
 * (its `checker`, the validator's hash of the route search's own source). That is the
 * validator's rule, and it is asked here in full. The server's loader can only ask the
 * first half, because a deployed bundle cannot read the checker's source; everything in
 * this file runs where it can, so a changed checker makes every proof stale here as it
 * does there.
 *
 * Refreshing is the validator's job and nobody else's, so there is one place that walks
 * and one format. It is the whole validator, and what it says about the rest of the
 * content is not thrown away: `ensureGraphProofs` reports its exit code, and
 * `contentGateForBuild` stops on it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chapterFlagWrites } from "../../packages/shared/src/campaign-graph-lint.ts";
import { graphFingerprint, graphProofPath } from "../../packages/shared/src/graph-proof.ts";
import type { GraphProof } from "../../packages/shared/src/graph-proof.ts";
import type { Campaign, Chapter } from "../../packages/shared/src/types/chapter.ts";
import { runCli } from "./validate-cli.ts";
import { checkerFingerprint } from "./validate-content.ts";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

/**
 * The graph campaigns under `root/content` whose proof is missing, was made for other
 * content, or was made by another checker. Reads only the campaign files, the chapters
 * their graphs name, and the checker's own source.
 */
export function staleGraphProofs(root: string): string[] {
  const content = path.join(root, "content");
  const dir = path.join(content, "campaigns");
  if (!fs.existsSync(dir)) return [];
  const checker = checkerFingerprint();
  const stale: string[] = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
    const campaign = readJson<Campaign>(path.join(dir, file));
    if (!campaign?.graph) continue;
    const chapters = new Map<string, Chapter | null>();
    const flags = (id: string) => {
      if (!chapters.has(id)) chapters.set(id, readJson<Chapter>(path.join(content, "chapters", `${id}.json`)));
      const chapter = chapters.get(id);
      return chapter ? chapterFlagWrites(chapter) : undefined;
    };
    const proof = readJson<GraphProof>(path.join(content, graphProofPath(campaign.id)));
    const current = proof?.campaign === campaign.id && proof.fingerprint === graphFingerprint(campaign, flags) && proof.checker === checker;
    if (!current) stale.push(campaign.id);
  }
  return stale;
}

export interface GateRun {
  /** The validator's exit code: 0, or 1 when any rule failed, a graph's or any other. */
  code: number;
  /** Everything it printed. */
  report: string;
}

/** `npm run content:validate` over `root`, in process: the whole gate, recording clean graph walks as it goes. */
export function runContentGate(root: string = REPO_ROOT): GateRun {
  const lines: string[] = [];
  const code = runCli({ argv: [], env: { ...process.env, KAD_CONTENT_ROOT: root }, color: false, print: (line) => lines.push(line) });
  return { code, report: lines.join("\n") };
}

export interface EnsureResult {
  /** Campaigns whose proof was stale or missing when asked. */
  stale: string[];
  /** Those the validator then walked clean and recorded. */
  refreshed: string[];
  /** Those still without a current proof: their graph does not validate. */
  failed: string[];
  /**
   * The validator's exit code, or null when every proof was current and it was not
   * started. Not the same question as `failed`: the validator judges all the content, so
   * it can record every proof and still say 1, for a chapter that has nothing to do with
   * a graph. A caller that means "the content is good" must read this, and one that got
   * null has been told nothing about that either way.
   */
  validator: number | null;
  /** The validator's report, when it ran and did not pass. */
  report: string;
}

/**
 * Makes every graph campaign's proof current, running the validator only if one is not.
 * Never throws: it says which campaigns are still unproven and what the validator's
 * verdict on the whole tree was, and leaves the caller to decide what is fatal.
 */
export function ensureGraphProofs(root: string = REPO_ROOT): EnsureResult {
  const stale = staleGraphProofs(root);
  if (stale.length === 0) return { stale, refreshed: [], failed: [], validator: null, report: "" };
  const run = runContentGate(root);
  const failed = staleGraphProofs(root);
  return { stale, refreshed: stale.filter((id) => !failed.includes(id)), failed, validator: run.code, report: run.code !== 0 || failed.length > 0 ? run.report : "" };
}

export interface BuildGate {
  /** The content passes the whole gate, and every graph campaign has a current proof. */
  ok: boolean;
  /** Proofs recorded by this run. */
  refreshed: string[];
  /** Graph campaigns still without a current proof. */
  unproven: string[];
  /** The validator's report, when `ok` is false. */
  report: string;
}

/**
 * What the build asks before it packages `content/`: does it pass `content:validate`, all
 * of it, and is every graph campaign proven. The validator runs every time, whether or not
 * a proof was stale: skipping it when the proofs are current would let a package be made
 * from content nobody checked, and reading only the proofs afterwards would pass content
 * whose graph is sound and whose chapters are not.
 */
export function contentGateForBuild(root: string = REPO_ROOT): BuildGate {
  const before = staleGraphProofs(root);
  const run = runContentGate(root);
  const unproven = staleGraphProofs(root);
  const ok = run.code === 0 && unproven.length === 0;
  return { ok, refreshed: before.filter((id) => !unproven.includes(id)), unproven, report: ok ? "" : run.report };
}

/** What happened, in the words the command line and the test run both use. */
export function describe(result: EnsureResult): { lines: string[]; ok: boolean } {
  const lines: string[] = [];
  if (result.stale.length === 0) lines.push("graph proofs: all current");
  if (result.refreshed.length > 0) lines.push(`graph proofs: walked and recorded ${result.refreshed.join(", ")}`);
  if (result.failed.length > 0) {
    lines.push(`graph proofs: ${result.failed.join(", ")} did not validate, so no proof was recorded; a server will walk it at every start until the content is fixed`);
  }
  if (result.validator !== null && result.validator !== 0 && result.failed.length === 0) {
    lines.push("graph proofs: recorded, but the rest of the content does not pass npm run content:validate");
  }
  return { lines, ok: result.failed.length === 0 && (result.validator === null || result.validator === 0) };
}

/**
 * vitest's globalSetup: once, before any worker starts. Without it every test file that
 * loads the real content would walk Riftlight itself, five seconds a file. Not fatal: a
 * tree that does not validate has tests that will say so better than this can.
 */
export function setup(): void {
  const result = ensureGraphProofs();
  if (result.stale.length === 0) return;
  const said = describe(result);
  for (const line of said.lines) (said.ok ? console.log : console.warn)(line);
  if (!said.ok) console.warn("graph proofs: npm run content:validate says why; the tests that cover it will too");
}

// Run directly, not imported. Compared as URLs, so it is true on Windows too.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `KAD_CONTENT_ROOT` is the validator's own way to be pointed at another tree, and a test's.
  const root = process.env.KAD_CONTENT_ROOT ? path.resolve(process.env.KAD_CONTENT_ROOT) : REPO_ROOT;
  if (process.argv.includes("--check")) {
    const stale = staleGraphProofs(root);
    console.log(stale.length === 0 ? "graph proofs: all current" : `graph proofs: stale or missing for ${stale.join(", ")} (npm run content:validate records them)`);
    process.exitCode = stale.length === 0 ? 0 : 1;
  } else {
    const result = ensureGraphProofs(root);
    const said = describe(result);
    if (!said.ok) console.error(result.report);
    for (const line of said.lines) (said.ok ? console.log : console.error)(line);
    // `--soft` is for the callers that must go on regardless: setup, and the hook that runs
    // before the dev server, which should start on broken content so the author can see it.
    process.exitCode = said.ok || process.argv.includes("--soft") ? 0 : 1;
  }
}
