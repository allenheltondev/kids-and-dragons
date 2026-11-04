/**
 * Who walks where, and when (docs/camp.md §8.5): the camp's wander planner.
 *
 * Each figure holds at a stand point for 8 to 20 seconds, then walks to a
 * nearby free one it has not just stood at, so it carries on round the camp
 * rather than pacing between two spots. The rules that keep it calm and clean (§8.6) live here, as
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
  type CampStandPoint,
  type LaneSweep,
  type RoutePoint,
} from "./camp-layout";
import { EDGE_MARGIN, campStandRange, type CampSpan } from "./camp-framing";

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
/**
 * ...that it has not stood at in its last this many stops. Without it a
 * figure ambles back and forth between the same few spots by its bedroll;
 * with it each walk carries on round the camp, so over a few minutes a full
 * camp uses the whole width of the clearing (camp-manifest.test.ts).
 */
export const RECENT = 3;

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

/**
 * A figure stepping out of the trailhead's line (Ready taken back) holds this
 * long, and waits this long between tries while its way is blocked: a beat,
 * not a wanderer's 8 to 20 seconds, so it leaves the line promptly.
 */
export const SOON_MIN_S = 0.2;
export const SOON_MAX_S = 0.6;

/** The gap left between two heroes queued at the trailhead, as a fraction of the canvas width. */
export const QUEUE_GAP = 0.008;

/**
 * Where heroes who tapped Ready wait (§8.5): in the order they tapped, the
 * first at the trailhead and each one after it behind the one before, away
 * from the edge they will leave by (`side`: 1 leaves right, -1 left), spaced
 * by their widths (canvas fractions) so nobody stands inside anybody.
 *
 * Every figure stands on the lane (`lane`, x0..x1, where feet may go) and,
 * when `visible` is given (camp-framing.ts `campVisibleSpan`, the part of the
 * painting the pane shows), with all of its width on screen: a trailhead the
 * pane crops, or one too near the edge for a wide hero, moves the front of
 * the line in, and the rest of the line runs on behind it. Only a line wider
 * than the whole span is left bunched at its far end, never off the ground or
 * the screen.
 *
 * `obstacles` are figures standing on the lane who are not in the line (a
 * hero resting at a bedroll the line reaches, one stepping out of it): the
 * line steps round them, the next place in it just behind, so nobody is put
 * inside anybody, and closes up once they have gone.
 */
export function queueSpots(
  front: number,
  side: 1 | -1,
  widths: readonly number[],
  lane: CampSpan,
  gap = QUEUE_GAP,
  visible?: CampSpan,
  obstacles: readonly { x: number; width: number }[] = [],
): number[] {
  const spots: number[] = [];
  const range = (width: number): CampSpan =>
    visible ? campStandRange(lane, visible, width, EDGE_MARGIN) : { x0: lane.x0, x1: lane.x1 };
  widths.forEach((width, i) => {
    const r = range(width);
    const clamp = (v: number) => Math.min(r.x1, Math.max(r.x0, v));
    let x = clamp(i === 0 ? front : spots[i - 1]! - side * ((widths[i - 1]! + width) / 2 + gap));
    for (let guard = 0; guard <= obstacles.length; guard++) {
      const hit = obstacles.find((o) => Math.abs(o.x - x) < (o.width + width) / 2 + gap - 1e-9);
      if (!hit) break;
      x = clamp(hit.x - side * ((hit.width + width) / 2 + gap));
    }
    spots.push(x);
  });
  return spots;
}

/** A lane the trailhead's line may stand on: its walkable span, and the heroes' widths and who is in the way there. */
export interface QueueRow extends CampSpan {
  lane: string;
  /** Every hero in the line, in tap order, as wide as they are drawn on this lane. */
  widths: readonly number[];
  obstacles?: readonly { x: number; width: number }[];
}

/**
 * The line's places when one lane may not hold it all (`queueSpots`): a pane
 * that crops the painting hard (a phone's World pane under short panels)
 * leaves too little of the trailhead's lane on screen for a whole party.
 * Then the line fills the trailhead's lane from the front, as far as it fits
 * with nobody inside anybody, and goes on in a second row on the next lane
 * (`rows`, nearest first), again from the front: a crowd waiting at the
 * trail, every one of them seen whole. The last row takes whoever is left.
 */
