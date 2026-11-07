/**
 * The starter colours (docs/hero-looks.md §7.1; two parts, owner 2026-11-07):
 * every species has a set for her main part and a set for her accent part.
 * Every main colour stands out from every backdrop a hero stands on (her
 * accent is the smaller part, and the main part is what keeps her off the
 * ground), and within each set every pair is told apart under normal vision
 * and under simulated deuteranopia, protanopia and tritanopia. Her two sets
 * are never held against each other: the pair she picks is hers.
 *
 * **Measured on the rendered hero, as nearly as can be without her masks.**
 * The design measures each colour as the mean of her coloured part, applied
 * to her base painting at the size a phone's portrait draws it. No real mask
 * is shipped yet (#667, #668), so the hero here is a stand-in: a body and a
 * mane painted in her species' own part colours (the manifest palette slots
 * `art:coat-draft` picks each part by; a part painted in two slots, as a
 * Bigfoot's fur is, on each of them), with painted shading and soft-edged
 * parts, at 96 pixels (a phone portrait's well), tinted by this tinter and
 * averaged in linear light as the screen does. When the masks land, swap the
 * stand-in for the base painting and its mask; the thresholds stay.
 *
 * The backdrops are coat-backdrops.fixture.json: the ground band of every
 * biome background and camp backdrop, measured by tools/art/backdrop-grounds.py.
 * Colour-blind vision is Machado, Oliveira and Fernandes (2009) at full
 * severity, applied in linear sRGB.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CoatPart, SpeciesId } from "@kad/shared";
import manifest from "../../../../assets/manifest.json";
import grounds from "./coat-backdrops.fixture.json";
import { LOOKS } from "./hero-name";
import { MASK_CHANNEL, coatRegionStats, heroRegionStats, tintCoatPixels, tintHeroPixels } from "./hero-coat";
import { coatPartSlots } from "./coat-masks";
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

/**
 * Her stand-ins: one for every pairing of the palette slots her two parts are
 * painted in. Most parts are one slot; a part that spans two (a Bigfoot's fur
 * is his cream body and his brown mane) is checked on each, since a colour
 * must work on all of the part it covers.
 */
function standIns(species: SpeciesId): { main: string; accent: string }[] {
  const palette = manifest.species.find((s) => s.id === species)!.palette as Record<string, string>;
  const out: { main: string; accent: string }[] = [];
  for (const main of coatPartSlots(species, "main")) for (const accent of coatPartSlots(species, "accent")) out.push({ main: palette[main]!, accent: palette[accent]! });
  return out;
}

const OFFSET: Record<CoatPart, number> = { main: MASK_CHANNEL.main, accent: MASK_CHANNEL.accent };

/** The colour on stand-in `k`: her part, tinted, averaged as a phone shows it. */
function rendered(species: SpeciesId, part: CoatPart, color: string, k: number): Lab {
  const stand = standIns(species)[k]!;
  const { painting, mask } = syntheticPainting(stand.main, PORTRAIT_PX, stand.accent);
  const stats = coatRegionStats(painting.data, mask.data, 4, OFFSET[part]);
  const out = new Uint8ClampedArray(painting.data.length);
  tintCoatPixels(painting.data, mask.data, color, stats, out, { maskStride: 4, maskOffset: OFFSET[part] });
  return regionMean(out, mask.data, 4, OFFSET[part]);
}

/** Every stand-in of a species, by index. */
const stands = (species: SpeciesId): number[] => [...standIns(species).keys()];

const PARTS: readonly CoatPart[] = ["main", "accent"];
const starters = (species: SpeciesId, part: CoatPart) => LOOKS.coats.filter((c) => c.species.includes(species) && c.part === part && c.unlock.from === "starter");
const earned = (species: SpeciesId, part: CoatPart) => LOOKS.coats.filter((c) => c.species.includes(species) && c.part === part && c.unlock.from !== "starter");
const GROUNDS = Object.entries(grounds.grounds).map(([name, hex]) => ({ name, lab: hexToOklab(hex) }));

