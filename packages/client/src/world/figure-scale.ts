/**
 * True relative size (#362): how tall each figure is drawn, from how tall it
 * really is.
 *
 * Every figure is painted to fill the same 1024 canvas, so a harvest sprite is
 * as tall on disk as a centaur and the art says nothing about size. Canon does:
 * `height_cm` and `stance` on everything we draw, projected for the client into
 * figure-sizes.ts. This module turns those into drawn heights.
 *
 * The rules are the owner's (#362):
 *
 * - **True proportion.** At its natural scale a stage draws `PX_PER_CM` units
 *   per centimeter, so a 160 cm faun stands about where a hero always stood
 *   and a 25 cm sprite is a sixth of that.
 * - **Huge things are shown whole.** When the biggest figure in view would not
 *   fit the frame, everything scales down together until it does, so the
 *   dragon is all there and the heroes are small beside it. Nothing is cropped,
 *   and nothing is scaled *up* to fill an empty frame either.
 * - **A floor.** Below a minimum drawn height a figure stops shrinking, so a
 *   teapot-sized sprite is never a speck. That is the one place proportion
 *   gives, and `floored` says where it did.
 *
 * Height means the *painted* figure, top to bottom, not the canvas around it:
 * a will-o'-wisp fills a fifth of its canvas and a centaur four fifths, so the
 * canvas is scaled by whatever the painting measures (`PaintBox`). Heroes are
 * the exception: their tiers grow inside one canvas (a Mythic is drawn taller
 * than a Fledgling), so a hero is measured against the nominal box and the
 * growth the art carries stays on screen.
 *
 * Pure and Pixi-free, like cast.ts, so every number here is a test.
 */

import type { CastStance } from "@kad/shared";
import { heightInBand, type CastSize } from "@kad/shared";
import { ANCHOR_Y } from "./art-paths";
import { FIGURE_SIZES } from "./figure-sizes";

/**
 * Where a figure's paint sits inside its square canvas, as fractions of the
 * canvas side: `top` and `bottom` are rows, `left` and `right` columns.
 */
export interface PaintBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The box the asset contract implies (feet on the origin at 0.879, a top
 * margin of about 8%), and what an unmeasured figure is assumed to fill. The
 * hero art measures 0.077–0.879 at Fledgling, which is where the top comes
 * from.
 */
export const NOMINAL_PAINT: PaintBox = { top: 0.078, bottom: ANCHOR_Y, left: 0.15, right: 0.85 };

/** What a figure nobody has sized is taken to be: a person, standing. */
export const DEFAULT_SIZE = { heightCm: 160, stance: "standing" as CastStance };

/** A figure's own height and stance (figure-sizes.ts), or the default. */
export function figureSize(figure: string): { heightCm: number; stance: CastStance } {
  const known = FIGURE_SIZES[figure];
  return known ? { heightCm: known[0], stance: known[1] } : DEFAULT_SIZE;
}

/**
 * A cast entry's height and stance for this scene: the figure's own, with the
 * chapter's `size` (moved into that band, see `heightInBand`) and `stance`
 * laid over it.
 */
export function castSize(
  figure: string,
  size?: CastSize,
  stance?: CastStance,
): { heightCm: number; stance: CastStance } {
  const own = figureSize(figure);
  return { heightCm: heightInBand(own.heightCm, size), stance: stance ?? own.stance };
}

/**
 * How far a stance lifts the painted figure off the ground line, as a
 * fraction of its own drawn height. Negative sinks it: a swimmer's lower body
 * is below the water line, which is the ground line drawn as water.
 */
export const STANCE_LIFT: Readonly<Record<CastStance, number>> = {
  standing: 0,
  hovering: 0.22,
  flying: 0.4,
  swimming: -0.38,
};

/** How much of the frame above the ground a figure in this stance reaches, per unit of its height. */
export function stanceReach(stance: CastStance): number {
  return 1 + STANCE_LIFT[stance];
}

/** The painted figure's width over its height. */
export function paintAspect(paint: PaintBox): number {
  const height = paint.bottom - paint.top;
  return height > 0 ? (paint.right - paint.left) / height : 1;
}

export interface SizedFigure {
  heightCm: number;
  stance: CastStance;
  /** As measured once the art loads; null until then. */
  paint: PaintBox | null;
}

export interface StageMeasure {
  /** Units per centimeter at natural scale. */
  pxPerCm: number;
  /** Room above the ground line for the tallest figure, in the same units. */
  headroom: number;
  /** The smallest drawn height anything is given. */
  floor: number;
}

/**
 * The scale that fits the tallest figure, stance and all, under the frame:
 * 1 when everything already fits at natural size, less when something huge is
 * in view. Never more than 1.
 */
export function heightFit(figures: readonly SizedFigure[], measure: StageMeasure): number {
  let reach = 0;
  for (const figure of figures) {
    reach = Math.max(reach, figure.heightCm * measure.pxPerCm * stanceReach(figure.stance));
  }
  return reach > measure.headroom ? measure.headroom / reach : 1;
}

/**
 * The drawn width of each figure's paint, at scale `k`: what layout has to
 * find room for. Unmeasured art is assumed to fill the nominal box.
 */
export function paintedWidths(figures: readonly SizedFigure[], k: number, measure: StageMeasure): number[] {
  return figures.map((figure) => drawnHeight(figure, k, measure) * paintAspect(figure.paint ?? NOMINAL_PAINT));
}

/**
 * The scale (at most 1) that fits each width into its room: `widths[i]` must
 * be no more than `rooms[i]`. A crowd member's room is shared, so it may
 * overlap its neighbours; the caller passes the room it is allowed.
 */
export function widthFit(widths: readonly number[], rooms: readonly number[]): number {
  let k = 1;
  widths.forEach((width, i) => {
    const room = rooms[i];
    if (room !== undefined && room > 0 && width > room) k = Math.min(k, room / width);
  });
  return k;
}

/** A figure's drawn height at scale `k`, never below the floor. */
export function drawnHeight(figure: SizedFigure, k: number, measure: StageMeasure): number {
  return Math.max(measure.floor, figure.heightCm * measure.pxPerCm * k);
}

/** Whether the floor, not proportion, decided this figure's height. */
export function floored(figure: SizedFigure, k: number, measure: StageMeasure): boolean {
  return figure.heightCm * measure.pxPerCm * k < measure.floor;
}

/**
 * The tallest figure that is still drawn in true proportion at scale `k`: at
 * or under this many centimeters, the floor takes over. The number to call out
 * when somebody asks where proportion gives.
 */
export function floorHeightCm(k: number, measure: StageMeasure): number {
  return measure.floor / (measure.pxPerCm * k);
}

/**
 * How to scale and place a figure's whole canvas so its *paint* is `height`
 * tall with its lowest painted row on the container's origin.
 *
 * `canvas` is the canvas side on screen (the sprite's drawn height), and
 * `offsetY` moves the sprite (anchored at the contract origin) so the paint's
 * bottom meets the origin: 0 for art standing on the line, positive for art
 * painted floating mid-canvas (a cloud whale), whose own drift the stance
 * replaces. `vertical` is the paint whose height counts, which for a hero is
 * the nominal box (see the header).
 */
export function fitCanvas(
  height: number,
  paint: PaintBox | null,
  vertical: PaintBox | null = paint,
): { canvas: number; offsetY: number } {
  const box = vertical ?? NOMINAL_PAINT;
  const fill = Math.max(0.05, box.bottom - box.top);
  const canvas = height / fill;
  const bottom = (paint ?? NOMINAL_PAINT).bottom;
  return { canvas, offsetY: (ANCHOR_Y - bottom) * canvas };
}
