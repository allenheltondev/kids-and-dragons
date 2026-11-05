/**
 * How a camp figure moves (docs/camp.md §8.1, §8.2, §8.4): the paper-puppet
 * walk, the poses at a stand point, and the moving parts of pieces.
 *
 * Every figure is one transparent cutout, so the motion, not the drawing,
 * says what it is doing. A standing figure walks as a series of small hops:
 * it pushes off with its feet on the ground, travels only while it is in the
 * air, and lands with a tiny squash. That one rule is what keeps a cutout from
 * reading as a sliding sticker, and `walkPose` is built so it cannot break it:
 * along a step, horizontal travel happens only between `AIR_START` and
 * `AIR_END`, and outside that window the feet are on the route's ground line.
 *
 * A walk is planned once (`planWalk`) and then read at any time (`walkPose`),
 * so a frame that comes late reads the same pose a frame on time would have
 * at that moment: motion runs on frame time, never frame count (§8.6, rule 7).
 * `frameSeconds` caps one frame's advance, so a screen that was hidden picks
 * up where it was rather than racing through what it missed.
 *
 * One small set of constants for every figure (rule 6): the hop, lean, wobble
 * and squash are fractions of the figure's own height or fixed angles, and
 * only the step's length and pace come from its size, with pace growing more
 * slowly than height so big things lumber rather than rush.
 *
 * Pure and Pixi-free, like idle-motion.ts; camp-motion.test.ts holds §8.6 as
 * numbers.
 */

import type { CastStance } from "@kad/shared";
import type { CampAction, CampPartMotion, RoutePoint } from "./camp-layout";
import { drawnHeight, type StageMeasure } from "./figure-scale";

// ---------------------------------------------------------------------------
// The constants (§8.2)
// ---------------------------------------------------------------------------

/** A full step's hop, as a fraction of the figure's height. */
export const HOP = 0.03;
/** The lean into a walk, in radians (about 2.3°). */
export const LEAN = 0.04;
/** The gait's alternating wobble per step, in radians (1.5°). */
export const WOBBLE = (1.5 * Math.PI) / 180;
/** How much shorter (and wider) a landing squashes the figure. */
export const SQUASH = 0.02;
/** The part of a step the feet are off the ground: travel happens only here. */
export const AIR_START = 0.12;
export const AIR_END = 0.82;
/** The first and last steps' length, as a share of a full step. */
export const EASED_STEP = 0.6;
/** And their duration. */
export const EASED_STEP_TIME = 0.8;
/** The dip a figure makes on arriving, then it breathes. */
export const SETTLE_S = 0.4;
export const SETTLE_DIP = 0.015;
/** Time to turn round before the first step, when a walk starts the other way. */
export const TURN_LEAD_S = 0.3;
/** The most one frame advances the camp: past this, the screen was paused. */
export const MAX_FRAME_S = 0.25;

/** The figure every gait is scaled from: a hero, 160 cm, at a walking pace. */
const REFERENCE_CM = 160;
const REFERENCE_STEP_CM = 42;
const REFERENCE_STEP_S = 0.48;
/** Step length grows as height^0.75 and step time as height^0.25, so speed
    grows as height^0.5: a mosshorn is not a sprinter. */
export const STEP_LENGTH_POWER = 0.75;
export const STEP_TIME_POWER = 0.25;

/**
 * How the camp turns centimeters into backdrop-canvas pixels, for figures and
 * pieces alike (figure-scale.ts `drawnHeight`): a 160 cm hero stands
 * `HERO_SHARE` of the backdrop's height on a lane of scale 1, nothing is drawn
 * shorter than `FLOOR_SHARE` of it, and nothing taller than `MAX_SHARE`.
 */
export const HERO_SHARE = 0.26;
export const FLOOR_SHARE = 0.06;
export const MAX_SHARE = 0.6;
export function campMeasure(canvasHeight: number): StageMeasure {
  return {
    pxPerCm: (HERO_SHARE * canvasHeight) / REFERENCE_CM,
    headroom: canvasHeight,
    floor: FLOOR_SHARE * canvasHeight,
    maxHeight: MAX_SHARE * canvasHeight,
  };
}

/** A figure's or piece's drawn height on the camp canvas, before its lane's scale. */
export function campHeightPx(heightCm: number, measure: StageMeasure): number {
  const drawn = drawnHeight({ heightCm, stance: "standing", paint: null }, 1, measure);
  return Math.min(measure.maxHeight ?? Infinity, drawn);
}

