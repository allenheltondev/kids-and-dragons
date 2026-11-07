/**
 * The starter colours (docs/hero-looks.md §7.1): every one stands out from
 * every backdrop a hero stands on, and within a species' set every pair is
 * told apart under normal vision and under simulated deuteranopia,
 * protanopia and tritanopia.
 *
 * **Measured on the rendered hero, as nearly as can be without her masks.**
 * The design measures each colour as the mean of her coloured region, applied
 * to her base painting at the size a phone's portrait draws it. No real mask
 * is shipped yet (#667, #668), so the hero here is a stand-in: a body painted
 * in her species' own region colour (the manifest palette slot `art:coat-draft`
 * picks the region by), with painted shading and a soft-edged mask, at 96
 * pixels (a phone portrait's well), tinted by this tinter and averaged in
 * linear light as the screen does. When the masks land, swap the stand-in for
 * the base painting and its mask; the thresholds stay.
 *
 * The backdrops are coat-backdrops.fixture.json: the ground band of every
 * biome background and camp backdrop, measured by tools/art/backdrop-grounds.py.
 * Colour-blind vision is Machado, Oliveira and Fernandes (2009) at full
 * severity, applied in linear sRGB.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { coatPaintOf } from "@kad/shared";
import type { CoatPaint, SpeciesId } from "@kad/shared";
import manifest from "../../../../assets/manifest.json";
import grounds from "./coat-backdrops.fixture.json";
import { LOOKS } from "./hero-name";
import { coatRegionStats, tintCoatPixels } from "./hero-coat";
import { hexToOklab, linearToOklab, oklabDistance, oklabToLinear, type Lab } from "./oklab";
import { regionMean, syntheticPainting } from "../testing/coat-fixture";

const SPECIES = manifest.species.map((s) => s.id) as SpeciesId[];
const PORTRAIT_PX = 96;

/** Machado et al. 2009, severity 1, on linear sRGB. */
const CVD: Record<string, number[][]> = {
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};

function seen(lab: Lab, vision: string): Lab {
  if (vision === "normal") return lab;
  const m = CVD[vision]!;
  const rgb = oklabToLinear(...lab).map((c) => Math.min(1, Math.max(0, c)));
  const out = m.map((row) => Math.min(1, Math.max(0, row[0]! * rgb[0]! + row[1]! * rgb[1]! + row[2]! * rgb[2]!)));
  return linearToOklab(out[0]!, out[1]!, out[2]!);
}

/** Her species' region as painted: the palette slot the draft picks it out by. */
function regionColor(species: SpeciesId): string {
  const slot = (manifest.coatMasks.regions as Record<string, { draftFrom: string }>)[species]!.draftFrom;
  const palette = manifest.species.find((s) => s.id === species)!.palette as Record<string, string>;
  return palette[slot]!;
}

/** The colour on the rendered stand-in hero: her region, tinted, averaged as a phone shows it. */
function rendered(species: SpeciesId, color: string | CoatPaint): Lab {
  const { painting, mask } = syntheticPainting(regionColor(species), PORTRAIT_PX);
  const stats = coatRegionStats(painting.data, mask.data, 4);
  const out = new Uint8ClampedArray(painting.data.length);
  tintCoatPixels(painting.data, mask.data, typeof color === "string" ? { kind: "plain", color } : color, stats, out, { maskStride: 4 });
  return regionMean(out, mask.data);
}

const starters = (species: SpeciesId) => LOOKS.coats.filter((c) => c.species.includes(species) && c.unlock.from === "starter");
const GROUNDS = Object.entries(grounds.grounds).map(([name, hex]) => ({ name, lab: hexToOklab(hex) }));

