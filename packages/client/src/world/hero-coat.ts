/**
 * The hero's colours (docs/hero-looks.md §5.2): the colour swap that turns a
 * painting, its coat mask and her look into her tinted painting.
 *
 * For each coloured pixel of a region, in OKLab:
 *
 *   - **Lightness** is the colour's, plus the pixel's own step from the
 *     region's **anchor**, its mask-weighted median lightness: the lightness
 *     of most of the part, so the chosen colour lands where most of her is
 *     (a Bigfoot's cream body, not halfway to his brown mane). Shadows stay
 *     shadows and highlights stay highlights. A part whose spread (its 5th to
 *     95th percentile of lightness) is wider than `COAT_SWAP.span` has its
 *     steps compressed to fit it; going darker than the anchor they are
 *     softened (×0.85); and they are compressed again so the spread stays
 *     inside `floor`..`ceil` around the colour, so a dark choice never
 *     crushes the part's darkest pixels to black and a light one never
 *     clamps its fur strokes to white. A narrow part away from the ends keeps
 *     its steps as painted. Clamped to 0.04..0.98 at last.
 *   - **Hue** is the colour's.
 *   - **Chroma** is the colour's, times the square root of the pixel's chroma
 *     over the region's anchor chroma, its weighted median (clamped 0.6..1.4),
 *     so a painted gradient keeps some life. A near-grey region (anchor under
 *     0.02) has no ratio to keep: every pixel takes the colour's chroma flat.
 *   - **Out of gamut**, the chroma is lowered at the same lightness and hue
 *     (a bisection), never each channel clipped.
 *   - **Blended** by the mask's value, in sRGB, so soft edges stay soft.
 *
 * A mask is RGB (owner, 2026-11-07): **red** her main part, **green** her
 * accent part, **blue** her whole figure. One pass (`tintHeroPixels`) does
 * the whole look:
 *
 *   - **Her two colours** (`CoatPaint` `parts`): red takes the main colour and
 *     green the accent colour, each swapped with its own region's means; where
 *     both soft edges reach one pixel, their weights are shared out so they
 *     never add to more than the whole pixel. A part with no colour stays as
 *     painted. Nothing outside both changes.
 *   - **Gilded** (`gilded`): her whole figure, blue, takes the gold by the
 *     same swap with the figure's means, keeping its lightness steps, so she
 *     reads as a gold statue; her colours are ignored. On a cut-out painting
 *     with no mask, its alpha is her figure (`FIGURE_FROM_ALPHA`).
 *
 * The same arithmetic as tools/art/coat.py `tint` / `tint_parts` (the review
 * sheet's tinter): hero-coat.test.ts holds the two to one 8-bit step on a
 * committed reference.
 *
 * Pure: no DOM, no Pixi. `hero-coat-pass.ts` runs it in a worker or in slices
 * between frames; `hero-coat-cache.ts` keeps what it makes.
 */

import type { CoatPaint } from "@kad/shared";
import { hexToOklab, inGamut, oklabToLinear, toGamma, toLinear } from "./oklab";

/** The bounds of §5.2, named once. */
export const COAT_SWAP = {
  /** Lightness steps are softened by this going darker than the region's anchor. */
  darkSoften: 0.85,
  /** The histograms a region's lightness and chroma percentiles are read from (each the bin's centre). */
  bins: 1024,
  /** The chroma histogram's top: OKLab chroma in sRGB stays under it. */
  chromaTop: 0.5,
  /** A region's spread: its weighted 5th to 95th percentile of lightness. */
  lowQ: 0.05,
  highQ: 0.95,
  /** A region spread wider than this has its steps compressed to fit it. */
  span: 0.3,
  /** The steps are compressed so the region's spread stays inside these, around the colour. */
  floor: 0.14,
  ceil: 0.95,
  minL: 0.04,
  maxL: 0.98,
  /** A region whose anchor chroma is under this is near-grey: no ratio to keep. */
  greyChroma: 0.02,
  minRatio: 0.6,
  maxRatio: 1.4,
  /** Bisection steps when bringing a colour back into gamut, as coat.py. */
  gamutSteps: 14,
} as const;

/** Where each region is in an RGBA mask (a canvas's `ImageData`): red, green, blue. */
export const MASK_CHANNEL = { main: 0, accent: 1, figure: 2 } as const;

/** A region's lightness anchor and spread and its mean chroma, computed once per mask (§5.3 keeps them as numbers). */
export interface CoatRegionStats {
  /** The weighted median lightness: where the chosen colour lands. */
  anchorL: number;
  /** The weighted 5th and 95th percentiles of lightness: the region's spread. */
  lowL: number;
  highL: number;
  /** The weighted median chroma: what each pixel's chroma is a ratio to. */
  anchorC: number;
  /** The mask's total weight (0 for an empty mask: nothing to colour). */
  weight: number;
}

/** Every region's means: her two parts and her figure. */
export interface HeroRegionStats {
  main: CoatRegionStats;
  accent: CoatRegionStats;
  figure: CoatRegionStats;
}

/** A colour resolved to what the per-pixel swap needs. */
export interface CoatTarget {
  L: number;
  C: number;
  cos: number;
  sin: number;
}

