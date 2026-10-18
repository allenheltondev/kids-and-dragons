import { describe, expect, it } from "vitest";
import { checkFlairRequest, deriveBadges, PROFILE_FLAIR_VERSION, readFlair, type BadgeInput } from "./kid-profile";

const HOME = "h_home";
const input = (over: Partial<BadgeInput> = {}): BadgeInput => ({
  homeHouseholdId: HOME,
  finished: [],
  heroLevels: [1],
  souvenirs: [],
  finds: 0,
  ...over,
});
const line = (campaignId: string, at: string, table = HOME) => ({
  campaignId, title: campaignId === "gemfall" ? "Gemfall" : "Bramblewood", outcome: "success" as const, at, table,
});
const ids = (i: BadgeInput): string[] => deriveBadges(i).map((b) => b.id);

describe("badges are derived from what the game already keeps", () => {
  it("has none for a kid who has done nothing yet", () => {
    expect(deriveBadges(input())).toEqual([]);
  });

  it("names a finisher badge after the campaign's title, once, even for a loss ending", () => {
    const badges = deriveBadges(input({
      finished: [line("gemfall", "2026-02-01"), { ...line("gemfall", "2026-03-01"), outcome: "setback" }],
    }));
    expect(badges).toEqual([expect.objectContaining({ id: "finished:gemfall", name: "Gemfall Finisher" })]);
  });

  it("earns Guest Star only from a campaign finished at somebody else's table", () => {
    expect(ids(input({ finished: [line("gemfall", "2026-02-01")] }))).not.toContain("guest-star");
    expect(ids(input({ finished: [line("gemfall", "2026-02-01", "h_rue")] }))).toContain("guest-star");
  });

  it("earns Story Collector at three campaigns, and Kept Going from a keepsake", () => {
    const three = ["a", "b", "c"].map((c, i) => line(c, `2026-0${i + 1}-01`));
    expect(ids(input({ finished: three }))).toContain("finished-3");
    expect(ids(input({ finished: three.slice(0, 2) }))).not.toContain("finished-3");
    expect(ids(input({ souvenirs: [{ id: "cracked_pendant" }] }))).toEqual(["kept-going"]);
  });

  it("steps up with levels and finds", () => {
    expect(ids(input({ heroLevels: [2, 3] }))).toEqual(["level-3"]);
    expect(ids(input({ heroLevels: [5] }))).toEqual(["level-3", "level-5"]);
    expect(ids(input({ finds: 1 }))).toEqual(["finds-1"]);
    expect(ids(input({ finds: 15 }))).toEqual(["finds-1", "finds-5", "finds-15"]);
  });
});

describe("what she chose", () => {
  const heroes = new Set(["c_1"]);
  const badges = [{ id: "finds-1" }];

  it("reads a stored choice, dropping what is no longer there", () => {
    const stored = { v: PROFILE_FLAIR_VERSION, color: "berry", frames: { c_1: "ivy", c_gone: "stars" }, title: "finds-1" };
    expect(readFlair(stored, heroes, badges)).toEqual({ v: 1, color: "berry", frames: { c_1: "ivy" }, title: "finds-1" });
    expect(readFlair({ ...stored, color: "neon", title: "finished:gemfall" }, heroes, badges)).toEqual({ v: 1, frames: { c_1: "ivy" } });
  });

  it("reads nothing from a missing, malformed or newer row", () => {
    for (const raw of [undefined, null, "x", [], { color: "berry" }, { v: 2, color: "berry" }]) {
      expect(readFlair(raw, heroes, badges)).toBeNull();
    }
  });

  it("accepts a request for presets, her own heroes and an earned title", () => {
    expect(checkFlairRequest({ color: "sky", frames: { c_1: "stars" }, title: "finds-1" }, heroes, badges)).toEqual({
      ok: true, flair: { v: 1, color: "sky", frames: { c_1: "stars" }, title: "finds-1" },
    });
    // Plain is the absence of a frame, and choosing nothing stores nothing.
    expect(checkFlairRequest({ frames: { c_1: "plain" } }, heroes, badges)).toEqual({ ok: true, flair: null });
    expect(checkFlairRequest({ color: null, title: null }, heroes, badges)).toEqual({ ok: true, flair: null });
  });

  it("refuses anything that is not a preset, her hero or her badge", () => {
    for (const body of [
      null, [], "sky", { color: "#ff0000" }, { color: "Sky" }, { frames: { c_1: "gold" } }, { frames: { c_other: "ivy" } },
      { frames: [] }, { title: "Dragon King" }, { title: "finished:gemfall" }, { title: 7 },
    ]) {
      expect(checkFlairRequest(body, heroes, badges).ok, JSON.stringify(body)).toBe(false);
    }
  });
});
