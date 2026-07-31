/**
 * Where the commissioned art lives, as URLs.
 *
 * Split out of `actor-art.ts` because that module imports Pixi: the screens
 * show real creatures now (species cards, the creation preview, the lobby
 * lineup), and a React component asking "what is the URL of a unicorn?" must
 * not drag the whole renderer into the main bundle — WorldView lazy-loads
 * PixiStage precisely so the join screen is interactive before pixi.js has
 * finished downloading.
 *
 * So: no imports, no side effects, string in / string out. `actor-art.ts`
 * re-exports the two the stage uses, and nothing has two spellings of a path.
 *
 * Paths mirror `assets/` exactly (docs/art-pipeline.md §2). In development the
 * dev server serves that directory at `/assets`; in production CloudFront
 * serves the same prefix from S3 — deliberately the same URL in both, which is
 * why these are plain absolute paths and not build-time imports.
 */

import type { SpeciesId, TierId } from "@kad/shared";

/** The full 1024×1024 figure, registered to the canvas. What the stage draws. */
export function characterArtUrl(species: SpeciesId, tier: TierId): string {
  return `/assets/characters/${species}/${tier}/assembled.png`;
}

/**
 * The derived card-sized cutout (tools/art/portraits.py): trimmed, squared,
 * 384px, ~25KB. What the DOM draws. Always paired with `characterArtUrl` as a
 * fallback — see `screens/CreatureImage.tsx` — because a portrait is a
 * derivation that can be stale or absent, and a species with no picture is a
 * worse bug than a species with a slow one.
 */
export function characterPortraitUrl(species: SpeciesId, tier: TierId): string {
  return `/assets/characters/${species}/${tier}/portrait.webp`;
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

/** A biome's painted backdrop. Used by the Pixi scene and as a CSS backdrop. */
export function biomeBackdropUrl(biome: string): string {
  return `/assets/biomes/${biome}/bg.webp`;
}

/**
 * An effect sprite sheet: `frames` square cells of `size` px in one horizontal
 * strip (assets/manifest.json → effects). CSS animates it with `steps()`, which
 * needs both numbers — see `EFFECT_SHEETS`.
 */
export function effectSheetUrl(id: string): string {
  return `/assets/effects/${id}.sheet.png`;
}

export interface EffectSheet {
  readonly id: string;
  readonly frames: number;
  readonly fps: number;
  readonly size: number;
}

/**
 * The sheets the DOM plays. A copy of the manifest's numbers, not a fetch: two
 * fields for one looping decoration is not worth a network round trip on the
 * screen a child is looking at, and `art-urls.test.ts` fails if this and
 * `assets/manifest.json` ever disagree.
 *
 * Only the per-species auras are listed. The combat effects are the board's,
 * and the board reads the manifest through Pixi.
 */
export const SPECIES_AURAS: Readonly<Record<SpeciesId, EffectSheet>> = {
  unicorn: { id: "aura_unicorn", frames: 12, fps: 12, size: 256 },
  dragonling: { id: "aura_dragonling", frames: 12, fps: 12, size: 256 },
  griffin: { id: "aura_griffin", frames: 12, fps: 12, size: 256 },
  bigfoot: { id: "aura_bigfoot", frames: 12, fps: 12, size: 256 },
  kitsune: { id: "aura_kitsune", frames: 12, fps: 12, size: 256 },
  manticore: { id: "aura_manticore", frames: 12, fps: 12, size: 256 },
};

/**
 * The biome behind character creation and the home screen.
 *
 * Creation happens before any chapter is loaded, so there is no authored biome
 * to read — this is a set dressing choice, and Bramblewood (`enchanted_woods`)
 * is where the committed campaign opens. When creation eventually knows which
 * chapter it is a prologue to, this becomes that chapter's biome and the
 * callers do not change.
 */
export const CREATION_BIOME = "enchanted_woods";
