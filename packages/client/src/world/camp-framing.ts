/**
 * Where the camp's painting goes in a pane (docs/camp.md §3, §8.3, #614): one
 * painting, edge to edge, slid so the camp stands in the lobby's window.
 *
 * The lobby leaves an open window between its header and its panels, and that
 * window is wide and short. The backdrop is a 16:9 painting, so fitting all of
 * it in the window ("contain") left a small picture with gaps at its sides.
 * Instead the painting covers: it is scaled to the full pane width (or the
 * window's height, whichever needs more), centered across the camp, and slid
 * up or down so the camp's focus band, from a standing hero's head on the back
 * lane to just below the near lane, sits centered in the window. Its sky is
 * trimmed off the top of the pane, and its plain grass runs on under the
 * panels (docs/briefs/camp.md promises the top and bottom quarters are plain).
 *
 * Where the slid painting stops short of the pane's top or bottom, its own
 * edge rows are drawn on past it, flipped so the seam meets itself
 * (`campBleed`): the same painting at the same scale, never a dimmed copy.
 *
 * When the band is taller than the window at that scale (a tall hero seated,
 * a short window on a 16:9 TV), the figures and pieces shrink, not the
 * painting (`campFigureScale`), so every hero stands whole between the header
 * and the panels.
 *
 * The moving camp (camp.ts) and the still one (StillCamp.tsx) both frame
 * through `campFit`, so the two never disagree. Pure and Pixi-free, like
 * camp-layout.ts, so every rule here is a test (camp-framing.test.ts).
 */

import type { CampLayout } from "./camp-layout";
import { campHeightPx, campMeasure } from "./camp-motion";
import { DEFAULT_SIZE, NOMINAL_PAINT, paintAspect } from "./figure-scale";

/** How far below the nearest lane a figure's feet and contact shadow still reach, as a fraction of the canvas. */
export const GROUND_MARGIN = 0.04;

/**
 * The share of the painting at its top and bottom that the brief promises is
 * plain (sky, then grass), and so may be drawn on past the edge.
 */
export const BLEED_SOURCE = 0.25;

/** A stretch of the canvas from `top` to `bottom`, as fractions of its height. */
export interface CampBand {
  top: number;
  bottom: number;
}

/** The open window in the pane, in pane px from its top. */
export interface CampWindow {
  top: number;
  bottom: number;
}

/** The painting's scale and its top-left corner, in pane px. */
export interface CampFraming {
  scale: number;
  x: number;
  y: number;
}

/**
 * The camp's focus band: from the head of the tallest seated figure standing
 * on the lane that puts a head highest (the back lane, drawn smallest but
 * furthest up), to the nearest lane plus the feet's margin. Nobody seated, or
 * nobody taller, is measured as a standing person (figure-scale.ts
 * `DEFAULT_SIZE`), so the frame is set for a hero before the first one sits
 * down and a small one arriving does not move it.
 *
 * `figureScale` is the factor every figure and piece is drawn at
 * (`campFigureScale`): the heads and the feet's margin shrink with it, the
 * lanes do not.
 */
export function campFocusBand(layout: CampLayout, heightsCm: readonly number[] = [], figureScale = 1, extra: readonly CampReach[] = []): CampBand {
  const reach: CampReach[] = [...campReach(layout, heightsCm), ...extra];
  const top = Math.min(...reach.map((lane) => lane.y - lane.head * figureScale));
  const ground = Math.max(...reach.map((lane) => lane.y));
  const bottom = Math.max(ground + GROUND_MARGIN * figureScale, ...reach.map((lane) => lane.y + (lane.foot ?? 0)));
  return { top: Math.max(0, top), bottom: Math.min(1, bottom) };
}

/**
 * Something that stands up from a ground line `y` by `head` at full size, as
 * fractions of the canvas: a lane's tallest seated head, or a stage-2 piece
 * taller than any hero (a hero's tent is a little taller than she is, and its
 * name sits over it; camp-boxes.ts `campReachOf`).
 */
export interface CampReach {
  y: number;
  head: number;
  /**
   * How far a name under its foot reaches below `y`, as a fraction of the
   * canvas: names keep their size as the figures shrink, so this does not
   * scale with the figure factor (camp-boxes.ts puts the crew's name under its
   * banner pole).
   */
  foot?: number;
}

/** Each lane's ground and how far the tallest seated head stands above it at full size, as fractions of the canvas. */
function campReach(layout: CampLayout, heightsCm: readonly number[]): { y: number; head: number }[] {
  const tallest = Math.max(DEFAULT_SIZE.heightCm, ...heightsCm.filter((cm) => Number.isFinite(cm)));
  const drawn = campHeightPx(tallest, campMeasure(layout.canvas.height)) / layout.canvas.height;
  return layout.backdrop.lanes.map((lane) => ({ y: lane.y, head: drawn * lane.scale }));
}

