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
 *
 * Decoded is not yet drawable: WebGL copies a texture to the GPU the first frame it is drawn,
 * which for a backdrop is a long frame on a television's GPU, and that frame would be the
 * scene change. So on the television each picture held ahead is also handed to the GPU as it
 * decodes (`ArtUploadTarget`), one per frame and only while the stage is running. Pixi's own
 * `pixi.js/prepare` does the same, but it imports the bitmap and HTML text classes, which the
 * stage's bundle leaves out (pixi-webgl-only.ts), so this calls the one method it uses for a
 * texture. Pixi's texture GC frees a GPU copy unused for a while (PixiStage.tsx
 * `stageBudget`), so a long read may still upload at the change; a quick one does not.
 */

import type { Texture, TextureSource } from "pixi.js";
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

/** The part of Pixi's ticker the upload paces itself by. */
export interface UploadTicker {
  readonly started: boolean;
  addOnce(fn: () => void): unknown;
  remove(fn: () => void): unknown;
}

/** Where art held ahead is uploaded: the stage's ticker and its renderer's `texture.initSource`. */
export interface ArtUploadTarget {
  ticker: UploadTicker;
  initSource(source: TextureSource): void;
}

/**
 * Hand decoded textures to the GPU one at a time: each in the gap after a frame the stage
 * drew, as Pixi's prepare does, so the upload never lengthens the frame itself, and none
 * while the ticker is stopped (the pane hidden, the screen off).
 */
export function createArtUploader(target: ArtUploadTarget): { add(texture: Texture): void; stop(): void } {
  const queue: Texture[] = [];
  let armed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const arm = (): void => {
    if (armed || stopped || queue.length === 0) return;
    armed = true;
    target.ticker.addOnce(afterFrame);
  };
  const afterFrame = (): void => {
    armed = false;
    if (stopped) return;
    timer = setTimeout(uploadOne, 0);
  };
  const uploadOne = (): void => {
    timer = null;
    if (stopped) return;
    if (!target.ticker.started) return arm();
    const texture = queue.shift();
    // Unloaded by a sweep since it decoded: nothing left to upload.
    if (texture && !texture.destroyed && texture.source && !texture.source.destroyed) {
      try {
        target.initSource(texture.source);
      } catch {
        // A lost context or a torn-down renderer: the first draw uploads it, as before.
      }
    }
    arm();
  };
  return {
    add(texture) {
      if (stopped) return;
      queue.push(texture);
      arm();
    },
    stop() {
      stopped = true;
      queue.length = 0;
      if (timer !== null) clearTimeout(timer);
      if (armed) target.ticker.remove(afterFrame);
      armed = false;
    },
  };
}

export interface ArtUpkeepOptions {
  /** The art to load and hold ahead (`artAhead`); with none, the stage is only swept. */
  ahead: readonly string[];
  tv?: boolean;
  delayMs?: number;
  /** Upload what is held ahead to the GPU once decoded (the television's stage only). */
  upload?: ArtUploadTarget;
}

/**
 * Sweep `stage` and load `ahead` after the delay; the returned function cancels whatever has
 * not started and lets go of the holds, for the next scene's upkeep to judge.
 */
export function scheduleArtUpkeep(stage: DrawnNode, { ahead, tv = isTvBrowser(), delayMs = ART_UPKEEP_DELAY_MS, upload }: ArtUpkeepOptions): () => void {
  let cancelled = false;
  let releases: (() => void)[] = [];
  const uploader = upload ? createArtUploader(upload) : null;
  const timer = setTimeout(() => {
    if (cancelled) return;
    sweepArt(stage, idleArtBudget(tv));
    if (ahead.length === 0) return;
    releases = ahead.map((url) => holdArt(url));
    const queue = [...ahead];
    const lane = async (): Promise<void> => {
      for (let url = queue.shift(); url !== undefined && !cancelled; url = queue.shift()) {
        const texture = await loadArt(url).catch(() => null);
        if (texture && !cancelled) uploader?.add(texture);
      }
    };
    // One at a time on a television: its decoder and its network are the scene's first.
    for (let i = 0; i < (tv ? 1 : 2); i++) void lane();
  }, delayMs);
  return () => {
    cancelled = true;
    clearTimeout(timer);
    uploader?.stop();
    for (const release of releases) release();
    releases = [];
  };
}
