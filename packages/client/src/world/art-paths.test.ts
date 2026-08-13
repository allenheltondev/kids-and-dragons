/**
 * The asset paths are a contract with `assets/`, not an implementation detail:
 * the art is deployed separately from the bundle (one S3 bucket, two syncs —
 * see vite.config.ts), so a typo here is a 404 in production that no compiler
 * catches. These are the shapes docs/art-pipeline.md documents.
 */

import { describe, expect, it } from "vitest";
import type { ClassId, SpeciesId, TierId } from "@kad/shared";
import manifest from "../../../../assets/manifest.json";
import {
  ANCHOR_X,
  ANCHOR_Y,
  CANVAS,
  CREATION_BIOME,
  RIG_ANCHOR_X,
  RIG_ANCHOR_Y,
  RIG_STAGE,
  STARTING_TIER,
  biomeBackdropUrl,
  biomeTilesUrl,
  characterArtUrl,
  characterPortraitArtUrl,
  characterRigUrl,
  characterWorldArtUrl,
  enemyArtUrl,
  gearPortraitUrl,
} from "./art-paths";

describe("art paths", () => {
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

it("rig files live beside the assembled PNG they fall back to", () => {
  expect(characterRigUrl("unicorn", "mythic")).toBe("/assets/characters/unicorn/mythic/rig.riv");
  expect(characterRigUrl("griffin")).toBe("/assets/characters/griffin/fledgling/rig.riv");
});

describe("class rig variants", () => {
  it("selects the exact delivered species, class, and tier", () => {
    expect(characterRigUrl("bigfoot", "sworn", "thornguard")).toBe(
      "/assets/character-rigs/thornguard/sworn/bigfoot/rig.riv",
    );
    expect(characterWorldArtUrl("bigfoot", "sworn", "thornguard")).toBe(
      "/assets/character-rigs/thornguard/sworn/bigfoot/assembled.png",
    );
    expect(characterRigUrl("dragonling", "sworn", "thornguard")).toBe(
      "/assets/character-rigs/thornguard/sworn/dragonling/rig.riv",
    );
    expect(characterRigUrl("griffin", "sworn", "thornguard")).toBe(
      "/assets/character-rigs/thornguard/sworn/griffin/rig.riv",
    );
    expect(characterRigUrl("kitsune", "sworn", "thornguard")).toBe(
      "/assets/character-rigs/thornguard/sworn/kitsune/rig.riv",
    );
    expect(characterRigUrl("manticore", "sworn", "thornguard")).toBe(
      "/assets/character-rigs/thornguard/sworn/manticore/rig.riv",
    );
    expect(characterRigUrl("unicorn", "sworn", "thornguard")).toBe(
      "/assets/character-rigs/thornguard/sworn/unicorn/rig.riv",
    );
  });

  it("keeps every undeclared combination on its species rig", () => {
    expect(characterRigUrl("bigfoot", "mythic", "thornguard")).toBe(
      characterRigUrl("bigfoot", "mythic"),
    );
    expect(characterRigUrl("griffin", "radiant", "duskrunner")).toBe(
      characterRigUrl("griffin", "radiant"),
    );
    expect(characterWorldArtUrl("bigfoot", "sworn", "duskrunner")).toBe(
      characterArtUrl("bigfoot", "sworn"),
    );
  });

  it("keeps the runtime selector in lockstep with manifest.rigVariants", () => {
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
    const declared = manifest.rigVariants.map(
      (variant) => `${variant.class}/${variant.tier}/${variant.species}`,
    );
    const addressed = classes.flatMap((characterClass) =>
      tiers.flatMap((tier) =>
        species.flatMap((creature) =>
          characterRigUrl(creature, tier, characterClass) === characterRigUrl(creature, tier)
            ? []
            : [`${characterClass}/${tier}/${creature}`],
        ),
      ),
    );

    expect(addressed.sort()).toEqual(declared.sort());
  });
});

/*
 * The two anchors, which used to be one.
 *
 * A rig is drawn on `rigStage`; a static `assembled.png` sprite is drawn on the
 * art canvas. While the stage *was* the canvas those were the same fraction, and
 * `rive-rig.ts` re-exported the static anchor for rigs on that basis. The stage
 * is bigger now (art-pipeline §6.3), so they have diverged — and the horizontal
 * half has NOT, which is what makes the divergence easy to miss.
 *
 * Both are checked against the manifest rather than against each other, so this
 * fails if the client's copy of the geometry drifts from the contract.
 */
describe("sprite anchors", () => {
  it("takes the static-art anchor from the canvas", () => {
    expect(CANVAS.width).toBe(manifest.canvas.width);
    expect(CANVAS.originY).toBe(manifest.canvas.originY);
    expect(ANCHOR_X).toBeCloseTo(manifest.canvas.originX / manifest.canvas.width, 9);
    expect(ANCHOR_Y).toBeCloseTo(manifest.canvas.originY / manifest.canvas.height, 9);
  });

  it("takes the rig anchor from the stage, offset and all", () => {
    expect(RIG_STAGE.width).toBe(manifest.rigStage.width);
    expect(RIG_STAGE.offsetX).toBe(manifest.rigStage.offsetX);
    expect(RIG_ANCHOR_X).toBeCloseTo(
      (manifest.canvas.originX + manifest.rigStage.offsetX) / manifest.rigStage.width,
      9,
    );
    expect(RIG_ANCHOR_Y).toBeCloseTo(
      (manifest.canvas.originY + manifest.rigStage.offsetY) / manifest.rigStage.height,
      9,
    );
  });

  it("keeps the horizontal anchor and moves the vertical one", () => {
    // The trap in one assertion: X is unchanged, so a reader checking only the
    // centring would conclude nothing moved.
    expect(RIG_ANCHOR_X).toBeCloseTo(ANCHOR_X, 9);
    expect(RIG_ANCHOR_Y).not.toBeCloseTo(ANCHOR_Y, 3);
  });
});

/*
 * The invariant the two sprite paths have to share.
 *
 * A rigged character and a static PNG of the same character, both asked for the
 * same drawn height, must come out the same size with their feet in the same
 * place — otherwise a rig that falls back to its PNG (or a board mixing the two)
 * changes size on screen. That is not automatic any more: the PNG sprite is
 * textured with the 1024 canvas and the rig sprite with the 1400 stage, so the
 * rig has to be scaled up by the ratio or it draws the figure at 73% and stands
 * it too high. It shipped that way for one commit; this is the arithmetic that
 * caught it, kept.
 */
describe("a rig and a PNG of the same character agree", () => {
  const H = 414; // world/scene.ts: a character at 46% of the 900-unit design height

  it("draws the art canvas at exactly the requested height", () => {
    const spriteH = H * (RIG_STAGE.height / CANVAS.height);
    const canvasRegion = spriteH * (CANVAS.height / RIG_STAGE.height);
    expect(canvasRegion).toBeCloseTo(H, 9);
  });

  it("puts the feet where the PNG path puts them", () => {
    const spriteH = H * (RIG_STAGE.height / CANVAS.height);
    const canvasTopWithinSprite = (RIG_STAGE.offsetY / RIG_STAGE.height) * spriteH;
    const originWithinSprite = RIG_ANCHOR_Y * spriteH;
    // Distance from the top of the *art* to the standing point, which is what
    // ANCHOR_Y means for a PNG sprite of height H.
    expect(originWithinSprite - canvasTopWithinSprite).toBeCloseTo(ANCHOR_Y * H, 9);
  });
});