/** One frame's advance in seconds, capped so a long pause never replays. */
export function frameSeconds(deltaMS: number): number {
  if (!Number.isFinite(deltaMS) || deltaMS <= 0) return 0;
  return Math.min(deltaMS / 1000, MAX_FRAME_S);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Zero speed at both ends, so travel starts and stops without a jerk. */
export const smoothstep = (v: number): number => {
  const c = clamp01(v);
  return c * c * (3 - 2 * c);
};

// ---------------------------------------------------------------------------
// The gait
// ---------------------------------------------------------------------------

export interface CampGait {
  /** The figure's drawn height, in canvas pixels. */
  heightPx: number;
  /** A full step's length, in canvas pixels. */
  stepPx: number;
  /** A full step's duration, in seconds. */
  stepS: number;
  /** Hovering, flying and swimming figures glide rather than hop. */
  glide: boolean;
}

/**
 * A figure's gait from its true height (figure-scale.ts) and how many canvas
 * pixels a centimeter is drawn at. `heightPx` is what it is drawn at, which a
 * floor may have raised above true proportion; the stride stays true.
 */
export function campGait(heightCm: number, stance: CastStance, pxPerCm: number, heightPx = heightCm * pxPerCm): CampGait {
  const ratio = Math.max(0.05, heightCm / REFERENCE_CM);
  return {
    heightPx,
    stepPx: REFERENCE_STEP_CM * Math.pow(ratio, STEP_LENGTH_POWER) * pxPerCm,
    stepS: REFERENCE_STEP_S * Math.pow(ratio, STEP_TIME_POWER),
    glide: stance !== "standing",
  };
}

/**
 * A gait for a figure drawn at `figureScale` of its size (camp-framing.ts
 * `campFigureScale`): the stride shrinks with the drawing, so a smaller hero
 * still covers the ground in steps its own size, and its pace is kept. The
 * hop, lean and squash need nothing: they are fractions of `heightPx`, read in
 * the figure's own units, which the camp draws at the same factor.
 */
export function campStride(gait: CampGait, figureScale: number): CampGait {
  const k = Number.isFinite(figureScale) && figureScale > 0 ? figureScale : 1;
  return k === 1 ? gait : { ...gait, stepPx: gait.stepPx * k };
}

/** Canvas pixels per second at a steady walk. */
export function walkSpeed(gait: CampGait): number {
  return gait.stepPx / gait.stepS;
}

// ---------------------------------------------------------------------------
// A walk
// ---------------------------------------------------------------------------

export interface WalkStep {
  /** Distance along the route at take-off and landing, in canvas pixels. */
  d0: number;
  d1: number;
  /** When the step starts and ends, in seconds from the walk's start. */
  t0: number;
  t1: number;
  /** The step's share of a full step (first and last are shorter). */
  share: number;
  /** Which way it travels across the screen: 1 right, -1 left. */
  heading: 1 | -1;
}

export interface CampWalk {
  /** The route in canvas pixels, with each corner's lane. */
  points: { x: number; y: number; lane: string | null }[];
  /** Distance along the route at each corner. */
  along: number[];
  length: number;
  gait: CampGait;
  steps: WalkStep[];
  /** Seconds spent turning round before the first step. */
  lead: number;
  /** When travel ends and the settle begins. */
  travelEnd: number;
  /** When the walk is over, settle and all. */
  duration: number;
  /** The way the figure faces at the start and the end. */
  startHeading: 1 | -1;
  endHeading: 1 | -1;
}

/** Where along the route a distance lands, in canvas pixels. */
function pointAlong(walk: Pick<CampWalk, "points" | "along">, d: number): { x: number; y: number; segment: number } {
  const { points, along } = walk;
  if (points.length === 1 || d <= 0) return { x: points[0]!.x, y: points[0]!.y, segment: 0 };
  for (let i = 1; i < points.length; i++) {
    if (d <= along[i]! || i === points.length - 1) {
      const span = along[i]! - along[i - 1]!;
      const f = span > 0 ? clamp01((d - along[i - 1]!) / span) : 1;
      const a = points[i - 1]!;
      const b = points[i]!;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, segment: i - 1 };
    }
  }
  const last = points[points.length - 1]!;
  return { x: last.x, y: last.y, segment: points.length - 2 };
}