describe("the starter colours (§7.1)", () => {
  it("are about six per part per species, every species", () => {
    for (const species of SPECIES) for (const part of PARTS) expect(starters(species, part).length, `${species} ${part}`).toBe(6);
  });

  it("render as themselves: the part's mean is near the catalog's colour (a dark colour a little lighter, its painted highlights kept)", () => {
    for (const species of SPECIES) {
      for (const part of PARTS) {
        for (const coat of starters(species, part)) {
          for (const k of stands(species)) expect(oklabDistance(rendered(species, part, coat.color, k), hexToOklab(coat.color)), `${coat.id} (${k})`).toBeLessThan(0.08);
        }
      }
    }
  });

  it("stand out from every backdrop's ground by an OKLab distance of at least 0.10: her main part's", () => {
    const close: string[] = [];
    for (const species of SPECIES) {
      for (const coat of starters(species, "main")) {
        for (const k of stands(species)) {
          const lab = rendered(species, "main", coat.color, k);
          for (const ground of GROUNDS) {
            const d = oklabDistance(lab, ground.lab);
            if (d < 0.1) close.push(`${coat.id} (${k}) on ${ground.name}: ${d.toFixed(3)}`);
          }
        }
      }
    }
    expect(close).toEqual([]);
  });

  it("are told apart within each part's set, under normal and colour-blind vision: distance 0.08 or lightness 0.10", () => {
    const alike: string[] = [];
    for (const species of SPECIES) {
      for (const [part, k] of PARTS.flatMap((part) => stands(species).map((k) => [part, k] as const))) {
        const set = starters(species, part).map((coat) => ({ id: `${coat.id} (${k})`, lab: rendered(species, part, coat.color, k) }));
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
 * The earned colours (§7.1): each part's earned colours stand out by the
 * starters' rules (a main colour from every backdrop), and each is told apart
 * from her other colours for that part under normal vision, so an earned tile
 * is never a starter again.
 */
describe("the earned colours (§7.1)", () => {
  it("give every species an earned accent", () => {
    for (const species of SPECIES) expect(earned(species, "accent").length, species).toBeGreaterThan(0);
  });

  it("stand out from every backdrop's ground by an OKLab distance of at least 0.10: her main part's", () => {
    const close: string[] = [];
    for (const species of SPECIES) {
      for (const coat of earned(species, "main")) {
        for (const k of stands(species)) {
          const lab = rendered(species, "main", coat.color, k);
          for (const ground of GROUNDS) {
            const d = oklabDistance(lab, ground.lab);
            if (d < 0.1) close.push(`${coat.id} (${k}) on ${ground.name}: ${d.toFixed(3)}`);
          }
        }
      }
    }
    expect(close).toEqual([]);
  });

  it("are told apart from her other colours for that part: distance 0.08 or lightness 0.10", () => {
    const alike: string[] = [];
    for (const species of SPECIES) {
      for (const [part, k] of PARTS.flatMap((part) => stands(species).map((k) => [part, k] as const))) {
        const all = LOOKS.coats
          .filter((c) => c.species.includes(species) && c.part === part)
          .map((c) => ({ id: `${c.id} (${k})`, earned: c.unlock.from !== "starter", lab: rendered(species, part, c.color, k) }));
        for (const a of all.filter((c) => c.earned)) {
          for (const b of all) {
            if (a.id === b.id || (b.earned && b.id < a.id)) continue;
            const d = oklabDistance(a.lab, b.lab);
            const dl = Math.abs(a.lab[0] - b.lab[0]);
            if (d < 0.08 && dl < 0.1) alike.push(`${a.id} / ${b.id}: ${d.toFixed(3)}, L ${dl.toFixed(3)}`);
          }
        }
      }
    }
    expect(alike).toEqual([]);
  });
});

/**
 * Gold (§5.5): her whole figure, read as gold. On the stand-in, the gilded
 * figure's mean is near the special's colour. It is not held to the
 * backdrops: gold is a statue's look she picks on purpose, and every gold
 * there is sits near some ground (the snowy ones for a pale gold, Bramblewood
 * for a deep one).
 */
describe("the gilded specials (§5.5)", () => {
  const gilded = LOOKS.specials.flatMap((x) => (x.effect.kind === "gilded" ? [{ id: x.id, color: x.effect.color }] : []));

  it("read as their colour on every species", () => {
    expect(gilded.length).toBeGreaterThan(0);
    for (const [species, stand] of SPECIES.flatMap((species) => standIns(species).map((stand) => [species, stand] as const))) {
      const { painting, mask } = syntheticPainting(stand.main, PORTRAIT_PX, stand.accent);
      const view = { data: mask.data, stride: 4, figure: MASK_CHANNEL.figure };
      const stats = heroRegionStats(painting.data, view);
      for (const { id, color } of gilded) {
        const out = new Uint8ClampedArray(painting.data.length);
        tintHeroPixels(painting.data, view, { kind: "gilded", color }, stats, out);
        // Her outline and shading stay darker, so the figure reads as gold a little deeper than the swatch.
        expect(oklabDistance(regionMean(out, mask.data, 4, MASK_CHANNEL.figure), hexToOklab(color)), `${id} on ${species}`).toBeLessThan(0.15);
      }
    }
  });
});
