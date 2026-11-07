/**
 * The hero's colour (docs/hero-looks.md §5.2): the colour swap that turns a
 * painting, its coat mask and a coat into her tinted painting.
 *
 * For each coloured pixel, in OKLab:
 *
 *   - **Lightness** is the coat's, plus the pixel's own step from the
 *     region's mean lightness, so shadows stay shadows and highlights stay
 *     highlights. Going from a light region to a darker coat the steps are
 *     softened (×0.85) so it does not go muddy. Clamped to 0.04..0.98.
 *   - **Hue** is the coat's.
 *   - **Chroma** is the coat's, times the square root of the pixel's chroma
 *     over the region's mean (clamped 0.6..1.4), so a painted gradient keeps
 *     some life. A near-grey region (mean chroma under 0.02) has no ratio to
 *     keep: every pixel takes the coat's chroma flat.
 *   - **Out of gamut**, the chroma is lowered at the same lightness and hue
 *     (a bisection), never each channel clipped.
 *   - **Blended** by the mask's value, in sRGB, so soft edges stay soft.
 *
 * A **two-tone** coat (§5.5, #669) swaps each pixel twice, to its light and
 * its dark colour, and mixes the two in sRGB by `twoToneWeight`: the light
 * colour above the region's mean lightness, the dark below, across a soft
 * step. A still image, so it costs one more swap per pixel and nothing else.
 *
 * The same arithmetic as tools/art/coat.py `tint`, the review sheet's tinter:
 * coat.test.ts holds the two to one 8-bit step on a committed reference.
 *
 * Pure: no DOM, no Pixi. `hero-coat-pass.ts` runs it in a worker or in slices
 * between frames; `hero-coat-cache.ts` keeps what it makes.
 */

import type { CoatPaint } from "@kad/shared";
import { hexToOklab, inGamut, oklabToLinear, toGamma, toLinear } from "./oklab";

/** The bounds of §5.2, named once. */
export const COAT_SWAP = {
  /** Lightness steps are softened by this going from a light region to a darker coat. */
  darkSoften: 0.85,
  minL: 0.04,
  maxL: 0.98,
  /** A region whose mean chroma is under this is near-grey: no ratio to keep. */
  greyChroma: 0.02,
  minRatio: 0.6,
  maxRatio: 1.4,
  /** Bisection steps when bringing a colour back into gamut, as coat.py. */
  gamutSteps: 14,
  /** A two-tone coat's soft step (§5.5): half its width in OKLab lightness, either side of the region's mean. */
  twoToneStep: 0.04,
} as const;

/** The region's means, computed once per mask (§5.3 keeps them as numbers). */
export interface CoatRegionStats {
  meanL: number;
  meanC: number;
  /** The mask's total weight (0 for an empty mask: nothing to colour). */
  weight: number;
}

/** A paint resolved to what the per-pixel swap needs. */
export interface CoatTarget {
  L: number;
  C: number;
  cos: number;
  sin: number;
}

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) LINEAR[i] = toLinear(i / 255);

/** One pixel (8-bit sRGB in `rgba` at `i`) to OKLab L and chroma. */
function lc(rgba: ArrayLike<number>, i: number): [number, number, number, number] {
  const r = LINEAR[rgba[i]!]!;
  const g = LINEAR[rgba[i + 1]!]!;
  const b = LINEAR[rgba[i + 2]!]!;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), A, B];
}

/**
 * The mask's weighted mean lightness and chroma over the painting. `mask`
 * holds one value per pixel every `maskStride` entries (1 for greyscale, 4
 * for a canvas's RGBA, where the red channel is read).
 */
export function coatRegionStats(rgba: ArrayLike<number>, mask: ArrayLike<number>, maskStride = 1): CoatRegionStats {
  let weight = 0;
  let sumL = 0;
  let sumC = 0;
  const n = Math.floor(rgba.length / 4);
  for (let p = 0; p < n; p++) {
    const w = mask[p * maskStride]! / 255;
    if (w <= 0) continue;
    const [L, C] = lc(rgba, p * 4);
    weight += w;
    sumL += w * L;
    sumC += w * C;
  }
  return weight > 0 ? { meanL: sumL / weight, meanC: sumC / weight, weight } : { meanL: 0, meanC: 0, weight: 0 };
}

/** What the swap aims for, for one colour. */
function targetOf(hex: string): CoatTarget {
  const [L, a, b] = hexToOklab(hex);
  const h = Math.atan2(b, a);
  return { L, C: Math.hypot(a, b), cos: Math.cos(h), sin: Math.sin(h) };
}

/** What the swap aims for, for this paint: a plain coat's colour, or a two-tone coat's light one. */
export function coatTarget(paint: CoatPaint): CoatTarget {
  return targetOf(paint.color);
}

