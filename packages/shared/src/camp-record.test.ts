import { describe, expect, it } from "vitest";
import {
  CAMP_VERSION,
  campView,
  emptyCamp,
  emptyKit,
  frameStageFor,
  growCamp,
  KIT_VERSION,
  MILESTONE_KIT_PIECES,
  migrateCamp,
  migrateKit,
  milestonePieces,
  PLACEHOLDER_KIT_PIECES,
  readKit,
  StoredCampError,
  withMilestones,
  withKitCrew,
} from "./camp-record.js";
import { grownView } from "./camp-edit.js";
import { commitCampaign, failCampaign } from "./character.js";
import { CHARACTER_VERSION, migrateCharacter } from "./migrate.js";
import type { Character } from "./types/domain.js";

function hero(overrides: Partial<Character> = {}): Character {
  return {
    id: "c_1",
    householdId: "h_1",
    ownerPlayerId: "p_1",
    name: "Pip",
    species: "unicorn",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    committed: {
      level: 1,
      xp: 0,
      stats: { might: 1, quick: 2, clever: 2, heart: 4 },
      tier: "fledgling",
      class: "songkeeper",
      mastery: {},
      inventory: [],
      unspentPoints: 0,
    },
    provisional: null,
    questItems: [],
    souvenirs: [],
    createdAt: "2026-07-04T18:00:00.000Z",
    ...overrides,
  };
}

describe("the camp record", () => {
  it("reads an unstamped or current row, and refuses one from a newer build", () => {
    const camp = { ...emptyCamp(), revision: 3, dashCash: 4, grownBy: ["gemfall"], frameStage: 2 as const };
    expect(migrateCamp(camp, CAMP_VERSION)).toEqual(camp);
    expect(migrateCamp({ revision: 1 }, undefined)).toEqual({ ...emptyCamp(), revision: 1 });
    expect(() => migrateCamp(camp, CAMP_VERSION + 1)).toThrow(StoredCampError);
    expect(() => migrateCamp({ dashCash: -1 }, CAMP_VERSION)).toThrow(/dashCash/);
    expect(() => migrateCamp({ owned: { awning: { from: "stolen", at: "x" } } }, CAMP_VERSION)).toThrow(/owned\.awning\.from/);
  });

  it("derives the frame from what grew it, so a stored stage can never disagree", () => {
    expect(migrateCamp({ grownBy: ["a", "b"], frameStage: 1 }, CAMP_VERSION).frameStage).toBe(3);
    expect([0, 1, 2, 3, 4, 9].map(frameStageFor)).toEqual([1, 2, 3, 4, 4, 4]);
  });

  it("grows once per campaign, returns the same camp when nothing is new, and never shrinks", () => {
    const one = growCamp(emptyCamp(), ["gemfall", "gemfall"]);
    expect(one).toMatchObject({ frameStage: 2, grownBy: ["gemfall"] });
    expect(growCamp(one, ["gemfall"])).toBe(one);
    expect(growCamp(one, [])).toBe(one);
    expect(growCamp(one, ["riftlight"])).toMatchObject({ frameStage: 3, grownBy: ["gemfall", "riftlight"] });
  });

  it("reaches stage 3 on Gemfall and Riftlight, stage 4 on a third, and no replay moves it (#627)", () => {
    const three = growCamp(growCamp(emptyCamp(), ["gemfall"]), ["riftlight"]);
    expect(three.frameStage).toBe(3);
    // Either replayed, in any order, alone or together: the same camp back.
    expect(growCamp(three, ["riftlight"])).toBe(three);
    expect(growCamp(three, ["gemfall", "riftlight", "gemfall"])).toBe(three);
    const four = growCamp(three, ["full-3"]);
    expect(four).toMatchObject({ frameStage: 4, grownBy: ["gemfall", "riftlight", "full-3"] });
    // Capped: a fourth finish is a trophy, not a fifth stage.
    expect(growCamp(four, ["full-4"]).frameStage).toBe(4);
  });

  it("marks the chapter end's view grown only when the frame moved (#627)", () => {
    const two = campView(growCamp(emptyCamp(), ["gemfall"]));
    const three = grownView(two, "riftlight", frameStageFor);
    expect(three).toMatchObject({ frameStage: 3, grew: true, grownBy: ["gemfall", "riftlight"] });
    // Finishing Riftlight again: already counted, nothing grows.
    const again = grownView(campView(growCamp(emptyCamp(), ["gemfall", "riftlight"])), "riftlight", frameStageFor);
    expect(again.frameStage).toBe(3);
    expect(again.grew).toBeUndefined();
    // Past the cap a finish adds a trophy but pitches no new camp.
    const capped = grownView(campView(growCamp(emptyCamp(), ["gemfall", "riftlight", "full-3"])), "full-4", frameStageFor);
    expect(capped).toMatchObject({ frameStage: 4, grownBy: ["gemfall", "riftlight", "full-3", "full-4"] });
    expect(capped.grew).toBeUndefined();
  });

  it("shows the screens a slim view: no receipts, the shop open at two paid chapters", () => {
    const camp = { ...emptyCamp(), paidChapterCount: 2, owned: { b: { from: "bought" as const, at: "t" }, a: { from: "kept" as const, at: "t" } } };
    const view = campView(camp);
    expect(view).toMatchObject({ shopOpen: true, owned: ["a", "b"] });
    expect(view).not.toHaveProperty("receipts");
    expect(campView(emptyCamp()).shopOpen).toBe(false);
  });
});

