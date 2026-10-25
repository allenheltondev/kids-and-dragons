/**
 * The asset paths are a contract with `assets/`, not an implementation detail:
 * the art is deployed separately from the bundle (one S3 bucket, two syncs —
 * see vite.config.ts), so a typo here is a 404 in production that no compiler
 * catches. These are the shapes docs/art-pipeline.md documents.
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import bramblewood from "../../../../content/chapters/bramblewood-01.json";
import type { Chapter, ClassId, SpeciesId, TierId } from "@kad/shared";
import manifest from "../../../../assets/manifest.json";
import gemfall from "../../../../content/chapters/gemfall-08.json";
import { makeState } from "../testing/fixtures";
import {
  ANCHOR_X,
  ANCHOR_Y,
  CANVAS,
  CREATION_BIOME,
  STARTING_TIER,
  biomeBackdropUrl,
  sceneBackdropUrl,
  sceneArtFor,
  biomeTilesUrl,
  characterArtUrl,
  characterPortraitArtUrl,
  characterWorldArtUrl,
  enemyArtUrl,
  gearPortraitUrl,
} from "./art-paths";

describe("art paths", () => {
  it("resolves every Hollow Crown story backdrop to a declared shipped image", () => {
    const chapter = bramblewood as unknown as Chapter;
    for (const scene of Object.values(chapter.scenes)) {
      if (!scene.art || scene.type === "encounter") continue;
      expect(manifest.sceneIllustrations, scene.art).toContain(scene.art);
      const url = sceneBackdropUrl(scene.art);
      expect(url, scene.art).not.toBeNull();
      expect(existsSync(new URL(`../../../../${url!.slice(1)}`, import.meta.url)), scene.art).toBe(true);
    }
  });
  it("follows scene art and returns to biome art for combat or stale chapter content", () => {
    const chapter = gemfall as unknown as Chapter;
    const state = makeState({ chapterId: chapter.id, sceneId: "scene_mouth" });
    expect(sceneArtFor(chapter, state)).toBe("scenes/gemfall/gem-gallery");
    expect(sceneArtFor(chapter, { ...state, sceneId: "scene_seal_chamber" })).toBe("scenes/gemfall/seal-chamber");
    expect(sceneArtFor(chapter, { ...state, sceneId: "encounter_dragon" })).toBeNull();
    expect(sceneArtFor(chapter, { ...state, sceneId: "ending_heroes" })).toBeNull();
    expect(sceneArtFor(chapter, { ...state, chapterId: "gemfall-06" })).toBeNull();
    expect(sceneArtFor(null, state)).toBeNull();
  });
  it("resolves scene illustrations without treating legacy art ids as backdrops", () => {
    expect(sceneBackdropUrl("scenes/gemfall/hollow-gate")).toBe("/assets/scenes/gemfall/hollow-gate.webp");
    expect(sceneBackdropUrl("enemies/will_o_wisp")).toBeNull();
    expect(sceneBackdropUrl("scenes/gemfall/../../other")).toBeNull();
    expect(sceneBackdropUrl("biomes/../bg")).toBeNull();
    expect(sceneBackdropUrl("biomes/open_sea/tiles")).toBeNull();
  });
  it("can select every declared story illustration, including background-only destinations", () => {
    for (const art of manifest.sceneIllustrations) {
      expect(sceneBackdropUrl(art), art).toBe(`/assets/${art}.webp`);
    }
    for (const biome of manifest.backgroundOnlyBiomes) {
      expect(sceneBackdropUrl(`biomes/${biome}/bg`)).toBe(`/assets/biomes/${biome}/bg.webp`);
    }
  });
  it("addresses a character by species and tier", () => {
    expect(characterArtUrl("unicorn", "mythic")).toBe(
      "/assets/characters/unicorn/mythic/assembled.png",
    );
  });

  it("defaults to the tier a new character starts at", () => {
    expect(STARTING_TIER).toBe("fledgling");
    expect(characterArtUrl("griffin")).toBe(characterArtUrl("griffin", "fledgling"));
  });

  it("addresses approved class gear portraits by exact creature, class, and tier", () => {
    expect(gearPortraitUrl("dragonling", "thornguard", "sworn")).toBe(
      "/assets/gear-portraits/thornguard/sworn/dragonling.png",
    );
    expect(characterPortraitArtUrl("bigfoot", "mythic", "starweaver")).toBe(
      "/assets/gear-portraits/starweaver/mythic/bigfoot.png",
    );
    expect(gearPortraitUrl("griffin", "thornguard", "radiant")).toBe(
      "/assets/gear-portraits/thornguard/radiant/griffin.png",
    );
    expect(gearPortraitUrl("manticore", "songkeeper", "mythic")).toBe(
      "/assets/gear-portraits/songkeeper/mythic/manticore.png",
    );
  });

  it("falls back for fledglings, who do not wear class gear", () => {
    expect(gearPortraitUrl("unicorn", "duskrunner", "fledgling")).toBeNull();
    expect(characterPortraitArtUrl("griffin", "fledgling", "thornguard")).toBe(
      characterArtUrl("griffin", "fledgling"),
    );
  });

  it("keeps the client selector in lockstep with the manifest", () => {
    const classes: ClassId[] = ["thornguard", "duskrunner", "starweaver", "songkeeper"];
    const species: SpeciesId[] = [
      "unicorn",
      "dragonling",
      "griffin",
      "bigfoot",
      "kitsune",
      "manticore",
    ];
    const tiers: TierId[] = ["fledgling", "sworn", "radiant", "mythic"];
    const declared = manifest.gearPortraits.flatMap((group) =>
      group.tiers.flatMap((tier) =>
        group.species.map((creature) => `${group.class}/${tier}/${creature}`),
      ),
    );
    const addressed = classes.flatMap((characterClass) =>
      tiers.flatMap((tier) =>
        species.flatMap((creature) =>
          gearPortraitUrl(creature, characterClass, tier) === null
            ? []
            : [`${characterClass}/${tier}/${creature}`],
        ),
      ),
    );

    expect(addressed.sort()).toEqual(declared.sort());
  });

  it("treats a chapter's `enemies/` prefix as convention, not a directory", () => {
    expect(enemyArtUrl("enemies/will_o_wisp")).toBe("/assets/entities/will_o_wisp/assembled.png");
    expect(enemyArtUrl("will_o_wisp")).toBe("/assets/entities/will_o_wisp/assembled.png");
    expect(enemyArtUrl("cast/deep-ice-figure")).toBe("/assets/cast/deep-ice-figure/assembled.png");
  });

  it("addresses a biome's backdrop and tile sheet", () => {
    expect(biomeBackdropUrl("enchanted_woods")).toBe("/assets/biomes/enchanted_woods/bg.webp");
    expect(biomeTilesUrl("enchanted_woods")).toBe("/assets/biomes/enchanted_woods/tiles.png");
  });

  /* Creation runs before any chapter is loaded, so its backdrop is a constant.
     A constant naming a biome nobody commissioned is a silent blank screen. */
  it("stands creation in a biome the art actually ships", () => {
    expect(manifest.biomes).toContain(CREATION_BIOME);
  });
});

