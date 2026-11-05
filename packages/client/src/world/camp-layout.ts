/**
 * The camp's ground (docs/camp.md §8.3): lanes, crossings, stand points and
 * the trailhead, as authored in assets/manifest.json → `camp`, and the routes
 * a figure walks between them.
 *
 * The walkable floor has horizontal lanes at fixed depths. A figure walks along its lane and changes lanes only at a
 * crossing the layout marks, so a route is a short line with at most a couple
 * of corners and there is no pathfinding to get wrong. A nearer lane (larger
 * `y`) draws in front and slightly bigger.
 *
 * Every coordinate is a fraction (0 to 1) of the backdrop canvas, so the same
 * frame stage lays over every backdrop of a terrain family. That is also why
 * the parser checks a frame against every backdrop: a stand point must stand
 * on a lane each backdrop has, inside the part of it that is walkable there.
 *
 * Pure and Pixi-free, like cast.ts and board-math.ts, so every rule here is a
 * test (camp-layout.test.ts).
 */

export type CampFace = "left" | "right";

/** What a figure does at a stand point (§8.4). */
export type CampAction = "warmUp" | "lookUp" | "peek" | "rest" | "greet" | "pet";
export const CAMP_ACTIONS: readonly CampAction[] = ["warmUp", "lookUp", "peek", "rest", "greet", "pet"];

/** How a piece's moving part moves while somebody uses it (§8.4). */
export type CampPartMotion = "flicker" | "sway" | "ripple" | "lift";
export const CAMP_PART_MOTIONS: readonly CampPartMotion[] = ["flicker", "sway", "ripple", "lift"];

/** How many heroes a table seats, and so how many bedrolls stage 1 lays out. */
export const CAMP_SEATS = 4;

export interface CampLane {
  id: string;
  /** The lane's ground line. */
  y: number;
  /** Its walkable span. */
  x0: number;
  x1: number;
  /** How big a figure on it is drawn, relative to the nearest lane (1). */
  scale: number;
}

/** A place where figures may change lanes, at `x`, between any of `lanes`. */
export interface CampCrossing {
  x: number;
  lanes: string[];
}

export interface CampBackdrop {
  family: string;
  /** Relative to `assets/`. */
  path: string;
  lanes: CampLane[];
  crossings: CampCrossing[];
}

export interface CampPiece {
  id: string;
  /** Relative to `assets/`. A 1024 canvas with ground contact at (512, 900), like a figure. */
  path: string;
  lane: string;
  x: number;
  /** Painted height, or the reference height for a 160cm owner. Absent: inferred from the id. */
  heightCm?: number;
  /** Optional hero seat for owned kit; shared camp pieces omit it. */
  ownerSeat?: number;
}

/**
 * How tall a piece is drawn when the manifest does not say, in centimeters,
 * by the first word of its id that this table knows (`campfire-big` is a
 * campfire). Anything else is `DEFAULT_PIECE_CM`, about a camp stool: big
 * enough to read, too small to hide a hero.
 */
export const PIECE_DEFAULT_CM: Readonly<Record<string, number>> = {
  campfire: 60,
  cookfire: 80,
  bedroll: 25,
  tent: 170,
  awning: 220,
  banner: 260,
  lantern: 45,
  lanterns: 45,
  lookout: 320,
  chest: 55,
  pack: 50,
  log: 40,
  stump: 45,
  kettle: 30,
};
export const DEFAULT_PIECE_CM = 60;

export function pieceHeightCm(piece: Pick<CampPiece, "id" | "heightCm">): number {
  if (piece.heightCm !== undefined) return piece.heightCm;
  for (const word of piece.id.toLowerCase().split(/[^a-z0-9]+/)) {
    const known = PIECE_DEFAULT_CM[word];
    if (known !== undefined) return known;
  }
  return DEFAULT_PIECE_CM;
}

export interface CampMovingPart {
  piece: string;
  path: string;
  motion: CampPartMotion;
}

export interface CampStandPoint {
  id: string;
  lane: string;
  x: number;
  face: CampFace;
  /** What a figure does here. Absent on a free wander spot: it just stands and breathes. */
  action?: CampAction;
  /** The piece the action uses, which animates only while somebody is here. */
  hotspot?: string;
  /** A hero's own bedroll (0 to 3): only that hero stands here. */
  seat?: number;
}

