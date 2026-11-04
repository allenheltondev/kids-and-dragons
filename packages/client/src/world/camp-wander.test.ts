/**
 * The wander planner, run for long stretches of camp time with a full camp:
 * four heroes and two friends. Every frame checks the §8.6 rules it owns —
 * two walkers at most, one figure per stand point, lane-mates never passing
 * through each other — and the holds of §8.5.
 */

import { describe, expect, it } from "vitest";
import { campLayoutFixture } from "../testing/camp-fixture";
import { campRoute, routeLength, standPoint, type RoutePoint } from "./camp-layout";
import { campGait, planWalk } from "./camp-motion";
import {
  CLEARANCE,
  HOLD_MAX_S,
  HOLD_MIN_S,
  MAX_WALKERS,
  QUEUE_GAP,
  RECENT,
  createWanderPlanner,
  queueSpots,
  seededRandom,
  type WanderPlanner,
  type WanderWalk,
} from "./camp-wander";

const layout = campLayoutFixture();
const PX_PER_CM = (0.26 * 1080) / 160;
const HEIGHTS: Record<string, number> = { h0: 160, h1: 95, h2: 215, h3: 85, goat: 45, duck: 20 };

function camp(seed: number): WanderPlanner {
  const planner = createWanderPlanner(layout, seed, {
    walkSeconds: (id, route) => planWalk(route, layout.canvas, campGait(HEIGHTS[id] ?? 160, "standing", PX_PER_CM)).duration,
  });
  for (let seat = 0; seat < 4; seat++) {
    const bed = layout.frame.standPoints.find((p) => p.seat === seat)!;
    planner.add({ id: `h${seat}`, seat }, { spot: { lane: bed.lane, x: bed.x }, point: bed.id });
  }
  const stars = standPoint(layout, "stars")!;
  const fire = standPoint(layout, "campfire-w")!;
  planner.add({ id: "goat" }, { spot: { lane: stars.lane, x: stars.x }, point: stars.id });
  planner.add({ id: "duck" }, { spot: { lane: fire.lane, x: fire.x }, point: fire.id });
  return planner;
}

/** Run `seconds` of camp in frames of `dt`, calling `check` after every one. */
function run(planner: WanderPlanner, seconds: number, dt: number, check?: (walks: WanderWalk[]) => void): WanderWalk[] {
  const all: WanderWalk[] = [];
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) {
    const walks = planner.advance(dt);
    all.push(...walks);
    check?.(walks);
  }
  return all;
}