describe("static sprite anchors", () => {
  it("places the feet at the manifest ground origin", () => {
    expect(ANCHOR_X).toBe(manifest.canvas.originX / manifest.canvas.width);
    expect(ANCHOR_Y).toBe(manifest.canvas.originY / manifest.canvas.height);
    expect(CANVAS.width).toBe(manifest.canvas.width);
  });
});

it("addresses every delivered static class figure and keeps undeclared figures on base art", () => {
  const declared = new Set(manifest.figureVariants.map(v => `${v.class}/${v.tier}/${v.species}`));
  for (const characterClass of ["songkeeper", "starweaver", "duskrunner", "thornguard"] as ClassId[]) {
    for (const tier of manifest.tiers as TierId[]) {
      for (const { id } of manifest.species) {
        const species = id as SpeciesId;
        const key = `${characterClass}/${tier}/${species}`;
        expect(characterWorldArtUrl(species, tier, characterClass)).toBe(
          declared.has(key) ? `/assets/character-rigs/${key}/assembled.png` : characterArtUrl(species, tier),
        );
      }
    }
  }
});

describe("art for tiers past Mythic", () => {
  it("draws ascendant, eternal and legendary as Mythic, and leaves painted tiers alone", async () => {
    const { artTierOf } = await import("./art-paths");
    expect(artTierOf("sworn")).toBe("sworn");
    expect(artTierOf("mythic")).toBe("mythic");
    for (const tier of ["ascendant", "eternal", "legendary"] as const) expect(artTierOf(tier)).toBe("mythic");
  });
});