describe("the starter colours (§7.1)", () => {
  it("are about six per species, every species", () => {
    for (const species of SPECIES) expect(starters(species).length, species).toBe(6);
  });

  it("render as themselves: the region's mean is near the catalog's colour (a dark coat a little lighter, its painted highlights kept)", () => {
    for (const species of SPECIES) {
      for (const coat of starters(species)) {
        expect(oklabDistance(rendered(species, coat.color), hexToOklab(coat.color)), coat.id).toBeLessThan(0.08);
      }
    }
  });

  it("stand out from every backdrop's ground by an OKLab distance of at least 0.10", () => {
    const close: string[] = [];
    for (const species of SPECIES) {
      for (const coat of starters(species)) {
        const lab = rendered(species, coat.color);
        for (const ground of GROUNDS) {
          const d = oklabDistance(lab, ground.lab);
          if (d < 0.1) close.push(`${coat.id} on ${ground.name}: ${d.toFixed(3)}`);
        }
      }
    }
    expect(close).toEqual([]);
  });

  it("are told apart within a species, under normal and colour-blind vision: distance 0.08 or lightness 0.10", () => {
    const alike: string[] = [];
    for (const species of SPECIES) {
      const set = starters(species).map((coat) => ({ id: coat.id, lab: rendered(species, coat.color) }));
      for (const vision of ["normal", ...Object.keys(CVD)]) {
        for (let i = 0; i < set.length; i++) {
          for (let j = i + 1; j < set.length; j++) {
            const a = seen(set[i]!.lab, vision);
            const b = seen(set[j]!.lab, vision);
            const d = oklabDistance(a, b);
            const dl = Math.abs(a[0] - b[0]);
            if (d < 0.08 && dl < 0.1) alike.push(`${set[i]!.id} / ${set[j]!.id} (${vision}): ${d.toFixed(3)}, L ${dl.toFixed(3)}`);
          }
        }
      }
    }
    expect(alike).toEqual([]);
  });

  it("are checked against every backdrop there is: the fixture covers each biome and camp backdrop", () => {
    const assets = fileURLToPath(new URL("../../../../assets/", import.meta.url));
    const biomes = readdirSync(`${assets}biomes`).filter((b) => {
      try {
        return readFileSync(`${assets}biomes/${b}/bg.webp`).length > 0;
      } catch {
        return false;
      }
    });
    const want = [...biomes.map((b) => `biomes/${b}`), ...manifest.camp.backdrops.map((b) => `camp/${b.family}`)].sort();
    expect(Object.keys(grounds.grounds).sort(), "run tools/art/backdrop-grounds.py").toEqual(want);
  });
});

/**
 * The earned colours (§7.1, §5.5; #669): painted as they are worn (a
 * two-tone coat by both its colours, through `coatPaintOf`), each stands out
 * from every backdrop by the starters' rule, and is told apart from each of
 * her species' starters and other earned colours under normal vision, so an
 * earned tile is never a starter again.
 */
describe("the earned colours (§7.1, §5.5)", () => {
  const earned = (species: SpeciesId) => LOOKS.coats.filter((c) => c.species.includes(species) && c.unlock.from !== "starter");

  it("are there for every species: a shimmer and a two-tone each", () => {
    for (const species of SPECIES) {
      const kinds = earned(species).map((c) => c.effect?.kind ?? "plain");
      expect(kinds, species).toContain("shimmer");
      expect(kinds, species).toContain("two-tone");
    }
  });

  it("stand out from every backdrop's ground by an OKLab distance of at least 0.10", () => {
    const close: string[] = [];
    for (const species of SPECIES) {
      for (const coat of earned(species)) {
        const lab = rendered(species, coatPaintOf(coat));
        for (const ground of GROUNDS) {
          const d = oklabDistance(lab, ground.lab);
          if (d < 0.1) close.push(`${coat.id} on ${ground.name}: ${d.toFixed(3)}`);
        }
      }
    }
    expect(close).toEqual([]);
  });

  it("are told apart from her other colours: distance 0.08 or lightness 0.10", () => {
    const alike: string[] = [];
    for (const species of SPECIES) {
      const all = LOOKS.coats.filter((c) => c.species.includes(species)).map((c) => ({ id: c.id, earned: c.unlock.from !== "starter", lab: rendered(species, coatPaintOf(c)) }));
      for (const a of all.filter((c) => c.earned)) {
        for (const b of all) {
          if (a.id === b.id || (b.earned && b.id < a.id)) continue;
          const d = oklabDistance(a.lab, b.lab);
          const dl = Math.abs(a.lab[0] - b.lab[0]);
          if (d < 0.08 && dl < 0.1) alike.push(`${a.id} / ${b.id}: ${d.toFixed(3)}, L ${dl.toFixed(3)}`);
        }
      }
    }
    expect(alike).toEqual([]);
  });
});