/**
 * Plan a walk along `route` (canvas fractions, camp-layout.ts `campRoute`).
 * `facing` is the way the figure faces now (1 right, -1 left): a walk that
 * starts the other way spends `TURN_LEAD_S` turning before its first step.
 */
export function planWalk(
  route: readonly RoutePoint[],
  canvas: { width: number; height: number },
  gait: CampGait,
  facing: 1 | -1 = 1,
): CampWalk {
  const points = route.map((p) => ({ x: p.x * canvas.width, y: p.y * canvas.height, lane: p.lane }));
  const along = [0];
  for (let i = 1; i < points.length; i++) {
    along.push(along[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  }
  const length = along[along.length - 1]!;
  const walk: CampWalk = {
    points,
    along,
    length,
    gait,
    steps: [],
    lead: 0,
    travelEnd: 0,
    duration: 0,
    startHeading: facing,
    endHeading: facing,
  };
  if (length < 0.5) return walk;

  // The heading of each stretch of the route: a lane change keeps whichever
  // way the figure was going.
  const headingAt = (d: number, previous: 1 | -1): 1 | -1 => {
    const a = pointAlong(walk, d);
    const b = pointAlong(walk, Math.min(length, d + 1));
    if (b.x > a.x + 1e-6) return 1;
    if (b.x < a.x - 1e-6) return -1;
    return previous;
  };

  let shares: number[];
  if (gait.glide) {
    shares = [1];
  } else {
    const n = Math.max(1, Math.round(length / gait.stepPx + 2 * (1 - EASED_STEP)));
    shares = n === 1 ? [1] : Array.from({ length: n }, (_, i) => (i === 0 || i === n - 1 ? EASED_STEP : 1));
  }
  const total = shares.reduce((a, b) => a + b, 0);

  let heading = headingAt(0, facing);
  walk.startHeading = heading;
  walk.lead = heading === facing ? 0 : TURN_LEAD_S;
  let t = walk.lead;
  let d = 0;
  for (const share of shares) {
    const d1 = Math.min(length, d + (length * share) / total);
    heading = headingAt(d, heading);
    const duration = gait.glide
      ? Math.max(0.6, (length / walkSpeed(gait)) * 1.25)
      : gait.stepS * (share === 1 ? 1 : EASED_STEP_TIME);
    walk.steps.push({ d0: d, d1, t0: t, t1: t + duration, share, heading });
    t += duration;
    d = d1;
  }
  walk.endHeading = heading;
  walk.travelEnd = t;
  walk.duration = t + SETTLE_S;
  return walk;
}

export interface WalkPose {
  /** The feet's ground point, in canvas pixels. */
  x: number;
  y: number;
  /** How far the feet are off that ground, in canvas pixels (up). */
  lift: number;
  /** In screen space: positive leans the top of the figure to the right. */
  rotation: number;
  /** Squash and stretch about the feet. */
  scaleX: number;
  scaleY: number;
  /** Multiplier on the contact shadow. */
  shadow: number;
  /** Which way the figure should face: 1 right, -1 left. */
  facing: 1 | -1;
  /** Feet off the ground (a hop's air phase, or a glide). */
  airborne: boolean;
  /** Still travelling (lead and settle are not). */
  moving: boolean;
  done: boolean;
  /** The lane under the feet, or null between lanes on a crossing. */
  lane: string | null;
}

/** The pose `t` seconds into a walk. Defined for any t: before 0 is the start, past the end the finish. */
export function walkPose(walk: CampWalk, t: number): WalkPose {
  const start = walk.points[0]!;
  const end = walk.points[walk.points.length - 1]!;
  const h = walk.gait.heightPx;
  const rest: WalkPose = {
    x: start.x,
    y: start.y,
    lift: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shadow: 1,
    facing: walk.startHeading,
    airborne: false,
    moving: false,
    done: false,
    lane: start.lane,
  };
  if (walk.steps.length === 0) return { ...rest, done: true };
  if (t < walk.lead) return rest;

  if (t >= walk.travelEnd) {
    // The settle: one small dip, feet planted, then it breathes.
    const v = (t - walk.travelEnd) / SETTLE_S;
    // A glider has no feet to settle on; it drifts to a stop and bobs on.
    const dip = v < 1 && !walk.gait.glide ? SETTLE_DIP * Math.sin(Math.PI * v) : 0;
    return {
      ...rest,
      x: end.x,
      y: end.y,
      scaleX: 1 + dip * 0.5,
      scaleY: 1 - dip,
      shadow: 1 + dip,
      facing: walk.endHeading,
      done: t >= walk.duration,
      lane: end.lane,
    };
  }

  const index = walk.steps.findIndex((s) => t < s.t1);
  const i = index < 0 ? walk.steps.length - 1 : index;
  const step = walk.steps[i]!;
  const u = clamp01((t - step.t0) / (step.t1 - step.t0));
  const first = walk.steps[0]!;
  const last = walk.steps[walk.steps.length - 1]!;
  // Lean in over the first step, upright over the last.
  const envelope = Math.min(
    smoothstep((t - first.t0) / (first.t1 - first.t0)),
    1 - smoothstep((t - last.t0) / (last.t1 - last.t0)),
  );
  // A step that turns the figure round eases its lean from one side to the other.
  const previousHeading = i > 0 ? walk.steps[i - 1]!.heading : step.heading;
  const leanSide = previousHeading + (step.heading - previousHeading) * smoothstep(u);

  if (walk.gait.glide) {
    const travel = smoothstep(u);
    const at = pointAlong(walk, step.d0 + (step.d1 - step.d0) * travel);
    return {
      ...rest,
      x: at.x,
      y: at.y,
      rotation: leanSide * LEAN * 0.6 * Math.sin(Math.PI * u),
      facing: step.heading,
      airborne: true,
      moving: true,
      lane: segmentLane(walk, at),
    };
  }

  const a = clamp01((u - AIR_START) / (AIR_END - AIR_START));
  const inAir = u > AIR_START && u < AIR_END;
  const travel = u <= AIR_START ? 0 : u >= AIR_END ? 1 : smoothstep(a);
  const at = pointAlong(walk, step.d0 + (step.d1 - step.d0) * travel);
  const hop = HOP * Math.sqrt(step.share) * h;
  const lift = inAir ? hop * Math.sin(Math.PI * a) : 0;
  const squash = u >= AIR_END ? SQUASH * Math.sin((Math.PI * (u - AIR_END)) / (1 - AIR_END)) : 0;
  const wobble = WOBBLE * (i % 2 === 0 ? 1 : -1) * Math.sin(Math.PI * u);
  const up = hop > 0 ? lift / (HOP * h) : 0;
  return {
    x: at.x,
    y: at.y,
    lift,
    rotation: leanSide * LEAN * envelope + wobble,
    scaleX: 1 + squash,
    scaleY: 1 - squash,
    shadow: 1 - 0.3 * up + 2 * squash,
    facing: step.heading,
    airborne: inAir,
    moving: true,
    done: false,
    lane: segmentLane(walk, at),
  };
}

/** The lane whose ground line the feet are on, or null between lanes on a crossing. */
function segmentLane(walk: CampWalk, at: { x: number; y: number }): string | null {
  for (const p of walk.points) if (p.lane !== null && Math.abs(p.y - at.y) < 1e-6) return p.lane;
  return null;
}

// ---------------------------------------------------------------------------
// At a stand point (§8.4)
// ---------------------------------------------------------------------------

/**
 * A stand-point action's pose, `since` seconds after arriving. `lean` is
 * toward the way the stand point faces (negative leans back); the caller turns
 * it into screen space. `lift` is a fraction of height, `low` how much shorter
 * the figure settles. `breathPace` slows the idle breath under it.
 */
export interface ActionPose {
  lean: number;
  lift: number;
  low: number;
  breathPace: number;
}

const STILL_POSE: ActionPose = { lean: 0, lift: 0, low: 0, breathPace: 1 };

/** Eases into the action over its first moments, so arriving never snaps. */
const into = (since: number, seconds = 0.8): number => smoothstep(since / seconds);

/** One hop between `from` and `to` seconds, as a fraction of height. */
function hopBetween(since: number, from: number, to: number, height = HOP): number {
  if (since <= from || since >= to) return 0;
  return height * Math.sin((Math.PI * (since - from)) / (to - from));
}

/** How long a peek's loop takes: lean in, hop, lean back, then a long hold. */
export const PEEK_PERIOD_S = 7;

export function actionPose(action: CampAction, since: number, still = false): ActionPose {
  if (still) return STILL_POSE;
  switch (action) {
    case "warmUp":
      // Faces the fire, settles a little lower, slow breath.
      return { lean: 0.015 * into(since), lift: 0, low: 0.02 * into(since), breathPace: 0.7 };
    case "lookUp":
      // Leans back a few degrees and holds.
      return { lean: -0.06 * into(since, 1), lift: 0, low: 0, breathPace: 1 };
    case "peek": {
      const c = since % PEEK_PERIOD_S;
      const leanIn = smoothstep(c / 0.8) * (1 - smoothstep((c - 1.8) / 0.8));
      return { lean: 0.07 * leanIn, lift: hopBetween(c, 0.8, 1.2), low: 0, breathPace: 1 };
    }
    case "rest":
      // Turns to it, dips and holds still.
      return { lean: 0, lift: 0, low: 0.03 * into(since), breathPace: 0.6 };
    case "greet":
      // Turns to face them, one hop.
      return { lean: 0, lift: hopBetween(since, 0.3, 0.7), low: 0, breathPace: 1 };
    case "pet":
      // Steps close, leans in.
      return { lean: 0.08 * into(since), lift: 0, low: 0.01 * into(since), breathPace: 1 };
  }
}

/** Bun gives her ribbon two little shakes before tucking in by the fire. */
export function bunSettlePose(since: number, still: boolean): ActionPose {
  const shake = (since - 0.35) / 0.55;
  return {
    lean: !still && shake > 0 && shake < 1
      ? 0.065 * Math.sin(shake * Math.PI * 4) * Math.sin(shake * Math.PI)
      : 0,
    lift: 0,
    low: still ? 0.09 : 0.09 * smoothstep((since - 0.9) / 0.5),
    breathPace: 0.6,
  };
}

/**
 * A hero arriving in the lobby (§8.5): sits up on the bedroll, looks around
 * and waves, a hop and a turn toward the screen. `turned` is when the figure
 * faces the other way from its stand point's facing, for the look round.
 */
export const WAVE_S = 2;
export function wavePose(since: number, still = false): { lift: number; turned: boolean } {
  if (still) return { lift: 0, turned: false };
  return { lift: hopBetween(since, 0.9, 1.3), turned: since > 0.3 && since < 0.9 };
}

// ---------------------------------------------------------------------------
// Pieces (§8.4)
// ---------------------------------------------------------------------------

/**
 * A moving part's transform about its anchor. `strength` (0 to 1) is how much
 * somebody is using its piece, eased by the caller: at 0 this is exactly the
 * painted rest pose, so a piece nobody uses is a painting.
 */
export interface PartPose {
  dy: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
}

export const PART_REST: PartPose = { dy: 0, rotation: 0, scaleX: 1, scaleY: 1, alpha: 1 };

export function partMotion(motion: CampPartMotion, seconds: number, strength: number): PartPose {
  const s = clamp01(strength);
  if (s === 0) return PART_REST;
  const wave = (period: number, offset = 0): number => Math.sin((seconds * 2 * Math.PI) / period + offset);
  switch (motion) {
    case "flicker": {
      // Three periods that never line up, so a flame never reads as a loop.
      const f = 0.5 * wave(0.37) + 0.3 * wave(0.61, 1.3) + 0.2 * wave(1.13, 2.1);
      return { dy: 0, rotation: 0.02 * s * wave(0.9, 0.4), scaleX: 1 - 0.02 * s * f, scaleY: 1 + 0.07 * s * f, alpha: 1 - 0.12 * s * (0.5 - 0.5 * f) };
    }
    case "sway":
      return { ...PART_REST, rotation: 0.05 * s * wave(2.6) };
    case "ripple":
      return { ...PART_REST, rotation: 0.015 * s * wave(1.4, 0.7), scaleX: 1 + 0.03 * s * wave(1.1) };
    case "lift": {
      // The lid or flap lifts and drops now and then, not constantly.
      const pulse = Math.max(0, wave(3.2));
      return { ...PART_REST, dy: -0.04 * s * pulse * pulse };
    }
  }
}

/** The pieces somebody is using, from the stand points figures are acting at. */
export function activeHotspots(
  points: readonly { id: string; hotspot?: string }[],
  using: Iterable<string>,
): Set<string> {
  const byId = new Map(points.map((p) => [p.id, p]));
  const active = new Set<string>();
  for (const id of using) {
    const hotspot = byId.get(id)?.hotspot;
    if (hotspot) active.add(hotspot);
  }
  return active;
}
