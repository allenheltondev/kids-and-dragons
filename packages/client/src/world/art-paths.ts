/**
 * Where the commissioned art lives, and the canvas contract it is drawn on.
 *
 * Split out of `actor-art.ts` for one reason: that module imports `pixi.js` for
 * its placeholder Graphics, and `screens/` now draws the same art as plain
 * `<img>` elements — the species portraits in creation, the party lineup in the
 * lobby, the face on your sheet. Importing a URL helper must never drag the
 * renderer into the main bundle (WorldView loads PixiStage lazily precisely so
 * it does not, see layout/WorldView.tsx), so anything both sides need lives
 * here and nothing here imports Pixi.
 *
 * Every path is a fact about `assets/`, which `assets/manifest.json` and
 * docs/art-pipeline.md own. Nothing derives a filename anywhere else.
 */

import type { Chapter, ClassId, RunState, SpeciesId, TierId } from "@kad/shared";

/** assets/manifest.json → canvas. */
export const CANVAS = { width: 1024, height: 1024, originX: 512, originY: 900 } as const;
export const ANCHOR_X = CANVAS.originX / CANVAS.width;
export const ANCHOR_Y = CANVAS.originY / CANVAS.height;

/**
 * The tier every character starts at (content/rules.json → tierLevels, level 1).
 * It is what creation has to draw: the draft has no level yet, and the hero the
 * player is building is a fledgling by definition.
 */
export const STARTING_TIER: TierId = "fledgling";

/**
 * The tiers that have painted art, in level order. Ascendant, starborn and
 * legendary (levels 15, 20 and 30, spec §8.1) are rules before they are
 * pictures, so a hero past Mythic is drawn as Mythic until theirs is
 * commissioned: add a tier here when its art lands. Lives here, not in
 * @kad/shared, because the service worker concatenates this file and cannot
 * import at runtime.
 */
const ART_TIERS: readonly TierId[] = ["fledgling", "sworn", "radiant", "mythic"];

/** The tier whose art draws a hero of `tier`: itself, or Mythic, the highest painted. */
export function artTierOf(tier: TierId): TierId {
  return ART_TIERS.includes(tier) ? tier : "mythic";
}

export function characterArtUrl(species: SpeciesId, tier: TierId = STARTING_TIER): string {
  return `/assets/characters/${species}/${artTierOf(tier)}/assembled.png`;
}

/**
 * Class figures are commissioned one exact species/class/tier combination at a
 * time. This set is intentionally tested against manifest.figureVariants: the
 * runtime stays tiny while the manifest remains the source of truth.
 */
// Every commissioned class/tier group currently has the full species roster.
// The manifest coverage test guards this compact representation.
const CLASS_FIGURE_VARIANTS = new Set<string>(
  [
  "starweaver/mythic",
  "songkeeper/mythic",
  "songkeeper/radiant",
  "songkeeper/sworn",
  "starweaver/radiant",
  "duskrunner/mythic",
  "duskrunner/radiant",
  "duskrunner/sworn",
  "starweaver/sworn",
  "thornguard/mythic",
  "thornguard/radiant",
  "thornguard/sworn"
].flatMap(prefix=>
    ["bigfoot", "dragonling", "griffin", "kitsune", "manticore", "unicorn"].map(species=>prefix+"/"+species),
  ),
);

function classFigureKey(species: SpeciesId, tier: TierId, characterClass: ClassId): string {
  return `${characterClass}/${artTierOf(tier)}/${species}`;
}

function hasClassFigure(species: SpeciesId, tier: TierId, characterClass?: ClassId): boolean {
  return (
    characterClass !== undefined &&
    CLASS_FIGURE_VARIANTS.has(classFigureKey(species, tier, characterClass))
  );
}

/** The still-image fallback matching the illustration selected for a world figure. */
export function characterWorldArtUrl(
  species: SpeciesId,
  tier: TierId = STARTING_TIER,
  characterClass?: ClassId,
): string {
  if (hasClassFigure(species, tier, characterClass)) {
    return `/assets/character-rigs/${characterClass}/${artTierOf(tier)}/${species}/assembled.png`;
  }
  return characterArtUrl(species, tier);
}

