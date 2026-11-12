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
 * merged. Non-zero leaves the file conflicted: a conflict outside the lists is marked in the
 * file the usual way; for an entry both sides changed differently ours is kept, and the
 * entry is named on stderr. GitHub does not run merge drivers: a pull request it calls
 * conflicted is merged locally, where this runs.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { MANIFEST_FILE, mergeManifests, orderProblems, type TextMerge } from "./manifest-order.ts";

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

/** What the driver writes for three versions of the manifest. Never throws on bad JSON. */
export function driveMerge(base: string, ours: string, theirs: string, mergeText: TextMerge = gitTextMerge): DriverResult {
  try {
    const merged = mergeManifests(base, ours, theirs, mergeText);
    if (merged.conflicts.length === 0) {
      // A clean merge is believed only if it is a manifest with its lists in order.
      const wrong = orderProblems(merged.text).filter((p) => p.problem !== "missing");
      if (wrong.length > 0) throw new Error(wrong.map((p) => p.detail).join("; "));
    }
    return merged;
  } catch (error) {
    // A side that is not JSON, or a result that is not right: nothing here is better than
    // git's own line merge, so do exactly that.
    const plain = mergeText(base, ours, theirs);
    const why = error instanceof Error ? error.message : String(error);
    return { text: plain.text, conflicts: plain.conflicts > 0 ? [`merged by line (${why}): ${plain.conflicts} conflict(s), marked in the file`] : [] };
  }
}

// Run directly, not imported. Compared as URLs, so it is true on Windows too.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [basePath, oursPath, theirsPath] = process.argv.slice(2);
  if (!basePath || !oursPath || !theirsPath) {
    console.error("usage: node tools/art/merge-manifest.ts <base> <ours> <theirs>");
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
