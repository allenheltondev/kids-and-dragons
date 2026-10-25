import { describe, expect, it } from "vitest";
import {
  CLASS_GUIDE_ID,
  CLASS_PLACE_GUIDE_ID,
  chapterDiscoveries,
  chapterStartDiscoveries,
  partyClassDiscoveries,
  sceneDiscoveries,
} from "./discoveries.js";

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

  describe("classes", () => {
    it("a class place finds its room, then the class it teaches, after the scene's own tags", () => {
      const room = { type: "story", classPlace: "duskrunner", discovers: ["npc.x"] } as never;
      expect(sceneDiscoveries(room, bestiary)).toEqual(["npc.x", "location.rookery", "class.duskrunner"]);
      for (const cls of ["thornguard", "starweaver", "duskrunner", "songkeeper"] as const) {
        expect(sceneDiscoveries({ type: "choice_point", classPlace: cls } as never, bestiary)).toEqual([
          CLASS_PLACE_GUIDE_ID[cls],
          CLASS_GUIDE_ID[cls],
        ]);
      }
    });

    it("the four classes have four distinct entries and four distinct rooms", () => {
      expect(new Set(Object.values(CLASS_GUIDE_ID)).size).toBe(4);
      expect(new Set(Object.values(CLASS_PLACE_GUIDE_ID)).size).toBe(4);
      expect(CLASS_PLACE_GUIDE_ID).toEqual({
        thornguard: "location.dojo",
        starweaver: "location.academy",
        duskrunner: "location.rookery",
        songkeeper: "location.conservatory",
      });
    });

    it("a scene that is not a class place finds no class", () => {
      expect(sceneDiscoveries({ type: "story" } as never, bestiary)).toEqual([]);
      expect(sceneDiscoveries({ type: "story", classPlace: undefined } as never, bestiary)).toEqual([]);
    });

    it("heroes find the classes they wear, once each, in seat order", () => {
      const heroes = ["songkeeper", "thornguard", "songkeeper"].map((c) => ({ character: { class: c } })) as never;
      expect(partyClassDiscoveries(heroes)).toEqual(["class.songkeeper", "class.thornguard"]);
      expect(partyClassDiscoveries([])).toEqual([]);
      expect(partyClassDiscoveries(null)).toEqual([]);
    });
  });
});
