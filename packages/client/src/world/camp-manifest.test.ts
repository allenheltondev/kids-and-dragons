/**
 * The real camp layout in assets/manifest.json → camp, run through the same
 * parser and wander planner the stage uses. The fixture tests prove the
 * planner; this proves the data the TV will actually draw: it parses, and in
 * ten minutes of a full camp no hero is ever boxed in at their bedroll by
 * lane-mates they may not walk through (docs/camp.md §8.3, §8.5), and the
 * heroes range across the width of the painting rather than clustering in
 * its middle: the backdrop fills the TV edge to edge (camp-framing.ts).
 */

import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import { campLayout, parseCampManifest } from "./camp-layout";
import { campGait, planWalk } from "./camp-motion";
import { HOLD_MAX_S, createWanderPlanner } from "./camp-wander";

const PX_PER_CM = (0.26 * 1080) / 160;
const HEIGHTS = [160, 95, 215, 85];

/** Longest a hero may go without a walk: a full hold, plus room for waits. */
const LONGEST_STILL_S = HOLD_MAX_S * 4;

/**
 * Ten minutes of a full camp (four heroes), sampled every half second: the
 * share of hero-time spent in the outer thirds of the width, and the spread
 * of where they stood (the 5th to the 95th percentile of x).
 */
function spread(seed: number): { outer: number; lo: number; hi: number } {
  const layout = campLayout(parseCampManifest((manifest as { camp: unknown }).camp), "open_plains", 1);
  const planner = createWanderPlanner(layout, seed, {
    walkSeconds: (id, route) =>
      planWalk(route, layout.canvas, campGait(HEIGHTS[Number(id.slice(1))] ?? 160, "standing", PX_PER_CM)).duration,
  });
  for (let seat = 0; seat < 4; seat++) {
    const bed = layout.frame.standPoints.find((p) => p.seat === seat)!;
    planner.add({ id: `h${seat}`, seat }, { spot: { lane: bed.lane, x: bed.x }, point: bed.id });
  }
  const xs: number[] = [];
  for (let i = 0; i < 1200; i++) {
    planner.advance(0.5);
    for (let seat = 0; seat < 4; seat++) xs.push(planner.positionAt(`h${seat}`)!.x);
  }
  xs.sort((a, b) => a - b);
  const at = (q: number): number => xs[Math.floor(q * (xs.length - 1))]!;
  return { outer: xs.filter((x) => x < 1 / 3 || x > 2 / 3).length / xs.length, lo: at(0.05), hi: at(0.95) };
}

describe("the camp layout in the manifest", () => {
  const parsed = parseCampManifest((manifest as { camp: unknown }).camp);

  it("parses, with an open_plains backdrop and a stage-1 frame", () => {
    const layout = campLayout(parsed, "open_plains", 1);
    expect(layout.frame.stage).toBe(1);
    expect(layout.frame.standPoints.filter((p) => p.seat !== undefined)).toHaveLength(4);
  });

  for (const seed of [1, 7, 42, 2026]) {
    it(`lets every hero leave their bedroll, seed ${seed}`, () => {
      const layout = campLayout(parsed, "open_plains", 1);
      const planner = createWanderPlanner(layout, seed, {
        walkSeconds: (id, route) =>
          planWalk(route, layout.canvas, campGait(HEIGHTS[Number(id.slice(1))] ?? 160, "standing", PX_PER_CM)).duration,
      });
      for (let seat = 0; seat < 4; seat++) {
        const bed = layout.frame.standPoints.find((p) => p.seat === seat)!;
        planner.add({ id: `h${seat}`, seat }, { spot: { lane: bed.lane, x: bed.x }, point: bed.id });
      }
      const still = new Map<string, number>();
      let longest = 0;
      const dt = 0.05;
      for (let i = 0; i < 600 / dt; i++) {
        planner.advance(dt);
        for (const s of planner.snapshots()) {
          const t = s.walking ? 0 : (still.get(s.id) ?? 0) + dt;
          still.set(s.id, t);
          longest = Math.max(longest, t);
        }
      }
      expect(longest, "a hero stood still too long: boxed in by lane-mates?").toBeLessThanOrEqual(LONGEST_STILL_S);
    });
  }

  // The layout drawn for the old shrink-to-fit framing (bedrolls and fire at
  // x 0.38 to 0.62) gave 55 to 61 percent in the outer thirds and a spread of
  // 0.13 to 0.86 for every seed; the wide clearing gives 64 to 71 and 0.10 to 0.88.
  for (const seed of [1, 7, 42, 2026]) {
    it(`spreads a full camp across the width, seed ${seed}`, () => {
      const { outer, lo, hi } = spread(seed);
      // A real share of the time out in the outer thirds of the painting...
      expect(outer, "share of hero-time in the outer thirds").toBeGreaterThanOrEqual(0.62);
      // ...and where they stand spans most of 0.1 to 0.9.
      expect(hi - lo, "spread of x, 5th to 95th percentile").toBeGreaterThanOrEqual(0.75);
    });
  }
});
