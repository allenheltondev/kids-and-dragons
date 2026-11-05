import { describe, expect, it } from "vitest";
import {
  CAMP_VERSION,
  campView,
  emptyCamp,
  emptyKit,
  frameStageFor,
  growCamp,
  migrateCamp,
  migrateKit,
  milestonePieces,
  readKit,
  StoredCampError,
  withMilestones,
} from "./camp-record.js";
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
    expect(migrateKit({ ...emptyKit(), style: "tent_round" })).toEqual({ ...emptyKit(), style: "tent_round" });
    expect(() => migrateKit({ unlocked: { x: { from: "crew" } } })).toThrow(/kit\.unlocked\.x\.from/);
  });

  it("unlocks a tent per painted tier reached and a decoration per distinction, from both halves", () => {
    const h = hero({
      committed: { ...hero().committed, tier: "sworn", mastery: { songkeeper: { rank: "expert", deeds: {} } } },
      provisional: { ...hero().committed, tier: "ascendant", mastery: { thornguard: { rank: "apprentice", deeds: {} } }, runId: "r_1" },
    });
    expect(milestonePieces(h)).toEqual([
      "kit_deco_songkeeper_apprentice",
      "kit_deco_songkeeper_expert",
      "kit_deco_thornguard_apprentice",
      "kit_tent_mythic",
      "kit_tent_radiant",
      "kit_tent_sworn",
    ]);
    const kit = withMilestones(emptyKit(), h, "2026-08-01T00:00:00.000Z");
    expect(kit.unlocked["kit_tent_sworn"]).toEqual({ from: "milestone", at: "2026-08-01T00:00:00.000Z" });
    expect(withMilestones(kit, h)).toBe(kit);
    expect(kit.revision).toBe(0);
  });

  it("a failed campaign keeps the kit, and the pieces of a tier it puts back (§5.4)", () => {
    const kit = { ...emptyKit(), revision: 2, style: "tent_round", unlocked: { feather: { from: "found" as const, at: "t" } } };
    const h = hero({ kit, provisional: { ...hero().committed, tier: "sworn", runId: "r_1" } });
    const failed = failCampaign(h, "souvenir", "2026-08-01T00:00:00.000Z");
    expect(failed.committed.tier).toBe("fledgling");
    expect(failed.kit).toMatchObject({ revision: 2, style: "tent_round", unlocked: { feather: kit.unlocked.feather } });
    expect(failed.kit?.unlocked["kit_tent_sworn"]).toEqual({ from: "milestone", at: "2026-08-01T00:00:00.000Z" });
    expect(readKit(failed).unlocked["kit_tent_sworn"]).toBeDefined();
    // A hero with nothing to keep is left exactly as she was.
    expect(failCampaign(hero(), "s", "t")).not.toHaveProperty("kit");
    expect(commitCampaign(h).kit).toEqual(kit);
  });
});

describe("the character ladder's kit backfill (v8 → v9, §12.3)", () => {
  it("grants an existing hero the milestones she holds, and run twice gives the same hero", () => {
    const v8 = { ...hero({ committed: { ...hero().committed, tier: "radiant" } }), version: 4 };
    const once = migrateCharacter(v8, 8);
    expect(Object.keys(once.kit?.unlocked ?? {}).sort()).toEqual(["kit_tent_radiant", "kit_tent_sworn"]);
    expect(once.kit?.unlocked["kit_tent_radiant"]).toEqual({ from: "milestone" });
    expect(migrateCharacter(v8, 8)).toEqual(once);
    // Written back at the current version and read again: unchanged.
    expect(migrateCharacter(JSON.parse(JSON.stringify(once)), CHARACTER_VERSION)).toEqual(once);
  });

  it("leaves a kit the row already has, and a hero with nothing earned, as stored", () => {
    const kit = { ...emptyKit(), style: "tent_round" };
    expect(migrateCharacter({ ...hero({ committed: { ...hero().committed, tier: "sworn" } }), kit }, 8).kit).toEqual(kit);
    expect(migrateCharacter(hero(), 8)).not.toHaveProperty("kit");
  });
});
