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
 * The moving camp (camp.ts) and the still one (StillCamp.tsx) both frame
 * through `campFraming`, so the two never disagree. Pure and Pixi-free, like
 * camp-layout.ts, so every rule here is a test (camp-framing.test.ts).
 */

import type { CampLayout } from "./camp-layout";
import { campHeightPx, campMeasure } from "./camp-motion";
import { DEFAULT_SIZE } from "./figure-scale";

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
 */
export function campFocusBand(layout: CampLayout, heightsCm: readonly number[] = []): CampBand {
  const tallest = Math.max(DEFAULT_SIZE.heightCm, ...heightsCm.filter((cm) => Number.isFinite(cm)));
  const drawn = campHeightPx(tallest, campMeasure(layout.canvas.height)) / layout.canvas.height;
  const lanes = layout.backdrop.lanes;
  const top = Math.min(...lanes.map((lane) => lane.y - drawn * lane.scale));
  const bottom = Math.max(...lanes.map((lane) => lane.y)) + GROUND_MARGIN;
  return { top: Math.max(0, top), bottom: Math.min(1, bottom) };
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
 *   A band taller than the window overflows it evenly at both ends.
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
  const y = Math.min(window.top, Math.max(window.bottom - height, centered));
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
