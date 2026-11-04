/**
 * The paper-puppet walk and the camp's poses, held to docs/camp.md §8.2 and
 * the §8.6 rules as numbers. No Pixi: these are curves.
 */

import { describe, expect, it } from "vitest";
import type { CastStance } from "@kad/shared";
import { campLayoutFixture } from "../testing/camp-fixture";
import { CAMP_ACTIONS, campRoute, laneAt, type RoutePoint } from "./camp-layout";
import {
  AIR_END,
  AIR_START,
  EASED_STEP,
  HOP,
  LEAN,
  MAX_FRAME_S,
  PART_REST,
  SQUASH,
  TURN_LEAD_S,
  WOBBLE,
  actionPose,
  activeHotspots,
  FLOOR_SHARE,
  HERO_SHARE,
  MAX_SHARE,
  campGait,
  campHeightPx,
  campStride,
  campMeasure,
  frameSeconds,
  partMotion,
  planWalk,
  walkPose,
  walkSpeed,
  type CampWalk,
} from "./camp-motion";

const layout = campLayoutFixture();
const canvas = layout.canvas;
const PX_PER_CM = (0.26 * 1080) / 160;

/** The figures the walk has to suit: a duckling, a kitsune, a hero, a mosshorn, the boughkin. */
const SIZES: [string, number, CastStance][] = [
  ["duckling", 20, "standing"],
  ["kitsune", 85, "standing"],
  ["hero", 160, "standing"],
  ["mosshorn", 150, "standing"],
  ["boughkin", 900, "standing"],
];

const ROUTES: [string, RoutePoint[]][] = [
  ["along the middle lane", campRoute(layout, { lane: "middle", x: 0.42 }, { lane: "middle", x: 0.58 })!],
  ["back to near, leftwards", campRoute(layout, { lane: "back", x: 0.24 }, { lane: "near", x: 0.3 })!],
  ["near to back, rightwards", campRoute(layout, { lane: "near", x: 0.64 }, { lane: "back", x: 0.76 })!],
  ["out and back across", campRoute(layout, { lane: "back", x: 0.2 }, { lane: "near", x: 0.22 })!],
  ["a single short step", campRoute(layout, { lane: "near", x: 0.46 }, { lane: "near", x: 0.47 })!],
];

function walkFor(heightCm: number, route: RoutePoint[], stance: CastStance = "standing", facing: 1 | -1 = 1): CampWalk {
  return planWalk(route, canvas, campGait(heightCm, stance, PX_PER_CM), facing);
}

/** Every pose at 1 ms, from before the walk to past its settle. */
function samples(walk: CampWalk, dt = 0.001) {
  const out = [];
  for (let t = -0.05; t <= walk.duration + 0.05; t += dt) out.push({ t, ...walkPose(walk, t) });
  return out;
}

