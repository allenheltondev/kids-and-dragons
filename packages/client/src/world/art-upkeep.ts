/**
 * The stage's art between scenes: let go of what the last one drew, and get the next ones
 * ready before the party gets there.
 *
 * A moment after the scene changes (`ART_UPKEEP_DELAY_MS`, once its own art has had its
 * turn on the network and the decoder), the stage is swept (art-memory.ts `sweepArt`) and
 * then, on the shared screen, the art of the scenes one step ahead is loaded and decoded,
 * one or two at a time, and held until the scene changes again. A scene change then finds
 * its backdrop already decoded: the new painting goes up whole, in the same frame as the
 * new words, instead of popping in a beat later over a stand-in.
 *
 * Never more than `ART_AHEAD` pictures (a television's three backdrops are 24 MiB decoded),
 * and never the whole chapter: sw/prefetch.ts already keeps the files themselves near (two
 * steps ahead, and on the television the whole chapter, in the service worker's cache),
 * which costs disk, not memory. This decodes only what one choice can reach.
 */

import type { Chapter, SceneId } from "@kad/shared";
import { isTvBrowser } from "../display/tv";
import { upcomingAssets } from "../sw/prefetch";
import { holdArt, idleArtBudget, loadArt, sweepArt, type DrawnNode } from "./art-memory";

/** How many pictures one step ahead are decoded and held: on a television, and elsewhere. */
export const ART_AHEAD = { tv: 3, other: 6 } as const;

/** How long after a scene change the sweep and the look ahead wait. */
export const ART_UPKEEP_DELAY_MS = 2_500;

/** The art one step ahead of `sceneId`, nearest first, at most `limit`: backdrops, and a fight's tiles and enemies. */
export function artAhead(chapter: Chapter | null, sceneId: SceneId | null, limit: number): string[] {
  if (!chapter || !sceneId || !chapter.scenes[sceneId] || limit <= 0) return [];
  return upcomingAssets(chapter, sceneId, [], 1).slice(0, limit);
}

export interface ArtUpkeepOptions {
  /** The art to load and hold ahead: the shared screen's `artAhead`; empty on a phone, whose world pane only sweeps. */
  ahead: readonly string[];
  tv?: boolean;
  delayMs?: number;
}

/**
 * Sweep `stage` and load `ahead` after the delay; the returned function cancels whatever has
 * not started and lets go of the holds, for the next scene's upkeep to judge.
 */
export function scheduleArtUpkeep(stage: DrawnNode, { ahead, tv = isTvBrowser(), delayMs = ART_UPKEEP_DELAY_MS }: ArtUpkeepOptions): () => void {
  let cancelled = false;
  let releases: (() => void)[] = [];
  const timer = setTimeout(() => {
    if (cancelled) return;
    sweepArt(stage, idleArtBudget(tv));
    if (ahead.length === 0) return;
    releases = ahead.map((url) => holdArt(url));
    const queue = [...ahead];
    const lane = async (): Promise<void> => {
      for (let url = queue.shift(); url !== undefined && !cancelled; url = queue.shift()) {
        await loadArt(url).catch(() => undefined);
      }
    };
    // One at a time on a television: its decoder and its network are the scene's first.
    for (let i = 0; i < (tv ? 1 : 2); i++) void lane();
  }, delayMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
    for (const release of releases) release();
    releases = [];
  };
}
