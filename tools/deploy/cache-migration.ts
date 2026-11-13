#!/usr/bin/env node
/**
 * Which objects a deploy must give a new `Cache-Control`, by kind: `scripts/deploy.sh` pipes a
 * prefix's listing (`aws s3api list-objects-v2 --output json`) into
 * `node tools/deploy/cache-migration.ts` and gets one line per file extension found there,
 * `<extension><TAB><a key that has it>`.
 *
 * `aws s3 sync --cache-control` only sets the header on what it uploads, and it uploads only
 * what is missing or changed. So a deploy that changes the header leaves every painting and
 * chapter already in the bucket on the old one, which is nearly all of them. Changing it on an
 * object in place is a copy onto itself with its metadata replaced, and a replaced object keeps
 * only what the copy names, its `Content-Type` included. So the deploy copies one extension
 * at a time, each with the `Content-Type` the sample key printed here already has in the
 * bucket: what the bucket says a `.png` is today is what every `.png` is given back.
 *
 * Plain `node`, no dependencies: a ship-mode deploy has no node_modules (stale-bundles.ts).
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** A key's extension as written (the copy's `--include "*.<ext>"` is case-sensitive), or "" for none. */
export function extensionOfKey(key: string): string {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1);
}

export interface Listing {
  Contents?: { Key?: string }[] | null;
}

/** Each extension in the listing with the first key (in listing order) that has it; keys with none are left out. */
export function extensionSamples(listing: Listing): { extension: string; key: string; count: number }[] {
  const found = new Map<string, { key: string; count: number }>();
  for (const { Key } of listing.Contents ?? []) {
    if (!Key || Key.endsWith("/")) continue;
    const extension = extensionOfKey(Key);
    // Nothing the game ships lacks one, and a `*` include would sweep up every other kind.
    if (extension === "" || /[^A-Za-z0-9]/.test(extension)) continue;
    const seen = found.get(extension);
    if (seen) seen.count += 1;
    else found.set(extension, { key: Key, count: 1 });
  }
  return [...found].map(([extension, { key, count }]) => ({ extension, key, count })).sort((a, b) => a.extension.localeCompare(b.extension));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const input = fs.readFileSync(0, "utf8").trim();
  // An empty prefix lists as nothing at all, not as `{}`.
  const listing = (input === "" ? {} : JSON.parse(input)) as Listing;
  for (const { extension, key } of extensionSamples(listing)) process.stdout.write(`${extension}\t${key}\n`);
}