const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) LINEAR[i] = toLinear(i / 255);

/** One pixel (8-bit sRGB in `rgba` at `i`) to OKLab L and chroma. */
function lc(rgba: ArrayLike<number>, i: number): [number, number] {
  const r = LINEAR[rgba[i]!]!;
  const g = LINEAR[rgba[i + 1]!]!;
  const b = LINEAR[rgba[i + 2]!]!;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B)];
}

/**
 * One region's weighted mean lightness and chroma over the painting. `mask`
 * holds one value per pixel every `maskStride` entries, starting at
 * `maskOffset` (stride 1 for a single-channel mask; 4 for a canvas's RGBA,
 * where offset 0 is red, the main part; 1 green, the accent; 2 blue, the
 * figure; 3 alpha, a cut-out painting's own figure).
 */
export function coatRegionStats(rgba: ArrayLike<number>, mask: ArrayLike<number>, maskStride = 1, maskOffset = 0): CoatRegionStats {
  const { bins, chromaTop } = COAT_SWAP;
  const histL = new Float64Array(bins);
  const histC = new Float64Array(bins);
  const bin = (v: number, top: number): number => Math.min(bins - 1, Math.max(0, Math.floor((v / top) * bins)));
  let weight = 0;
  const n = Math.floor(rgba.length / 4);
  for (let p = 0; p < n; p++) {
    const w = mask[p * maskStride + maskOffset]! / 255;
    if (w <= 0) continue;
    const [L, C] = lc(rgba, p * 4);
    weight += w;
    histL[bin(L, 1)]! += w;
    histC[bin(C, chromaTop)]! += w;
  }
  if (weight <= 0) return { anchorL: 0, lowL: 0, highL: 0, anchorC: 0, weight: 0 };
  // The centre of the first bin whose running weight reaches the quantile, as coat.py's searchsorted.
  const quantile = (hist: Float64Array, top: number, q: number): number => {
    const want = q * weight;
    let cum = 0;
    for (let b = 0; b < bins; b++) {
      cum += hist[b]!;
      if (cum >= want) return ((b + 0.5) / bins) * top;
    }
    return ((bins - 0.5) / bins) * top;
  };
  return {
    anchorL: quantile(histL, 1, 0.5),
    lowL: quantile(histL, 1, COAT_SWAP.lowQ),
    highL: quantile(histL, 1, COAT_SWAP.highQ),
    anchorC: quantile(histC, chromaTop, 0.5),
    weight,
  };
}

/**
 * A pixel's new lightness (§5.2): the colour's `tL`, plus its step from the
 * region's anchor, compressed to fit `span`, softened going darker, and
 * compressed again to keep the region's spread inside `floor`..`ceil`.
 * coat.py `_lightness`.
 */
export function swapLightness(L: number, tL: number, stats: Pick<CoatRegionStats, "anchorL" | "lowL" | "highL">): number {
  const { anchorL, lowL, highL } = stats;
  let k = 1;
  const spread = highL - lowL;
  if (spread > COAT_SWAP.span) k = COAT_SWAP.span / spread;
  if (tL < anchorL) k *= COAT_SWAP.darkSoften;
  const up = (highL - anchorL) * k;
  const down = (anchorL - lowL) * k;
  const kUp = up > 0 && tL + up > COAT_SWAP.ceil ? Math.max(0, COAT_SWAP.ceil - tL) / up : 1;
  const kDown = down > 0 && tL - down < COAT_SWAP.floor ? Math.max(0, tL - COAT_SWAP.floor) / down : 1;
  const step = L - anchorL;
  return Math.min(COAT_SWAP.maxL, Math.max(COAT_SWAP.minL, tL + step * k * (step > 0 ? kUp : kDown)));
}

/** Where a pass reads her regions from. */
export interface HeroMask {
  /** RGBA mask pixels (a decoded RGB mask), or the painting itself for a cut-out with no mask. */
  data: ArrayLike<number>;
  /** Entries per pixel: 4 for RGBA. */
  stride: number;
  /** Where her figure is: blue (2) in a mask, alpha (3) in a cut-out painting read as its own. */
  figure: number;
}

/** A cut-out painting with no mask, read as its own figure (its alpha); her two parts are not known there. */
export const FIGURE_FROM_ALPHA = { stride: 4, figure: 3 } as const;

/** Every region's means for this mask. A mask with no parts (`FIGURE_FROM_ALPHA`) has none: their weight is 0. */
export function heroRegionStats(rgba: ArrayLike<number>, mask: HeroMask): HeroRegionStats {
  const empty: CoatRegionStats = { anchorL: 0, lowL: 0, highL: 0, anchorC: 0, weight: 0 };
  const parts = mask.figure === MASK_CHANNEL.figure;
  return {
    main: parts ? coatRegionStats(rgba, mask.data, mask.stride, MASK_CHANNEL.main) : empty,
    accent: parts ? coatRegionStats(rgba, mask.data, mask.stride, MASK_CHANNEL.accent) : empty,
    figure: coatRegionStats(rgba, mask.data, mask.stride, mask.figure),
  };
}

