/**
 * What a moment of play reveals to the Field Guide (epic #101).
 *
 * Pure and I/O-free: the engine runs in Lambda and the validator in Node, and
 * both pass in the bestiary / world data they have already loaded. Both call
 * these functions, so "what a chapter discovers" has exactly one definition.
 *
 * Rules (each returns canon ids, deduplicated, in a stable order):
 *   - chapter start: the chapter's `biome` -> its canon id via world `places`
 *   - scene entry / encounter start: the creatures of an encounter's enemies
 *     (`EnemySpec.creature` -> `bestiary.creatures[..].canon_id`), in enemy
 *     order, then the scene's explicit `discovers`
 *
 * The server calls `chapterStartDiscoveries` when a chapter begins and
 * `sceneDiscoveries` on every scene entry (an encounter's start is its scene's
 * entry), and merges into the household's guide idempotently (server handlers/field-guide.ts). Ids that are not in
 * the field guide are the validator's concern, not filtered here.
 *
 * Only type imports: this file is also loaded directly by tools/content/validate.mjs.
 */

import type { Bestiary } from "./bestiary.js";
import type { Chapter, Scene } from "./types/chapter.js";
import type { WorldMap } from "./types/world.js";

/** Drop repeats, keep first-seen order. */
function unique(ids: Iterable<string>): string[] {
  return [...new Set(ids)];
}

/** The canon id of the chapter's biome, when `world.places` knows it. */
export function chapterStartDiscoveries(
  chapter: Pick<Chapter, "biome">,
  world: Pick<WorldMap, "places"> | null | undefined,
): string[] {
  const id = world?.places?.[chapter.biome]?.id;
  return id ? [id] : [];
}

/**
 * What entering `scene` reveals: its enemies' creatures (encounters only, via
 * the bestiary), then its explicit `discovers`.
 */
export function sceneDiscoveries(
  scene: Pick<Scene, "type"> & { discovers?: string[]; enemies?: { creature?: string }[] },
  bestiary: Pick<Bestiary, "creatures"> | null | undefined,
): string[] {
  const ids: string[] = [];
  if (scene.type === "encounter") {
    for (const enemy of scene.enemies ?? []) {
      const canon = enemy.creature ? bestiary?.creatures?.[enemy.creature]?.canon_id : undefined;
      if (canon) ids.push(canon);
    }
  }
  ids.push(...(scene.discovers ?? []));
  return unique(ids);
}

/** Everything a chapter can reveal, for tooling: start discoveries, then each scene's. */
export function chapterDiscoveries(
  chapter: Pick<Chapter, "biome" | "scenes">,
  world: Pick<WorldMap, "places"> | null | undefined,
  bestiary: Pick<Bestiary, "creatures"> | null | undefined,
): string[] {
  return unique([
    ...chapterStartDiscoveries(chapter, world),
    ...Object.values(chapter.scenes).flatMap((scene) => sceneDiscoveries(scene, bestiary)),
  ]);
}
