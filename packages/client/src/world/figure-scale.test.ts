/**
 * True relative size and stance (#362): the owner's rules, as numbers.
 */

import { describe, expect, it } from "vitest";
import { ANCHOR_Y } from "./art-paths";
import { STORY_MEASURE, stageLayout, type StageFigure } from "./cast";
import {
  NOMINAL_PAINT,
  STANCE_LIFT,
  castSize,
  drawnHeight,
  figureSize,
  fitCanvas,
  floorHeightCm,
  floored,
  heightFit,
  paintAspect,
  stanceReach,
  widthFit,
  type SizedFigure,
} from "./figure-scale";
import { HOVER_BOB, stanceIdle } from "./idle-motion";

const standing = (heightCm: number, paint: StageFigure["paint"] = null): StageFigure => ({ heightCm, stance: "standing", paint });
/** A unicorn, a kitsune and a bigfoot, with their Fledgling art as measured. */
const party = [
  standing(165, { top: 0.078, bottom: 0.878, left: 0.146, right: 0.854 }),
  standing(85, { top: 0.077, bottom: 0.878, left: 0.123, right: 0.877 }),
  standing(215, { top: 0.077, bottom: 0.878, left: 0.262, right: 0.737 }),
];

describe("true proportion", () => {
  it("draws everybody at natural scale when they all fit, in the ratio of their heights", () => {
    // A TV's stage above the narration is far wider than 16:9 (scene.ts stageWidth).
    const fit = stageLayout(party, [standing(160)], 2400);
    expect(fit.k).toBe(1);
    expect(fit.party[0]! / fit.party[1]!).toBeCloseTo(165 / 85);
    expect(fit.party[2]! / fit.cast[0]!).toBeCloseTo(215 / 160);
    // 2.5 units a centimeter: a faun stands where a hero always stood.
    expect(fit.cast[0]).toBeCloseTo(400);
  });

  it("never grows a scene of small things to fill the frame", () => {
    const fit = stageLayout([standing(85)], [standing(25)], 1600);
    expect(fit.k).toBe(1);
    expect(fit.party[0]).toBeCloseTo(85 * STORY_MEASURE.pxPerCm);
  });

  it("shows a huge thing whole: the tallest fits, and everyone shrinks with it", () => {
    const dragon = standing(1400);
    const fit = stageLayout(party, [dragon], 2560);
    expect(fit.k).toBeLessThan(1);
    expect(fit.cast[0]).toBeLessThanOrEqual(STORY_MEASURE.headroom + 1e-6);
    // Proportion holds between everybody above the floor.
    expect(fit.cast[0]! / fit.party[2]!).toBeCloseTo(1400 / 215);
  });

  it("counts a stance's lift against the headroom, so a flyer is not cut off at the top", () => {
    const whale: SizedFigure = { heightCm: 1100, stance: "flying", paint: null };
    const k = heightFit([whale], STORY_MEASURE);
    expect(1100 * STORY_MEASURE.pxPerCm * k * stanceReach("flying")).toBeCloseTo(STORY_MEASURE.headroom);
    // A swimmer only shows what is above the water line.
    expect(stanceReach("swimming")).toBeLessThan(1);
  });

  it("fits a wide figure into its slot by shrinking the whole stage, not just it", () => {
    const wide: StageFigure = { heightCm: 400, stance: "standing", paint: { top: 0.4, bottom: 0.8, left: 0, right: 1 } };
    const fit = stageLayout(party, [wide, standing(160), standing(160)], 1600);
    expect(fit.k).toBeLessThan(1);
    expect(fit.party[0]! / fit.cast[1]!).toBeCloseTo(165 / 160);
  });

  it("keeps the slowest of several limits", () => {
    expect(widthFit([100, 300, 50], [200, 150, 10])).toBeCloseTo(0.2);
    expect(widthFit([100], [200])).toBe(1);
  });
});