/** What the swap aims for, for one colour. */
export function coatTarget(hex: string): CoatTarget {
  const [L, a, b] = hexToOklab(hex);
  const h = Math.atan2(b, a);
  return { L, C: Math.hypot(a, b), cos: Math.cos(h), sin: Math.sin(h) };
}

/**
 * One pixel recoloured (§5.2), before the mask's blend: OKLab L and chroma
 * in, 0..1 sRGB out. Exported so the arithmetic is pinned on its own, as the
 * camp's `shadedPixel` is.
 */
export function swapPixel(L: number, C: number, target: CoatTarget, stats: CoatRegionStats): [number, number, number] {
  const nL = swapLightness(L, target.L, stats);
  let nC: number;
  if (stats.anchorC < COAT_SWAP.greyChroma) nC = target.C;
  else nC = target.C * Math.min(COAT_SWAP.maxRatio, Math.max(COAT_SWAP.minRatio, Math.sqrt(Math.max(C, 0) / stats.anchorC)));
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
}

/** One region a pass recolours: its colour, its means, and where its weights are in the mask. */
interface Region {
  target: CoatTarget;
  stats: CoatRegionStats;
  offset: number;
}

function copyPixel(src: ArrayLike<number>, out: { [index: number]: number }, i: number): void {
  out[i] = src[i]!;
  out[i + 1] = src[i + 1]!;
  out[i + 2] = src[i + 2]!;
  out[i + 3] = src[i + 3]!;
}

/**
 * The regions recoloured into `out`, pixels `from..to`: each region's swap
 * blended by its mask weight, the weights shared out where they would add to
 * more than the whole pixel (the soft edge where her two parts meet), and
 * everything else copied. Alpha is never touched.
 */
function tintRegions(
  src: ArrayLike<number>,
  mask: ArrayLike<number>,
  stride: number,
  regions: readonly Region[],
  out: { [index: number]: number; length: number },
  from: number,
  to: number,
): void {
  const live = regions.filter((r) => r.stats.weight > 0);
  const weights = new Float64Array(live.length);
  for (let p = from; p < to; p++) {
    const i = p * 4;
    let total = 0;
    for (let k = 0; k < live.length; k++) {
      const w = mask[p * stride + live[k]!.offset]! / 255;
      weights[k] = w > 0 ? w : 0;
      total += weights[k]!;
    }
    if (total <= 0) {
      if (out !== src) copyPixel(src, out, i);
      continue;
    }
    const share = total > 1 ? 1 / total : 1;
    const r0 = src[i]! / 255;
    const g0 = src[i + 1]! / 255;
    const b0 = src[i + 2]! / 255;
    const [L, C] = lc(src, i);
    let r = r0 * (1 - total * share);
    let g = g0 * (1 - total * share);
    let b = b0 * (1 - total * share);
    for (let k = 0; k < live.length; k++) {
      const w = weights[k]! * share;
      if (w <= 0) continue;
      const [sr, sg, sb] = swapPixel(L, C, live[k]!.target, live[k]!.stats);
      r += sr * w;
      g += sg * w;
      b += sb * w;
    }
    out[i] = Math.round(r * 255);
    out[i + 1] = Math.round(g * 255);
    out[i + 2] = Math.round(b * 255);
    out[i + 3] = src[i + 3]!;
  }
}

/**
 * One region recoloured to `color` (8-bit RGBA `src` through a one-channel
 * view of `mask` into `out`, the same size; may be `src` itself). The single
 * mask call: coat.py `tint`'s twin, and what the review tools and the palette
 * test run.
 */
export function tintCoatPixels(
  src: ArrayLike<number>,
  mask: ArrayLike<number>,
  color: string,
  stats: CoatRegionStats,
  out: { [index: number]: number; length: number },
  { from = 0, to = Math.floor(src.length / 4), maskStride = 1, maskOffset = 0 }: TintRange & { maskStride?: number; maskOffset?: number } = {},
): void {
  tintRegions(src, mask, maskStride, [{ target: coatTarget(color), stats, offset: maskOffset }], out, from, to);
}

/**
 * Her whole look in one pass (§5.2, §5.5): her main colour on red and her
 * accent colour on green, each by its own region's means; or, gilded, the
 * gold on her whole figure (blue, or a cut-out's alpha), her colours ignored.
 */
export function tintHeroPixels(
  src: ArrayLike<number>,
  mask: HeroMask,
  paint: CoatPaint,
  stats: HeroRegionStats,
  out: { [index: number]: number; length: number },
  { from = 0, to = Math.floor(src.length / 4) }: TintRange = {},
): void {
  const regions: Region[] = [];
  if (paint.kind === "gilded") {
    regions.push({ target: coatTarget(paint.color), stats: stats.figure, offset: mask.figure });
  } else {
    if (paint.main) regions.push({ target: coatTarget(paint.main), stats: stats.main, offset: MASK_CHANNEL.main });
    if (paint.accent) regions.push({ target: coatTarget(paint.accent), stats: stats.accent, offset: MASK_CHANNEL.accent });
  }
  tintRegions(src, mask.data, mask.stride, regions, out, from, to);
}