export function queuePlaces(
  front: number,
  side: 1 | -1,
  rows: readonly QueueRow[],
  gap = QUEUE_GAP,
  visible?: CampSpan,
): { lane: string; x: number }[] {
  const places: { lane: string; x: number }[] = [];
  const count = rows[0]?.widths.length ?? 0;
  for (const [r, row] of rows.entries()) {
    if (places.length >= count) break;
    const rest = row.widths.slice(places.length);
    const obstacles = row.obstacles ?? [];
    const spots = queueSpots(front, side, rest, row, gap, visible, obstacles);
    let fit = spots.length;
    if (r < rows.length - 1) {
      const clear = (i: number): boolean =>
        obstacles.every((o) => Math.abs(o.x - spots[i]!) >= (o.width + rest[i]!) / 2 + gap - 1e-9) &&
        (i === 0 || side * (spots[i - 1]! - spots[i]!) >= (rest[i - 1]! + rest[i]!) / 2 + gap - 1e-9);
      fit = spots.findIndex((_, i) => !clear(i));
      if (fit < 0) fit = spots.length;
    }
    for (const x of spots.slice(0, fit)) places.push({ lane: row.lane, x });
  }
  return places;
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
  /** The stand points it stood at last, newest first (at most RECENT). */
  recent: string[];
  /** Released to step out of a line: it tries again quickly until it walks. */
  soon: boolean;
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
  /**
   * Back to wandering from wherever the moment left it, with a fresh hold.
   * `soon`: a beat's hold, and short retries until it next walks (a hero
   * stepping out of the trailhead's line), rather than 8 to 20 seconds.
   */
  release(id: string, opts?: { soon?: boolean }): void;
  /**
   * Who stands or walks in the way of `id` walking `route` (§8.3): the
   * figures it would pass through. Empty when the way is clear.
   */
  blockers(id: string, route: RoutePoint[]): string[];
  /** Cut a holding figure's hold short: somebody needs it out of the way. */
  nudge(id: string): void;
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
  /**
   * Where a stand point is now: its authored x, or (camp.ts) that x moved in
   * so a figure standing there is wholly on screen. Default: as authored.
   */
  pointX?: (point: CampStandPoint) => number;
  /**
   * Half a figure's drawn width on a lane, as a fraction of the canvas width. Two
   * figures in one lane keep the sum of their halves apart; without it,
   * `CLEARANCE`.
   */
  halfWidth?: (id: string, lane: string) => number;
  /**
   * Stretches of lane nobody wanders to (the trailhead's line, camp.ts): a
   * stand point that would put a figure in one is not free.
   */
  reserved?: () => readonly LaneSweep[];
  /** A route as the figure will walk it (camp.ts moves its crossings in from a cropped edge). */
  fitRoute?: (id: string, route: RoutePoint[]) => RoutePoint[];
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

  /** How far apart two figures in one lane keep: their half-widths, or `CLEARANCE`. */
  function clearance(a: string, b: string, lane: string): number {
    return options.halfWidth ? options.halfWidth(a, lane) + options.halfWidth(b, lane) : CLEARANCE;
  }

  /** Everybody `me` would pass through walking `route` (§8.3). */
  function inTheWay(me: State, route: RoutePoint[]): State[] {
    const sweeps = routeSweeps(layout, route);
    const start = route[0]!;
    const next = route[1] ?? start;
    const outward = Math.sign(next.x - start.x);
    const found: State[] = [];
    for (const other of figures.values()) {
      if (other.id === me.id) continue;
      if (isWalking(other)) {
        const meets = (a: LaneSweep, b: LaneSweep): boolean => {
          if (a.lane !== b.lane) return false;
          const gap = clearance(me.id, other.id, a.lane);
          return a.lo - gap <= b.hi && b.lo - gap <= a.hi;
        };
        if (sweeps.some((a) => other.sweeps.some((b) => meets(a, b)))) found.push(other);
        continue;
      }
      const spot = other.route !== null && other.to ? other.to.spot : other.at.spot;
      const gap = clearance(me.id, other.id, spot.lane);
      for (const [i, sweep] of sweeps.entries()) {
        if (sweep.lane !== spot.lane) continue;
        if (spot.x < sweep.lo - gap || spot.x > sweep.hi + gap) continue;
        // Somebody just behind where `me` sets off is not in the way: it walks away from them.
        const behind = i === 0 && spot.lane === me.at.spot.lane && (outward === 0 || (spot.x - start.x) * outward <= 0);
        if (behind && Math.abs(spot.x - start.x) <= gap) continue;
        found.push(other);
        break;
      }
    }
    return found;
  }

  /** Whether `me` walking `route` keeps clear of everybody else (§8.3). */
  function clear(me: State, route: RoutePoint[]): boolean {
    return inTheWay(me, route).length === 0;
  }

  /** Whether standing at `spot` would put `me` in a reserved stretch (the trailhead's line). */
  function reservedAt(me: State, spot: CampSpot): boolean {
    const half = options.halfWidth ? options.halfWidth(me.id, spot.lane) : CLEARANCE / 2;
    return (options.reserved?.() ?? []).some((r) => r.lane === spot.lane && spot.x + half >= r.lo && spot.x - half <= r.hi);
  }

  /** The beat a figure waits before it tries again. */
  function retry(f: State, now: number): void {
    f.until = now + (f.soon ? between(SOON_MIN_S, SOON_MAX_S) : between(RETRY_MIN_S, RETRY_MAX_S));
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
      retry(f, now);
      return;
    }
    const busy = taken(f);
    const choices: { point: string; spot: CampSpot; route: RoutePoint[]; length: number }[] = [];
    for (const point of layout.frame.standPoints) {
      if (point.id === f.at.point || busy.has(point.id)) continue;
      if (point.seat !== undefined && point.seat !== f.seat) continue;
      const spot = { lane: point.lane, x: options.pointX ? options.pointX(point) : point.x };
      if (reservedAt(f, spot)) continue;
      const found = campRoute(layout, f.at.spot, spot);
      const route = found && options.fitRoute ? options.fitRoute(f.id, found) : found;
      if (!route || !clear(f, route)) continue;
      choices.push({ point: point.id, spot, route, length: routeLength(route, layout.canvas) });
    }
    if (choices.length === 0) {
      retry(f, now);
      return;
    }
    // Somewhere it has not just been, if there is anywhere.
    const fresh = choices.filter((c) => !f.recent.includes(c.point));
    const pool = fresh.length > 0 ? fresh : choices;
    pool.sort((a, b) => a.length - b.length || a.point.localeCompare(b.point));
    const pick = pool[Math.floor(random() * Math.min(NEARBY, pool.length))]!;
    const seconds = Math.max(0.01, options.walkSeconds(f.id, pick.route));
    f.mode = "walk";
    f.soon = false;
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

  function remember(f: State, point: string | null): void {
    if (!point) return;
    f.recent = [point, ...f.recent.filter((p) => p !== point)].slice(0, RECENT);
  }

  function arrive(f: State): void {
    if (f.to) {
      f.at = f.to;
      remember(f, f.to.point);
    }
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
        recent: [],
        soon: false,
      };
      remember(f, at.point);
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
      f.soon = false;
      f.startedAt = clock;
      if (route === null) {
        f.at = to;
        remember(f, to.point);
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
    release(id, opts) {
      const f = figures.get(id);
      if (!f) return;
      if (f.route !== null) arrive(f);
      f.soon = opts?.soon === true;
      if (f.soon) hold(f, clock, SOON_MIN_S, SOON_MAX_S);
      else hold(f, clock);
    },
    blockers(id, route) {
      const f = figures.get(id);
      if (!f || route.length === 0) return [];
      // Judged from where the route sets off, as a walk the planner starts is.
      const first = route[0]!;
      const me: State = { ...f, at: { spot: { lane: first.lane ?? f.at.spot.lane, x: first.x }, point: null } };
      return inTheWay(me, route).map((other) => other.id);
    },
    nudge(id) {
      const f = figures.get(id);
      if (!f || f.mode !== "hold") return;
      f.until = Math.min(f.until, clock + between(SOON_MIN_S, SOON_MAX_S));
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
