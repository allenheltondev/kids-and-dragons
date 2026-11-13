import { describe, expect, it } from "vitest";
import { stageCast } from "./cast";
import { PULSE_BASE, PULSE_BEAT, PULSE_HOP, PULSE_STILL, pulseHop, pulseScale, speaksFor } from "./cast-pulse";

describe("who pulses when a recorded clip is heard (#551)", () => {
  it("is the cast member standing with the speaker's figure, and nobody else", () => {
    const keys = stageCast([{ figure: "cast/pib", name: "Pib" }, { figure: "entities/faun", name: "Tansy" }]).map((m) => m.key);
    expect(keys.filter((key) => speaksFor(key, { figure: "cast/pib", name: "Pib" }))).toEqual(["cast/pib|Pib"]);
    expect(keys.filter((key) => speaksFor(key, { figure: "entities/faun", name: "Tansy" }))).toEqual(["entities/faun|Tansy"]);
  });

  it("is found by name when the chapter draws them with another painting than the cast sheet's", () => {
    // bramblewood-01 stands Pib as entities/pib; the cast sheet paints them cast/pib.
    const keys = stageCast([{ figure: "entities/pib", name: "Pib" }]).map((m) => m.key);
    expect(keys.filter((key) => speaksFor(key, { figure: "cast/pib", name: "pib" }))).toEqual(["entities/pib|Pib"]);
  });

  it("is a whole group, and every member of an ensemble, when they speak together", () => {
    const sheep = stageCast([{ figure: "entities/sheeple", count: 3 }]).map((m) => m.key);
    expect(sheep.filter((key) => speaksFor(key, { figure: "entities/sheeple" }))).toHaveLength(3);
    const guards = stageCast([{ figure: "entities/skywardens", name: "Skywardens" }]).map((m) => m.key);
    expect(guards.filter((key) => speaksFor(key, { figure: "entities/skywardens", name: "Skywardens" }))).toHaveLength(3);
  });

  it("is nobody for the narrator, a speaker off the stage, or a figure or name that only begins the same", () => {
    const keys = stageCast([{ figure: "cast/pib", name: "Pib" }]).map((m) => m.key);
    expect(keys.some((key) => speaksFor(key, null))).toBe(false);
    expect(keys.some((key) => speaksFor(key, { figure: "", name: "" }))).toBe(false);
    expect(keys.some((key) => speaksFor(key, { figure: "cast/tansy", name: "Tansy" }))).toBe(false);
    expect(keys.some((key) => speaksFor(key, { figure: "cast/pi", name: "Pi" }))).toBe(false);
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