describe("the floor", () => {
  it("stops a tiny thing shrinking past a readable size, and says so", () => {
    const sprite = standing(20);
    expect(floored(sprite, 1, STORY_MEASURE)).toBe(true);
    expect(drawnHeight(sprite, 1, STORY_MEASURE)).toBe(STORY_MEASURE.floor);
    // At natural scale the floor is a 25 cm figure: Pib, "the size of a teapot".
    expect(floorHeightCm(1, STORY_MEASURE)).toBeCloseTo(25.6, 1);
  });

  it("climbs when a huge figure shrinks the stage, which is where proportion gives", () => {
    const fit = stageLayout(party, [standing(1400), standing(25)], 2560);
    expect(fit.cast[1]).toBe(STORY_MEASURE.floor);
    // With a dragon in view, everything under about a meter and a half floors.
    expect(floorHeightCm(fit.k, STORY_MEASURE)).toBeGreaterThan(85);
    expect(fit.party[1]).toBe(STORY_MEASURE.floor);
  });
});

describe("the art's own paint", () => {
  it("scales the canvas so the paint, not the canvas, is the height", () => {
    const wisp = { top: 0.625, bottom: 0.822, left: 0.45, right: 0.55 };
    const { canvas, offsetY } = fitCanvas(100, wisp);
    expect(canvas * (wisp.bottom - wisp.top)).toBeCloseTo(100);
    // Painted floating mid-canvas: moved down so its lowest row is on the line.
    expect(offsetY).toBeCloseTo((ANCHOR_Y - wisp.bottom) * canvas);
    expect(offsetY).toBeGreaterThan(0);
  });

  it("measures a hero against the nominal box, so a Mythic's taller painting still shows", () => {
    const mythic = { top: 0.016, bottom: 0.878, left: 0.04, right: 0.96 };
    expect(fitCanvas(400, mythic, NOMINAL_PAINT).canvas).toBeCloseTo(400 / (NOMINAL_PAINT.bottom - NOMINAL_PAINT.top));
    expect(paintAspect({ top: 0, bottom: 0.5, left: 0, right: 1 })).toBe(2);
  });
});

describe("sizes and stances from data", () => {
  it("reads canon's heights, and lets a chapter's band and stance over them", () => {
    expect(figureSize("characters/bigfoot").heightCm).toBeGreaterThan(figureSize("characters/kitsune").heightCm);
    expect(castSize("entities/faun", "small")).toEqual({ heightCm: 75, stance: "standing" });
    expect(castSize("cast/captain_voss", undefined, "flying").stance).toBe("flying");
  });

  it("lifts a flyer further than a hoverer, and sinks a swimmer", () => {
    expect(STANCE_LIFT.standing).toBe(0);
    expect(STANCE_LIFT.flying).toBeGreaterThan(STANCE_LIFT.hovering);
    expect(STANCE_LIFT.swimming).toBeLessThan(0);
  });
});

describe("stance idles", () => {
  const seconds = [0, 0.7, 1.5, 2.2, 3.1, 4.4];

  it("breathes when standing and moves nothing else", () => {
    for (const t of seconds) {
      const idle = stanceIdle("standing", t, 0);
      expect(idle).toMatchObject({ dx: 0, dy: 0, rotation: 0, shadow: 1, ripple: 1 });
    }
    expect(stanceIdle("standing", 3, 0).breath).toBeGreaterThan(0);
  });

  it("bobs a hoverer up, never down through its rest, and tightens its shadow as it rises", () => {
    const peak = stanceIdle("hovering", 1.5, 0);
    expect(peak.dy).toBeCloseTo(-HOVER_BOB);
    expect(peak.shadow).toBeLessThan(1);
    for (const t of seconds) expect(stanceIdle("hovering", t, 0).dy).toBeLessThanOrEqual(0);
  });

  it("drifts and sways a flyer, and lets a swimmer rise, fall and ripple", () => {
    const flight = seconds.map((t) => stanceIdle("flying", t, 0));
    expect(new Set(flight.map((f) => f.dx.toFixed(4))).size).toBeGreaterThan(1);
    expect(flight.some((f) => f.rotation !== 0)).toBe(true);
    const swim = seconds.map((t) => stanceIdle("swimming", t, 0));
    expect(swim.some((f) => f.dy > 0) && swim.some((f) => f.dy < 0)).toBe(true);
    expect(swim.some((f) => f.ripple !== 1)).toBe(true);
    expect(swim.every((f) => f.breath === 0)).toBe(true);
  });

  it("holds every stance perfectly still under reduced motion", () => {
    for (const stance of ["standing", "hovering", "flying", "swimming"] as const) {
      for (const t of seconds) {
        expect(stanceIdle(stance, t, 1.3, true)).toEqual({ dx: 0, dy: 0, rotation: 0, breath: 0, shadow: 1, ripple: 1 });
      }
    }
  });
});