/** A spot on the ground: a lane and a position along it. */
export interface CampSpot {
  lane: string;
  x: number;
}

/**
 * A shared hotspot (§4.2) from stage 2: where the crew's piece of that kind
 * stands at this stage, and the piece shown there until the crew places
 * another (`default`, a `crewPieces` id in the manifest). Nothing is drawn at
 * a hotspot yet: the camp record that says what is placed comes with Phase 2.
 */
export interface CampHotspot {
  id: string;
  kind: string;
  lane: string;
  x: number;
  default?: string;
}

export interface CampFrame {
  stage: number;
  pieces: CampPiece[];
  movingParts: CampMovingPart[];
  /** Absent before stage 2. */
  hotspots?: CampHotspot[];
  standPoints: CampStandPoint[];
  trailhead: CampSpot;
}

export interface CampManifest {
  backdropCanvas: { width: number; height: number };
  backdrops: CampBackdrop[];
  frames: CampFrame[];
}

/** What a manifest's `camp` section failed on, with the path to the bad value. */
export class CampLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampLayoutError";
  }
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

function fail(at: string, what: string): never {
  throw new CampLayoutError(`camp${at}: ${what}`);
}

function object(value: unknown, at: string): Raw {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(at, "must be an object");
  return value as Raw;
}

function array(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) fail(at, "must be an array");
  return value;
}

function text(value: unknown, at: string): string {
  if (typeof value !== "string" || value.length === 0) fail(at, "must be a non-empty string");
  return value;
}

function fraction(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(at, "must be a fraction from 0 to 1");
  }
  return value;
}

function positive(value: unknown, at: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) fail(at, "must be a positive number");
  return value;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], at: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) fail(at, `must be one of ${options.join(", ")}`);
  return value as T;
}

function unique(ids: readonly string[], at: string, what: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(at, `${what} "${id}" appears twice`);
    seen.add(id);
  }
}

function parseLane(raw: unknown, at: string): CampLane {
  const o = object(raw, at);
  const lane = {
    id: text(o["id"], `${at}.id`),
    y: fraction(o["y"], `${at}.y`),
    x0: fraction(o["x0"], `${at}.x0`),
    x1: fraction(o["x1"], `${at}.x1`),
    scale: positive(o["scale"], `${at}.scale`),
  };
  if (lane.x0 >= lane.x1) fail(at, "x0 must be left of x1");
  return lane;
}

function parseBackdrop(raw: unknown, at: string): CampBackdrop {
  const o = object(raw, at);
  const lanes = array(o["lanes"], `${at}.lanes`).map((lane, i) => parseLane(lane, `${at}.lanes[${i}]`));
  if (lanes.length === 0) fail(`${at}.lanes`, "needs at least one lane");
  unique(lanes.map((l) => l.id), `${at}.lanes`, "lane");
  unique(lanes.map((l) => String(l.y)), `${at}.lanes`, "lane depth");
  const byId = new Map(lanes.map((l) => [l.id, l]));
  const crossings = array(o["crossings"], `${at}.crossings`).map((rawCrossing, i): CampCrossing => {
    const where = `${at}.crossings[${i}]`;
    const c = object(rawCrossing, where);
    const x = fraction(c["x"], `${where}.x`);
    const named = array(c["lanes"], `${where}.lanes`).map((id, j) => text(id, `${where}.lanes[${j}]`));
    if (named.length < 2) fail(`${where}.lanes`, "a crossing joins at least two lanes");
    unique(named, `${where}.lanes`, "lane");
    for (const id of named) {
      const lane = byId.get(id);
      if (!lane) fail(`${where}.lanes`, `names no lane "${id}"`);
      if (x < lane.x0 || x > lane.x1) fail(`${where}.x`, `is off the walkable span of lane "${id}"`);
    }
    return { x, lanes: named };
  });
  const backdrop: CampBackdrop = {
    family: text(o["family"], `${at}.family`),
    path: text(o["path"], `${at}.path`),
    lanes,
    crossings,
  };
  // Every lane has to be reachable from every other, or a figure could be
  // sent somewhere it can never walk to.
  const reached = new Set<string>([lanes[0]!.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const c of crossings) {
      if (c.lanes.some((id) => reached.has(id)) && c.lanes.some((id) => !reached.has(id))) {
        c.lanes.forEach((id) => reached.add(id));
        grew = true;
      }
    }
  }
  const stranded = lanes.find((l) => !reached.has(l.id));
  if (stranded) fail(`${at}.crossings`, `no crossing reaches lane "${stranded.id}"`);
  return backdrop;
}