describe("the hero's kit", () => {
  it("reads an empty kit for a hero with none, and refuses a kit piece from nowhere", () => {
    expect(readKit(hero())).toEqual(emptyKit());
    expect(migrateKit({ ...emptyKit(), style: "quilted" })).toEqual({ ...emptyKit(), style: "quilted" });
    expect(() => migrateKit({ unlocked: { x: { from: "crew" } } })).toThrow(/kit\.unlocked\.x\.from/);
  });

  it("keeps the tent apart from the bedroll and pack: null until picked, and kept as picked (#618)", () => {
    expect(emptyKit()).toMatchObject({ v: KIT_VERSION, style: null, tent: null });
    const picked = { ...emptyKit(), style: "patched", tent: "sworn" };
    expect(migrateKit(picked)).toEqual(picked);
    expect(() => migrateKit({ ...emptyKit(), tent: 3 })).toThrow(/kit\.tent/);
    expect(() => migrateKit({ ...emptyKit(), v: KIT_VERSION + 1 })).toThrow(StoredCampError);
  });

  it("migrates a v1 kit: a tent of null, and #617's placeholder ids renamed so none survives, twice the same", () => {
    const v1 = {
      v: 1,
      revision: 4,
      style: "rolled",
      color: "tide",
      slots: ["kit_deco_starweaver_apprentice", "deco_bunting"],
      unlocked: {
        kit_tent_sworn: { from: "milestone" },
        kit_deco_starweaver_apprentice: { from: "milestone", at: "2026-08-01T00:00:00.000Z" },
        // A placeholder whose real id is already there: the real record stands.
        kit_tent_radiant: { from: "milestone", at: "old" },
        radiant: { from: "milestone", at: "new" },
        deco_lamp_ribbon: { from: "found", rewardId: "gemfall-01.lamp_ribbon", at: "t" },
      },
    };
    const once = migrateKit(v1);
    expect(once).toEqual({
      v: KIT_VERSION,
      revision: 4,
      style: "rolled",
      tent: null,
      color: "tide",
      slots: ["deco_starweaver_apprentice", "deco_bunting"],
      unlocked: {
        sworn: { from: "milestone" },
        deco_starweaver_apprentice: { from: "milestone", at: "2026-08-01T00:00:00.000Z" },
        radiant: { from: "milestone", at: "new" },
        deco_lamp_ribbon: { from: "found", rewardId: "gemfall-01.lamp_ribbon", at: "t" },
      },
      buddies: {},
    });
    const ids = [...Object.keys(once.unlocked), ...once.slots];
    for (const placeholder of Object.keys(PLACEHOLDER_KIT_PIECES)) expect(ids).not.toContain(placeholder);
    expect(migrateKit(JSON.parse(JSON.stringify(once)))).toEqual(once);
    expect(migrateKit(v1)).toEqual(once);
  });

  it("migrates a v2 kit to v3 with no buddies, keeps v3 buddies by camp, and refuses a malformed one (#624)", () => {
    const v2 = { v: 2, revision: 1, style: "rolled", tent: null, color: null, slots: [null, null], unlocked: {} };
    expect(migrateKit(v2)).toMatchObject({ v: KIT_VERSION, buddies: {} });
    const v3 = { ...v2, v: 3, buddies: { h_test: "bun", "h_test#cw_1": "kid_goat" } };
    expect(migrateKit(v3).buddies).toEqual({ h_test: "bun", "h_test#cw_1": "kid_goat" });
    expect(() => migrateKit({ ...v3, buddies: { h_test: 7 } })).toThrow(StoredCampError);
  });

  it("migrates a v3 kit to v4 with its crews unrecorded, keeps v4 crews once each, and refuses malformed ones (#629)", () => {
    const v3 = { v: 3, revision: 2, style: "rolled", tent: null, color: null, slots: [null, null], unlocked: {}, buddies: { h_test: "bun" } };
    const migrated = migrateKit(v3);
    expect(migrated).toMatchObject({ v: KIT_VERSION, revision: 2, buddies: { h_test: "bun" } });
    // Absent, not empty: never recorded, so the book backfills her from the runs.
    expect(migrated.crews).toBeUndefined();
    const v4 = { ...v3, v: 4, crews: ["h_test", "h_test#cw_1", "h_test"] };
    expect(migrateKit(v4).crews).toEqual(["h_test", "h_test#cw_1"]);
    expect(migrateKit(JSON.parse(JSON.stringify(migrateKit(v4))))).toEqual(migrateKit(v4));
    expect(() => migrateKit({ ...v4, crews: "h_test" })).toThrow(StoredCampError);
    expect(() => migrateKit({ ...v4, crews: [""] })).toThrow(StoredCampError);
  });

  it("adds a crew to a kit once, without bumping its revision (#629)", () => {
    const kit = { ...emptyKit(), revision: 3 };
    const once = withKitCrew(kit, "h_test#cw_1");
    expect(once).toMatchObject({ revision: 3, crews: ["h_test#cw_1"] });
    expect(withKitCrew(once, "h_test#cw_1")).toBe(once);
    expect(withKitCrew(once, "h_test").crews).toEqual(["h_test#cw_1", "h_test"]);
  });

  it("names the catalog's real milestone ids, one placeholder for each", () => {
    expect(MILESTONE_KIT_PIECES.tiers).toEqual({ sworn: "sworn", radiant: "radiant", mythic: "mythic" });
    expect(MILESTONE_KIT_PIECES.distinctions.duskrunner.master).toBe("deco_duskrunner_master");
    const real = [...Object.values(MILESTONE_KIT_PIECES.tiers), ...Object.values(MILESTONE_KIT_PIECES.distinctions).flatMap((r) => Object.values(r))];
    expect(Object.values(PLACEHOLDER_KIT_PIECES).sort()).toEqual(real.sort());
    for (const id of real) expect(id).not.toMatch(/^kit_/);
  });

  it("unlocks a tent per painted tier reached and a decoration per distinction, from both halves", () => {
    const h = hero({
      committed: { ...hero().committed, tier: "sworn", mastery: { songkeeper: { rank: "expert", deeds: {} } } },
      provisional: { ...hero().committed, tier: "ascendant", mastery: { thornguard: { rank: "apprentice", deeds: {} } }, runId: "r_1" },
    });
    expect(milestonePieces(h)).toEqual([
      "deco_songkeeper_apprentice",
      "deco_songkeeper_expert",
      "deco_thornguard_apprentice",
      "mythic",
      "radiant",
      "sworn",
    ]);
    const kit = withMilestones(emptyKit(), h, "2026-08-01T00:00:00.000Z");
    expect(kit.unlocked["sworn"]).toEqual({ from: "milestone", at: "2026-08-01T00:00:00.000Z" });
    expect(withMilestones(kit, h)).toBe(kit);
    expect(kit.revision).toBe(0);
  });

  it("a failed campaign keeps the kit, and the pieces of a tier it puts back (§5.4)", () => {
    const kit = { ...emptyKit(), revision: 2, style: "quilted", unlocked: { feather: { from: "found" as const, at: "t" } } };
    const h = hero({ kit, provisional: { ...hero().committed, tier: "sworn", runId: "r_1" } });
    const failed = failCampaign(h, "souvenir", "2026-08-01T00:00:00.000Z");
    expect(failed.committed.tier).toBe("fledgling");
    expect(failed.kit).toMatchObject({ revision: 2, style: "quilted", unlocked: { feather: kit.unlocked.feather } });
    expect(failed.kit?.unlocked["sworn"]).toEqual({ from: "milestone", at: "2026-08-01T00:00:00.000Z" });
    expect(readKit(failed).unlocked["sworn"]).toBeDefined();
    // A hero with nothing to keep is left exactly as she was.
    expect(failCampaign(hero(), "s", "t")).not.toHaveProperty("kit");
    expect(commitCampaign(h).kit).toEqual(kit);
  });

  it("remembers the highest tier reached, so an unpainted tier's tent comes once it is painted, even after a revert (#621)", () => {
    const h = hero({ committed: { ...hero().committed, tier: "mythic" }, provisional: { ...hero().committed, tier: "ascendant", runId: "r_1" } });
    const failed = failCampaign(h, "souvenir", "2026-08-01T00:00:00.000Z");
    expect(failed.committed.tier).toBe("mythic");
    expect(failed.kit?.highestTier).toBe("ascendant");
    expect(readKit(failed).unlocked).not.toHaveProperty("ascendant");
    // Its art and catalog entry ship.
    MILESTONE_KIT_PIECES.tiers.ascendant = "ascendant";
    try {
      expect(readKit(failed).unlocked["ascendant"]).toEqual({ from: "milestone" });
      // Never lowered, and nothing new to write the second time.
      const kit = withMilestones(failed.kit!, failed);
      expect(withMilestones(kit, failed)).toBe(kit);
      expect(kit.highestTier).toBe("ascendant");
    } finally {
      delete MILESTONE_KIT_PIECES.tiers.ascendant;
    }
  });

  it("stores the highest tier as one of the ladder's, or not at all", () => {
    expect(migrateKit({ ...emptyKit(), highestTier: "sworn" }).highestTier).toBe("sworn");
    expect(migrateKit(emptyKit())).not.toHaveProperty("highestTier");
    expect(() => migrateKit({ ...emptyKit(), highestTier: "galactic" })).toThrow(StoredCampError);
    // A fledgling has climbed nowhere yet, so nothing is written for her.
    expect(withMilestones(emptyKit(), hero())).not.toHaveProperty("highestTier");
  });
});

