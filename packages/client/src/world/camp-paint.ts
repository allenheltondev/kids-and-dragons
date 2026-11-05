/**
 * Each camp painting's painted footprint on its 1024 canvas (docs/camp.md
 * §8.3; #620, #623), from the table tools/art/camp-paint.py measures off the
 * paintings (`npm run art:camp-paint`; art:verify and camp-art.test.ts fail
 * when it is stale).
 *
 * The camp draws a piece so its painted height is its `heightCm` (camp.ts
 * `fitCanvas`); its drawn width, and how far its paint sits off the ground
 * contact at the canvas's middle (a banner's flag flies off to one side of its
 * pole), are the painting's. The layout's boxes (camp-boxes.ts), the moving
 * camp and the still one all read them here, so the overlap tests judge what
 * is drawn, and a piece is the same size before, during and after its art
 * loads.
 */

import table from "./camp-paint.json";
import type { PaintBox } from "./figure-scale";
import { ANCHOR_X } from "./art-paths";

const CANVAS = table.canvas;
const PAINT = Object.fromEntries(Object.entries(table.paint).map(([path, entry]) => [path, entry.box])) as Readonly<Record<string, readonly number[]>>;

/** A painting's footprint as fractions of its canvas, or null for one not painted yet. `path` is relative to `assets/` (a leading `/assets/` is allowed). */
export function campPaint(path: string | null | undefined): PaintBox | null {
  if (!path) return null;
  const box = PAINT[path.replace(/^\/?assets\//, "")];
  if (!box || box.length !== 4) return null;
  const [left, top, right, bottom] = box as [number, number, number, number];
  return { left: left / CANVAS, top: top / CANVAS, right: right / CANVAS, bottom: bottom / CANVAS };
}

/**
 * A painting drawn `height` tall (its paint, foot to top), as a box: its
 * width, and its middle's offset from the ground contact (right is positive;
 * `mirrored` flips it). Null for one not painted yet.
 */
export function campPaintBox(path: string | null | undefined, height: number, mirrored = false): { width: number; offset: number } | null {
  const paint = campPaint(path);
  if (!paint) return null;
  const fill = paint.bottom - paint.top;
  const canvas = height / fill;
  const offset = ((paint.left + paint.right) / 2 - ANCHOR_X) * canvas;
  return { width: (paint.right - paint.left) * canvas, offset: mirrored ? -offset : offset };
}

/** One slice of a painting's paint, px off its ground contact: `l`, `r` across (right positive), `t`, `b` up (negative above the ground). */
export interface CampPaintSlice {
  l: number;
  r: number;
  t: number;
  b: number;
}

const BANDS = table.bands;
const SLICES = table.paint as Readonly<Record<string, { box: readonly number[]; bands: readonly (readonly number[] | null)[] }>>;

/**
 * A painting drawn `height` tall, as the slices of its paint (the table's
 * `bands`, top to bottom, the empty ones left out): what the layout keeps
 * clear, so a short piece may stand under a banner's flag but never in it.
 * Null for one not painted yet.
 */
export function campPaintSlices(path: string | null | undefined, height: number, mirrored = false): CampPaintSlice[] | null {
  if (!path) return null;
  const entry = SLICES[path.replace(/^\/?assets\//, "")];
  if (!entry) return null;
  const [, top, , bottom] = entry.box as [number, number, number, number];
  const canvas = (height * CANVAS) / (bottom - top);
  const px = (v: number) => (v / CANVAS) * canvas;
  const out: CampPaintSlice[] = [];
  entry.bands.forEach((band, i) => {
    if (!band) return;
    const y0 = top + Math.round((i * (bottom - top)) / BANDS);
    const y1 = top + Math.round(((i + 1) * (bottom - top)) / BANDS);
    const l = px(band[0]!) - ANCHOR_X * canvas;
    const r = px(band[1]!) - ANCHOR_X * canvas;
    out.push({ l: mirrored ? -r : l, r: mirrored ? -l : r, t: -px(bottom - y0), b: -px(bottom - y1) });
  });
  return out;
}
