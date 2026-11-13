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
 * Never more than `ART_AHEAD` pictures (a television's five are about 40 MiB decoded),
 * and never the whole chapter: sw/prefetch.ts already keeps the files themselves near (two
 * steps ahead, and on the television the whole chapter, in the service worker's cache),
 * which costs disk, not memory. This decodes only what one choice can reach.
 */

import { edgesOf } from "@kad/shared";
import type { Chapter, SceneId } from "@kad/shared";
import { isTvBrowser } from "../display/tv";
import { biomeBackdropUrl, biomeTilesUrl, castArtUrl, enemyArtUrl, sceneBackdropUrl } from "./art-paths";
import { holdArt, idleArtBudget, loadArt, sweepArt, type DrawnNode } from "./art-memory";

/**
 * How many pictures one step ahead are decoded and held: on a television, elsewhere on a
 * shared screen, and in a phone's world pane (backdrops only: its figures are small and its
 * memory is the player's).
 */
export const ART_AHEAD = { tv: 5, other: 8, phone: 2 } as const;

/**
 * How long after a scene change the sweep and the look ahead wait: long enough for the
 * scene's own art to be first on the network and the decoder, short enough that a party
 * tapping through one-button beats still finds the next painting ready.
 */
export const ART_UPKEEP_DELAY_MS = 1_200;

/**
 * The art one step ahead of `sceneId`, at most `limit`, in the order a scene change needs
 * it: every choice's backdrop first (the picture that would otherwise pop in a beat late,
 * whichever way the party votes), then who stands in those scenes, then a fight's tiles and
 * enemies. `backdropsOnly` stops after the first group.
 */
export function artAhead(chapter: Chapter | null, sceneId: SceneId | null, limit: number, backdropsOnly = false): string[] {
  const here = chapter && sceneId ? chapter.scenes[sceneId] : undefined;
  if (!chapter || !sceneId || !here || limit <= 0) return [];
  const backdrops = new Set<string>();
  const cast = new Set<string>();
  const fights = new Set<string>();
  const seen = new Set<SceneId>([sceneId]);
  for (const { to } of edgesOf(sceneId, here)) {
    const scene = chapter.scenes[to];
    if (!scene || seen.has(to)) continue;
    seen.add(to);
    backdrops.add((scene.art ? sceneBackdropUrl(scene.art) : null) ?? biomeBackdropUrl(chapter.biome));
    for (const member of ("cast" in scene ? scene.cast ?? [] : [])) {
      const url = castArtUrl(member.figure);
      if (url) cast.add(url);
    }
    if (scene.type === "encounter") {
      fights.add(biomeTilesUrl(chapter.biome));
      for (const enemy of scene.enemies) {
        const art = enemy.art ?? (enemy.creature ? `enemies/${enemy.creature}` : null);
        if (art) fights.add(enemyArtUrl(art));
      }
    }
  }
  const current = (here.art ? sceneBackdropUrl(here.art) : null) ?? biomeBackdropUrl(chapter.biome);
  const ordered = backdropsOnly ? [...backdrops] : [...backdrops, ...cast, ...fights];
  // The painting already up is not ahead of anything.
  return [...new Set(ordered)].filter((url) => url !== current).slice(0, limit);
}

export interface ArtUpkeepOptions {
  /** The art to load and hold ahead (`artAhead`); with none, the stage is only swept. */
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
