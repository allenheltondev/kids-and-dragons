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
 *   - `infra/build.mjs` refreshes them before it copies `content/` into the API's package,
 *     and refuses to build a package without a current one, so a Lambda never walks at a
 *     cold start;
 *   - `npm run setup` and `npm run dev:server` refresh them, so a dev server starts fast.
 *
 *   node tools/content/graph-proofs.ts            refresh what is stale, say what happened
 *   node tools/content/graph-proofs.ts --soft     the same, but exit 0 even if content is broken
 *   node tools/content/graph-proofs.ts --check    say what is stale, exit 1 if anything is
 *
 * Whether a proof is current is the loader's question, asked the loader's way: does its
 * fingerprint match the content. Refreshing is the validator's job and nobody else's, so
 * there is one place that walks and one format.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chapterFlagWrites } from "../../packages/shared/src/campaign-graph-lint.ts";
import { graphFingerprint, graphProofPath } from "../../packages/shared/src/graph-proof.ts";
import type { GraphProof } from "../../packages/shared/src/graph-proof.ts";
import type { Campaign, Chapter } from "../../packages/shared/src/types/chapter.ts";
import { runCli } from "./validate-cli.ts";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};

/**
 * The graph campaigns under `root/content` whose proof is missing or was made for other
 * content. Reads only the campaign files and the chapters their graphs name.
 */
export function staleGraphProofs(root: string): string[] {
  const content = path.join(root, "content");
  const dir = path.join(content, "campaigns");
  if (!fs.existsSync(dir)) return [];
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
    if (proof?.campaign !== campaign.id || proof.fingerprint !== graphFingerprint(campaign, flags)) stale.push(campaign.id);
  }
  return stale;
}

export interface EnsureResult {
  /** Campaigns whose proof was stale or missing when asked. */
  stale: string[];
  /** Those the validator then walked clean and recorded. */
  refreshed: string[];
  /** Those still without a current proof: the content does not validate. */
  failed: string[];
  /** The validator's report, when it ran and something is still stale. */
  report: string;
}

/**
 * Makes every graph campaign's proof current, running the validator only if one is not.
 * Never throws for content that does not validate: it says which campaigns are still
 * unproven and leaves the caller to decide whether that is fatal.
 */
export function ensureGraphProofs(root: string = REPO_ROOT): EnsureResult {
  const stale = staleGraphProofs(root);
  if (stale.length === 0) return { stale, refreshed: [], failed: [], report: "" };
  const lines: string[] = [];
  runCli({ argv: [], env: { ...process.env, KAD_CONTENT_ROOT: root }, color: false, print: (line) => lines.push(line) });
  const failed = staleGraphProofs(root);
  return { stale, refreshed: stale.filter((id) => !failed.includes(id)), failed, report: failed.length > 0 ? lines.join("\n") : "" };
}

/**
 * vitest's globalSetup: once, before any worker starts. Without it every test file that
 * loads the real content would walk Riftlight itself, five seconds a file. Not fatal: a
 * tree that does not validate has tests that will say so better than this can.
 */
export function setup(): void {
  const result = ensureGraphProofs();
  if (result.refreshed.length > 0) console.log(`graph proofs: walked and recorded ${result.refreshed.join(", ")}`);
  if (result.failed.length > 0) {
    console.warn(`graph proofs: ${result.failed.join(", ")} did not validate, so tests that load the content will walk it themselves (npm run content:validate says why)`);
  }
}

// Run directly, not imported. Compared as URLs, so it is true on Windows too.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) {
    const stale = staleGraphProofs(REPO_ROOT);
    console.log(stale.length === 0 ? "graph proofs: all current" : `graph proofs: stale or missing for ${stale.join(", ")} (npm run content:validate records them)`);
    process.exitCode = stale.length === 0 ? 0 : 1;
  } else {
    const result = ensureGraphProofs();
    if (result.stale.length === 0) console.log("graph proofs: all current");
    if (result.refreshed.length > 0) console.log(`graph proofs: walked and recorded ${result.refreshed.join(", ")}`);
    if (result.failed.length > 0) {
      console.error(result.report);
      console.error(`graph proofs: ${result.failed.join(", ")} did not validate, so no proof was recorded; a server will walk it at every start until the content is fixed`);
      // `--soft` is for the callers that must go on regardless: setup, and the hook that runs
      // before the dev server, which should start on broken content so the author can see it.
      process.exitCode = process.argv.includes("--soft") ? 0 : 1;
    }
  }
}