function onEveryBackdrop(spot: CampSpot, backdrops: readonly CampBackdrop[], at: string, offEdge = false): void {
  for (const backdrop of backdrops) {
    const lane = backdrop.lanes.find((l) => l.id === spot.lane);
    if (!lane) fail(`${at}.lane`, `names no lane "${spot.lane}" on backdrop "${backdrop.family}"`);
    if (!offEdge && (spot.x < lane.x0 || spot.x > lane.x1)) {
      fail(`${at}.x`, `is off the walkable span of lane "${spot.lane}" on backdrop "${backdrop.family}"`);
    }
  }
}

function parseFrame(raw: unknown, at: string, backdrops: readonly CampBackdrop[]): CampFrame {
  const o = object(raw, at);
  const stage = o["stage"];
  if (typeof stage !== "number" || !Number.isInteger(stage) || stage < 1) fail(`${at}.stage`, "must be a whole number from 1");

  const pieces = array(o["pieces"], `${at}.pieces`).map((rawPiece, i): CampPiece => {
    const where = `${at}.pieces[${i}]`;
    const p = object(rawPiece, where);
    const piece: CampPiece = {
      id: text(p["id"], `${where}.id`),
      path: text(p["path"], `${where}.path`),
      lane: text(p["lane"], `${where}.lane`),
      x: fraction(p["x"], `${where}.x`),
    };
    if (p["heightCm"] !== undefined) piece.heightCm = positive(p["heightCm"], `${where}.heightCm`);
    if (p["ownerSeat"] !== undefined) {
      const seat = p["ownerSeat"];
      if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat >= CAMP_SEATS) fail(`${where}.ownerSeat`, "must be a seat from 0 to 3");
      piece.ownerSeat = seat;
    }
    onEveryBackdrop(piece, backdrops, where, true);
    return piece;
  });
  unique(pieces.map((p) => p.id), `${at}.pieces`, "piece");
  const pieceIds = new Set(pieces.map((p) => p.id));

  const movingParts = array(o["movingParts"] ?? [], `${at}.movingParts`).map((rawPart, i): CampMovingPart => {
    const where = `${at}.movingParts[${i}]`;
    const m = object(rawPart, where);
    const piece = text(m["piece"], `${where}.piece`);
    if (!pieceIds.has(piece)) fail(`${where}.piece`, `names no piece "${piece}"`);
    return { piece, path: text(m["path"], `${where}.path`), motion: oneOf(m["motion"], CAMP_PART_MOTIONS, `${where}.motion`) };
  });

  const hotspots = array(o["hotspots"] ?? [], `${at}.hotspots`).map((rawSpot, i): CampHotspot => {
    const where = `${at}.hotspots[${i}]`;
    const h = object(rawSpot, where);
    const spot: CampHotspot = {
      id: text(h["id"], `${where}.id`),
      kind: text(h["kind"], `${where}.kind`),
      lane: text(h["lane"], `${where}.lane`),
      x: fraction(h["x"], `${where}.x`),
    };
    if (h["default"] !== undefined) spot.default = text(h["default"], `${where}.default`);
    onEveryBackdrop(spot, backdrops, where);
    return spot;
  });
  unique([...pieces.map((p) => p.id), ...hotspots.map((h) => h.id)], `${at}.hotspots`, "piece or hotspot");
  const hotspotIds = new Set(hotspots.map((h) => h.id));

  const standPoints = array(o["standPoints"], `${at}.standPoints`).map((rawPoint, i): CampStandPoint => {
    const where = `${at}.standPoints[${i}]`;
    const s = object(rawPoint, where);
    const point: CampStandPoint = {
      id: text(s["id"], `${where}.id`),
      lane: text(s["lane"], `${where}.lane`),
      x: fraction(s["x"], `${where}.x`),
      face: oneOf(s["face"], ["left", "right"] as const, `${where}.face`),
    };
    if (s["action"] !== undefined) point.action = oneOf(s["action"], CAMP_ACTIONS, `${where}.action`);
    if (s["hotspot"] !== undefined) {
      const hotspot = text(s["hotspot"], `${where}.hotspot`);
      if (!pieceIds.has(hotspot) && !hotspotIds.has(hotspot)) fail(`${where}.hotspot`, `names no piece or hotspot "${hotspot}"`);
      point.hotspot = hotspot;
    }
    if (s["seat"] !== undefined) {
      const seat = s["seat"];
      if (typeof seat !== "number" || !Number.isInteger(seat) || seat < 0 || seat >= CAMP_SEATS) {
        fail(`${where}.seat`, `must be a whole number from 0 to ${CAMP_SEATS - 1}`);
      }
      point.seat = seat;
    }
    onEveryBackdrop(point, backdrops, where);
    return point;
  });
  if (standPoints.length === 0) fail(`${at}.standPoints`, "needs at least one stand point");
  unique(standPoints.map((p) => p.id), `${at}.standPoints`, "stand point");
  const seats = standPoints.flatMap((p) => (p.seat === undefined ? [] : [String(p.seat)]));
  unique(seats, `${at}.standPoints`, "seat");
  if (stage === 1 && seats.length !== CAMP_SEATS) {
    fail(`${at}.standPoints`, `stage 1 needs exactly ${CAMP_SEATS} seats, one bedroll per hero; it has ${seats.length}`);
  }

  const t = object(o["trailhead"], `${at}.trailhead`);
  const trailhead = { lane: text(t["lane"], `${at}.trailhead.lane`), x: fraction(t["x"], `${at}.trailhead.x`) };
  onEveryBackdrop(trailhead, backdrops, `${at}.trailhead`);

  return { stage, pieces, movingParts, ...(hotspots.length ? { hotspots } : {}), standPoints, trailhead };
}

