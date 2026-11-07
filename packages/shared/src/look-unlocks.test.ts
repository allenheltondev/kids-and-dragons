/**
 * Earned looks (docs/hero-looks.md §6; #669): which milestones a standing has
 * earned, how a find is shared out by species, and that receipts are only ever
 * added, once, with where they came from.
 */

import { describe, expect, it } from "vitest";
import { makeCharacter } from "./test-fixtures.js";
import { coatPaintKey, coatPaintOf, coatShimmers, emptyLook, lookView } from "./hero-look.js";
import {
  earnedLooks,
  foundLookGrants,
  heroLookStanding,
  lookHasAnything,
  milestoneGrants,
  readEarnedLook,
  withLookGrants,
} from "./look-unlocks.js";
import type { LookCatalog } from "./types/look.js";

const CATALOG: LookCatalog = {
  coats: [
    { id: "unicorn_sky", name: "Sky", unlock: { from: "starter" }, species: ["unicorn"], color: "#3EC3FD" },
    { id: "unicorn_aurora", name: "Aurora", unlock: { from: "found" }, species: ["unicorn"], color: "#0FD18B", effect: { kind: "shimmer" } },
    { id: "bigfoot_aurora", name: "Aurora", unlock: { from: "found" }, species: ["bigfoot"], color: "#0FD18B", effect: { kind: "shimmer" } },
    { id: "unicorn_ripple", name: "Ripple", unlock: { from: "milestone", tier: "radiant" }, species: ["unicorn"], color: "#F89DC9", effect: { kind: "two-tone", dark: "#742651" } },
    { id: "bigfoot_ripple", name: "Ripple", unlock: { from: "milestone", tier: "radiant" }, species: ["bigfoot"], color: "#F89DC9", effect: { kind: "two-tone", dark: "#742651" } },
  ],
  nameplates: [
    { id: "plain", name: "Plain", unlock: { from: "starter" } },
    { id: "songbird", name: "Songbird", unlock: { from: "found" }, art: "nameplates/songbird.webp" },
    { id: "golden", name: "Golden", unlock: { from: "milestone", tier: "mythic" }, art: "nameplates/golden.webp" },
  ],
  titles: [
    { id: "the_bold", text: "the Bold", unlock: { from: "starter" } },
    { id: "the_sworn", text: "the Sworn", unlock: { from: "milestone", tier: "sworn" } },
    { id: "thornguard_master", text: "Thornguard Master", unlock: { from: "milestone", classRank: { class: "thornguard", rank: "master" } } },
    { id: "of_the_gemfall", text: "of the Gemfall", unlock: { from: "milestone", campaign: "gemfall" } },
    { id: "friend_of_bun", text: "Friend of Bun", unlock: { from: "milestone", friend: "bun" } },
    { id: "the_friendly", text: "the Friendly", unlock: { from: "milestone", camp: "firstFriend" } },
    { id: "keeper", text: "Keeper of the Fire", unlock: { from: "milestone", camp: "fullCamp" } },
    { id: "the_tracker", text: "the Tracker", unlock: { from: "found" } },
  ],
};

const ids = (list: { id: string }[]) => list.map((e) => e.id).sort();

describe("earnedLooks: the milestones a standing has earned (§6)", () => {
  it("reads tiers at and below the one reached, from either progress half", () => {
    const hero = makeCharacter({ species: "unicorn" });
    expect(earnedLooks(CATALOG, heroLookStanding(hero))).toEqual([]);
    hero.provisional = { ...structuredClone(hero.committed), tier: "radiant", runId: "r_1" };
    expect(ids(earnedLooks(CATALOG, heroLookStanding(hero)))).toEqual(["the_sworn", "unicorn_ripple"]);
  });

  it("gives a coat only to its own species", () => {
    const bigfoot = makeCharacter({ species: "bigfoot" });
    bigfoot.committed.tier = "radiant";
    expect(ids(earnedLooks(CATALOG, heroLookStanding(bigfoot)))).toEqual(["bigfoot_ripple", "the_sworn"]);
  });

  it("reads a class rank held, a finished campaign, and the camp only when given one", () => {
    const hero = makeCharacter({ species: "unicorn" });
    hero.committed.mastery = { thornguard: { rank: "master", deeds: {} } } as typeof hero.committed.mastery;
    hero.finished = [{ campaignId: "gemfall", outcome: "setback", at: "2026-01-01T00:00:00.000Z", table: "h_1" }];
    const names = { campaign: (id: string) => (id === "gemfall" ? "The Gemfall" : undefined), friend: () => "Bun" };
    const earned = earnedLooks(CATALOG, heroLookStanding(hero), names);
    expect(earned.map((e) => [e.id, e.cause, e.source])).toEqual([
      ["thornguard_master", "rank", "Became a Thornguard Master"],
      ["of_the_gemfall", "campaign", "Finished The Gemfall"],
    ]);
    const camp = earnedLooks(CATALOG, heroLookStanding(hero, [], { friends: ["bun"], frameStage: 4 }), names);
    expect(ids(camp.filter((e) => e.cause === "camp"))).toEqual(["friend_of_bun", "keeper", "the_friendly"]);
    const small = earnedLooks(CATALOG, heroLookStanding(hero, [], { friends: [], frameStage: 3 }), names);
    expect(small.filter((e) => e.cause === "camp")).toEqual([]);
  });
});