/**
 * Approved purpose-drawn class-gear variants exist for every species and geared
 * tier. They are complete opaque illustrations, not rig parts, so this path is
 * deliberately separate from `assets/gear/` and is consumed only by portrait
 * surfaces.
 *
 * Returning `null` is part of the contract: fledglings wear no class gear,
 * while every ClassId has an accepted Sworn, Radiant, and Mythic variant.
 * Callers can fall back to the species/tier art without probing a fledgling URL
 * known not to exist.
 */
export function gearPortraitUrl(
  species: SpeciesId,
  characterClass: ClassId,
  tier: TierId,
): string | null {
  if (tier === "fledgling") return null;
  return `/assets/gear-portraits/${characterClass}/${artTierOf(tier)}/${species}.png`;
}

/** The best commissioned still image available for a resolved character. */
export function characterPortraitArtUrl(
  species: SpeciesId,
  tier: TierId = STARTING_TIER,
  characterClass?: ClassId,
): string {
  return (
    (characterClass === undefined ? null : gearPortraitUrl(species, characterClass, tier)) ??
    characterArtUrl(species, tier)
  );
}

/**
 * Enemy cutouts. A chapter authors `art: "enemies/will_o_wisp"`; the files
 * live in `assets/entities/<id>/assembled.png`, so the prefix is convention,
 * not a directory — strip it if present, trust the rest.
 */
export function enemyArtUrl(artId: string): string {
  if (artId.startsWith("cast/")) return `/assets/${artId}/assembled.png`;
  const id = artId.startsWith("enemies/") ? artId.slice("enemies/".length) : artId;
  return `/assets/entities/${id}/assembled.png`;
}

/** The 1920×1080 backdrop for a biome (asset-brief §4.5). */
export function biomeBackdropUrl(biome: string): string {
  return `/assets/biomes/${biome}/bg.webp`;
}

/** Scene illustrations or a story-only biome background, without changing combat terrain. */
export function sceneBackdropUrl(art: string): string | null {
  return /^(?:scenes\/[a-z0-9_-]+\/[a-z0-9_-]+|biomes\/[a-z0-9_]+\/bg)$/.test(art)
    ? `/assets/${art}.webp` : null;
}

/** Story art follows the scene; combat always uses the chapter's terrain. */
export function sceneArtFor(chapter: Chapter | null, state: RunState | null): string | null {
  if (!chapter || chapter.id !== state?.chapterId || !state.sceneId || state.encounter) return null;
  const scene = chapter.scenes[state.sceneId];
  return scene && scene.type !== "encounter" ? scene.art ?? null : null;
}

/** The 4×4 combat tile sheet for a biome — floor row, then blocked row. */
export function biomeTilesUrl(biome: string): string {
  return `/assets/biomes/${biome}/tiles.png`;
}

/**
 * The biome creation happens in when nothing else says otherwise.
 *
 * A draft character belongs to no chapter yet — there is no run state to read a
 * biome off — but the preview still has to stand somewhere, and a hero floating
 * in a void is the thing this file exists to stop. `enchanted_woods` is the
 * reference chapter's biome (spec §6.2); once a chapter *is* loaded the preview
 * uses that instead, so this is a first-frame default, not a hardcoded setting.
 */
export const CREATION_BIOME = "enchanted_woods";

/** Shared by the cast stage and offline chapter warming. */
export function castArtUrl(figure: string): string | null {
 const match=/^(entities|characters|cast)\/([a-z0-9]+(?:[_-][a-z0-9]+)*)$/.exec(figure);
 if(!match)return null;
 const [,kind,id]=match;
 return kind==="characters" ? "/assets/characters/"+id+"/fledgling/assembled.png" : "/assets/"+kind+"/"+id+"/assembled.png";
}
