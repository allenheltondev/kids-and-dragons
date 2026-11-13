import { describe, expect, it } from "vitest";
import { stageCast } from "./cast";
import { PULSE_BASE, PULSE_BEAT, PULSE_HOP, PULSE_STILL, pulseHop, pulseScale, speaksFor } from "./cast-pulse";

describe("who pulses when a recorded clip is heard (#551)", () => {
  const keysOf = (...members: { figure: string; name?: string; count?: number }[]): string[] => stageCast(members).map((m) => m.key);

  it("is the cast member standing as the speaker, and nobody else", () => {
    const keys = keysOf({ figure: "cast/pib", name: "Pib" }, { figure: "entities/faun", name: "Tansy" });
    expect(keys.filter((key) => speaksFor(key, { figure: "cast/pib", names: ["Pib"] }))).toEqual(["cast/pib|Pib"]);
    expect(keys.filter((key) => speaksFor(key, { figure: "entities/faun", names: ["Tansy"] }))).toEqual(["entities/faun|Tansy"]);
  });

  it("is found by name when the chapter paints them differently from the cast sheet", () => {
    // bramblewood-01 stands Pib as entities/pib; the cast sheet paints them cast/pib.
    expect(keysOf({ figure: "entities/pib", name: "Pib" }).filter((key) => speaksFor(key, { figure: "cast/pib", names: ["pib"] }))).toEqual(["entities/pib|Pib"]);
  });

  it("is found under an alias the cast sheet records, and a plural or an apostrophe changes nothing", () => {
    const soup = { figure: "cast/soup_woman", names: ["Soup Woman", "Marigold"] };
    expect(keysOf({ figure: "cast/soup_woman", name: "Marigold" }).filter((key) => speaksFor(key, soup))).toHaveLength(1);
    expect(keysOf({ figure: "cast/dock_worker", name: "Dock workers", count: 2 }).filter((key) => speaksFor(key, { figure: "cast/dock_worker", names: ["Dock worker"] }))).toHaveLength(2);
    expect(keysOf({ figure: "cast/gullets_cousin", name: "Gullets Cousins" }).filter((key) => speaksFor(key, { figure: "cast/gullets_cousin", names: ["Gullet's Cousins"] }))).toHaveLength(1);
  });

  it("is never another named person painted alike (#778 review)", () => {
    // The cast sheet paints Tansy, the faun prospector and others all as entities/faun.
    const prospector = { figure: "entities/faun", names: ["Faun prospector"] };
    expect(speaksFor("entities/faun|Tansy", prospector)).toBe(false);
    // Both on stage: only the one who is speaking.
    const both = keysOf({ figure: "entities/faun", name: "Tansy" }, { figure: "entities/faun", name: "Faun prospector" });
    expect(both.filter((key) => speaksFor(key, prospector))).toEqual(["entities/faun|Faun prospector"]);
    expect(both.filter((key) => speaksFor(key, { figure: "entities/faun", names: ["Tansy"] }))).toEqual(["entities/faun|Tansy"]);
    // Gullet is not Gullet's cousins, though one name begins the other.
    expect(speaksFor("cast/gullet|Gullet", { figure: "cast/gullets_cousin", names: ["Gullet's Cousins"] })).toBe(false);
  });

  it("is nobody when the speaker is off the stage and someone painted alike stands there", () => {
    // The tired carter speaks from off stage; only Tansy, another faun, is standing there.
    expect(keysOf({ figure: "entities/faun", name: "Tansy" }).some((key) => speaksFor(key, { figure: "entities/faun", names: ["Tired carter"] }))).toBe(false);
  });

  it("matches by painting only where a side has no name: an unnamed figure, or a speaker the sheet does not name", () => {
    expect(keysOf({ figure: "entities/faun" }).filter((key) => speaksFor(key, { figure: "entities/faun", names: ["Faun prospector"] }))).toHaveLength(1);
    expect(keysOf({ figure: "entities/faun", name: "Tansy" }).filter((key) => speaksFor(key, { figure: "entities/faun" }))).toHaveLength(1);
  });

  it("is a whole group, and every member of an ensemble, when they speak together", () => {
    expect(keysOf({ figure: "entities/sheeple", count: 3 }).filter((key) => speaksFor(key, { figure: "entities/sheeple" }))).toHaveLength(3);
    expect(keysOf({ figure: "entities/skywardens", name: "Skywardens" }).filter((key) => speaksFor(key, { figure: "entities/skywardens", names: ["Skywardens"] }))).toHaveLength(3);
  });

  it("is nobody for the narrator, an empty mark, or a figure or name that only begins the same", () => {
    const keys = keysOf({ figure: "cast/pib", name: "Pib" });
    expect(keys.some((key) => speaksFor(key, null))).toBe(false);
    expect(keys.some((key) => speaksFor(key, { figure: "", names: [] }))).toBe(false);
    expect(keys.some((key) => speaksFor(key, { figure: "cast/tansy", names: ["Tansy"] }))).toBe(false);
    expect(keys.some((key) => speaksFor(key, { figure: "cast/pi", names: ["Pi"] }))).toBe(false);
  });
});

describe("the pulse", () => {
  it("leaves a silent figure at its own size", () => {
    expect(pulseScale(0, 1.23, 0, false)).toBe(1);
    expect(pulseScale(0, 1.23, 0, true)).toBe(1);
  });

  it("beats between a small swell and a slightly larger one while speaking", () => {
    const sizes = Array.from({ length: 100 }, (_, i) => pulseScale(1, i / 100, 0, false));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(1 + PULSE_BASE - 1e-9);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1 + PULSE_BASE + PULSE_BEAT + 1e-9);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(PULSE_BEAT * 0.9);
  });

  it("holds still with reduced motion: a steady lift, no beat", () => {
    expect(new Set([0, 0.1, 0.37, 2].map((t) => pulseScale(1, t, 0, true)))).toEqual(new Set([1 + PULSE_STILL]));
    expect(pulseScale(0.5, 0, 0, true)).toBeCloseTo(1 + PULSE_STILL / 2);
  });
});

describe("the hop", () => {
  it("is the same share of the stage whatever the figure, rising and landing once a beat", () => {
    const hops = Array.from({ length: 200 }, (_, i) => pulseHop(1, i / 200, 0, false));
    expect(Math.max(...hops)).toBeCloseTo(PULSE_HOP, 3);
    expect(Math.min(...hops)).toBeCloseTo(0, 3);
  });

  it("is nothing when silent or with reduced motion", () => {
    expect(pulseHop(0, 0.3, 0, false)).toBe(0);
    expect(pulseHop(1, 0.3, 0, true)).toBe(0);
  });
});