describe("withLookGrants: receipts, once, never taken back (§6)", () => {
  it("adds each new look once with where it came from, keeps the first receipt, and never touches her choices", () => {
    const look = { ...emptyLook(), revision: 3, title: "the_bold" };
    const once = withLookGrants(look, [{ id: "the_tracker", from: "found", rewardId: "ch.tracker", source: "Found in Ch" }], "2026-11-07T00:00:00.000Z");
    expect(once.unlocked["the_tracker"]).toEqual({ from: "found", rewardId: "ch.tracker", at: "2026-11-07T00:00:00.000Z", source: "Found in Ch" });
    expect(once.revision).toBe(3);
    expect(once.title).toBe("the_bold");
    // A second grant of the same look, from anywhere, is nothing: the same object back.
    expect(withLookGrants(once, [{ id: "the_tracker", from: "found", rewardId: "other.reward" }], "later")).toBe(once);
    expect(lookView(once, { sources: true }).sources).toEqual({ the_tracker: "Found in Ch" });
  });
});

describe("foundLookGrants: a find shared out to each hero (§6)", () => {
  it("gives every frame and title, and the coat of her own species alone", () => {
    const looks = ["unicorn_aurora", "bigfoot_aurora", "songbird"];
    expect(ids(foundLookGrants(CATALOG, looks, "unicorn", "r.x"))).toEqual(["songbird", "unicorn_aurora"]);
    expect(ids(foundLookGrants(CATALOG, looks, "bigfoot", "r.x"))).toEqual(["bigfoot_aurora", "songbird"]);
    // Never a starter or a milestone look, and never one the catalog does not have.
    expect(foundLookGrants(CATALOG, ["the_bold", "golden", "nope"], "unicorn", "r.x")).toEqual([]);
  });
});

describe("readEarnedLook: milestones backfilled on read (camp.md §12.3)", () => {
  it("adds what her row holds with no `at`, returns a stored look unchanged when nothing is new, and reads nothing without a catalog", () => {
    const hero = makeCharacter({ species: "unicorn" });
    expect(lookHasAnything(readEarnedLook(CATALOG, hero))).toBe(false);
    hero.committed.tier = "sworn";
    const read = readEarnedLook(CATALOG, hero);
    expect(read.unlocked).toEqual({ the_sworn: { from: "milestone", source: "Reached Sworn" } });
    expect(hero.look).toBeUndefined();
    const stored = { ...emptyLook(), revision: 1, unlocked: { the_sworn: { from: "milestone" as const, at: "then" } } };
    expect(readEarnedLook(CATALOG, { ...hero, look: stored })).toBe(stored);
    expect(readEarnedLook(null, hero)).toEqual(emptyLook());
    expect(milestoneGrants(earnedLooks(CATALOG, heroLookStanding(hero)))).toEqual([{ id: "the_sworn", from: "milestone", source: "Reached Sworn" }]);
  });
});

describe("special coats' paint (§5.5)", () => {
  it("paints a two-tone coat by both its colours, a shimmer as its base, and keys each apart", () => {
    const [, aurora, , ripple] = CATALOG.coats;
    expect(coatPaintOf(ripple!)).toEqual({ kind: "two-tone", color: "#F89DC9", dark: "#742651" });
    expect(coatPaintOf(aurora!)).toEqual({ kind: "plain", color: "#0FD18B" });
    expect(coatShimmers(aurora)).toBe(true);
    expect(coatShimmers(ripple)).toBe(false);
    expect(coatShimmers(null)).toBe(false);
    expect(coatPaintOf({ color: "#0fd18b", effect: { kind: "shimmer", dark: "#222a79" } })).toEqual({ kind: "two-tone", color: "#0FD18B", dark: "#222A79" });
    expect(coatPaintKey(coatPaintOf(ripple!))).not.toBe(coatPaintKey({ kind: "plain", color: "#F89DC9" }));
  });
});
