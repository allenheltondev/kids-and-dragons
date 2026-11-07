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
 * `coatMaskUrl(paintingUrl)`. The path rule itself (`maskPathBeside`, `coatMaskFor`) is in
 * art-paths.ts, which the service worker concatenates and so can use without the JSON.
 */

import type { SpeciesId } from "@kad/shared";
import { coatMasks } from "../../../../assets/manifest.json";
import { coatMaskFor, maskPathBeside } from "./art-paths";

export { maskPathBeside };

/**
 * The name of a part of a species that takes a colour (§4.2), shown to the kid as its shelf
 * label (capitalised). The mask's R channel is her main part, G her accent part, B her figure.
 */
export type CoatRegion = "coat" | "mane" | "scales" | "feathers" | "fur" | "skin" | "wings" | "tails" | "tail" | "belly";

interface CoatRegionEntry {
  region: CoatRegion;
  /** The species palette slot (or slots) `art:coat-draft` picks the part out by. Art-tool only. */
  draftFrom: string | string[];
  /** False until the part is confirmed on the species' clean masks. */
  confirmed: boolean;
}

/** A species' two colourable parts: the main (the mask's R) and the accent (its G). */
export interface CoatRegions {
  main: CoatRegion;
  accent: CoatRegion;
}

const REGIONS = coatMasks.regions as Record<SpeciesId, { main: CoatRegionEntry; accent: CoatRegionEntry }>;

/** Paintings with a shipped mask, as paths under /assets/. */
const SHIPPED: readonly string[] = coatMasks.paintings as readonly string[];
let masked: ReadonlySet<string> = new Set(SHIPPED);

/** Which parts of a species her colours go on (§4.2). */
export function coatRegionOf(species: SpeciesId): CoatRegions {
  return { main: REGIONS[species].main.region, accent: REGIONS[species].accent.region };
}

/** The paintings with a mask, as paths under /assets/ (the manifest's list, or a test's). */
export function coatMaskPaintings(): readonly string[] {
  return [...masked];
}

/** Whether a painting (by its URL, `/assets/...`) has a coat mask. */
export function hasCoatMask(paintingUrl: string): boolean {
  return coatMaskFor(paintingUrl, masked) !== null;
}

/** The mask for a painting (by its URL), or null when it has none and draws as painted. */
export function coatMaskUrl(paintingUrl: string): string | null {
  return coatMaskFor(paintingUrl, masked);
}

/**
 * Test seam: pretend these paintings (paths under assets/) have masks, as a later art wave's
 * manifest will list them; null goes back to the manifest's own list. No real hero has a
 * shipped mask yet (#667, #668), so every test of a coloured hero runs on a list of its own.
 */
export function setCoatMaskPaintings(paths: readonly string[] | null): void {
  masked = new Set(paths ?? SHIPPED);
}
