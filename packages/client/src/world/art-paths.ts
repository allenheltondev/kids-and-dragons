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

import type { SpeciesId, TierId } from "@kad/shared";

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

export function characterArtUrl(species: SpeciesId, tier: TierId = STARTING_TIER): string {
  return `/assets/characters/${species}/${tier}/assembled.png`;
}

/**
 * The rigged character — the Rive file rive-mcp builds from the same tier's
 * registered parts against `assets/manifest.json`'s rigContract. Sits beside
 * `assembled.png` on purpose: the PNG is the rig's own fallback, so the two
 * living in one directory is the statement that they are the same character.
 */
export function characterRigUrl(species: SpeciesId, tier: TierId = STARTING_TIER): string {
  return `/assets/characters/${species}/${tier}/rig.riv`;
}

/**
 * Enemy cutouts. A chapter authors `art: "enemies/will_o_wisp"`; the files
 * live in `assets/entities/<id>/assembled.png`, so the prefix is convention,
 * not a directory — strip it if present, trust the rest.
 */
export function enemyArtUrl(artId: string): string {
  const id = artId.startsWith("enemies/") ? artId.slice("enemies/".length) : artId;
  return `/assets/entities/${id}/assembled.png`;
}

/** The 1920×1080 backdrop for a biome (asset-brief §4.5). */
export function biomeBackdropUrl(biome: string): string {
  return `/assets/biomes/${biome}/bg.webp`;
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
