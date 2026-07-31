/**
 * The asset paths are a contract with `assets/`, not an implementation detail:
 * the art is deployed separately from the bundle (one S3 bucket, two syncs —
 * see vite.config.ts), so a typo here is a 404 in production that no compiler
 * catches. These are the shapes docs/art-pipeline.md documents.
 */

import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import {
  CREATION_BIOME,
  STARTING_TIER,
  biomeBackdropUrl,
  biomeTilesUrl,
  characterArtUrl,
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