describe("the character ladder's kit backfill (v8 → v9, §12.3)", () => {
  it("grants an existing hero the milestones she holds, and run twice gives the same hero", () => {
    const v8 = { ...hero({ committed: { ...hero().committed, tier: "radiant" } }), version: 4 };
    const once = migrateCharacter(v8, 8);
    expect(Object.keys(once.kit?.unlocked ?? {}).sort()).toEqual(["radiant", "sworn"]);
    expect(once.kit?.unlocked["radiant"]).toEqual({ from: "milestone" });
    expect(migrateCharacter(v8, 8)).toEqual(once);
    // Written back at the current version and read again: unchanged.
    expect(migrateCharacter(JSON.parse(JSON.stringify(once)), CHARACTER_VERSION)).toEqual(once);
  });

  it("reads a hero #617 wrote with placeholder milestones as the catalog's ids, and again the same", () => {
    const stored = {
      ...hero({ committed: { ...hero().committed, tier: "sworn" } }),
      version: 2,
      kit: { v: 1, revision: 1, style: null, color: null, slots: [null, null], unlocked: { kit_tent_sworn: { from: "milestone" } } },
    };
    const once = migrateCharacter(stored, CHARACTER_VERSION);
    expect(once.kit).toEqual({ ...emptyKit(), revision: 1, unlocked: { sworn: { from: "milestone" } } });
    expect(readKit(once)).toEqual(once.kit);
    expect(migrateCharacter(JSON.parse(JSON.stringify(once)), CHARACTER_VERSION)).toEqual(once);
  });

  it("leaves a kit the row already has, and a hero with nothing earned, as stored", () => {
    const kit = { ...emptyKit(), style: "quilted" };
    expect(migrateCharacter({ ...hero({ committed: { ...hero().committed, tier: "sworn" } }), kit }, 8).kit).toEqual(kit);
    expect(migrateCharacter(hero(), 8)).not.toHaveProperty("kit");
  });
});
