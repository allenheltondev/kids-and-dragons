/**
 * The scenes ahead, fetched before the party gets there.
 *
 * A scene's backdrop, its enemies and the party's rigs are otherwise
 * requested the moment they are needed — which on a phone or a television is
 * the moment the picture visibly arrives late. The chapter already says where
 * the story can go next (shared `edgesOf`), so while the party reads one
 * scene, this fetches what the next ones draw, through the service worker,
 * which keeps it (warm.ts). Two steps ahead: far enough to cover any choice,
 * near enough not to fetch a whole chapter nobody will see.
 *
 * Only a world that is on screen asks (layout/WorldView.tsx `prefetch`): the
 * television always; a phone only while its world pane is showing, not while
 * the layout keeps it mounted behind the controls or the map.
 */

import { useEffect } from "react";
import { edgesOf } from "@kad/shared";
import type { Chapter, PartyMember, SceneId } from "@kad/shared";
import { useChapter, useRunState } from "../store";
import {
  biomeBackdropUrl,
  biomeTilesUrl,
  characterRigUrl,
  characterWorldArtUrl,
  enemyArtUrl,
  sceneBackdropUrl,
} from "../world/art-paths";
import { warm } from "./warm";

/** How many steps of the story ahead to fetch. */
export const PREFETCH_DEPTH = 2;

/**
 * What the world will draw next, nearest first: the party's own figures
 * (needed in every scene), then each scene up to `depth` steps from `from` —
 * its backdrop, and for a fight its enemies and the biome's tiles. From the
 * chapter's entry when there is no current scene yet (the chapter is about
 * to start); just the party when there is no chapter (the lobby).
 */
export function upcomingAssets(
  chapter: Chapter | null,
  from: SceneId | null,
  party: readonly PartyMember[],
  depth = PREFETCH_DEPTH,
): string[] {
  const urls = new Set<string>();
  for (const { character } of party) {
    urls.add(characterRigUrl(character.species, character.tier, character.class));
    urls.add(characterWorldArtUrl(character.species, character.tier, character.class));
  }
  if (!chapter) return [...urls];

  // Where the party stands is already on screen; the chapter's entry is not yet.
  const here = from !== null && chapter.scenes[from] ? from : null;
  const seen = new Set<SceneId>(here === null ? [] : [here]);
  let frontier: SceneId[] = here === null ? [chapter.entry] : next(chapter, here);
  for (let step = 0; step < depth && frontier.length > 0; step += 1) {
    const after: SceneId[] = [];
    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);
      const scene = chapter.scenes[id];
      if (!scene) continue;
      urls.add((scene.art ? sceneBackdropUrl(scene.art) : null) ?? biomeBackdropUrl(chapter.biome));
      if (scene.type === "encounter") {
        urls.add(biomeTilesUrl(chapter.biome));
        for (const enemy of scene.enemies) if (enemy.art) urls.add(enemyArtUrl(enemy.art));
      }
      after.push(...next(chapter, id));
    }
    frontier = after;
  }
  return [...urls];
}

function next(chapter: Chapter, id: SceneId): SceneId[] {
  const scene = chapter.scenes[id];
  return scene ? edgesOf(id, scene).map((edge) => edge.to) : [];
}

/** Everything already asked for this page load, so each scene adds only what is new. */
const asked = new Set<string>();

/**
 * Fetch the scenes ahead of wherever the party is, as the story moves — while
 * `enabled`, which a layout sets only when the world is on screen.
 */
export function usePrefetchUpcoming(enabled = true): void {
  const chapter = useChapter();
  const state = useRunState();
  const chapterId = state?.chapterId ?? null;
  const sceneId = state?.sceneId ?? null;
  const party = state?.party;
  // The party's figures change only with who is seated and their tier.
  const partyKey = (party ?? []).map((m) => `${m.character.species}/${m.character.tier}/${m.character.class}`).join(",");

  useEffect(() => {
    if (!enabled) return;
    const current = chapter !== null && chapter.id === chapterId ? chapter : null;
    const fresh = upcomingAssets(current, current ? sceneId : null, party ?? []).filter((url) => !asked.has(url));
    if (fresh.length === 0) return;
    // After whatever the scene itself is loading, not alongside it. Marked as
    // asked only once started, so a scene left before then is not skipped.
    const start = (): void => {
      for (const url of fresh) asked.add(url);
      void warm(fresh, { lanes: 2 });
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(start, { timeout: 4_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(start, 1_500);
    return () => clearTimeout(timer);
    // `party` is read through `partyKey`: a new array every patch, the same figures.
  }, [enabled, chapter, chapterId, sceneId, partyKey]);
}

/** Test seam: forget what this page has asked for. */
export function resetPrefetched(): void {
  asked.clear();
}