/**
 * Read assets/manifest.json → `camp`, checking everything a bad layout would
 * otherwise break at the table. Unknown keys are ignored, so the section can
 * grow (tent styles, kit pieces) without this having to change.
 */
export function parseCampManifest(raw: unknown): CampManifest {
  const o = object(raw, "");
  const canvas = object(o["backdropCanvas"], ".backdropCanvas");
  const backdropCanvas = {
    width: positive(canvas["width"], ".backdropCanvas.width"),
    height: positive(canvas["height"], ".backdropCanvas.height"),
  };
  const backdrops = array(o["backdrops"], ".backdrops").map((b, i) => parseBackdrop(b, `.backdrops[${i}]`));
  if (backdrops.length === 0) fail(".backdrops", "needs at least one backdrop");
  unique(backdrops.map((b) => b.family), ".backdrops", "family");
  const frames = array(o["frames"], ".frames").map((f, i) => parseFrame(f, `.frames[${i}]`, backdrops));
  if (frames.length === 0) fail(".frames", "needs at least one frame");
  unique(frames.map((f) => String(f.stage)), ".frames", "stage");
  return { backdropCanvas, backdrops, frames };
}

// ---------------------------------------------------------------------------
// One camp: a backdrop with a frame stage laid over it
// ---------------------------------------------------------------------------

/** What camp.ts draws: one backdrop and one frame stage, with lanes by id. */
export interface CampLayout {
  canvas: { width: number; height: number };
  backdrop: CampBackdrop;
  frame: CampFrame;
  lanes: ReadonlyMap<string, CampLane>;
}

/**
 * The camp for a terrain family at a frame stage. An unknown family takes the
 * first backdrop, and a stage past the last authored one takes the biggest,
 * so a new terrain or a fifth campaign still pitches a camp.
 */
export function campLayout(manifest: CampManifest, family: string, stage: number): CampLayout {
  const backdrop = manifest.backdrops.find((b) => b.family === family) ?? manifest.backdrops[0]!;
  const byStage = [...manifest.frames].sort((a, b) => a.stage - b.stage);
  const frame = byStage.find((f) => f.stage === stage) ?? byStage.filter((f) => f.stage <= stage).pop() ?? byStage[0]!;
  return { canvas: manifest.backdropCanvas, backdrop, frame, lanes: new Map(backdrop.lanes.map((l) => [l.id, l])) };
}

export function laneOf(layout: CampLayout, id: string): CampLane {
  const lane = layout.lanes.get(id);
  if (!lane) throw new CampLayoutError(`camp: no lane "${id}"`);
  return lane;
}

