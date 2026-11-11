/**
 * The git merge driver for assets.lock.json (docs/asset-store.md, "Merging").
 *
 * Two branches that each add a painting to the same folder change neighbouring
 * lines of the lock, which git's line merge calls a conflict. By path they do
 * not conflict at all, so this merges by path (mergeLocks) and only stops on a
 * path both sides changed differently.
 *
 * Registered per clone by scripts/setup.mjs (git does not read drivers from the
 * repo), and named for the file in .gitattributes:
 *
 *   git config merge.kad-assets-lock.driver "node tools/assets/merge-lock.ts %O %A %B"
 *
 * git passes the ancestor, ours (which we overwrite with the result) and theirs.
 * Exit 0 is merged; non-zero leaves the file conflicted, with ours kept for the
 * paths in dispute and the paths listed on stderr.
 */

import fs from "node:fs";
import { mergeLocks, parseLock, serializeLock, emptyLock } from "../../packages/shared/src/asset-store.ts";

const [basePath, oursPath, theirsPath] = process.argv.slice(2);
if (!basePath || !oursPath || !theirsPath) {
  console.error("usage: node tools/assets/merge-lock.ts <base> <ours> <theirs>");
  process.exit(2);
}

function read(file: string) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  return text.trim() === "" ? emptyLock() : parseLock(text);
}

try {
  const { lock, conflicts } = mergeLocks(read(basePath), read(oursPath), read(theirsPath));
  fs.writeFileSync(oursPath, serializeLock(lock));
  if (conflicts.length > 0) {
    console.error(`assets.lock.json: both sides changed ${conflicts.length} path(s) differently; ours is kept for each. Decide, then npm run assets:push:`);
    for (const p of conflicts) console.error(`  ${p}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`assets.lock.json merge driver: ${(error as Error).message}`);
  process.exit(1);
}