/**
 * The smallest factor the camp's figures and pieces are ever drawn at: past
 * this a hero stops reading as a hero, so a window still too short for the
 * band keeps the feet in and lets the tallest head reach under the header
 * (`campFraming`).
 */
export const MIN_FIGURE_SCALE = 0.6;

/**
 * The factor the camp draws every figure and piece at in this window
 * (docs/camp.md §8.3): 1 whenever the focus band fits the window at the
 * painting's cover scale, and otherwise the largest factor that makes it fit,
 * never below `MIN_FIGURE_SCALE`. Only the figures shrink: the painting stays
 * cover-fit, edge to edge, and the lanes stay where it painted them.
 *
 * The band's height grows linearly with the factor on every lane (the head
 * above it, and the feet's margin below the nearest), so the largest factor
 * that fits is the least of one bound per lane, and also keeps every head on
 * the painting (a head above its top edge could never be in the window, which
 * the painting always covers). Continuous in every input, like the framing,
 * so the camp eases from one factor to the next rather than jumping.
 */
export function campFigureScale(
  paneWidth: number,
  window: CampWindow,
  layout: CampLayout,
  heightsCm: readonly number[] = [],
  extra: readonly CampReach[] = [],
): number {
  const { canvas } = layout;
  const windowHeight = Math.max(0, window.bottom - window.top);
  const scale = Math.max(paneWidth / canvas.width, windowHeight / canvas.height);
  if (!(scale > 0)) return MIN_FIGURE_SCALE;
  // The window's height as a share of the painting's.
  const room = windowHeight / (canvas.height * scale);
  const reach: CampReach[] = [...campReach(layout, heightsCm), ...extra];
  const ground = Math.max(...reach.map((lane) => lane.y));
  // A name under a foot holds the band's bottom at its own size (`CampReach.foot`).
  const foot = Math.max(0, ...reach.map((lane) => lane.y + (lane.foot ?? 0) - ground));
  let k = 1;
  for (const lane of reach) {
    if (lane.head <= 0) continue;
    // The band is ground - lane.y + head k + max(margin k, foot) tall: the larger root that fits.
    const withMargin = (room - (ground - lane.y)) / (lane.head + GROUND_MARGIN);
    const bound = GROUND_MARGIN * withMargin >= foot ? withMargin : (room - (ground - lane.y) - foot) / lane.head;
    k = Math.min(k, bound, lane.y / lane.head);
  }
  return Math.min(1, Math.max(MIN_FIGURE_SCALE, k));
}

/** How the camp stands in a pane: the figures' factor, the band it gives, and where the painting goes. */
export interface CampFit {
  figureScale: number;
  band: CampBand;
  framing: CampFraming;
}

/**
 * The one rule the moving camp (camp.ts), the still camp (StillCamp.tsx) and
 * Travel Mode's phone pane (the same camp.ts) all frame by: the figures'
 * factor for this window and these heroes, the focus band at that factor, and
 * the painting slid to put the band in the window.
 */
export function campFit(
  paneWidth: number,
  window: CampWindow,
  layout: CampLayout,
  heightsCm: readonly number[] = [],
  focusX = 0.5,
  options: { reach?: readonly CampReach[]; maxScale?: number } = {},
): CampFit {
  const extra = options.reach ?? [];
  // The row's own bound (camp-boxes.ts `campRowScale`): gear too big for the spots at full size.
  const figureScale = Math.min(options.maxScale ?? 1, campFigureScale(paneWidth, window, layout, heightsCm, extra));
  const band = campFocusBand(layout, heightsCm, figureScale, extra);
  return { figureScale, band, framing: campFraming(paneWidth, window, layout.canvas, band, focusX) };
}

/**
 * The window between the header (`insetTop` px from the pane's top) and the
 * panels (`insetBottom` px up from its bottom). Never inside out: panels that
 * reach past the header leave a window of no height at the header's foot.
 */
export function campWindow(paneHeight: number, insetTop: number, insetBottom: number): CampWindow {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const top = clamp(Number.isFinite(insetTop) ? insetTop : 0, 0, paneHeight);
  const bottom = clamp(paneHeight - (Number.isFinite(insetBottom) ? Math.max(0, insetBottom) : 0), top, paneHeight);
  return { top, bottom };
}