describe("the step curve (§8.2)", () => {
  for (const [name, heightCm] of SIZES) {
    for (const [routeName, route] of ROUTES) {
      it(`nothing slides: a ${name} moves across the ground only in the air, ${routeName}`, () => {
        const walk = walkFor(heightCm, route);
        const poses = samples(walk);
        let travelled = 0;
        for (let i = 1; i < poses.length; i++) {
          const a = poses[i - 1]!;
          const b = poses[i]!;
          const moved = Math.hypot(b.x - a.x, b.y - a.y);
          travelled += moved;
          if (moved > 1e-9) expect(a.airborne || b.airborne, `moved ${moved}px on the ground at ${b.t.toFixed(3)}s`).toBe(true);
        }
        expect(travelled).toBeCloseTo(walk.length, 0);
        const end = poses[poses.length - 1]!;
        const last = route[route.length - 1]!;
        expect(end.x).toBeCloseTo(last.x * canvas.width, 6);
        expect(end.y).toBeCloseTo(last.y * canvas.height, 6);
        expect(end.done).toBe(true);
      });

      it(`feet stay on the ground line when grounded: a ${name}, ${routeName}`, () => {
        const walk = walkFor(heightCm, route);
        const crossingXs = layout.backdrop.crossings.map((c) => c.x * canvas.width);
        for (const pose of samples(walk)) {
          if (pose.airborne) {
            expect(pose.lift).toBeGreaterThanOrEqual(0);
            continue;
          }
          expect(pose.lift).toBe(0);
          // On a lane's line, or on a crossing between two.
          const onLane = laneAt(layout, pose.y / canvas.height) !== null;
          const onCrossing = crossingXs.some((x) => Math.abs(x - pose.x) < 1e-6);
          expect(onLane || onCrossing, `grounded at (${pose.x}, ${pose.y})`).toBe(true);
          if (onLane) expect(pose.lane).toBe(laneAt(layout, pose.y / canvas.height));
        }
      });
    }
  }

  it("hops about 3% of the figure's height, squashes about 2%, wobbles 1.5° and leans a couple of degrees", () => {
    const route = campRoute(layout, { lane: "near", x: 0.1 }, { lane: "near", x: 0.9 })!;
    const walk = walkFor(160, route);
    const poses = samples(walk);
    const h = walk.gait.heightPx;
    const top = Math.max(...poses.map((p) => p.lift));
    expect(top / h).toBeCloseTo(HOP, 3);
    const squash = Math.max(...poses.map((p) => 1 - p.scaleY));
    expect(squash).toBeCloseTo(SQUASH, 3);
    expect(Math.max(...poses.map((p) => p.scaleX - 1))).toBeCloseTo(SQUASH, 3);
    const lean = Math.max(...poses.map((p) => Math.abs(p.rotation)));
    expect(lean).toBeLessThanOrEqual(LEAN + WOBBLE + 1e-9);
    expect(lean).toBeGreaterThan(LEAN);
    // The wobble alternates: one step leans further in, the next less.
    const middle = walk.steps.slice(2, 4).map((s) => walkPose(walk, (s.t0 + s.t1) / 2).rotation);
    expect(middle[0]! - LEAN).toBeCloseTo(WOBBLE, 6);
    expect(middle[1]! - LEAN).toBeCloseTo(-WOBBLE, 6);
    // Leaning into a walk to the right tips the top right (positive in Pixi).
    expect(walkPose(walk, walk.travelEnd / 2).rotation).toBeGreaterThan(0);
  });

  it("travels only between take-off and landing in every step", () => {
    const route = campRoute(layout, { lane: "near", x: 0.1 }, { lane: "near", x: 0.9 })!;
    const walk = walkFor(160, route);
    for (const step of walk.steps) {
      const span = step.t1 - step.t0;
      const before = walkPose(walk, step.t0 + span * AIR_START * 0.99);
      const after = walkPose(walk, step.t0 + span * (AIR_END + (1 - AIR_END) * 0.5));
      expect(before.x).toBeCloseTo(walk.points[0]!.x + step.d0, 6);
      expect(before.lift).toBe(0);
      expect(after.x).toBeCloseTo(walk.points[0]!.x + step.d1, 6);
      expect(after.lift).toBe(0);
    }
  });

  it("eases in and out: the first and last steps are shorter, and the lean comes and goes", () => {
    const route = campRoute(layout, { lane: "near", x: 0.1 }, { lane: "near", x: 0.9 })!;
    const walk = walkFor(160, route);
    const lengths = walk.steps.map((s) => s.d1 - s.d0);
    const full = lengths[1]!;
    expect(lengths[0]! / full).toBeCloseTo(EASED_STEP, 6);
    expect(lengths[lengths.length - 1]! / full).toBeCloseTo(EASED_STEP, 6);
    expect(walkPose(walk, 0).rotation).toBeCloseTo(0, 6);
    expect(walkPose(walk, walk.travelEnd).rotation).toBeCloseTo(0, 6);
  });

  it("settles on arrival with one small dip, feet planted", () => {
    const route = campRoute(layout, { lane: "near", x: 0.3 }, { lane: "near", x: 0.46 })!;
    const walk = walkFor(160, route);
    const settle = samples(walk).filter((p) => p.t >= walk.travelEnd);
    const deepest = Math.min(...settle.map((p) => p.scaleY));
    expect(deepest).toBeLessThan(1);
    expect(deepest).toBeGreaterThan(0.97);
    for (const p of settle) {
      expect(p.lift).toBe(0);
      expect(p.x).toBeCloseTo(0.46 * canvas.width, 6);
    }
    expect(walkPose(walk, walk.duration).done).toBe(true);
    expect(walkPose(walk, walk.duration).scaleY).toBe(1);
  });

  it("takes its pace and stride from size, with speed growing more slowly than height", () => {
    const gaits = SIZES.map(([, cm]) => campGait(cm, "standing", PX_PER_CM));
    const byHeight = [...gaits].sort((a, b) => a.heightPx - b.heightPx);
    for (let i = 1; i < byHeight.length; i++) {
      const small = byHeight[i - 1]!;
      const big = byHeight[i]!;
      expect(big.stepPx).toBeGreaterThan(small.stepPx);
      expect(big.stepS).toBeGreaterThan(small.stepS);
      expect(walkSpeed(big)).toBeGreaterThan(walkSpeed(small));
      expect(walkSpeed(big) / walkSpeed(small)).toBeLessThan(big.heightPx / small.heightPx);
    }
    // A duckling patters: many more, quicker steps than a hero over the same ground.
    const route = ROUTES[0]![1];
    expect(walkFor(20, route).steps.length).toBeGreaterThan(walkFor(160, route).steps.length * 3);
  });

  it("glides a hovering or flying figure: no hop, no squash, travel eased", () => {
    for (const stance of ["hovering", "flying"] as const) {
      const walk = walkFor(20, ROUTES[1]![1], stance);
      const poses = samples(walk);
      expect(Math.max(...poses.map((p) => p.lift))).toBe(0);
      expect(Math.min(...poses.map((p) => p.scaleY))).toBe(1);
      expect(poses.some((p) => p.moving && p.airborne)).toBe(true);
      expect(poses[poses.length - 1]!.done).toBe(true);
    }
  });

  it("turns round before it sets off the other way", () => {
    const route = ROUTES[0]![1];
    expect(walkFor(160, route, "standing", 1).lead).toBe(0);
    const reversed = walkFor(160, route, "standing", -1);
    expect(reversed.lead).toBe(TURN_LEAD_S);
    expect(walkPose(reversed, TURN_LEAD_S / 2)).toMatchObject({ moving: false, lift: 0, facing: 1 });
    expect(walkPose(reversed, TURN_LEAD_S / 2).x).toBe(walkPose(reversed, 0).x);
  });

  it("faces the way it travels, turning where a route doubles back", () => {
    const walk = walkFor(160, ROUTES[3]![1], "standing", -1);
    expect(walk.startHeading).toBe(-1);
    expect(walk.endHeading).toBe(1);
  });
});