export function standPoint(layout: CampLayout, id: string): CampStandPoint | undefined {
  return layout.frame.standPoints.find((p) => p.id === id);
}

export type CampFriendHabit = "bun" | "duckling" | "mosshorn";

export function friendHabitSpot(layout: CampLayout, habit: CampFriendHabit): CampStandPoint | undefined {
  if (habit === "mosshorn") {
    const corner = layout.frame.standPoints.find((point) => point.action === "pet");
    return corner && { ...corner, x: corner.x - 0.075, face: "left" };
  }
  const warmSpots = layout.frame.standPoints.filter((point) => point.action === "warmUp");
  const nearby = warmSpots[habit === "bun" ? 0 : 1];
  // Tuck closer to the stones so the heroes can still use their warm-up spots.
  return nearby && { ...nearby, x: nearby.x + (nearby.face === "right" ? 0.045 : -0.045) };
}

/**
 * How big a figure is drawn with its feet at `y`: its lane's scale on a lane,
 * eased between the two lanes' while it is on a crossing, so a figure grows
 * as it walks nearer rather than popping when it arrives.
 */
export function laneScaleAt(layout: CampLayout, y: number): number {
  const lanes = [...layout.lanes.values()].sort((a, b) => a.y - b.y);
  const first = lanes[0]!;
  if (y <= first.y) return first.scale;
  for (let i = 1; i < lanes.length; i++) {
    const near = lanes[i]!;
    const far = lanes[i - 1]!;
    if (y <= near.y) return far.scale + ((y - far.y) / (near.y - far.y)) * (near.scale - far.scale);
  }
  return lanes[lanes.length - 1]!.scale;
}

/** The lane whose ground line is at `y`, or null between lanes on a crossing. */
export function laneAt(layout: CampLayout, y: number): string | null {
  for (const lane of layout.lanes.values()) if (Math.abs(lane.y - y) < 1e-9) return lane.id;
  return null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * A corner of a route, in canvas fractions. `lane` is the lane the figure is
 * on from here, or null while it is between two lanes on a crossing.
 */
export interface RoutePoint {
  x: number;
  y: number;
  lane: string | null;
}

/** A route's length in canvas pixels, which is what a walk is measured in. */
export function routeLength(route: readonly RoutePoint[], canvas: { width: number; height: number }): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    total += Math.hypot((route[i]!.x - route[i - 1]!.x) * canvas.width, (route[i]!.y - route[i - 1]!.y) * canvas.height);
  }
  return total;
}

/**
 * The route from one spot to another: along the lane, and across at a
 * crossing when the lanes differ, by the crossing (or the two) that make the
 * shortest walk. A crossing that spans three lanes is walked straight across
 * the middle one. Null when the lanes are not joined (the parser refuses such
 * a layout, so in practice never).
 *
 * `to` may stand past the lane's end: the trail out of camp continues off
 * the backdrop.
 */
export function campRoute(layout: CampLayout, from: CampSpot, to: CampSpot): RoutePoint[] | null {
  const start = laneOf(layout, from.lane);
  const end = laneOf(layout, to.lane);
  const first: RoutePoint = { x: from.x, y: start.y, lane: start.id };
  const last: RoutePoint = { x: to.x, y: end.y, lane: end.id };
  if (start.id === end.id) return from.x === to.x ? [first] : [first, last];

  const crossings = layout.backdrop.crossings;
  const joins = (c: CampCrossing, a: string, b: string): boolean => c.lanes.includes(a) && c.lanes.includes(b);

  // One crossing straight from lane to lane.
  let best: { cost: number; via: { x: number; lane: CampLane }[] } | null = null;
  for (const c of crossings) {
    if (!joins(c, start.id, end.id)) continue;
    const cost = Math.abs(from.x - c.x) + Math.abs(c.x - to.x);
    if (!best || cost < best.cost) best = { cost, via: [{ x: c.x, lane: end }] };
  }
  // Failing that, two, through a lane between.
  if (!best) {
    for (const a of crossings) {
      if (!a.lanes.includes(start.id)) continue;
      for (const middleId of a.lanes) {
        if (middleId === start.id) continue;
        for (const b of crossings) {
          if (b === a || !joins(b, middleId, end.id)) continue;
          const cost = Math.abs(from.x - a.x) + Math.abs(a.x - b.x) + Math.abs(b.x - to.x);
          if (!best || cost < best.cost) best = { cost, via: [{ x: a.x, lane: laneOf(layout, middleId) }, { x: b.x, lane: end }] };
        }
      }
    }
  }
  if (!best) return null;
  return buildRoute(first, start, best.via, last);
}

