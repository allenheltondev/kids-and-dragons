import type { CampLayout, CampPiece } from "./camp-layout";
import { campHeightPx } from "./camp-motion";
import { DEFAULT_SIZE, type StageMeasure } from "./figure-scale";

export interface CampOwner { seat?: number; heightCm: number }

/** Explicit ownership also supports future packs/tents that have no rest hotspot. */
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
