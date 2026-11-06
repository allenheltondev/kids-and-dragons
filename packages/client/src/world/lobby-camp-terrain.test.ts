/**
 * The camp pitched in the chapter's terrain (docs/camp.md §3.1; #627): which
 * chapter's biome the lobby, a rest scene and the chapter's end read, and the
 * frame a crew past the art gets (§12.3). The biome-to-backdrop table itself
 * is camp-backdrop.test.ts's.
 */

import { describe, expect, it } from "vitest";
import type { CampaignView } from "@kad/shared";
import { campBiome, campFamilyFor, campLayoutFor } from "./lobby-camp";
import { makeState } from "../testing/fixtures";

const view = (id: string, biome: string | undefined, over: Partial<CampaignView> = {}): CampaignView => ({
  id,
  title: id,
  chapters: 8,
  next: { index: 1, title: "One", ...(biome ? { biome } : {}) },
  ...over,
});

describe("campBiome", () => {
  it("reads the lobby's next chapter, of the campaign the lobby would begin", () => {
    const lobby = makeState({ phase: "lobby", chapterId: null, campaign: view("riftlight", "glacier_of_origins"), campaignOptions: [view("riftlight", "glacier_of_origins")] });
    expect(campBiome(lobby, null)).toBe("glacier_of_origins");
    expect(campFamilyFor(lobby, null)).toBe("frozen_north");
    // The chapter last loaded on this screen is not where the crew goes next.
    expect(campBiome(lobby, { id: "gemfall-06", biome: "red_sky_foothills" })).toBe("glacier_of_origins");
    // Before any campaign, or on a run from before `next.biome`: the fallback.
    expect(campFamilyFor(makeState({ phase: "lobby", campaign: null, campaignOptions: [] }), null)).toBe("open_plains");
    expect(campFamilyFor(makeState({ phase: "creation", campaign: view("gemfall", undefined), campaignOptions: [] }), null)).toBe("open_plains");
  });

  it("reads the chapter being played at a rest scene and at the chapter's end, once it has loaded", () => {
    const chapter = { id: "gemfall-06", biome: "red_sky_foothills" };
    const end = makeState({ phase: "chapter_complete", chapterId: "gemfall-06" });
    expect(campFamilyFor(end, chapter)).toBe("red_sky_volcanic");
    const rest = makeState({ phase: "scene", sceneType: "rest", chapterId: "riftlight-frostfang-shore" });
    expect(campFamilyFor(rest, { id: "riftlight-frostfang-shore", biome: "frostfang_peaks" })).toBe("frozen_north");
    // Main's later backdrops (#649), chosen the same way: Gemfall's first chapter at the Exchange.
    const exchange = makeState({ phase: "chapter_complete", chapterId: "gemfall-01" });
    expect(campFamilyFor(exchange, { id: "gemfall-01", biome: "exchange" })).toBe("cliffside_exchange");
    // Another chapter's content, still loading this one's: nothing to say yet.
    expect(campBiome(rest, chapter)).toBeNull();
    expect(campFamilyFor(rest, null)).toBe("open_plains");
    expect(campBiome(null, chapter)).toBeNull();
  });
});

describe("campLayoutFor", () => {
  it("lays the crew's frame over the terrain's backdrop, each stage on each", () => {
    for (const family of ["open_plains", "red_sky_volcanic", "frozen_north", "enchanted_forest", "sky_islands", "whispering_marsh", "cliffside_exchange", "great_river", "bone_yard"]) {
      for (const stage of [1, 2, 3, 4]) {
        const layout = campLayoutFor(stage, family)!;
        expect(layout.backdrop.family).toBe(family);
        expect(layout.frame.stage).toBe(stage);
      }
    }
    expect(campLayoutFor(3, "not_painted")!.backdrop.family).toBe("open_plains");
  });

  it("gives a crew past the art the biggest frame painted, and a broken stage the first (§12.3)", () => {
    expect(campLayoutFor(5)!.frame.stage).toBe(4);
    expect(campLayoutFor(99, "frozen_north")!.frame.stage).toBe(4);
    expect(campLayoutFor(0)!.frame.stage).toBe(1);
    expect(campLayoutFor(Number.NaN)!.frame.stage).toBe(1);
  });

  it("is the same layout for the same stage and terrain, so a sync does not re-pitch the camp", () => {
    expect(campLayoutFor(3, "red_sky_volcanic")).toBe(campLayoutFor(3, "red_sky_volcanic"));
    expect(campLayoutFor(3, "red_sky_volcanic")).not.toBe(campLayoutFor(3, "frozen_north"));
  });
});
