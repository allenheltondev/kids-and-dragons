/**
 * The asset paths are a contract with `assets/`, not an implementation detail:
 * the art is deployed separately from the bundle (one S3 bucket, two syncs —
 * see vite.config.ts), so a typo here is a 404 in production that no compiler
 * catches. These are the shapes docs/art-pipeline.md documents.
 */

import { describe, expect, it } from "vitest";
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
  characterRigUrl,
  enemyArtUrl,
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