/** A route through `via`'s crossings, from `first` on `start` to `last`. */
function buildRoute(first: RoutePoint, start: CampLane, via: readonly { x: number; lane: CampLane }[], last: RoutePoint): RoutePoint[] {
  const route: RoutePoint[] = [{ ...first }];
  let lane = start;
  const push = (point: RoutePoint): void => {
    const prev = route[route.length - 1]!;
    if (prev.x === point.x && prev.y === point.y) {
      prev.lane = point.lane;
      return;
    }
    route.push(point);
  };
  for (const hop of via) {
    push({ x: hop.x, y: lane.y, lane: null });
    push({ x: hop.x, y: hop.lane.y, lane: hop.lane.id });
    lane = hop.lane;
  }
  push({ ...last });
  return route;
}

/**
 * Every way from one spot to another by at most two crossings, shortest
 * first: along the lane, across at any crossing that joins the two lanes,
 * or round by another lane and back. `campRoute` is the shortest; the rest
 * let a figure walk round a lane-mate who is in the way rather than through
 * them, or wait (camp.ts, the trailhead's line).
 */
export function campRoutes(layout: CampLayout, from: CampSpot, to: CampSpot): RoutePoint[][] {
  const start = laneOf(layout, from.lane);
  const end = laneOf(layout, to.lane);
  const first: RoutePoint = { x: from.x, y: start.y, lane: start.id };
  const last: RoutePoint = { x: to.x, y: end.y, lane: end.id };
  const crossings = layout.backdrop.crossings;
  const ways: { cost: number; via: { x: number; lane: CampLane }[] }[] = [];
  if (start.id === end.id) ways.push({ cost: Math.abs(from.x - to.x), via: [] });
  for (const c of crossings) {
    if (start.id === end.id || !c.lanes.includes(start.id) || !c.lanes.includes(end.id)) continue;
    ways.push({ cost: Math.abs(from.x - c.x) + Math.abs(c.x - to.x), via: [{ x: c.x, lane: end }] });
  }
  for (const a of crossings) {
    if (!a.lanes.includes(start.id)) continue;
    for (const middleId of a.lanes) {
      if (middleId === start.id || middleId === end.id) continue;
      for (const b of crossings) {
        if (b === a || !b.lanes.includes(middleId) || !b.lanes.includes(end.id)) continue;
        const cost = Math.abs(from.x - a.x) + Math.abs(a.x - b.x) + Math.abs(b.x - to.x);
        ways.push({ cost, via: [{ x: a.x, lane: laneOf(layout, middleId) }, { x: b.x, lane: end }] });
      }
    }
  }
  ways.sort((p, q) => p.cost - q.cost);
  return ways.map((way) => (way.via.length === 0 && from.x === to.x ? [first] : buildRoute(first, start, way.via, last)));
}

/**
 * The stretches of each lane a route sweeps, as [lo, hi] spans of x: the
 * along-lane legs, and the single x where it crosses a lane on a crossing.
 * What the wander planner checks so lane-mates take turns (§8.3).
 */
export interface LaneSweep {
  lane: string;
  lo: number;
  hi: number;
}

export function routeSweeps(layout: CampLayout, route: readonly RoutePoint[]): LaneSweep[] {
  const sweeps: LaneSweep[] = [];
  const lanes = [...layout.lanes.values()];
  if (route.length === 1) {
    const only = route[0]!;
    if (only.lane) sweeps.push({ lane: only.lane, lo: only.x, hi: only.x });
    return sweeps;
  }
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    if (a.y === b.y) {
      const lane = lanes.find((l) => l.y === a.y);
      if (lane) sweeps.push({ lane: lane.id, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    } else {
      const lo = Math.min(a.y, b.y);
      const hi = Math.max(a.y, b.y);
      for (const lane of lanes) if (lane.y >= lo && lane.y <= hi) sweeps.push({ lane: lane.id, lo: a.x, hi: a.x });
    }
  }
  return sweeps;
}
