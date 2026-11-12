/**
 * The narration ahead, fetched before the party gets there (docs/voice-narration-plan.md §5).
 *
 * A television on a slow connection might not have a line's recordings within a moment of the
 * line being spoken, and the line would be read by the device voice instead. The chapter already
 * says where the story can go next (shared `edgesOf`), so while the table reads one scene this
 * asks the recorded voice (shared `prefetchNarration`) for the next scenes' clips, two steps
 * ahead like the art (sw/prefetch.ts). The shared screen, which is plugged in and shows the whole
 * story, also fetches the rest of the chapter, after the nearer scenes, so a long sitting does
 * not depend on the connection after the first minutes.
 *
 * Guessing ahead is retired when it stops being useful: a chapter that is over (its queued
 * clips would compete with the next chapter's), a world that leaves the screen, a page that is
 * hidden (the speaker drops its queue, `whileSeen`) and asks again when it is seen. A line being
 * spoken is never touched.
 *
 * Only the recorded voice does anything with it: with read-aloud off, or no clips for a scene,
 * a request is a no-op, and the clip speaker leaves Data Saver devices alone. The same rule as
 * the art: only a world that is on screen asks.
 */

import { useEffect } from "react";
import { edgesOf, prefetchNarration, stopPrefetchNarration } from "@kad/shared";
import type { Chapter, SceneId } from "@kad/shared";
import { useChapter, useRunState } from "../store";

/** How many steps of the story ahead to fetch first. */
export const VOICE_PREFETCH_DEPTH = 2;

/**
 * The address prefixes of the scenes to fetch, nearest first: the scene the party is in (its own
 * line may still be on its way), then each scene up to `depth` steps from it. From the chapter's
 * entry when there is no scene yet, with the chapter's own goal and plate, which are said
 * before the first scene's story.
 */
export function upcomingNarration(chapter: Chapter, from: SceneId | null, depth = VOICE_PREFETCH_DEPTH): string[] {
  const here = from !== null && chapter.scenes[from] ? from : null;
  const prefixes: string[] = [];
  if (here === null || here === chapter.entry) prefixes.push(`${chapter.id}/@plate`, `${chapter.id}/@goal`);
  const seen = new Set<SceneId>();
  let frontier: SceneId[] = [here ?? chapter.entry];
  for (let step = 0; step <= depth && frontier.length > 0; step += 1) {
    const after: SceneId[] = [];
    for (const id of frontier) {
      const scene = chapter.scenes[id];
      if (seen.has(id) || !scene) continue;
      seen.add(id);
      prefixes.push(`${chapter.id}/${id}/`);
      after.push(...edgesOf(id, scene).map((edge) => edge.to));
    }
    frontier = after;
  }
  return prefixes;
}

/**
 * Fetch the recordings for the scenes ahead of wherever the party is, as the story moves, while
 * `enabled` (a layout sets it only when the world is on screen); with `wholeChapter`, the rest
 * of the chapter as well.
 */
export function useVoicePrefetch(enabled: boolean, wholeChapter: boolean): void {
  const chapter = useChapter();
  const state = useRunState();
  const chapterId = state?.chapterId ?? null;
  const sceneId = state?.sceneId ?? null;

  // Leaving the world or the chapter retires what was queued for it, ahead of the effects below
  // asking for the new one (cleanups run before the next effects).
  useEffect(() => () => stopPrefetchNarration(), [enabled, chapterId]);

  useEffect(() => {
    if (!enabled || chapter === null || chapter.id !== chapterId) return;
    return whenSeen(() => prefetchNarration(upcomingNarration(chapter, sceneId)));
  }, [enabled, chapter, chapterId, sceneId]);

  useEffect(() => {
    if (!enabled || !wholeChapter || chapter === null || chapter.id !== chapterId) return;
    // The chapter, not the scene: the rest of it is asked for once, and again when the page is seen.
    return whenSeen(() => prefetchNarration([`${chapter.id}/`], { background: true }));
  }, [enabled, wholeChapter, chapter, chapterId]);
}

/**
 * Runs `ask` now and every time the page becomes visible again, since a hidden page has its
 * queued guesses dropped. Returns what undoes the listener.
 */
function whenSeen(ask: () => void): () => void {
  ask();
  if (typeof document === "undefined") return () => undefined;
  const seen = (): void => {
    if (document.visibilityState === "visible") ask();
  };
  document.addEventListener("visibilitychange", seen);
  window.addEventListener("pageshow", seen);
  return () => {
    document.removeEventListener("visibilitychange", seen);
    window.removeEventListener("pageshow", seen);
  };
}
