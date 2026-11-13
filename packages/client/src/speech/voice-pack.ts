/**
 * "Keep this chapter's voices" (docs/voice-narration-plan.md §5, #547): a chapter's recorded
 * narration saved on this device, so it plays with no signal.
 *
 * Nothing here saves anything itself. The service worker keeps every narration clip that passes
 * through it (sw.ts `voiceClip`, in its own `kad-voice-v1` cache); keeping a chapter is asking for
 * all of its clips, from the chapter's manifest, a few at a time. A clip already kept is not
 * asked for again, and a clip the site lacks is passed over: the line it belongs to is read by the
 * device voice, as it always is when a clip is missing (clip-speaker.ts).
 *
 * The manifests are small and arrive through the worker too (`/content/voice/manifest/`), so a
 * chapter whose manifest this phone has seen opens offline as well.
 */

import { clipPath, manifestPath } from "@kad/shared";
import type { VoiceManifest } from "@kad/shared";
import { SW_CACHES } from "../sw/policy";
import { controlled } from "../sw/warm";

/** What a clip weighs, for telling a grown-up about how much a chapter takes (about 31 KB measured over the shipped takes). */
export const CLIP_BYTES_ESTIMATE = 31 * 1024;

/** How many clips are asked for at once: background work on a phone, not a race. */
export const KEEP_LANES = 3;

/** How long to wait for the worker to take over a page that has none yet, before saying it cannot be kept. */
const WORKER_WAIT_MS = 10_000;

/** A chapter's recordings, as what to ask for. */
export interface VoicePack {
  /** Every clip the chapter plays, once, as the path it is served from. */
  paths: string[];
  /** About how much they take, in bytes. */
  bytes: number;
}

/**
 * Every clip a manifest plays, once, in the order the chapter says them. A manifest is one chapter's
 * (or the campaign's, or the help sheet's), so all of its clips are that chapter's.
 */
export function manifestClipPaths(manifest: VoiceManifest): string[] {
  const paths = new Set<string>();
  for (const variants of Object.values(manifest)) {
    for (const clips of Object.values(variants)) for (const { clip } of clips) paths.add(clipPath(clip));
  }
  return [...paths];
}

/**
 * The chapter's recordings, or null when it has none: no manifest (a chapter nobody has recorded,
 * or a signal that is not there) or one with no clips in it. Never throws.
 */
export async function loadVoicePack(chapterId: string, fetcher: typeof fetch = fetch): Promise<VoicePack | null> {
  try {
    const response = await fetcher(manifestPath(chapterId));
    if (!response.ok) return null;
    const manifest = (await response.json()) as VoiceManifest;
    if (manifest === null || typeof manifest !== "object") return null;
    const paths = manifestClipPaths(manifest);
    return paths.length === 0 ? null : { paths, bytes: paths.length * CLIP_BYTES_ESTIMATE };
  } catch {
    return null;
  }
}

/** Which of `paths` the worker has kept. Empty where there is no Cache Storage (a private window, a test). */
export async function keptPaths(paths: readonly string[]): Promise<Set<string>> {
  try {
    if (typeof caches === "undefined") return new Set();
    const cache = await caches.open(SW_CACHES.voice);
    const saved = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
    return new Set(paths.filter((path) => saved.has(path)));
  } catch {
    return new Set();
  }
}

export type KeepResult =
  /** Every clip is kept. */
  | "kept"
  /** Some are not: the signal went, or the site lacks a clip, or the disk is full. */
  | "partial"
  /** No worker is in charge of this page (a first visit, a browser that refuses them), so nothing can be kept. */
  | "unavailable";

/**
 * Ask for every clip of `paths` the worker does not have yet, so it keeps them, and say how it went.
 * `onProgress(done, total)` is told after each one, counting what was already kept. A tap is the
 * request, so Data Saver does not stop it (the scenes ahead are what Data Saver turns off, voice-prefetch.ts).
 */
export async function keepVoices(
  paths: readonly string[],
  onProgress: (done: number, total: number) => void = () => undefined,
  fetcher: typeof fetch = fetch,
  waitMs: number = WORKER_WAIT_MS,
): Promise<KeepResult> {
  if (!(await controlled(waitMs))) return "unavailable";
  const have = await keptPaths(paths);
  const queue = paths.filter((path) => !have.has(path));
  let done = have.size;
  onProgress(done, paths.length);
  const lane = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const response = await fetcher(path, { priority: "low" } as RequestInit).catch(() => null);
      // A clip the site lacks answers 403; it is not kept and not counted, the line falls back to the device voice.
      if (response?.ok) done += 1;
      onProgress(done, paths.length);
    }
  };
  await Promise.all(Array.from({ length: KEEP_LANES }, lane));
  // The worker saves a clip behind the answer; whatever it has not finished yet is kept in a moment.
  return done >= paths.length ? "kept" : "partial";
}
