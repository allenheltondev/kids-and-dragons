/**
 * Who walks where, and when (docs/camp.md §8.5): the camp's wander planner.
 *
 * Each figure holds at a stand point for 8 to 20 seconds, then walks to a
 * nearby free one. The rules that keep it calm and clean (§8.6) live here, as
 * decisions rather than as animation:
 *
 * - **At most two walkers at once.** A figure whose hold runs out while two
 *   are walking waits a beat and tries again.
 * - **One figure per stand point.** A point somebody stands at, or is walking
 *   to, is not free.
 * - **Lane-mates take turns.** A walk reserves the stretch of each lane it
 *   sweeps until it arrives. A walk that would pass through somebody standing
 *   in its lane, or overlap the stretch another walker holds, does not start;
 *   the figure waits a beat rather than walking through another (§8.3).
 * - **Heroes keep their own bedrolls.** A seat point is only its hero's.
 *
 * Moments (§8.5: a kid sits down, taps Ready, steps away, Begin) take
 * priority: `direct` hands a figure to the caller, who walks it wherever the
 * moment says, and the planner keeps out of its way until `release`.
 *
 * Seeded, never the wall clock (§12.6): the caller passes a seed taken from
 * the downtime moment, and the planner's clock is the time it is advanced by.
 * Events are processed in the order they fall due, not the order frames
 * arrive, so the same seed plans the same camp whether it is advanced in one
 * long step or a thousand short ones: a TV and a phone looking at the same
 * camp mostly agree, and nothing has to sync.
 *
 * Pure and Pixi-free; camp-wander.test.ts runs it for minutes of camp time and
 * holds the rules as numbers.
 */

import {
  campRoute,
  routeLength,
  routeSweeps,
  type CampLayout,
  type CampSpot,
  type LaneSweep,
  type RoutePoint,
} from "./camp-layout";

/** How long a figure stays put before it wanders, in seconds (§8.5). */
export const HOLD_MIN_S = 8;
export const HOLD_MAX_S = 20;
/** At most this many figures walk at once. */
export const MAX_WALKERS = 2;
/** The beat a figure waits when it may not go yet. */
export const RETRY_MIN_S = 1;
export const RETRY_MAX_S = 3;
/** How close (a fraction of the canvas width) two figures in one lane may come: about one figure's width. */
export const CLEARANCE = 0.04;
/** A figure picks among this many of the nearest free stand points. */
export const NEARBY = 3;

/** mulberry32, as packages/shared/src/chapter-pacing.ts uses: small, seeded, the same everywhere. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The gap left between two heroes queued at the trailhead, as a fraction of the canvas width. */
export const QUEUE_GAP = 0.008;

/**
 * Where heroes who tapped Ready wait (§8.5): in the order they tapped, the
 * first at the trailhead and each one after it behind the one before, away
 * from the edge they will leave by (`side`: 1 leaves right, -1 left), spaced
 * by their widths (canvas fractions) so nobody stands inside anybody. A queue
 * longer than the lane leaves the rest at its end rather than off the ground.
 */
export function queueSpots(
  front: number,
  side: 1 | -1,
  widths: readonly number[],
  span: { x0: number; x1: number },
  gap = QUEUE_GAP,
): number[] {
  const spots: number[] = [];
  let x = front;
  widths.forEach((width, i) => {
    if (i > 0) x -= side * ((widths[i - 1]! + width) / 2 + gap);
    spots.push(Math.min(span.x1, Math.max(span.x0, x)));
  });
  return spots;
}

/** A spot, and the stand point it is (null at the trailhead or off the edge). */
export interface WanderPlace {
  spot: CampSpot;
  point: string | null;
}

export type WanderMode = "hold" | "walk" | "directed";

export interface WanderFigure {
  id: string;
  /** A hero's seat (0 to 3): the bedroll only they use. Friends have none. */
  seat?: number;
}

/** A walk the planner started, for the caller to animate. */
export interface WanderWalk {
  id: string;
  from: WanderPlace;
  to: WanderPlace;
  route: RoutePoint[];
  /** Planner time it starts at: the caller begins `clock - startedAt` into it. */
  startedAt: number;
  seconds: number;
}

/** Where a figure is, as the planner sees it. */
export interface WanderSnapshot {
  id: string;
  mode: WanderMode;
  /** Where it stands, or (walking) where it set out from. */
  at: WanderPlace;
  /** Where it is going, while walking or directed. */
  to: WanderPlace | null;
  route: RoutePoint[] | null;
  startedAt: number;
  /** Hold: when it next tries to go. Walking: when it arrives. */
  until: number;
  /** Whether it is on its feet and travelling right now. */
  walking: boolean;
}

interface State extends WanderSnapshot {
  seat?: number;
  sweeps: LaneSweep[];
}

