/**
 * How big is it? The size line on a wiki page (#370).
 *
 * Canon's `height_cm` and `stance` (#362) are read straight off the entity, so
 * a height change in canon reaches the published wiki on the next deploy. The
 * game never shows these numbers; the encyclopedia is read by families outside
 * play, where "how big is it?" is a favorite question.
 *
 * Both units, because a static page cannot know the reader's region, and a
 * comparison a child can picture. The comparisons are one fixed table keyed by
 * size, never written per page, so two things the same size always read the
 * same.
 */

import type { CanonEntity } from './types.ts';

/**
 * Smallest first. A height belongs to the first row whose `upToCm` it does not
 * pass; the last row has no ceiling.
 */
export const SIZE_COMPARISONS: readonly { upToCm: number; words: string }[] = [
  { upToCm: 15, words: 'fits in a teapot' },
  { upToCm: 35, words: 'fits in a backpack' },
  { upToCm: 60, words: 'knee-high to a grown-up' },
  { upToCm: 100, words: 'waist-high to a grown-up' },
  { upToCm: 140, words: 'about as tall as a kid' },
  { upToCm: 200, words: 'as tall as a grown-up' },
  { upToCm: 250, words: 'as tall as a door' },
  { upToCm: 450, words: 'as tall as an elephant' },
  { upToCm: 1000, words: 'as big as a house' },
  { upToCm: Infinity, words: 'as long as a whale' },
];

/**
 * Stance only where it matters: standing is what a reader assumes, so it says
 * nothing.
 */
export const STANCE_WORDS: Readonly<Record<string, string | null>> = {
  standing: null,
  hovering: 'hovers',
  flying: 'usually flies',
  swimming: 'swims',
};

export function sizeComparison(heightCm: number): string {
  return SIZE_COMPARISONS.find((row) => heightCm <= row.upToCm)!.words;
}

/** Imperial, to the inch; feet alone once the inches stop meaning anything. */
function imperial(heightCm: number): string {
  const inches = Math.round(heightCm / 2.54);
  if (inches < 12) return `${Math.max(1, inches)} in`;
  const feet = Math.floor(inches / 12);
  const rest = inches % 12;
  if (heightCm >= 300 || rest === 0) return `${Math.round(heightCm / 30.48)} ft`;
  return `${feet} ft ${rest} in`;
}

/** Metric: centimeters under a meter, meters (to the centimeter, then whole) above. */
function metric(heightCm: number): string {
  if (heightCm < 100) return `${Math.round(heightCm)} cm`;
  const meters = heightCm >= 1000 ? Math.round(heightCm / 100) : Math.round(heightCm) / 100;
  return `${meters} m`;
}

/** "1.65 m (5 ft 5 in)", "25 cm (10 in)". */
export function formatHeight(heightCm: number): string {
  return `${metric(heightCm)} (${imperial(heightCm)})`;
}

export interface SizeLine {
  heightCm: number;
  /** Both units: "1.65 m (5 ft 5 in)". */
  height: string;
  /** From {@link SIZE_COMPARISONS}: "as tall as a grown-up". */
  compare: string;
  /** From {@link STANCE_WORDS}, absent for a figure that stands. */
  stance?: string;
  /** The whole line as a page shows it. */
  line: string;
}

/** The size line for an entity, or null when canon gives it no height. */
export function sizeLine(entity: CanonEntity): SizeLine | null {
  const heightCm = entity.metadata['height_cm'];
  if (typeof heightCm !== 'number' || !(heightCm > 0)) return null;
  const rawStance = entity.metadata['stance'];
  const stance = typeof rawStance === 'string' ? (STANCE_WORDS[rawStance] ?? undefined) : undefined;
  const height = formatHeight(heightCm);
  const compare = sizeComparison(heightCm);
  const line = `${height}, ${compare}.${stance ? ` ${stance.charAt(0).toUpperCase()}${stance.slice(1)}.` : ''}`;
  return { heightCm, height, compare, ...(stance ? { stance } : {}), line };
}
