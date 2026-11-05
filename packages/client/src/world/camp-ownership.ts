/**
 * A hero's own gear (docs/camp.md §4.5, §8.3): whose it is, and how big it is
 * drawn. **A hero's own gear fits that hero** (decided):
 *
 *   - her bedroll is longer than she is (`BEDROLL_LENGTH_FIT` times her drawn
 *     body length, the longer of her drawn height and width, so a long, low
 *     unicorn and a tall bigfoot could each lie in theirs); the pack on the
 *     same painting stays in proportion;
 *   - her tent is bigger than she is: `TENT_HEIGHT_FIT` times her drawn height
 *     and at least `TENT_WIDTH_FIT` times her drawn width, so she could fit
 *     inside.
 *
 * The fit is a minimum, never a cap: gear already bigger than it keeps its
 * authored size scaled with its owner (`campOwnedScale`). Anything else she
 * owns (her souvenir line) keeps that ratio to her height.
 *
 * Her drawn box is her painting's box, judged standing on the ground (a
 * flying or hovering hero is judged by her ground-standing painting): every
 * figure is drawn so its nominal paint is its true height (camp.ts `fitArt`),
 * and `HERO_PAINT` is, per species, the largest share of that a painting of
 * it actually covers across every tier and class figure (measured from the
 * art; tools/art/camp-art.test.ts keeps the table honest). The largest, so the
 * gear fits every variant; and a table rather than a measurement at runtime,
 * so the moving camp, the still one and a phone's Camp panel size her gear the
 * same before, during and after her art loads.
 *
 * None of this clamps: a kitsune's gear is her own size, 85/215 of a
 * bigfoot's, all the way down. The only floor is the camp's legibility floor
 * on a hero herself (camp-motion.ts `FLOOR_SHARE`, under about 37 cm), which
 * no hero species reaches, and gear fitted to a floored hero fits the floored
 * hero.
 */

import type { CampLayout, CampPiece } from "./camp-layout";
import { campHeightPx } from "./camp-motion";
import { DEFAULT_SIZE, NOMINAL_PAINT, type StageMeasure } from "./figure-scale";
import { ANCHOR_Y } from "./art-paths";

export interface CampOwner {
  seat?: number;
  heightCm: number;
  /** Her species (`characters/<species>`), for her drawn box; absent, the nominal box. */
  species?: string;
}

/** A bedroll's drawn length over its hero's drawn body length. */
export const BEDROLL_LENGTH_FIT = 1.2;
/** A tent's drawn height over its hero's drawn height. */
export const TENT_HEIGHT_FIT = 1.25;
/** A tent's drawn width over its hero's drawn width, at least. */
export const TENT_WIDTH_FIT = 1.3;
/** The narrowest a tent stand-in is drawn, width over height (a bell tent). */
export const TENT_STAND_IN_MIN_ASPECT = 0.65;

/**
 * Per species, a hero's painted box as a share of her drawn height (the
 * figure's true height, camp-motion.ts `campHeightPx`): the most any of her
 * paintings covers, rounded up. Measured with alpha over 64, like actor-art.ts
 * `measurePaint`.
 */
export const HERO_PAINT: Readonly<Record<string, { height: number; width: number }>> = {
  bigfoot: { height: 1.04, width: 0.64 },
  dragonling: { height: 1.1, width: 1.2 },
  griffin: { height: 1.05, width: 0.99 },
  kitsune: { height: 1.04, width: 1.1 },
  manticore: { height: 1.02, width: 1.11 },
  unicorn: { height: 1.08, width: 0.91 },
};

/** A hero with no species: the nominal paint (figure-scale.ts `NOMINAL_PAINT`). */
const NOMINAL_BOX = {
  height: 1,
  width: (NOMINAL_PAINT.right - NOMINAL_PAINT.left) / (ANCHOR_Y - NOMINAL_PAINT.top),
};

export function campPieceOwner<T extends CampOwner>(layout: CampLayout, piece: CampPiece, figures: readonly T[]): T | undefined {
  const seat = piece.ownerSeat ?? layout.frame.standPoints.find(point => point.hotspot === piece.id && point.seat !== undefined)?.seat;
  return seat === undefined ? undefined : figures.find(figure => figure.seat === seat);
}

/** Scale after the base item's legibility floor, keeping its ratio to the drawn hero. */
export function campOwnedScale(owner: CampOwner | undefined, measure: StageMeasure): number {
  return owner && Number.isFinite(owner.heightCm) && owner.heightCm > 0
    ? campHeightPx(owner.heightCm, measure) / campHeightPx(DEFAULT_SIZE.heightCm, measure)
    : 1;
}

/** A hero's drawn box on the camp canvas, before her lane's scale and the camp's figure factor. */
export function heroDrawnBox(owner: CampOwner, measure: StageMeasure): { height: number; width: number } {
  const drawn = campHeightPx(owner.heightCm, measure);
  const box = (owner.species ? HERO_PAINT[owner.species] : undefined) ?? NOMINAL_BOX;
  return { height: drawn * box.height, width: drawn * box.width };
}

/** What a piece of a hero's own gear is, for fitting. */
export type CampGearKind = "bedroll" | "tent" | "other";

export function campGearKind(pieceId: string): CampGearKind {
  if (pieceId.startsWith("bedroll")) return "bedroll";
  if (pieceId.startsWith("tent")) return "tent";
  return "other";
}

/**
 * How big a piece of gear is drawn, in canvas px before its lane's scale and
 * the figure factor: `baseHeightPx` is its authored height (for a 160 cm
 * owner), `aspect` its painting's width over height, or null for a stand-in
 * that may be drawn at any width (a tent before its painting). Unowned, it is
 * its authored size.
 */
export function fittedGear(
  kind: CampGearKind,
  baseHeightPx: number,
  aspect: number | null,
  owner: CampOwner | undefined,
  measure: StageMeasure,
): { height: number; width: number } {
  const shape = aspect ?? 1;
  if (!owner) {
    if (kind === "tent" && aspect === null) return tentStandInBox(baseHeightPx, heroDrawnBox({ heightCm: DEFAULT_SIZE.heightCm }, measure));
    return { height: baseHeightPx, width: baseHeightPx * shape };
  }
  const base = baseHeightPx * campOwnedScale(owner, measure);
  const hero = heroDrawnBox(owner, measure);
  if (kind === "bedroll") {
    const height = Math.max(base, (BEDROLL_LENGTH_FIT * Math.max(hero.height, hero.width)) / shape);
    return { height, width: height * shape };
  }
  if (kind === "tent") {
    if (aspect === null) return tentStandInBox(base, hero);
    const height = Math.max(base, TENT_HEIGHT_FIT * hero.height, (TENT_WIDTH_FIT * hero.width) / shape);
    return { height, width: height * shape };
  }
  return { height: base, width: base * shape };
}

function tentStandInBox(base: number, hero: { height: number; width: number }): { height: number; width: number } {
  const height = Math.max(base, TENT_HEIGHT_FIT * hero.height);
  return { height, width: Math.max(TENT_WIDTH_FIT * hero.width, TENT_STAND_IN_MIN_ASPECT * height) };
}
