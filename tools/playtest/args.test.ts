import { describe, expect, it } from "vitest";
import { near, parse } from "./args.ts";

describe("play:jump's command line", () => {
  it("reads a chapter, a scene and the options", () => {
    const args = parse(["riftlight-stuttering-flats", "sling", "--players", "3", "--flag", "a", "--flag", "b=false", "--fact", "tide=2", "--fact", "open=true", "--fact", "who=olivia", "--start", "--record", "1500", "--every", "100", "--reduced-motion", "--out", "x", "--travel"]);
    expect(args).toMatchObject({
      positional: ["riftlight-stuttering-flats", "sling"], players: 3, travel: true,
      flags: { a: true, b: false }, facts: { tide: 2, open: true, who: "olivia" },
      start: true, record: 1500, every: 100, reducedMotion: true, out: "x", open: false,
    });
  });
  it("defaults to a party table of two, still pictures only", () => {
    expect(parse(["gemfall-01"])).toMatchObject({ players: 2, travel: false, record: 0, start: false, flags: {}, facts: {} });
  });
  it("refuses what it cannot do, with the reason", () => {
    expect(() => parse(["x", "--players", "5"])).toThrow(/1 to 4/);
    expect(() => parse(["x", "--wat"])).toThrow(/unknown option --wat/);
    expect(() => parse(["x", "--record"])).toThrow(/--record needs a value/);
  });
  it("offers the nearest ids for a typo", () => {
    const scenes = ["sling", "sound", "lift", "loosen_mud", "lift_balance", "arrival"];
    expect(near("slng", scenes)[0]).toBe("sling");
    expect(near("loosen", scenes)[0]).toBe("loosen_mud");
    expect(near("riftlight-stutering", ["riftlight-stuttering-flats", "gemfall-01", "riftlight-finale"])[0]).toBe("riftlight-stuttering-flats");
  });
});
