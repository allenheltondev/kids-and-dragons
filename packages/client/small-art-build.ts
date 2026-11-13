/**
 * Whether this build may ask for copies of the art (src/world/art-paths.ts, "SMALL ART"):
 * the half-size ones a phone draws (`@0.5x.webp`) and the full-size WebPs every other
 * screen draws in place of a figure's PNG (`@1x.webp`).
 *
 * A device asked for a copy that is not there would draw nothing, so the page and the
 * service worker are told (`__KAD_SMALL_ART__`) only when the copies are all there and all
 * current: every painting the rules name has each of its copies in `assets.lock.json`, and
 * `assets.small.json` says that copy was made from the painting the lock holds now. A
 * painting repainted and not yet run through `npm run art:small` therefore turns the copies
 * off for the next build (every device draws the paintings themselves) instead of leaving a
 * screen on the old picture. One switch for both kinds: a build either has the set or does not.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SMALL_ART_SUFFIX, artCopyUrls } from "./src/world/art-paths.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** `assets.small.json`: each copy (a path under the repo) and the sha256 of the painting it was made from. */
export const SMALL_ART_RECORD = "assets.small.json";
export type SmallArtRecord = Record<string, string>;
export type LockFiles = Record<string, { sha256: string; bytes: number }>;

/** How a copy is made: half as wide and half as tall, or the painting's own size. */
export type ArtCopyKind = "half" | "whole";
export interface ArtCopy {
  source: string;
  copy: string;
  kind: ArtCopyKind;
}

/** Each copy the rules name for a painting in the lock (one of either kind, or both), with its painting's path. */
export function smallArtSources(files: LockFiles): ArtCopy[] {
  const out: ArtCopy[] = [];
  for (const source of Object.keys(files).sort()) {
    for (const copy of artCopyUrls(`/${source}`)) out.push({ source, copy: copy.slice(1), kind: copy.endsWith(SMALL_ART_SUFFIX) ? "half" : "whole" });
  }
  return out;
}

/** What stands between this lock and its copies: one missing from it, or made from an older painting. Empty when it is ready. */
export function smallArtOwed(files: LockFiles, record: SmallArtRecord): (ArtCopy & { why: "missing" | "stale" })[] {
  const owed: (ArtCopy & { why: "missing" | "stale" })[] = [];
  for (const { source, copy, kind } of smallArtSources(files)) {
    if (!files[copy] || record[copy] === undefined) owed.push({ source, copy, kind, why: "missing" });
    else if (record[copy] !== files[source]!.sha256) owed.push({ source, copy, kind, why: "stale" });
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

/** True when there are paintings with copies and none, of either kind, is owed. */
export function smallArtReady(root: string = repoRoot): boolean {
  const { files, record } = loadSmallArt(root);
  return smallArtSources(files).length > 0 && smallArtOwed(files, record).length === 0;
}