/** Every target a paint swaps to: one for a plain coat; the light and the dark of a two-tone one (§5.5). */
export interface CoatTargets {
  light: CoatTarget;
  dark?: CoatTarget;
}

export function coatTargets(paint: CoatPaint): CoatTargets {
  switch (paint.kind) {
    case "plain":
      return { light: targetOf(paint.color) };
    case "two-tone":
      return { light: targetOf(paint.color), dark: targetOf(paint.dark) };
  }
}

/**
 * How much of a two-tone coat's light colour a pixel takes (§5.5): 1 well
 * above the region's mean lightness, 0 well below it, and a smooth step
 * `COAT_SWAP.twoToneStep` wide either side, so the seam between the halves
 * is soft. The same in coat.py.
 */
export function twoToneWeight(L: number, stats: Pick<CoatRegionStats, "meanL">): number {
  const x = Math.min(1, Math.max(0, (L - stats.meanL + COAT_SWAP.twoToneStep) / (2 * COAT_SWAP.twoToneStep)));
  return x * x * (3 - 2 * x);
}

/**
 * One pixel recoloured (§5.2), before the mask's blend: 8-bit sRGB in, 0..1
 * sRGB out. Exported so the arithmetic is pinned on its own, as the camp's
 * `shadedPixel` is.
 */
export function swapPixel(L: number, C: number, target: CoatTarget, stats: CoatRegionStats): [number, number, number] {
  let step = L - stats.meanL;
  if (target.L < stats.meanL) step *= COAT_SWAP.darkSoften;
  const nL = Math.min(COAT_SWAP.maxL, Math.max(COAT_SWAP.minL, target.L + step));
  let nC: number;
  if (stats.meanC < COAT_SWAP.greyChroma) nC = target.C;
  else nC = target.C * Math.min(COAT_SWAP.maxRatio, Math.max(COAT_SWAP.minRatio, Math.sqrt(Math.max(C, 0) / stats.meanC)));
  const at = (scale: number): [number, number, number] => oklabToLinear(nL, nC * scale * target.cos, nC * scale * target.sin);
  let lin = at(1);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < COAT_SWAP.gamutSteps; k++) {
      const mid = (lo + hi) / 2;
      if (inGamut(at(mid))) lo = mid;
      else hi = mid;
    }
    lin = at(lo);
  }
  return [toGamma(lin[0]), toGamma(lin[1]), toGamma(lin[2])];
}

export interface TintRange {
  /** First pixel (not byte) to work on; default 0. */
  from?: number;
  /** One past the last pixel; default every pixel. */
  to?: number;
  /** See `coatRegionStats`. */
  maskStride?: number;
}

/**
 * Recolour `src` (8-bit RGBA) through `mask` into `out` (the same size; may
 * be `src` itself), for pixels `from..to`: the masked region takes the paint,
 * blended by the mask, and everything else is copied as is. Alpha is never
 * touched. Run it over the whole canvas in one go, or a slice at a time.
 */
export function tintCoatPixels(
  src: ArrayLike<number>,
  mask: ArrayLike<number>,
  paint: CoatPaint,
  stats: CoatRegionStats,
  out: { [index: number]: number; length: number },
  { from = 0, to = Math.floor(src.length / 4), maskStride = 1 }: TintRange = {},
): void {
  const { light: target, dark } = coatTargets(paint);
  for (let p = from; p < to; p++) {
    const i = p * 4;
    const w = stats.weight > 0 ? mask[p * maskStride]! / 255 : 0;
    if (w <= 0) {
      if (out !== src) {
        out[i] = src[i]!;
        out[i + 1] = src[i + 1]!;
        out[i + 2] = src[i + 2]!;
        out[i + 3] = src[i + 3]!;
      }
      continue;
    }
    const r0 = src[i]!;
    const g0 = src[i + 1]!;
    const b0 = src[i + 2]!;
    const [L, C] = lc(src, i);
    let [r, g, b] = swapPixel(L, C, target, stats);
    if (dark) {
      // Two-tone (§5.5): the light colour above the mean, the dark below, mixed across the step.
      const t = twoToneWeight(L, stats);
      if (t < 1) {
        const [dr, dg, db] = swapPixel(L, C, dark, stats);
        r = r * t + dr * (1 - t);
        g = g * t + dg * (1 - t);
        b = b * t + db * (1 - t);
      }
    }
    out[i] = Math.round(((r0 / 255) * (1 - w) + r * w) * 255);
    out[i + 1] = Math.round(((g0 / 255) * (1 - w) + g * w) * 255);
    out[i + 2] = Math.round(((b0 / 255) * (1 - w) + b * w) * 255);
    out[i + 3] = src[i + 3]!;
  }
}
