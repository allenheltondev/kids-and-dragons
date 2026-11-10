#!/usr/bin/env node
/**
 * Which old bundle files a deploy may delete: `scripts/deploy.sh` pipes the
 * bucket's `bundle/` listing into
 * `node tools/deploy/stale-bundles.ts <dist/bundle> [days]` and removes the
 * keys this prints, one per line.
 *
 * The deploy used to `aws s3 sync --delete` the bundle, before the new
 * index.html was up. Every file under `bundle/` has its hash in its name, so
 * that deleted the previous build's files while the previous page was still
 * the one being served, and while phones that had it open were still asking
 * for its lazy chunks: a screen opened for the first time that evening got a
 * 404 and a broken panel until somebody reloaded.
 *
 * So a deploy now only adds, and a file goes when both are true: this build
 * does not ship it, and it has not been uploaded for KEEP_DAYS. The age is
 * what protects a page that is still open, and it is measured from the upload
 * (S3's LastModified), which is the last moment any index.html could have
 * started naming that file.
 *
 * Plain `node`, no dependencies: a ship-mode deploy has no node_modules
 * (tools/voice/verify-site.ts runs the same way, for the same reason).
 */

import fs from "node:fs";
import path from "node:path";

/** Long enough that no open page or installed app is still on that build. */
export const KEEP_DAYS = 14;

export interface ListedObject {
  Key: string;
  LastModified: string;
}

/**
 * The keys to delete. `listed` is what is in the bucket under `bundle/`,
 * `current` the paths this build ships, relative to the bundle directory with
 * forward slashes. Anything outside `bundle/` is never returned, whatever the
 * listing holds: this is the one deploy step that deletes by computed name.
 */
export function staleBundleKeys(listed: readonly ListedObject[], current: ReadonlySet<string>, now: Date, keepDays: number = KEEP_DAYS): string[] {
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  const stale: string[] = [];
  for (const object of listed) {
    if (!object.Key.startsWith("bundle/")) continue;
    if (current.has(object.Key.slice("bundle/".length))) continue;
    const modified = Date.parse(object.LastModified);
    // An age that cannot be read is not an age: keep the file.
    if (Number.isNaN(modified) || modified > cutoff) continue;
    stale.push(object.Key);
  }
  return stale.sort();
}

/** Every file under `dir`, relative to it, with forward slashes. */
export function filesUnder(dir: string): Set<string> {
  const found = new Set<string>();
  const walk = (at: string, prefix: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(at, entry.name), relative);
      else found.add(relative);
    }
  };
  walk(dir, "");
  return found;
}

/** `aws s3api list-objects-v2 --output json`, or its `Contents` alone; an empty prefix lists nothing at all. */
export function parseListing(text: string): ListedObject[] {
  if (text.trim() === "") return [];
  const parsed: unknown = JSON.parse(text);
  const contents: unknown = Array.isArray(parsed) ? parsed : (parsed as { Contents?: unknown } | null)?.Contents;
  if (!Array.isArray(contents)) return [];
  return contents.filter(
    (o): o is ListedObject => typeof (o as ListedObject | null)?.Key === "string" && typeof (o as ListedObject | null)?.LastModified === "string",
  );
}

if (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1])) {
  const dir = process.argv[2];
  const days = process.argv[3] === undefined ? KEEP_DAYS : Number(process.argv[3]);
  if (dir === undefined || !fs.existsSync(dir) || !Number.isFinite(days) || days < 0) {
    console.error("usage: aws s3api list-objects-v2 … --output json | node tools/deploy/stale-bundles.ts <dist/bundle> [days]");
    process.exit(2);
  }
  const current = filesUnder(dir);
  // A build with no bundle is not a build. Deleting against it would call
  // every file in the bucket stale.
  if (current.size === 0) {
    console.error(`error: ${dir} holds no files; refusing to call anything stale`);
    process.exit(1);
  }
  const listing = fs.readFileSync(0, "utf8");
  for (const key of staleBundleKeys(parseListing(listing), current, new Date(), days)) console.log(key);
}
