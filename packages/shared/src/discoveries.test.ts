import { describe, expect, it } from "vitest";
import { chapterDiscoveries, chapterStartDiscoveries, sceneDiscoveries } from "./discoveries.js";

const bestiary = {
  creatures: {
    will_o_wisp: { canon_id: "creature.will_o_wisp" },
    embermoth: { canon_id: "creature.embermoth" },
  },
} as never;
const world = { places: { bramblewood: { id: "biome.bramblewood" } } } as never;

const fight = (extra: object = {}) =>
  ({
    type: "encounter",
    enemies: [{ creature: "will_o_wisp" }, { creature: "embermoth" }, { creature: "will_o_wisp" }, {}],
    ...extra,
  }) as never;

describe("discoveries", () => {
  it("chapter start reveals the biome's canon id", () => {
    expect(chapterStartDiscoveries({ biome: "bramblewood" }, world)).toEqual(["biome.bramblewood"]);
    expect(chapterStartDiscoveries({ biome: "nowhere" }, world)).toEqual([]);
    expect(chapterStartDiscoveries({ biome: "bramblewood" }, null)).toEqual([]);
  });

  it("explicit tags come through, deduplicated, in order", () => {
    const scene = { type: "story", discovers: ["npc.b", "creature.a", "npc.b"] } as never;
    expect(sceneDiscoveries(scene, bestiary)).toEqual(["npc.b", "creature.a"]);
    expect(sceneDiscoveries({ type: "story" } as never, bestiary)).toEqual([]);
  });

  it("a fight reveals its creatures implicitly, once each, before explicit tags", () => {
    expect(sceneDiscoveries(fight({ discovers: ["creature.embermoth", "npc.x"] }), bestiary)).toEqual([
      "creature.will_o_wisp",
      "creature.embermoth",
      "npc.x",
    ]);
  });

  it("chapterDiscoveries unions the start and every scene", () => {
    const chapter = { biome: "bramblewood", scenes: { a: fight(), b: { type: "story", discovers: ["npc.x"] } } } as never;
    expect(chapterDiscoveries(chapter, world, bestiary)).toEqual([
      "biome.bramblewood",
      "creature.will_o_wisp",
      "creature.embermoth",
      "npc.x",
    ]);
  });
});
