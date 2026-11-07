/**
 * The coat-mask lookup is a contract with assets/manifest.json → coatMasks (docs/hero-looks.md
 * §4): every species names its two parts (main and accent), every listed painting is one a hero
 * resolver can draw, and a painting with no listed mask never yields a mask URL.
 */

import { describe, expect, it } from "vitest";
import type { ClassId, SpeciesId, TierId } from "@kad/shared";
import manifest from "../../../../assets/manifest.json";
import { characterArtUrl, gearPortraitUrl } from "./art-paths";
import { coatMaskUrl, coatPartLabel, coatPartSlots, coatPartsOf, coatRegionOf, hasCoatMask, maskPathBeside, paintingIsCutOut } from "./coat-masks";

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
  it("names two parts for every species, as the owner decided for unicorn and Bigfoot", () => {
    for (const { id } of manifest.species) {
      const parts = coatPartsOf(id as SpeciesId);
      expect(parts.main.region, id).toBeTruthy();
      expect(parts.accent.region, id).toBeTruthy();
      expect(parts.main.region, id).not.toBe(parts.accent.region);
    }
    expect([coatPartLabel("unicorn", "main"), coatPartLabel("unicorn", "accent")]).toEqual(["Coat", "Mane"]);
    expect([coatPartLabel("bigfoot", "main"), coatPartLabel("bigfoot", "accent")]).toEqual(["Fur", "Skin"]);
  });

  it("names each part by a plain name and drafts it from a real palette slot", () => {
    for (const { id, palette } of manifest.species) {
      const parts = coatPartsOf(id as SpeciesId);
      expect(coatRegionOf(id as SpeciesId)).toEqual({ main: parts.main.region, accent: parts.accent.region });
      for (const part of ["main", "accent"] as const) {
        const slots = coatPartSlots(id as SpeciesId, part);
        expect(slots.length, `${id} ${part}`).toBeGreaterThan(0);
        for (const slot of slots) expect((palette as Record<string, string>)[slot], `${id} ${slot}`).toMatch(/^#/);
      }
    }
    expect(coatRegionOf("unicorn")).toEqual({ main: "coat", accent: "mane" });
    expect(coatRegionOf("bigfoot")).toEqual({ main: "fur", accent: "skin" });
  });

  it("knows a cut-out painting, whose alpha is her figure, from an opaque gear portrait", () => {
    expect(paintingIsCutOut("/assets/characters/unicorn/fledgling/assembled.png")).toBe(true);
    expect(paintingIsCutOut("/assets/character-rigs/thornguard/sworn/bigfoot/assembled.png")).toBe(true);
    expect(paintingIsCutOut("/assets/gear-portraits/thornguard/sworn/bigfoot.png")).toBe(false);
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