describe("the wander planner (§8.5)", () => {
  for (const seed of [1, 7, 42, 2026, 99_991]) {
    it(`holds the rules for ten minutes of camp, seed ${seed}`, () => {
      const planner = camp(seed);
      const lastSide = new Map<string, number>();
      let peak = 0;
      const walks = run(planner, 600, 0.05, () => {
        // Two walkers at most.
        const walking = planner.snapshots().filter((s) => s.walking);
        peak = Math.max(peak, walking.length);
        expect(walking.length).toBeLessThanOrEqual(MAX_WALKERS);

        // One figure per stand point, counting where walkers are headed.
        const held: string[] = [];
        for (const s of planner.snapshots()) {
          if (s.walking) {
            if (s.to?.point) held.push(s.to.point);
          } else if (s.at.point) held.push(s.at.point);
        }
        expect(new Set(held).size).toBe(held.length);

        // Lane-mates never pass through each other: while two figures share
        // a lane, the one on the left stays on the left, and they keep apart.
        const where = planner.snapshots().map((s) => ({ id: s.id, ...planner.positionAt(s.id)! }));
        for (const a of where) {
          for (const b of where) {
            if (a.id >= b.id) continue;
            const key = `${a.id}|${b.id}`;
            if (!a.lane || a.lane !== b.lane) {
              lastSide.delete(key);
              continue;
            }
            const side = Math.sign(b.x - a.x);
            const before = lastSide.get(key);
            if (before !== undefined && side !== 0) expect(side, `${key} swapped sides on ${a.lane}`).toBe(before);
            if (side !== 0) lastSide.set(key, side);
          }
        }
      });
      // Calm, but alive: the camp does wander, and does use both walkers.
      expect(walks.length).toBeGreaterThan(20);
      expect(peak).toBe(MAX_WALKERS);
    });
  }

  it("plans a hold of 8 to 20 seconds, and never goes sooner", () => {
    const planner = camp(5);
    const planned: number[] = planner.snapshots().map((s) => s.until);
    const arrivedAt = new Map<string, number>(planner.snapshots().map((s) => [s.id, 0]));
    const mode = new Map(planner.snapshots().map((s) => [s.id, s.mode]));
    const holds: number[] = [];
    const walksBy = new Map<string, number>();
    run(planner, 900, 0.05, (walks) => {
      for (const walk of walks) {
        holds.push(walk.startedAt - arrivedAt.get(walk.id)!);
        arrivedAt.set(walk.id, walk.startedAt + walk.seconds);
        walksBy.set(walk.id, (walksBy.get(walk.id) ?? 0) + 1);
      }
      for (const s of planner.snapshots()) {
        // Just arrived: the hold it plans, from the moment it got there.
        if (mode.get(s.id) === "walk" && s.mode === "hold") planned.push(s.until - arrivedAt.get(s.id)!);
        mode.set(s.id, s.mode);
      }
    });
    expect(planned.length).toBeGreaterThan(30);
    for (const hold of planned) {
      expect(hold).toBeGreaterThanOrEqual(HOLD_MIN_S - 1e-9);
      expect(hold).toBeLessThanOrEqual(HOLD_MAX_S + 1e-9);
    }
    // A hold that runs out while the way is busy waits a beat more; it never goes sooner.
    for (const hold of holds) expect(hold).toBeGreaterThanOrEqual(HOLD_MIN_S - 1e-9);
    // And nobody is shut in for good: everybody gets about.
    for (const id of Object.keys(HEIGHTS)) expect(walksBy.get(id) ?? 0, id).toBeGreaterThanOrEqual(5);
  });

  it("gives every hero their own bedroll and nobody else's", () => {
    const planner = camp(11);
    const walks = run(planner, 900, 0.1);
    for (const walk of walks) {
      const seat = walk.to.point ? standPoint(layout, walk.to.point)?.seat : undefined;
      if (seat === undefined) continue;
      expect(walk.id).toBe(`h${seat}`);
    }
  });

  it("walks only real routes to nearby free stand points", () => {
    const planner = camp(3);
    for (const walk of run(planner, 300, 0.05)) {
      expect(walk.to.point).not.toBeNull();
      expect(walk.to.point).not.toBe(walk.from.point);
      expect(walk.route).toEqual(campRoute(layout, walk.from.spot, walk.to.spot));
    }
  });

  it("carries on round the camp rather than pacing back to where it just was", () => {
    // Alone in camp, a hero always has somewhere fresh to go: it never walks
    // back to one of its last RECENT stops, and in ten minutes it uses every spot it may.
    const planner = createWanderPlanner(layout, 5, {
      walkSeconds: (_, route) => planWalk(route, layout.canvas, campGait(160, "standing", PX_PER_CM)).duration,
    });
    const bed = standPoint(layout, "bedroll-0")!;
    planner.add({ id: "h0", seat: 0 }, { spot: { lane: bed.lane, x: bed.x }, point: bed.id });
    const recent: string[] = [bed.id];
    const visited = new Set<string>([bed.id]);
    for (const walk of run(planner, 600, 0.1)) {
      expect(recent).not.toContain(walk.to.point);
      recent.unshift(walk.to.point!);
      recent.length = Math.min(recent.length, RECENT);
      visited.add(walk.to.point!);
    }
    const open = layout.frame.standPoints.filter((p) => p.seat === undefined || p.seat === 0);
    expect([...visited].sort()).toEqual(open.map((p) => p.id).sort());
  });

  it("plans the same camp from the same seed, however the frames fall", () => {
    const summary = (walks: WanderWalk[]) => walks.map((w) => `${w.id}:${w.to.point}@${w.startedAt.toFixed(6)}`);
    const smooth = summary(run(camp(42), 300, 1 / 60));
    const choppy = summary(run(camp(42), 300, 0.2));
    const again = summary(run(camp(42), 300, 1 / 60));
    expect(choppy).toEqual(smooth);
    expect(again).toEqual(smooth);
    expect(summary(run(camp(43), 300, 1 / 60))).not.toEqual(smooth);
  });

  it("starts a walk at the moment its hold ran out, not at the frame that noticed", () => {
    const planner = camp(8);
    const walks = run(planner, 120, 0.25);
    expect(walks.some((w) => Math.abs(w.startedAt / 0.25 - Math.round(w.startedAt / 0.25)) > 1e-6)).toBe(true);
  });

  it("makes a lane-mate wait rather than walk through somebody standing in its way", () => {
    const planner = createWanderPlanner(layout, 1, { walkSeconds: () => 4 });
    // The only free point for the walker is past a figure standing in the lane.
    const near = (x: number) => ({ lane: "near", x });
    planner.add({ id: "blocker" }, { spot: near(0.46), point: "meadow" });
    planner.add({ id: "walker" }, { spot: near(0.3), point: "stars" });
    for (const point of layout.frame.standPoints) {
      if (["meadow", "stars", "pack-peek"].includes(point.id)) continue;
      planner.add({ id: `sitter-${point.id}` }, { spot: { lane: point.lane, x: point.x }, point: point.id });
    }
    // Everybody but the walker is held where they are by a moment.
    for (const s of planner.snapshots()) if (s.id !== "walker") planner.direct(s.id, s.at, null, 0);
    const walks = run(planner, 120, 0.1);
    expect(walks).toEqual([]);
    // Moved aside, the way is clear.
    const aside = standPoint(layout, "bedroll-0")!;
    planner.direct("blocker", { spot: near(0.1), point: null }, null, 0);
    planner.direct("sitter-bedroll-0", { spot: { lane: aside.lane, x: aside.x }, point: aside.id }, null, 0);
    const later = run(planner, 60, 0.1);
    expect(later.map((w) => w.to.point)).toContain("pack-peek");
  });

  it("keeps walkers apart: no two sweep the same stretch of a lane at once", () => {
    const planner = camp(17);
    run(planner, 600, 0.05, () => {
      const walking = planner.snapshots().filter((s) => s.walking && s.route);
      if (walking.length < 2) return;
      const [a, b] = walking as [typeof walking[0], typeof walking[0]];
      const sweeps = (route: RoutePoint[]) => {
        const out: { lane: string; lo: number; hi: number }[] = [];
        for (let i = 1; i < route.length; i++) {
          const p = route[i - 1]!;
          const q = route[i]!;
          if (p.y === q.y && p.lane) out.push({ lane: p.lane, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) });
        }
        return out;
      };
      for (const x of sweeps(a.route!)) {
        for (const y of sweeps(b.route!)) {
          if (x.lane !== y.lane) continue;
          expect(x.hi + CLEARANCE < y.lo || y.hi + CLEARANCE < x.lo, `${a.id} and ${b.id} share ${x.lane}`).toBe(true);
        }
      }
    });
  });

  it("stays out of a moment's way, and takes the figure back on release", () => {
    const planner = camp(4);
    const trail = { spot: { lane: "near", x: 0.96 }, point: null };
    const route = campRoute(layout, { lane: "back", x: 0.24 }, trail.spot)!;
    planner.direct("h0", trail, route, 6);
    expect(planner.snapshot("h0")).toMatchObject({ mode: "directed", walking: true });
    const walks = run(planner, 60, 0.1);
    expect(walks.filter((w) => w.id === "h0")).toEqual([]);
    expect(planner.snapshot("h0")).toMatchObject({ mode: "directed", walking: false, at: trail });
    planner.release("h0");
    expect(planner.snapshot("h0")!.mode).toBe("hold");
    expect(run(planner, 120, 0.1).some((w) => w.id === "h0")).toBe(true);
  });

  it("seeds with mulberry32, the same everywhere", () => {
    const a = seededRandom(123);
    const b = seededRandom(123);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    for (const v of first) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(routeLength([{ x: 0, y: 0, lane: null }], layout.canvas)).toBe(0);
  });

  it("queues Ready heroes behind the trailhead in tap order, spaced by their widths", () => {
    const span = { x0: 0.05, x1: 0.97 };
    const widths = [0.12, 0.06, 0.14, 0.05];
    const right = queueSpots(0.96, 1, widths, span);
    expect(right[0]).toBe(0.96);
    for (let i = 1; i < widths.length; i++) {
      expect(right[i]!).toBeLessThan(right[i - 1]!);
      expect(right[i - 1]! - right[i]!).toBeCloseTo((widths[i - 1]! + widths[i]!) / 2 + QUEUE_GAP, 9);
    }
    // A trail leaving left lines up to the right of its trailhead.
    const left = queueSpots(0.08, -1, widths, span);
    expect(left[1]!).toBeGreaterThan(left[0]!);
    // A line longer than the lane stays on the ground.
    expect(Math.min(...queueSpots(0.2, 1, [0.2, 0.2, 0.2], span))).toBe(0.05);
  });
});
