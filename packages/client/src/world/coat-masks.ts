/**
 * Hero looks' coat masks (docs/hero-looks.md §4, §5.1): which two parts of each species take her
 * chosen colours, and which paintings have a mask to colour them through.
 *
 * Both are assets/manifest.json → `coatMasks`, the one place the art tools read too
 * (tools/art/coat.py: `art:coat-draft`, `art:verify`, `art:sheet`). A painting not listed has
 * no mask and draws as painted: never ask for one that does not exist.
 *
 * A mask is 8-bit RGB on its painting's canvas (owner, 2026-11-07): **red** is her main part,
 * **green** her accent part, **blue** her whole figure (her painting's alpha on a transparent
 * painting; everything but the backdrop on an opaque gear portrait). `coatMasks.regions[species]`
 * names the two parts: `{ main: { region, draftFrom, confirmed }, accent: { ... } }`, where
 * `region` is the part's plain name ("coat" and "mane" for a unicorn, "fur" and "skin" for a
 * Bigfoot), which the editors show as the shelves' labels.
 *
 * Keyed by painting URL, so it sits under whichever resolver picked the painting
 * (`characterArtUrl`, `characterWorldArtUrl`, `characterPortraitArtUrl`): ask
 * `coatMaskUrl(paintingUrl)`. Where a build has them the resolvers hand out a painting's
 * full-size WebP (`x@1x.webp`, art-paths.ts `fitArt`); its mask is the painting's, so every
 * question here is answered for the painting it was made from. The path rule itself (`maskPathBeside`, `coatMaskFor`) is in
 * art-paths.ts, which the service worker concatenates and so can use without the JSON.
 */

import type { CoatPart, SpeciesId } from "@kad/shared";
import { coatMasks } from "../../../../assets/manifest.json";
import { coatMaskFor, maskPathBeside, paintingOfCopy } from "./art-paths";

export { maskPathBeside };

/** The name of a part (§4.2), shown to the kid as its shelf's label, capitalised. */
export type CoatRegion = "coat" | "mane" | "scales" | "feathers" | "fur" | "skin" | "wings" | "tails" | "tail" | "belly";

/** One of her two parts, as the manifest names it. */
export interface CoatPartEntry {
  /** The part's plain name: "coat", "mane", "fur", "skin". The shelf's label, capitalised. */
  region: CoatRegion;
  /** The species palette slot (or slots) `art:coat-draft` picks the part out by. Art-tool only (and the palette test's stand-in). */
  draftFrom: string | readonly string[];
  /** False until the part is confirmed on the species' clean masks. */
  confirmed: boolean;
}

/** A species' two parts. */
export type CoatParts = Record<CoatPart, CoatPartEntry>;

/** A species' two part names: the main (the mask's red) and the accent (its green). */
export interface CoatRegions {
  main: CoatRegion;
  accent: CoatRegion;
}

const REGIONS = coatMasks.regions as unknown as Record<SpeciesId, CoatParts>;

/** Paintings with a shipped mask, as paths under /assets/. */
const SHIPPED: readonly string[] = coatMasks.paintings as readonly string[];
let masked: ReadonlySet<string> = new Set(SHIPPED);

/** Her two parts (§4.2): which part of her each of her colours goes on, and how the draft finds it. */
export function coatPartsOf(species: SpeciesId): CoatParts {
  return REGIONS[species];
}

/** Which parts of a species her colours go on (§4.2), by name. */
export function coatRegionOf(species: SpeciesId): CoatRegions {
  return { main: REGIONS[species].main.region, accent: REGIONS[species].accent.region };
}

/**
 * The palette slots a part is painted in, as a list: one for most parts, several where a part
 * spans two painted colours (a Bigfoot's fur is his cream body and his brown mane).
 */
export function coatPartSlots(species: SpeciesId, part: CoatPart): readonly string[] {
  const from = REGIONS[species][part].draftFrom;
  return typeof from === "string" ? [from] : from;
}

/** A part's name as a shelf says it: "Coat", "Mane", "Fur", "Skin". */
export function coatPartLabel(species: SpeciesId, part: CoatPart): string {
  const name = REGIONS[species][part].region;
  return `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
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
 * Whether a painting is transparent around her figure, so its own alpha is her figure (the mask's
 * blue channel matches it there): every `assembled.png`, base and class. A gear portrait is
 * painted on an opaque backdrop, and only its mask knows where she ends. The same of a
 * painting's full-size WebP (art-paths.ts `fitArt`), whose alpha is the painting's exactly.
 */
export function paintingIsCutOut(paintingUrl: string): boolean {
  return /\/assembled\.png$/.test(paintingOfCopy(paintingUrl.replace(/[?#].*$/, "")));
}

/**
 * Test seam: pretend these paintings (paths under assets/) have masks, as a later art wave's
 * manifest will list them; null goes back to the manifest's own list. No real hero has a
 * shipped mask yet (#667, #668), so every test of a coloured hero runs on a list of its own.
 */
export function setCoatMaskPaintings(paths: readonly string[] | null): void {
  masked = new Set(paths ?? SHIPPED);
}
