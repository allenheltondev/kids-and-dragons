/**
 * The git merge driver for assets/manifest.json (tools/art/manifest-order.ts says why).
 *
 * The manifest's growing lists are kept in order, so two branches that each declare a new
 * painting usually change different lines and git merges them by itself. This is for the
 * rest: two new entries that sort next to each other, and a branch cut before the lists
 * were sorted, whose list is in another order altogether. It merges those lists entry by
 * entry (mergeManifests) and everything else by line, as git would.
 *
 * Registered per clone by scripts/setup.mjs (git does not read drivers from the repo), and
 * named for the file in .gitattributes:
 *
 *   git config merge.kad-art-manifest.driver "node tools/art/merge-manifest.ts %O %A %B"
 *
 * git passes the ancestor, ours (which we overwrite with the result) and theirs. Exit 0 is
 * merged, and is only ever returned for a result that parses and has its lists in order.
 * Non-zero leaves the file conflicted: a conflict outside the lists is marked in the file
 * the usual way; for an entry both sides changed differently ours is kept, and the entry is
 * named on stderr; a merge whose lines went together but do not make a valid manifest is
 * written as merged, with what is wrong with it on stderr. GitHub does not run merge drivers: a pull request it calls
 * conflicted is merged locally, where this runs.
 *
 * git reads which driver a file has from the branch being merged INTO. A branch cut before
 * this driver existed does not name it yet, so the merge that first brings main into such
 * a branch stops on the manifest with git's own line conflict. For that merge, and any
 * other left conflicted on the manifest:
 *
 *   npm run art:resolve      (node tools/art/merge-manifest.ts --resolve)
 *
 * It takes the three versions git is holding for the conflicted file, merges them the way
 * the driver would have, writes the result and, when nothing is left to decide, stages it.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MANIFEST_FILE, REPO_ROOT, mergeManifests, orderProblems, type TextMerge } from "./manifest-order.ts";

/** git's own three-way line merge (`git merge-file`), on text instead of files. */
export const gitTextMerge: TextMerge = (base, ours, theirs) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad-manifest-merge-"));
  try {
    const files = { ours: path.join(dir, "ours"), base: path.join(dir, "base"), theirs: path.join(dir, "theirs") };
    fs.writeFileSync(files.ours, ours);
    fs.writeFileSync(files.base, base);
    fs.writeFileSync(files.theirs, theirs);
    const run = spawnSync("git", ["merge-file", "-p", "-L", "ours", "-L", "base", "-L", "theirs", files.ours, files.base, files.theirs], { encoding: "utf8", maxBuffer: 1 << 28 });
    // The exit status is the number of conflicts (at most 127), or an error.
    if (run.status === null || run.status > 127) throw new Error(`git merge-file failed: ${run.stderr || run.error?.message || `status ${String(run.status)}`}`);
    return { text: run.stdout, conflicts: run.status };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

export interface DriverResult {
  text: string;
  /** What is left for a person to decide. Empty when the merge is clean. */
  conflicts: string[];
}

/**
 * Why git should not record this text as the merged manifest: it is not JSON, or one of its
 * ordered lists is out of order or declares an entry twice. Empty when it may.
 */
export function manifestProblems(text: string): string[] {
  try {
    return orderProblems(text).filter((p) => p.problem !== "missing").map((p) => p.detail);
  } catch (error) {
    return [`it is not a manifest: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/**
 * What the driver writes for three versions of the manifest. Never throws on bad JSON.
 *
 * No merge is called clean unless its result is a manifest with its lists in order
 * (manifestProblems), whichever way it was made. A line merge with no conflict markers is
 * not thereby a valid file, and git records whatever a driver calls clean.
 */
export function driveMerge(base: string, ours: string, theirs: string, mergeText: TextMerge = gitTextMerge): DriverResult {
  try {
    const merged = mergeManifests(base, ours, theirs, mergeText);
    if (merged.conflicts.length === 0) {
      const wrong = manifestProblems(merged.text);
      if (wrong.length > 0) throw new Error(wrong.join("; "));
    }
    return merged;
  } catch (error) {
    // A side that is not JSON or declares an entry twice, or a result that is not right:
    // nothing here is better than git's own line merge, so do exactly that, and hold its
    // result to the same standard.
    const plain = mergeText(base, ours, theirs);
    const why = error instanceof Error ? error.message : String(error);
    // With conflict markers in it the file is already one git will not record.
    if (plain.conflicts > 0) return { text: plain.text, conflicts: [`merged by line (${why}): ${plain.conflicts} conflict(s), marked in the file`] };
    const wrong = manifestProblems(plain.text);
    if (wrong.length === 0) return { text: plain.text, conflicts: [] };
    return { text: plain.text, conflicts: wrong.map((problem) => `the lines merged without a conflict, but the result is not a valid manifest: ${problem}`) };
  }
}

export interface Resolution {
  /** "resolved": merged and staged. "conflicts": written, with things left to decide. "none": the file is not conflicted. */
  outcome: "resolved" | "conflicts" | "none";
  conflicts: string[];
}

/**
 * Finishes a merge that stopped on the manifest: merges the three versions git holds for
 * the conflicted file (its index stages) and writes the result. Staged when clean.
 */
export function resolveConflict(root: string, mergeText: TextMerge = gitTextMerge): Resolution {
  const git = (...args: string[]) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  const held = git("ls-files", "-u", "--", MANIFEST_FILE);
  if (held.status !== 0) throw new Error(`git ls-files failed: ${held.stderr}`);
  const stages = new Set(held.stdout.split("\n").map((line) => line.split(/\s+/)[2]).filter(Boolean));
  if (stages.size === 0) return { outcome: "none", conflicts: [] };
  if (!stages.has("2") || !stages.has("3")) throw new Error(`one side deleted ${MANIFEST_FILE}; that is for a person to decide`);
  const stage = (n: 1 | 2 | 3): string => {
    if (!stages.has(String(n))) return "";
    const shown = git("show", `:${n}:${MANIFEST_FILE}`);
    if (shown.status !== 0) throw new Error(`git show :${n}:${MANIFEST_FILE} failed: ${shown.stderr}`);
    return shown.stdout;
  };
  const { text, conflicts } = driveMerge(stage(1), stage(2), stage(3), mergeText);
  fs.writeFileSync(path.join(root, MANIFEST_FILE), text);
  if (conflicts.length > 0) return { outcome: "conflicts", conflicts };
  const added = git("add", "--", MANIFEST_FILE);
  if (added.status !== 0) throw new Error(`git add ${MANIFEST_FILE} failed: ${added.stderr}`);
  return { outcome: "resolved", conflicts: [] };
}

// Run directly, not imported. Compared as URLs, so it is true on Windows too.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes("--resolve")) {
  try {
    const { outcome, conflicts } = resolveConflict(REPO_ROOT);
    if (outcome === "none") console.log(`${MANIFEST_FILE} is not conflicted: nothing to resolve`);
    else if (outcome === "resolved") console.log(`${MANIFEST_FILE}: merged entry by entry and staged`);
    else {
      console.error(`${MANIFEST_FILE}: merged, with ${conflicts.length} thing(s) left to decide, then git add it:`);
      for (const conflict of conflicts) console.error(`  ${conflict}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`${MANIFEST_FILE}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} else if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [basePath, oursPath, theirsPath] = process.argv.slice(2);
  if (!basePath || !oursPath || !theirsPath) {
    console.error("usage: node tools/art/merge-manifest.ts <base> <ours> <theirs>   (as git's merge driver)\n       node tools/art/merge-manifest.ts --resolve                 (finish a merge that stopped on the manifest)");
    process.exit(2);
  }
  const read = (file: string): string => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
  try {
    const { text, conflicts } = driveMerge(read(basePath), read(oursPath), read(theirsPath));
    fs.writeFileSync(oursPath, text);
    if (conflicts.length > 0) {
      console.error(`${MANIFEST_FILE}: ${conflicts.length} thing(s) to decide, then git add it:`);
      for (const conflict of conflicts) console.error(`  ${conflict}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`${MANIFEST_FILE} merge driver: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
