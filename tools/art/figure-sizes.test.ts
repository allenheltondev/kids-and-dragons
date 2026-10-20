/**
 * The stage's height table (#362) against what it is projected from.
 *
 * Three things keep their own copy of a fact here, for reasons each file gives:
 * canon owns `SCALE_CM`, @kad/shared restates it as `SIZE_BAND_CM` for the
 * client, and packages/client/src/world/figure-sizes.ts is generated from canon
 * and the manifest. These are the checks that keep the copies honest.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCALE_CM } from "@kad/canon";
import { SIZE_BAND_CM, type Chapter } from "@kad/shared";
import { OUTPUT, figureSizes, renderFigureSizes } from "./figure-sizes.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const manifest = JSON.parse(readFileSync(`${REPO}/assets/manifest.json`, "utf8")) as {
  castFigures: { id: string; scale: keyof typeof SIZE_BAND_CM; heightCm: number; stance: string }[];
  stageFigures: { id: string; scale: keyof typeof SIZE_BAND_CM; heightCm: number; stance: string }[];
};
const sizes = figureSizes();

describe("figure sizes (#362)", () => {
  it("is regenerated: npm run art:figures after a height or stance changes", () => {
    expect(readFileSync(OUTPUT, "utf8")).toBe(renderFigureSizes(sizes));
  });

  it("restates canon's bands exactly, less the one a chapter cannot ask for", () => {
    const { variable: _variable, ...askable } = SCALE_CM;
    expect(SIZE_BAND_CM).toEqual(askable);
  });

  it("gives every manifest cast figure and stage animal a height inside its own band", () => {
    for (const figure of [...manifest.castFigures, ...manifest.stageFigures]) {
      const [low, high] = SIZE_BAND_CM[figure.scale];
      expect(figure.heightCm, `${figure.id}: ${figure.heightCm} cm is not ${figure.scale}`).toBeGreaterThanOrEqual(low);
      expect(figure.heightCm, `${figure.id}: ${figure.heightCm} cm is not ${figure.scale}`).toBeLessThanOrEqual(high);
      expect(["standing", "hovering", "flying", "swimming"], figure.id).toContain(figure.stance);
    }
  });

  it("has a height for every figure any chapter casts", () => {
    const missing = new Set<string>();
    for (const file of readdirSync(`${REPO}/content/chapters`).filter((f) => f.endsWith(".json"))) {
      const chapter = JSON.parse(readFileSync(`${REPO}/content/chapters/${file}`, "utf8")) as Chapter;
      for (const scene of Object.values(chapter.scenes)) {
        if (scene.type === "encounter") continue;
        for (const member of scene.cast ?? []) {
          // The Skywardens' group picture is stood as its three members (cast.ts ENSEMBLES).
          if (member.figure === "entities/skywardens") continue;
          if (!sizes.has(member.figure)) missing.add(`${member.figure} (${file})`);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });

  it("keeps a figure that is both an individual and a cast member the same height", () => {
    // Pib is canon (individual.pib) and has a cast figure; Old Ossley and Marda too.
    for (const id of ["pib", "old_ossley", "marda_thorn"]) {
      const canon = [...sizes.values()].find((s) => s.source === `individual.${id}`);
      const cast = sizes.get(`cast/${id}`);
      if (canon && cast) expect(cast.heightCm, id).toBe(canon.heightCm);
    }
    expect(sizes.get("entities/pib")?.heightCm).toBe(sizes.get("cast/pib")?.heightCm);
  });
});
