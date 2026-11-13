/**
 * Whether this build may ask for half-size art (src/world/art-paths.ts, "SMALL ART").
 *
 * A phone asked for a copy that is not there would draw nothing, so the page and the
 * service worker are told (`__KAD_SMALL_ART__`) only when the copies are all there and all
 * current: every painting the rule names has its copy in `assets.lock.json`, and
 * `assets.small.json` says that copy was made from the painting the lock holds now. A
 * painting repainted and not yet run through `npm run art:small` therefore turns small art
 * off for the next build (every device draws the paintings themselves) instead of leaving a
 * phone on the old picture.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { smallArtUrl } from "./src/world/art-paths.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** `assets.small.json`: each copy (a path under the repo) and the sha256 of the painting it was made from. */
export const SMALL_ART_RECORD = "assets.small.json";
export type SmallArtRecord = Record<string, string>;
export type LockFiles = Record<string, { sha256: string; bytes: number }>;

/** Each painting in the lock that has a half-size copy by the rule, with its copy's path. */
export function smallArtSources(files: LockFiles): { source: string; copy: string }[] {
  const out: { source: string; copy: string }[] = [];
  for (const source of Object.keys(files).sort()) {
    const copy = smallArtUrl(`/${source}`);
    if (copy) out.push({ source, copy: copy.slice(1) });
  }
  return out;
}

/** What stands between this lock and small art: a copy missing from it, or made from an older painting. Empty when it is ready. */
export function smallArtOwed(files: LockFiles, record: SmallArtRecord): { source: string; copy: string; why: "missing" | "stale" }[] {
  const owed: { source: string; copy: string; why: "missing" | "stale" }[] = [];
  for (const { source, copy } of smallArtSources(files)) {
    if (!files[copy] || record[copy] === undefined) owed.push({ source, copy, why: "missing" });
    else if (record[copy] !== files[source]!.sha256) owed.push({ source, copy, why: "stale" });
  }
  return owed;
}

function readJson<T>(path: string, empty: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return empty;
  }
}

export function loadSmallArt(root: string = repoRoot): { files: LockFiles; record: SmallArtRecord } {
  const files = readJson<{ files?: LockFiles }>(`${root}assets.lock.json`, {}).files ?? {};
  return { files, record: readJson<SmallArtRecord>(`${root}${SMALL_ART_RECORD}`, {}) };
}

/** True when there are paintings with copies and none is owed. */
export function smallArtReady(root: string = repoRoot): boolean {
  const { files, record } = loadSmallArt(root);
  return smallArtSources(files).length > 0 && smallArtOwed(files, record).length === 0;
}
