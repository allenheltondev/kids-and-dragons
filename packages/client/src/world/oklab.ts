/**
 * OKLab, for the hero's colour (docs/hero-looks.md §5.2) and the tests that
 * check her palettes (§7.1). The same matrices as tools/art/coat.py, the
 * review sheet's tinter, so the two agree to a step of 8-bit.
 *
 * Pure numbers, no DOM: the tinter runs it in a worker, between frames, and
 * under vitest alike.
 */

export type Lab = [number, number, number];

/** sRGB 0..1 → linear light. */
export function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear light → sRGB 0..1, clamped. */
export function toGamma(c: number): number {
  const v = c < 0 ? 0 : c > 1 ? 1 : c;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** Linear sRGB → OKLab. */
export function linearToOklab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → linear sRGB, unclamped (out of gamut shows as a channel outside 0..1). */
export function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** sRGB 0..1 → OKLab. */
export function srgbToOklab(r: number, g: number, b: number): Lab {
  return linearToOklab(toLinear(r), toLinear(g), toLinear(b));
}

/** `#RRGGBB` → sRGB 0..1. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** `#RRGGBB` → OKLab. */
export function hexToOklab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex);
  return srgbToOklab(r, g, b);
}

/** Whether linear sRGB is inside the gamut, with coat.py's tolerance. */
export function inGamut([r, g, b]: readonly [number, number, number], eps = 1e-4): boolean {
  return r >= -eps && r <= 1 + eps && g >= -eps && g <= 1 + eps && b >= -eps && b <= 1 + eps;
}

/** Euclidean OKLab distance. */
export function oklabDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}