describe("the walk at a smaller figure factor (camp-framing.ts campFigureScale)", () => {
  const route = campRoute(layout, { lane: "near", x: 0.1 }, { lane: "near", x: 0.9 })!;
  const full = campGait(160, "standing", PX_PER_CM, campHeightPx(160, campMeasure(canvas.height)));

  it("is the same gait at full size", () => {
    expect(campStride(full, 1)).toBe(full);
    expect(campStride(full, Number.NaN)).toBe(full);
  });

  for (const k of [0.8, 0.6]) {
    const small = planWalk(route, canvas, campStride(full, k), 1);
    const big = planWalk(route, canvas, full, 1);

    it(`strides in steps its drawn size at ${k}: about 1/${k} as many, at the same pace`, () => {
      expect(small.gait.stepPx).toBeCloseTo(full.stepPx * k);
      expect(small.gait.stepS).toBe(full.stepS);
      expect(small.steps.length / big.steps.length).toBeCloseTo(1 / k, 0);
      // Hop and squash are fractions of heightPx, which the camp draws at the factor itself.
      expect(small.gait.heightPx).toBe(full.heightPx);
    });

    it(`nothing slides and feet stay on the ground at ${k}`, () => {
      const poses = samples(small);
      for (let i = 1; i < poses.length; i++) {
        const a = poses[i - 1]!;
        const b = poses[i]!;
        const moved = Math.hypot(b.x - a.x, b.y - a.y);
        if (moved > 1e-9) expect(a.airborne || b.airborne).toBe(true);
        if (!b.airborne) {
          expect(b.lift).toBe(0);
          expect(laneAt(layout, b.y / canvas.height)).toBe("near");
        }
      }
      expect(poses[poses.length - 1]!.done).toBe(true);
    });
  }
});

