/**
 * True relative size and stance (#362): the owner's rules, as numbers.
 */

import { describe, expect, it } from "vitest";
import { ANCHOR_Y } from "./art-paths";
import { STORY_MEASURE, stageLayout, type StageFigure } from "./cast";
import {
  NOMINAL_PAINT,
  STANCE_LIFT,
  STANCE_LIFT_CM,
  castSize,
  drawnHeight,
  figureSize,
  fitCanvas,
  floorHeightCm,
  floored,
  heightFit,
  overflowOf,
  overflows,
  paintAspect,
  reachCm,
  stanceLift,
  stanceReach,
  widthFit,
  type SizedFigure,
} from "./figure-scale";
import { FLY_DRIFT, HOVER_BOB, STAND_SWAY, stanceIdle } from "./idle-motion";

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

  it("shrinks the stage a little for a big figure, so a troll is still shown whole", () => {
    const troll = standing(330);
    const fit = stageLayout(party, [troll], 2560);
    expect(fit.k).toBeLessThan(1);
    expect(fit.k).toBeGreaterThanOrEqual(STORY_MEASURE.minScale!);
    expect(fit.castOverflow).toEqual([null]);
    expect(fit.cast[0]).toBeCloseTo(STORY_MEASURE.headroom);
    expect(fit.cast[0]! / fit.party[2]!).toBeCloseTo(330 / 215);
  });

  it("lets a huge tall figure run off the top instead of shrinking anyone", () => {
    const dragon: StageFigure = { heightCm: 1400, stance: "standing", paint: { top: 0.01, bottom: 0.99, left: 0.02, right: 0.98 } };
    const fit = stageLayout(party, [dragon], 2560);
    expect(fit.castOverflow).toEqual(["top"]);
    // The heroes keep their natural size, and the dragon is capped, still taller than the frame.
    expect(fit.k).toBe(1);
    expect(fit.party[2]).toBeCloseTo(215 * STORY_MEASURE.pxPerCm);
    expect(fit.cast[0]).toBeCloseTo(STORY_MEASURE.maxHeight!);
    expect(fit.cast[0]).toBeGreaterThan(STORY_MEASURE.headroom);
    // Feet on the ground: nothing trims its lift.
    expect(fit.castMaxLift[0]).toBe(Infinity);
  });

  it("lets a huge wide figure run off the right, fitting the frame's height", () => {
    const whale: StageFigure = { heightCm: 1100, stance: "flying", paint: { top: 0.27, bottom: 0.72, left: 0.0, right: 1.0 } };
    const fit = stageLayout(party, [whale], 2560);
    expect(fit.castOverflow).toEqual(["right"]);
    expect(fit.k).toBe(1);
    // Its body and what is left of its lift fit under the frame.
    // Its body, what is left of its lift and its idle's drift fit under the frame.
    expect(fit.cast[0]! * (1 + FLY_DRIFT) + fit.castMaxLift[0]!).toBeLessThanOrEqual(STORY_MEASURE.headroom);
    // Wider than its slot: it runs past the band's edge.
    expect(fit.cast[0]! * paintAspect(whale.paint!)).toBeGreaterThan(fit.slots.castSlots[0]!);
  });

  it("takes the manifest's word on which way a figure overflows over its painting's shape", () => {
    const wide = { top: 0.3, bottom: 0.7, left: 0, right: 1 };
    expect(overflowOf({ heightCm: 900, stance: "standing", paint: wide })).toBe("right");
    expect(overflowOf({ heightCm: 900, stance: "standing", paint: wide, overflow: "top" })).toBe("top");
    expect(overflowOf({ heightCm: 900, stance: "standing", paint: null })).toBe("top");
    expect(castSize("entities/cloud_whale").overflow).toBe("right");
    expect(castSize("entities/legend_dragon").overflow).toBe("top");
    expect(overflows({ heightCm: 330, stance: "standing", paint: null }, STORY_MEASURE)).toBe(false);
    expect(overflows({ heightCm: 900, stance: "standing", paint: null }, STORY_MEASURE)).toBe(true);
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
    // At natural scale the floor is a 32 cm figure, so Pib, "the size of a teapot", stands on it.
    expect(floorHeightCm(1, STORY_MEASURE)).toBeCloseTo(32);
    expect(floored(standing(25), 1, STORY_MEASURE)).toBe(true);
  });

  it("stays at natural scale with a dragon in view, since the dragon overflows instead", () => {
    const fit = stageLayout(party, [standing(1400), standing(25)], 2560);
    expect(fit.cast[1]).toBe(STORY_MEASURE.floor);
    expect(floorHeightCm(fit.k, STORY_MEASURE)).toBeCloseTo(32);
    // A kitsune hero is drawn true, not floored.
    expect(fit.party[1]).toBeCloseTo(85 * STORY_MEASURE.pxPerCm);
  });

  it("never shrinks below minScale, however a big figure is", () => {
    // 350 cm overflows at 0.85 by a hair less than it needs; 400 does overflow.
    const fit = stageLayout(party, [standing(400)], 2560);
    expect(fit.k).toBeGreaterThanOrEqual(STORY_MEASURE.minScale!);
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

  it("breathes and leans a little when standing, with its feet where they were", () => {
    for (const t of seconds) {
      const idle = stanceIdle("standing", t, 0);
      expect(idle).toMatchObject({ dx: 0, dy: 0, shadow: 1, ripple: 1 });
      expect(Math.abs(idle.rotation)).toBeLessThanOrEqual(STAND_SWAY);
    }
    expect(stanceIdle("standing", 2, 0).breath).toBeGreaterThan(0);
    expect(seconds.some((t) => stanceIdle("standing", t, 0).rotation !== 0)).toBe(true);
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

describe("how high a stance holds a figure", () => {
  const px = STORY_MEASURE.pxPerCm;

  it("anchors hovering at two feet and flying at six, whatever the figure's size", () => {
    expect(STANCE_LIFT_CM.hovering).toBe(61);
    expect(STANCE_LIFT_CM.flying).toBe(183);
    // A moth and a griffin fly at the same height: the moth's own 40% is a speck beside it.
    const moth = stanceLift("flying", 80, 1, STORY_MEASURE);
    expect(moth).toBeCloseTo(183 * px);
    expect(moth).toBeGreaterThan(STANCE_LIFT.flying * 80 * 10);
    expect(stanceLift("hovering", 80, 1, STORY_MEASURE)).toBeCloseTo(61 * px);
  });

  it("lifts a big flyer by its own share when that is higher, and never below the anchor", () => {
    const big = 1500;
    expect(stanceLift("flying", big, 1, STORY_MEASURE)).toBeCloseTo(STANCE_LIFT.flying * big);
    expect(stanceLift("flying", 400, 1, STORY_MEASURE)).toBeCloseTo(183 * px);
  });

  it("shrinks with the stage, and leaves standing and swimming as they were", () => {
    expect(stanceLift("flying", 80, 0.5, STORY_MEASURE)).toBeCloseTo(0.5 * 183 * px);
    expect(stanceLift("standing", 400, 1, STORY_MEASURE)).toBe(0);
    expect(stanceLift("swimming", 400, 0.5, STORY_MEASURE)).toBeCloseTo(STANCE_LIFT.swimming * 400);
  });

  it("makes room in the frame for the lift: a person-sized flyer shrinks the stage, a moth does not", () => {
    expect(reachCm(160, "flying")).toBe(160 + 183);
    const griffin: SizedFigure = { heightCm: 170, stance: "flying", paint: null };
    const moth: SizedFigure = { heightCm: 18, stance: "flying", paint: null };
    expect(heightFit([griffin], STORY_MEASURE)).toBeLessThan(1);
    expect(heightFit([moth], STORY_MEASURE)).toBe(1);
  });
});
