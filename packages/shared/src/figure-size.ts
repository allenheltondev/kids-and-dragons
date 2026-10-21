/**
 * How tall the size words are, in centimeters (#362).
 *
 * Canon owns the numbers: this is `SCALE_CM` from packages/canon envelope.ts,
 * restated because the client may not import canon (Zod would land in the game
 * bundle), and held to it by tools/art/figure-sizes.test.ts. `variable` is not
 * here: a chapter cannot ask for it.
 *
 * Centimeters stay in data. Nothing a player reads is in them.
 */

import type { CastSize } from "./types/chapter.js";

export const SIZE_BAND_CM: Readonly<Record<CastSize, readonly [number, number]>> = {
  tiny: [1, 30],
  tiny_to_small: [5, 55],
  small: [20, 75],
  small_to_medium: [40, 120],
  medium: [80, 200],
  medium_to_large: [100, 250],
  large: [140, 400],
  very_large: [250, 1500],
  colossal: [800, 10000],
};

/**
 * A figure's height once a chapter has asked for a band: its own height when
 * that already fits, otherwise the nearest edge of the band. So a "small" faun
 * is the tallest small thing (a faun child at knee-to-waist height), and a
 * redundant override that restates the figure's own band changes nothing.
 */
export function heightInBand(heightCm: number, size: CastSize | undefined): number {
  if (size === undefined) return heightCm;
  const [low, high] = SIZE_BAND_CM[size];
  return Math.min(high, Math.max(low, heightCm));
}
