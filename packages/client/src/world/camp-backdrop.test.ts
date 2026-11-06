/**
 * Which backdrop a camp is pitched on (docs/camp.md §3.1, #625): the chapter's
 * terrain family where it is painted, `open_plains` everywhere else.
 */

import { describe, expect, it } from "vitest";
import { biomeFamilies, camp } from "../../../../assets/manifest.json";
import { CAMP_FALLBACK_FAMILY, campBackdropFamily, terrainFamilyOf } from "./camp-backdrop";
import { campLayoutFor } from "./lobby-camp";

describe("the camp backdrop for a chapter", () => {
  it("is the chapter's own terrain where its backdrop is painted", () => {
    expect(campBackdropFamily({ biome: "mount_red_sky" })).toBe("red_sky_volcanic");
    expect(campBackdropFamily({ biome: "red_sky_foothills" })).toBe("red_sky_volcanic");
    expect(campBackdropFamily({ biome: "glacier_of_origins" })).toBe("frozen_north");
    expect(campBackdropFamily({ biome: "frostfang_peaks" })).toBe("frozen_north");
    expect(campBackdropFamily({ biome: "sunward_fields" })).toBe("open_plains");
    expect(campBackdropFamily("eastern_plains")).toBe("open_plains");
    // The second and third waves (#649).
    expect(campBackdropFamily({ biome: "mosshome" })).toBe("enchanted_forest");
    expect(campBackdropFamily({ biome: "enchanted_woods" })).toBe("enchanted_forest");
    expect(campBackdropFamily({ biome: "exchange" })).toBe("cliffside_exchange");
    expect(campBackdropFamily({ biome: "stone_crossing" })).toBe("great_river");
    expect(campBackdropFamily({ biome: "sky_islands" })).toBe("sky_islands");
    expect(campBackdropFamily({ biome: "whispering_marsh" })).toBe("whispering_marsh");
    expect(campBackdropFamily({ biome: "bone_yard" })).toBe("bone_yard");
  });

  it("falls back to open_plains for a family not painted yet, a biome in no family, and no chapter", () => {
    expect(terrainFamilyOf("skullwater_cave")).toBe("skullwater_caverns");
    expect(campBackdropFamily({ biome: "skullwater_cave" })).toBe(CAMP_FALLBACK_FAMILY);
    expect(terrainFamilyOf("sallow_wastelands")).toBeNull();
    expect(campBackdropFamily({ biome: "sallow_wastelands" })).toBe("open_plains");
    expect(campBackdropFamily(null)).toBe("open_plains");
    expect(campBackdropFamily(undefined)).toBe("open_plains");
    expect(campBackdropFamily({ biome: "nowhere_at_all" })).toBe("open_plains");
  });

  it("follows the manifest: a family is pitched in once its backdrop is painted", () => {
    expect(campBackdropFamily({ biome: "mosshome" }, new Set(["open_plains", "enchanted_forest"]))).toBe("enchanted_forest");
    expect(campBackdropFamily({ biome: "mosshome" }, new Set(["open_plains"]))).toBe("open_plains");
    // Every family the manifest paints is one `biomeFamilies` knows, and is picked for its biomes.
    for (const backdrop of camp.backdrops) {
      const biomes = (biomeFamilies as Record<string, string[]>)[backdrop.family];
      expect(biomes, backdrop.family).toBeDefined();
      for (const biome of biomes!) expect(campBackdropFamily(biome)).toBe(backdrop.family);
    }
  });

  it("gives a layout on that family's own backdrop, at every frame stage", () => {
    for (const family of camp.backdrops.map((b) => b.family)) {
      for (const stage of [1, 2, 3, 4]) {
        const layout = campLayoutFor(stage, family)!;
        expect(layout.backdrop.family).toBe(family);
        expect(layout.backdrop.path).toBe(`camp/backdrops/${family}.webp`);
      }
    }
    // The default is the fallback's, and one layout per family and stage.
    expect(campLayoutFor(1)).toBe(campLayoutFor(1, "open_plains"));
    expect(campLayoutFor(1, "frozen_north")).not.toBe(campLayoutFor(1));
  });
});