describe("frame time (§8.6, rule 7)", () => {
  it("reads the same pose whether frames come on time or late", () => {
    const walk = walkFor(160, ROUTES[1]![1]);
    let onTime = 0;
    for (let i = 0; i < 60; i++) onTime += frameSeconds(1000 / 60);
    let late = 0;
    for (let i = 0; i < 30; i++) late += frameSeconds(2000 / 60); // every other frame dropped
    expect(late).toBeCloseTo(onTime, 9);
    const a = walkPose(walk, late);
    const b = walkPose(walk, onTime);
    for (const key of ["x", "y", "lift", "rotation", "scaleX", "scaleY", "shadow"] as const) expect(a[key]).toBeCloseTo(b[key], 6);
    expect(a.airborne).toBe(b.airborne);
  });

  it("does not replay a long pause: one frame advances at most a quarter second", () => {
    expect(frameSeconds(10_000)).toBe(MAX_FRAME_S);
    expect(frameSeconds(16)).toBeCloseTo(0.016);
    expect(frameSeconds(-5)).toBe(0);
    expect(frameSeconds(Number.NaN)).toBe(0);
  });
});

describe("stand-point actions (§8.4)", () => {
  it("eases into every action from rest, and reduced motion holds every one still", () => {
    for (const action of CAMP_ACTIONS) {
      const start = actionPose(action, 0);
      expect(Math.abs(start.lean) + start.lift + start.low).toBe(0);
      expect(actionPose(action, 5, true)).toEqual({ lean: 0, lift: 0, low: 0, breathPace: 1 });
      for (let t = 0; t < 20; t += 0.01) {
        const pose = actionPose(action, t);
        expect(Math.abs(pose.lean)).toBeLessThan(0.1);
        expect(pose.lift).toBeGreaterThanOrEqual(0);
        expect(pose.lift).toBeLessThanOrEqual(HOP + 1e-9);
      }
    }
    expect(actionPose("lookUp", 3).lean).toBeLessThan(0);
    expect(actionPose("pet", 3).lean).toBeGreaterThan(0);
    expect(actionPose("rest", 3).low).toBeGreaterThan(0);
    expect(Math.max(...Array.from({ length: 200 }, (_, i) => actionPose("greet", i / 100).lift))).toBeGreaterThan(0);
    expect(actionPose("greet", 5).lift).toBe(0);
  });

  it("leaves a piece exactly as painted while nobody uses it", () => {
    for (const motion of ["flicker", "sway", "ripple", "lift"] as const) {
      expect(partMotion(motion, 3.7, 0)).toEqual(PART_REST);
      const busy = Array.from({ length: 100 }, (_, i) => partMotion(motion, i * 0.05, 1));
      expect(busy.some((p) => JSON.stringify(p) !== JSON.stringify(PART_REST))).toBe(true);
    }
  });

  it("knows which pieces are in use from who stands where", () => {
    const points = layout.frame.standPoints;
    expect([...activeHotspots(points, [])]).toEqual([]);
    expect([...activeHotspots(points, ["bedroll-0", "stars"])]).toEqual([]);
    expect([...activeHotspots(points, ["campfire-w", "campfire-e"])]).toEqual(["campfire"]);
    expect([...activeHotspots(points, ["pack-peek"])]).toEqual(["pack"]);
  });

  it("sizes figures and pieces on one scale: a hero a quarter of the backdrop, a floor and a ceiling", () => {
    const measure = campMeasure(1080);
    expect(campHeightPx(160, measure)).toBeCloseTo(HERO_SHARE * 1080);
    expect(campHeightPx(60, measure)).toBeCloseTo((60 / 160) * HERO_SHARE * 1080);
    expect(campHeightPx(5, measure)).toBeCloseTo(FLOOR_SHARE * 1080);
    expect(campHeightPx(5000, measure)).toBeCloseTo(MAX_SHARE * 1080);
  });
});
