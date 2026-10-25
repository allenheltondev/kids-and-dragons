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
 *     order, then the scene's explicit `discovers`, then, for a class place
 *     (a scene marked `classPlace`), the place itself and the class it teaches
 *   - a party member wearing a class: that class's entry (`partyClassDiscoveries`),
 *     which the server reads at a chapter's start and whenever the party's
 *     classes change
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
import type { ClassId } from "./types/domain.js";
import type { WorldMap } from "./types/world.js";

/**
 * The Field Guide entry of each class (`class.*` in canon/classes.yaml). A
 * class entry shows once the class is encountered: a hero wears it, or the
 * party has been to its class place. Canon's `canon:check` and the field-guide
 * tests hold these ids to real entries.
 */
export const CLASS_GUIDE_ID: Readonly<Record<ClassId, string>> = {
  thornguard: "class.thornguard",
  starweaver: "class.starweaver",
  duskrunner: "class.duskrunner",
  songkeeper: "class.songkeeper",
};

/**
 * The Field Guide entry of each class place, the room that teaches it
 * (docs/class-mastery.md §2). Found the first time a party walks into the
 * room, like any other place; the class entry only names it from then on.
 */
export const CLASS_PLACE_GUIDE_ID: Readonly<Record<ClassId, string>> = {
  thornguard: "location.dojo",
  starweaver: "location.academy",
  duskrunner: "location.rookery",
  songkeeper: "location.conservatory",
};

/** The class entries for the classes these heroes wear, in seat order, once each. */
export function partyClassDiscoveries(
  party: Iterable<{ character: { class: ClassId } }> | null | undefined,
): string[] {
  const ids: string[] = [];
  for (const member of party ?? []) {
    const id = CLASS_GUIDE_ID[member.character.class];
    if (id) ids.push(id);
  }
  return unique(ids);
}

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
  scene: Pick<Scene, "type"> & { discovers?: string[]; enemies?: { creature?: string }[]; classPlace?: ClassId },
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
  // A class place (a scene marked `classPlace`) is the class's room: walking in
  // finds the room, and finds the class it teaches, whoever is wearing what.
  if (scene.classPlace && CLASS_PLACE_GUIDE_ID[scene.classPlace]) {
    ids.push(CLASS_PLACE_GUIDE_ID[scene.classPlace], CLASS_GUIDE_ID[scene.classPlace]);
  }
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
