/**
 * Hero looks' coat masks (docs/hero-looks.md §4, §5.1): which part of each species takes her
 * chosen colour, and which paintings have a mask to colour it through.
 *
 * Both are assets/manifest.json → `coatMasks`, the one place the art tools read too
 * (tools/art/coat.py: `art:coat-draft`, `art:verify`, `art:sheet`). A painting not listed has
 * no mask and draws as painted: never ask for one that does not exist.
 *
 * Keyed by painting URL, so it sits under whichever resolver picked the painting
 * (`characterArtUrl`, `characterWorldArtUrl`, `characterPortraitArtUrl`): ask
 * `coatMaskUrl(paintingUrl)`. Kept out of art-paths.ts, which the service worker concatenates
 * and so cannot import JSON.
 */

import type { SpeciesId } from "@kad/shared";
import { coatMasks } from "../../../../assets/manifest.json";

/** The part of a species that takes her colour (§4.2). The code says `coat` whatever it is. */
export type CoatRegion = "coat" | "mane" | "scales" | "feathers" | "fur";

interface CoatRegionEntry {
  region: CoatRegion;
  /** The species palette slot `art:coat-draft` picks the region out by. Art-tool only. */
  draftFrom: string;
  /** False until the region is confirmed on the species' clean masks. */
  confirmed: boolean;
}

const REGIONS = coatMasks.regions as Record<SpeciesId, CoatRegionEntry>;

/** Paintings with a shipped mask, as paths under /assets/. */
const MASKED: ReadonlySet<string> = new Set(coatMasks.paintings as readonly string[]);

/** Which part of a species her colour goes on (§4.2). */
export function coatRegionOf(species: SpeciesId): CoatRegion {
  return REGIONS[species].region;
}

function assetPath(paintingUrl: string): string | null {
  return paintingUrl.startsWith("/assets/") ? paintingUrl.slice("/assets/".length) : null;
}

/** Whether a painting (by its URL, `/assets/...`) has a coat mask. */
export function hasCoatMask(paintingUrl: string): boolean {
  const path = assetPath(paintingUrl);
  return path !== null && MASKED.has(path);
}

/**
 * Where a painting's mask would be (§4.2), whether or not it has one: `x/assembled.png` →
 * `x/coat-mask.png`, a gear portrait's `x/<species>.png` → `x/<species>.coat-mask.png`.
 * Use `coatMaskUrl` to fetch one.
 */
export function maskPathBeside(painting: string): string {
  return painting.endsWith("/assembled.png")
    ? painting.slice(0, -"assembled.png".length) + "coat-mask.png"
    : painting.replace(/\.png$/, ".coat-mask.png");
}

/** The mask for a painting (by its URL), or null when it has none and draws as painted. */
export function coatMaskUrl(paintingUrl: string): string | null {
  return hasCoatMask(paintingUrl) ? maskPathBeside(paintingUrl) : null;
}
