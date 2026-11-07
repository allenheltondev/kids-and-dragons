/**
 * The coat-mask lookup is a contract with assets/manifest.json → coatMasks (docs/hero-looks.md
 * §4): every species names its region, every listed painting is one a hero resolver can draw,
 * and a painting with no listed mask never yields a mask URL.
 */

import { describe, expect, it } from "vitest";
import type { ClassId, SpeciesId, TierId } from "@kad/shared";
import manifest from "../../../../assets/manifest.json";
import { characterArtUrl, gearPortraitUrl } from "./art-paths";
import { coatMaskUrl, coatRegionOf, hasCoatMask, maskPathBeside } from "./coat-masks";

const heroPaintings = (): string[] => {
  const urls: string[] = [];
  for (const { id } of manifest.species) {
    for (const tier of manifest.tiers as TierId[]) urls.push(characterArtUrl(id as SpeciesId, tier));
  }
  for (const v of manifest.figureVariants) {
    urls.push(`/assets/character-rigs/${v.class}/${v.tier}/${v.species}/assembled.png`);
  }
  for (const group of manifest.gearPortraits) {
    for (const tier of group.tiers) {
      for (const species of group.species) {
        urls.push(gearPortraitUrl(species as SpeciesId, group.class as ClassId, tier as TierId)!);
      }
    }
  }
  return urls;
};

describe("coat masks", () => {
  it("names a region for every species, as §4.2 decided for unicorn and Bigfoot", () => {
    for (const { id } of manifest.species) expect(coatRegionOf(id as SpeciesId)).toBeTruthy();
    expect(coatRegionOf("unicorn")).toBe("coat");
    expect(coatRegionOf("bigfoot")).toBe("mane");
  });

  it("lists only paintings a hero is drawn with", () => {
    const known = new Set(heroPaintings());
    for (const painting of manifest.coatMasks.paintings as string[]) {
      expect(known.has(`/assets/${painting}`), painting).toBe(true);
    }
  });

  it("yields a mask URL exactly for the listed paintings", () => {
    const listed = new Set((manifest.coatMasks.paintings as string[]).map(p => `/assets/${p}`));
    for (const url of heroPaintings()) {
      expect(hasCoatMask(url)).toBe(listed.has(url));
      expect(coatMaskUrl(url) !== null).toBe(listed.has(url));
    }
    expect(coatMaskUrl("/assets/characters/unicorn/nonesuch/assembled.png")).toBeNull();
    expect(hasCoatMask("characters/unicorn/fledgling/assembled.png")).toBe(false);
  });

  it("puts the mask beside its painting, as tools/art/coat.py does", () => {
    expect(maskPathBeside("/assets/characters/unicorn/fledgling/assembled.png"))
      .toBe("/assets/characters/unicorn/fledgling/coat-mask.png");
    expect(maskPathBeside("/assets/character-rigs/thornguard/sworn/bigfoot/assembled.png"))
      .toBe("/assets/character-rigs/thornguard/sworn/bigfoot/coat-mask.png");
    expect(maskPathBeside("/assets/gear-portraits/thornguard/sworn/bigfoot.png"))
      .toBe("/assets/gear-portraits/thornguard/sworn/bigfoot.coat-mask.png");
  });
});