export interface WanderPlanner {
  readonly clock: number;
  /** Seat a figure at a place, holding. */
  add(figure: WanderFigure, at: WanderPlace): void;
  remove(id: string): void;
  has(id: string): boolean;
  /**
   * A moment takes this figure: it walks `route` to `to` over `seconds` (or
   * is there at once, `route` null), and stays out of wandering until
   * released. Overrides anything it was doing.
   */
  direct(id: string, to: WanderPlace, route: RoutePoint[] | null, seconds: number): void;
  /** Back to wandering from wherever the moment left it, with a fresh hold. */
  release(id: string): void;
  /** Advance the clock; returns the walks that started, in order. */
  advance(seconds: number): WanderWalk[];
  snapshot(id: string): WanderSnapshot | undefined;
  snapshots(): WanderSnapshot[];
  /** How many figures are travelling now. */
  walkers(): number;
  /** Where a figure is along its route now, by distance (canvas fractions). Tests read this. */
  positionAt(id: string): { x: number; y: number; lane: string | null } | undefined;
}

export interface WanderOptions {
  /** How long the caller's walk along `route` takes (camp-motion.ts `planWalk`). */
  walkSeconds: (id: string, route: RoutePoint[]) => number;
}

export function createWanderPlanner(layout: CampLayout, seed: number, options: WanderOptions): WanderPlanner {
  const random = seededRandom(seed);
  const between = (lo: number, hi: number): number => lo + (hi - lo) * random();
  const figures = new Map<string, State>();
  let clock = 0;

  const isWalking = (f: State): boolean => f.route !== null && f.until > clock && f.mode !== "hold";

  function walkers(): number {
    let n = 0;
    for (const f of figures.values()) if (isWalking(f)) n += 1;
    return n;
  }

  /** Stand points held by somebody other than `me`: stood at, or walked to. */
  function taken(me: State): Set<string> {
    const points = new Set<string>();
    for (const f of figures.values()) {
      if (f === me) continue;
      if (f.at.point) points.add(f.at.point);
      if (f.to?.point) points.add(f.to.point);
    }
    return points;
  }

  /** Whether `me` walking `route` keeps clear of everybody else (§8.3). */
  function clear(me: State, route: RoutePoint[]): boolean {
    const sweeps = routeSweeps(layout, route);
    const start = route[0]!;
    const next = route[1] ?? start;
    const outward = Math.sign(next.x - start.x);
    for (const other of figures.values()) {
      if (other === me) continue;
      if (isWalking(other)) {
        for (const a of sweeps) {
          for (const b of other.sweeps) {
            if (a.lane === b.lane && a.lo - CLEARANCE <= b.hi && b.lo - CLEARANCE <= a.hi) return false;
          }
        }
        continue;
      }
      const spot = other.route !== null && other.to ? other.to.spot : other.at.spot;
      for (const [i, sweep] of sweeps.entries()) {
        if (sweep.lane !== spot.lane) continue;
        if (spot.x < sweep.lo - CLEARANCE || spot.x > sweep.hi + CLEARANCE) continue;
        // Somebody just behind where `me` sets off is not in the way: it walks away from them.
        const behind = i === 0 && spot.lane === me.at.spot.lane && (outward === 0 || (spot.x - start.x) * outward <= 0);
        if (behind && Math.abs(spot.x - start.x) <= CLEARANCE) continue;
        return false;
      }
    }
    return true;
  }

  function hold(f: State, from: number, lo = HOLD_MIN_S, hi = HOLD_MAX_S): void {
    f.mode = "hold";
    f.route = null;
    f.to = null;
    f.sweeps = [];
    f.until = from + between(lo, hi);
  }

  /** A hold has run out at time `now`: go somewhere, or wait a beat. */
  function tryWalk(f: State, now: number, started: WanderWalk[]): void {
    if (walkers() >= MAX_WALKERS) {
      f.until = now + between(RETRY_MIN_S, RETRY_MAX_S);
      return;
    }
    const busy = taken(f);
    const choices: { point: string; spot: CampSpot; route: RoutePoint[]; length: number }[] = [];
    for (const point of layout.frame.standPoints) {
      if (point.id === f.at.point || busy.has(point.id)) continue;
      if (point.seat !== undefined && point.seat !== f.seat) continue;
      const spot = { lane: point.lane, x: point.x };
      const route = campRoute(layout, f.at.spot, spot);
      if (!route || !clear(f, route)) continue;
      choices.push({ point: point.id, spot, route, length: routeLength(route, layout.canvas) });
    }
    if (choices.length === 0) {
      f.until = now + between(RETRY_MIN_S, RETRY_MAX_S);
      return;
    }
    choices.sort((a, b) => a.length - b.length || a.point.localeCompare(b.point));
    const pick = choices[Math.floor(random() * Math.min(NEARBY, choices.length))]!;
    const seconds = Math.max(0.01, options.walkSeconds(f.id, pick.route));
    f.mode = "walk";
    f.to = { spot: pick.spot, point: pick.point };
    f.route = pick.route;
    f.sweeps = routeSweeps(layout, pick.route);
    f.startedAt = now;
    f.until = now + seconds;
    started.push({ id: f.id, from: f.at, to: f.to, route: pick.route, startedAt: now, seconds });
  }

  /** The figure whose next event falls due first (ties by id, so order never depends on Map order). */
  function nextDue(limit: number): State | null {
    let best: State | null = null;
    for (const f of figures.values()) {
      const due = f.mode === "directed" ? (f.route !== null && f.until <= limit ? f.until : Infinity) : f.until;
      if (due > limit) continue;
      if (!best || due < best.until || (due === best.until && f.id < best.id)) best = f;
    }
    return best;
  }

  function arrive(f: State): void {
    if (f.to) f.at = f.to;
    f.to = null;
    f.route = null;
    f.sweeps = [];
  }

  function positionAt(id: string): { x: number; y: number; lane: string | null } | undefined {
    const f = figures.get(id);
    if (!f) return undefined;
    if (!isWalking(f) || !f.route) {
      const lane = layout.lanes.get(f.at.spot.lane);
      return { x: f.at.spot.x, y: lane?.y ?? 0, lane: f.at.spot.lane };
    }
    const route = f.route;
    const length = routeLength(route, layout.canvas);
    const span = f.until - f.startedAt;
    let d = span > 0 ? ((clock - f.startedAt) / span) * length : length;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1]!;
      const b = route[i]!;
      const leg = Math.hypot((b.x - a.x) * layout.canvas.width, (b.y - a.y) * layout.canvas.height);
      if (d <= leg || i === route.length - 1) {
        const t = leg > 0 ? Math.min(1, d / leg) : 1;
        const y = a.y + (b.y - a.y) * t;
        const lane = [...layout.lanes.values()].find((l) => Math.abs(l.y - y) < 1e-9)?.id ?? null;
        return { x: a.x + (b.x - a.x) * t, y, lane };
      }
      d -= leg;
    }
    const last = route[route.length - 1]!;
    return { x: last.x, y: last.y, lane: last.lane };
  }

  function snapshotOf(f: State): WanderSnapshot {
    return {
      id: f.id,
      mode: f.mode,
      at: f.at,
      to: f.to,
      route: f.route,
      startedAt: f.startedAt,
      until: f.until,
      walking: isWalking(f),
    };
  }

  return {
    get clock() {
      return clock;
    },
    add(figure, at) {
      const f: State = {
        id: figure.id,
        ...(figure.seat !== undefined ? { seat: figure.seat } : {}),
        mode: "hold",
        at,
        to: null,
        route: null,
        startedAt: clock,
        until: clock,
        walking: false,
        sweeps: [],
      };
      hold(f, clock);
      figures.set(figure.id, f);
    },
    remove(id) {
      figures.delete(id);
    },
    has(id) {
      return figures.has(id);
    },
    direct(id, to, route, seconds) {
      const f = figures.get(id);
      if (!f) return;
      // Interrupted mid-walk: it sets off from where it is now.
      if (isWalking(f)) {
        const now = positionAt(id);
        if (now?.lane) f.at = { spot: { lane: now.lane, x: now.x }, point: null };
      }
      f.mode = "directed";
      f.startedAt = clock;
      if (route === null) {
        f.at = to;
        f.to = null;
        f.route = null;
        f.sweeps = [];
        f.until = clock;
        return;
      }
      f.to = to;
      f.route = route;
      f.sweeps = routeSweeps(layout, route);
      f.until = clock + Math.max(0, seconds);
    },
    release(id) {
      const f = figures.get(id);
      if (!f) return;
      if (f.route !== null) arrive(f);
      hold(f, clock);
    },
    advance(seconds) {
      const started: WanderWalk[] = [];
      const target = clock + Math.max(0, seconds);
      for (let guard = 0; guard < 10_000; guard++) {
        const f = nextDue(target);
        if (!f) break;
        const due = f.until;
        clock = Math.max(clock, due);
        if (f.mode === "walk") {
          arrive(f);
          hold(f, due);
        } else if (f.mode === "directed") {
          // A moment's walk is over; it stays where the moment put it.
          arrive(f);
        } else {
          tryWalk(f, due, started);
        }
      }
      clock = target;
      return started;
    },
    snapshot(id) {
      const f = figures.get(id);
      return f ? snapshotOf(f) : undefined;
    },
    snapshots() {
      return [...figures.values()].map(snapshotOf);
    },
    walkers,
    positionAt,
  };
}
