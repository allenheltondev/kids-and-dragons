/**
 * Every picture a chapter can draw, as a pure function of the chapter and who
 * is in the party. Two callers: the TV warming the chapter it is starting
 * (`useWarmChapter`, prefetch.ts) and the installed phone's worker warming
 * the household's next chapter overnight (`periodicsync`, sw.ts).
 *
 * The worker cannot import, so `sw-build.ts` concatenates this file (with
 * `world/art-paths.ts`, whose URL helpers it calls) into `sw.js` and drops
 * the `import`/`export` lines. Nothing here may import anything at runtime
 * beyond the URL helpers and generated art list, and every name here is a global in the worker.
 */

import type { Chapter, ResolvedCharacter } from "@kad/shared";
import { castArtUrl, biomeBackdropUrl, biomeTilesUrl, characterWorldArtUrl, enemyArtUrl, sceneBackdropUrl } from "../world/art-paths";

/** What a figure's art depends on: a seated party member, or a hero from the journal. */
export interface FigureOf {
  character: Pick<ResolvedCharacter, "species" | "tier" | "class">;
}

/**
 * Everything the chapter can draw, whichever road the party takes: the party's
 * figures, and for every scene its backdrop (or the biome's) and, for a fight,
 * its enemies and the biome's tiles. Each scene is visited once, in the
 * chapter's own order, so the entry's art comes first.
 */
export function chapterAssets(chapter: Chapter | null, party: readonly FigureOf[]): string[] {
  const urls = new Set<string>();
  for (const { character } of party) {
    urls.add(characterWorldArtUrl(character.species, character.tier, character.class));
  }
  if (!chapter) return [...urls];
  const order = [chapter.entry, ...Object.keys(chapter.scenes)];
  const seen = new Set<string>();
  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const scene = chapter.scenes[id];
    if (!scene) continue;
    urls.add((scene.art ? sceneBackdropUrl(scene.art) : null) ?? biomeBackdropUrl(chapter.biome));
    for(const member of ("cast" in scene ? scene.cast ?? [] : [])) {
      const url=castArtUrl(member.figure);if(url)urls.add(url);
      if(member.figure==="entities/skywardens")for(const id of ["skywarden_griffin","skywarden_faun","skywarden_centaur"])urls.add("/assets/cast/"+id+"/assembled.png");
    }
    if (scene.type === "encounter") {
      urls.add(biomeTilesUrl(chapter.biome));
      for (const enemy of scene.enemies) {const art=enemy.art ?? (enemy.creature ? "enemies/"+enemy.creature : null);if(art)urls.add(enemyArtUrl(art));}
    }
    // Presentation props and tracking coverIcons are registered story-prop
    // assets, so their declared kind determines the URL without name guessing.
    const appearance = chapter.presentation?.interactions?.[id];
    for (const prop of appearance?.props ?? []) urls.add(`/assets/story-props/${prop}.webp`);
    for (const icon of appearance?.coverIcons ?? []) urls.add(`/assets/story-props/${icon}.webp`);
  }
  for(const url of chapter.presentation?.warmUrls ?? [])urls.add(url);
  return [...urls];
}