/**
 * Where the painting goes in a pane `paneWidth` wide with `window` open.
 *
 * - **Cover.** The scale is the larger of the pane's width over the canvas's
 *   and the window's height over the canvas's, so the painting spans the whole
 *   pane width and the whole window height: no side gaps, ever.
 * - **Across.** Centered on the camp (`focusX`, 0.5), clamped so neither edge
 *   of the painting shows.
 * - **Up and down.** Slid so the focus band's middle is the window's middle,
 *   then clamped so the painting still covers the window from top to bottom.
 *   A band taller than the window (figures already at `MIN_FIGURE_SCALE`)
 *   keeps the feet in: its bottom sits on the window's bottom and only the
 *   tallest head reaches past the top, since a kid misses a hero's feet
 *   behind a panel more than the tip of an ear under the header.
 *
 * Continuous in every input, so a panel growing a line eases the camp a
 * little rather than jumping it (camp.ts eases between two framings).
 */
export function campFraming(
  paneWidth: number,
  window: CampWindow,
  canvas: { width: number; height: number },
  band: CampBand,
  focusX = 0.5,
): CampFraming {
  const windowHeight = Math.max(0, window.bottom - window.top);
  const scale = Math.max(paneWidth / canvas.width, windowHeight / canvas.height);
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  const x = Math.min(0, Math.max(paneWidth - width, paneWidth / 2 - focusX * width));
  const centered = (window.top + window.bottom) / 2 - ((band.top + band.bottom) / 2) * height;
  // Past fitting, the feet's edge of the band holds the window's bottom. The
  // two agree exactly when the band just fits, so the switch is seamless.
  const feetFirst = window.bottom - band.bottom * height;
  const target = (band.bottom - band.top) * height > windowHeight ? feetFirst : centered;
  const y = Math.min(window.top, Math.max(window.bottom - height, target));
  return { scale, x, y };
}

/**
 * How far the pane runs past the painting's top and bottom edges at `at`, in
 * pane px: the stretches drawn by bleeding the painting's own plain edge rows
 * on (flipped at the seam), so the pane is one picture top to bottom. The
 * width needs none: `campFraming` always covers it.
 */
export function campBleed(
  paneHeight: number,
  at: CampFraming,
  canvas: { width: number; height: number },
): { top: number; bottom: number } {
  return {
    top: Math.max(0, at.y),
    bottom: Math.max(0, paneHeight - (at.y + canvas.height * at.scale)),
  };
}

/** A stretch across the canvas, as fractions of its width. */
export interface CampSpan {
  x0: number;
  x1: number;
}

/**
 * The part of the painting a pane `paneWidth` wide shows across at `at`, as
 * fractions of the canvas width. The painting covers the pane, so on a pane
 * narrower than 16:9 or one whose window asks for a bigger scale (a phone's
 * World pane) its sides are cropped, and a figure standing out there would be
 * cut off by the screen's edge (docs/camp.md §8.6).
 */
export function campVisibleSpan(paneWidth: number, at: CampFraming, canvasWidth: number): CampSpan {
  const width = canvasWidth * at.scale;
  if (!(width > 0) || !(paneWidth > 0)) return { x0: 0, x1: 1 };
  return { x0: Math.max(0, -at.x / width), x1: Math.min(1, (paneWidth - at.x) / width) };
}

/** What is left between a figure and the screen's edge, as a fraction of the canvas width. */
export const EDGE_MARGIN = 0.006;

/**
 * A figure's drawn width (its nominal paint, figure-scale.ts), as a fraction
 * of the canvas width: its true height, on a lane of `laneScale`, at the
 * camp's figure factor. The measure the trailhead's line is spaced by, and
 * how far in from the screen's edge a figure must stand to be seen whole.
 */
export function campFigureWidth(
  heightCm: number,
  laneScale: number,
  figureScale: number,
  canvas: { width: number; height: number },
): number {
  return (campHeightPx(heightCm, campMeasure(canvas.height)) * laneScale * figureScale * paintAspect(NOMINAL_PAINT)) / canvas.width;
}

/**
 * Where on a lane (`lane`, x0..x1, where feet may go) a figure `width` wide
 * may stand with all of it inside `visible`, `margin` clear of its edges. A
 * span too narrow for the figure leaves only its middle.
 */
export function campStandRange(lane: CampSpan, visible: CampSpan, width: number, margin = EDGE_MARGIN): CampSpan {
  const lo = Math.max(lane.x0, visible.x0 + width / 2 + margin);
  const hi = Math.min(lane.x1, visible.x1 - width / 2 - margin);
  if (lo <= hi) return { x0: lo, x1: hi };
  const mid = (Math.max(lane.x0, visible.x0) + Math.min(lane.x1, visible.x1)) / 2;
  return { x0: mid, x1: mid };
}

/** `x` moved into `range`: a stand point where a figure there is seen whole. */
export function campStandX(x: number, range: CampSpan): number {
  return Math.min(range.x1, Math.max(range.x0, x));
}
