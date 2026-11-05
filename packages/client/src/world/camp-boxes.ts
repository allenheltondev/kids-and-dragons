/**
 * Where everything in the camp is drawn, as boxes (docs/camp.md §4.2, §8.3,
 * §8.6; #620): each frame piece at its true size (a hero's own gear fitted to
 * her, camp-ownership.ts), each shared hotspot's piece at its `heightCm` and
 * `widthCm`, what waits beside the cookfire, and the small label under or over
 * each, placed so no two labels collide.
 *
 * The one reading of the layout the moving camp (camp.ts), the still camp
 * (StillCamp.tsx) and the overlap test (camp-boxes.test.ts) share, so a piece
 * is never drawn where the test did not look. Pure and Pixi-free.
 *
 * Every number is canvas px (the 1920 x 1080 backdrop canvas): `x` is a box's
 * middle, `ground` its foot, and it rises `height` from there. Boxes shrink
 * about their foot with the camp's figure factor; labels keep their size.
 */

import { CAMP_KIT_STYLES, campKitStyle } from "./camp-kit-art";
import { laneOf, pieceHeightCm, type CampLayout, type CampPiece } from "./camp-layout";
import { campHeightPx, campMeasure } from "./camp-motion";
import { campGearKind, campPieceOwner, fittedGear, type CampOwner } from "./camp-ownership";
import type { CampBesideView, CampSpotView } from "./camp-scene";
import { MIN_FIGURE_SCALE, campFit, type CampFit, type CampReach, type CampWindow } from "./camp-framing";

/** A seated hero, as her gear is sized and named. */
export interface CampBoxHero extends CampOwner {
  seat: number;
  id?: string;
  name?: string;
  kitStyle?: string | null;
  souvenirs?: number;
}

export interface CampBoxInput {
  heroes: readonly CampBoxHero[];
  spots?: readonly Pick<CampSpotView, "id" | "lane" | "x" | "pieceId" | "label" | "heightCm" | "widthCm">[];
  beside?: readonly Pick<CampBesideView, "pieceId" | "label" | "heightCm" | "widthCm">[];
  /** The camp's figure factor (camp-framing.ts `campFit`). */
  figureScale?: number;
  /** Draw every souvenir line, whether or not its hero carries any (the overlap test's worst case). */
  allSouvenirs?: boolean;
}

export interface CampLabelBox {
  text: string;
  /** Middle, top, and size, canvas px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The font size, canvas px. */
  size: number;
}

export interface CampBox {
  id: string;
  kind: "frame" | "tent" | "owned" | "spot" | "beside";
  lane: string;
  /** The hero whose gear it is. */
  seat?: number;
  x: number;
  ground: number;
  width: number;
  height: number;
  label: CampLabelBox | null;
}

/** A shared piece's label, and a tent's (her name is the one to find), canvas px. */
export const LABEL_PX = 22;
export const TENT_LABEL_PX = 24;
/** The smallest a tent's name shrinks to, and the room it may always take (a share of the canvas width). */
export const MIN_LABEL_PX = 16;
const TENT_LABEL_ROOM = 0.1;
/** Nothing beside the cookfire is drawn taller than this: it waits on the near lane, clear of the tents. */
export const BESIDE_MAX_CM = 90;
/** The gap kept between two boxes that must not touch, canvas px. */
const GAP = 4;

/**
 * Painted frame pieces' width over height (alpha-measured from the art,
 * tools/art/camp-art.test.ts), and the souvenir line's stand-in. A piece not
 * here is as wide as it is tall.
 */
export const FRAME_PIECE_ASPECT: Readonly<Record<string, number>> = {
  campfire: 1.06,
  trailhead: 0.64,
  souvenirs: 1.1,
};

const aspectOf = (id: string): number => FRAME_PIECE_ASPECT[id.split("_")[0]!] ?? 1;

/** A label's width at `size` canvas px: a little wider than Nunito bold sets it, so a real clash is never missed. */
export function labelWidth(text: string, size: number): number {
  return text.length * size * 0.58 + size * 0.8;
}

/** The size a piece of a hero's gear is drawn at before its lane and the figure factor, and its scale over its authored height. */
export function ownedPieceSize(
  layout: CampLayout,
  piece: CampPiece,
  owner: (CampOwner & { id?: string; kitStyle?: string | null }) | undefined,
): { height: number; width: number; scale: number } {
  const measure = campMeasure(layout.canvas.height);
  const base = campHeightPx(pieceHeightCm(piece), measure);
  const kind = campGearKind(piece.id);
  let aspect: number | null = aspectOf(piece.id);
  if (kind === "bedroll") {
    const style = CAMP_KIT_STYLES[campKitStyle(owner?.id ?? piece.id, owner?.kitStyle)];
    aspect = style.paintWidth / style.paintHeight;
  } else if (kind === "tent") {
    // Before the tents are painted, the stand-in is drawn at whatever width fits her.
    aspect = null;
  }
  const size = fittedGear(kind, base, aspect, owner, measure);
  return { ...size, scale: size.height / base };
}

const overlaps = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }): boolean =>
  a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

export const rectOf = (box: Pick<CampBox, "x" | "ground" | "width" | "height">) => ({
  l: box.x - box.width / 2,
  r: box.x + box.width / 2,
  t: box.ground - box.height,
  b: box.ground,
});
export const labelRect = (label: CampLabelBox) => ({ l: label.x - label.width / 2, r: label.x + label.width / 2, t: label.y, b: label.y + label.height });

/** A hero's souvenir line hangs on her own tent; nothing else may touch another thing. */
function mayTouch(a: CampBox, b: CampBox): boolean {
  return a.seat !== undefined && a.seat === b.seat;
}

/** Every pair of boxes that overlap and may not. */
export function campOverlaps(boxes: readonly CampBox[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (mayTouch(a, b)) continue;
      if (overlaps(rectOf(a), rectOf(b))) out.push([a.id, b.id]);
    }
  }
  return out;
}

/** Every pair of labels that collide, and every label over somebody else's box. */
export function campLabelClashes(boxes: readonly CampBox[]): [string, string][] {
  const out: [string, string][] = [];
  for (const a of boxes) {
    if (!a.label) continue;
    for (const b of boxes) {
      if (a === b) continue;
      if (b.label && a.id < b.id && overlaps(labelRect(a.label), labelRect(b.label))) out.push([`label:${a.id}`, `label:${b.id}`]);
      if (!mayTouch(a, b) && overlaps(labelRect(a.label), rectOf(b))) out.push([`label:${a.id}`, b.id]);
    }
  }
  return out;
}

/**
 * The boxes the camp draws for this party, at its figure factor.
 *
 * Labels go where they collide with nothing: a near-lane piece's under its
 * foot, a piece further back just inside its foot, a tent's over its ridge;
 * failing that over the piece's top, then under its foot. Things found or
 * bought this chapter wait on the near lane in the free ground nearest the
 * cookfire, sized as if every figure were full size so they never slide as
 * the factor eases.
 */
export function campBoxes(layout: CampLayout, input: CampBoxInput): CampBox[] {
  const k = input.figureScale ?? 1;
  const measure = campMeasure(layout.canvas.height);
  const W = layout.canvas.width;
  const H = layout.canvas.height;
  const boxes: CampBox[] = [];
  for (const piece of layout.frame.pieces) {
    const lane = laneOf(layout, piece.lane);
    const owner = campPieceOwner(layout, piece, input.heroes);
    if (piece.id.startsWith("souvenirs_") && !input.allSouvenirs && !((owner?.souvenirs ?? 0) > 0)) continue;
    const size = ownedPieceSize(layout, piece, owner);
    const kind = piece.id.startsWith("tent_") ? "tent" : owner || piece.ownerSeat !== undefined ? "owned" : "frame";
    const seat = piece.ownerSeat ?? layout.frame.standPoints.find((p) => p.hotspot === piece.id && p.seat !== undefined)?.seat;
    boxes.push({
      id: piece.id,
      kind,
      lane: piece.lane,
      ...(seat !== undefined ? { seat } : {}),
      x: piece.x * W,
      ground: lane.y * H,
      width: size.width * lane.scale * k,
      height: size.height * lane.scale * k,
      label: null,
      ...(kind === "tent" && owner?.name?.trim() ? { text: owner.name.trim() } : {}),
    } as CampBox & { text?: string });
  }
  for (const spot of input.spots ?? []) {
    if (!spot.pieceId) continue;
    const lane = laneOf(layout, spot.lane);
    const height = campHeightPx(spot.heightCm, measure) * lane.scale * k;
    boxes.push({
      id: `spot:${spot.id}`,
      kind: "spot",
      lane: spot.lane,
      x: spot.x * W,
      ground: lane.y * H,
      width: (height * spot.widthCm) / spot.heightCm,
      height,
      label: null,
      text: spot.label,
    } as CampBox & { text?: string });
  }
  // Labels, most important first: her tent, then the crew's spots.
  const placed: CampBox[] = [];
  const clear = (label: CampLabelBox, self: CampBox): boolean =>
    label.x - label.width / 2 >= 0 &&
    label.x + label.width / 2 <= W &&
    boxes.every((other) => other === self || mayTouch(self, other) || !overlaps(labelRect(label), rectOf(other))) &&
    placed.every((other) => other === self || !other.label || !overlaps(labelRect(label), labelRect(other.label)));
  const nearest = [...layout.lanes.values()].sort((a, b) => b.y - a.y)[0]!;
  const labelFor = (box: CampBox & { text?: string }, optional = false): void => {
    if (!box.text) return;
    // A tent's name shrinks to its tent's width (never under MIN_LABEL_PX), rather than reach a neighbour's.
    const room = Math.max(box.width, TENT_LABEL_ROOM * W);
    const size = box.kind === "tent"
      ? Math.max(MIN_LABEL_PX, Math.min(TENT_LABEL_PX, TENT_LABEL_PX * (room / labelWidth(box.text, TENT_LABEL_PX))))
      : LABEL_PX;
    const width = labelWidth(box.text, size);
    const height = size * 1.3;
    const at = (y: number): CampLabelBox => ({ text: box.text!, x: box.x, y, width, height, size });
    const top = box.ground - box.height;
    const under = at(box.ground + GAP);
    const inside = at(box.ground - height - GAP);
    const over = at(top - height - GAP);
    const options = box.kind === "tent" ? [over, under] : box.kind === "beside" ? [under] : box.lane === nearest.id ? [under, over] : [inside, over, under];
    // Something waiting beside the fire is named only where its name has room.
    box.label = options.find((option) => clear(option, box)) ?? (optional ? null : options[0]!);
    placed.push(box);
  };
  for (const box of boxes) labelFor(box);
  // Beside the cookfire (§12.5): the free near-lane ground nearest the fire.
  const fire = layout.frame.hotspots?.find((h) => h.kind === "cookfire") ?? layout.frame.pieces.find((p) => p.id === "campfire");
  const fx = (fire?.x ?? 0.5) * W;
  const fullSize = k === 1 || !(input.beside?.length) ? null : campBoxes(layout, { ...input, figureScale: 1 });
  (input.beside ?? []).forEach((piece, i) => {
    const known = fullSize?.find((b) => b.id === `beside:${piece.pieceId}`);
    const cm = Math.min(piece.heightCm, BESIDE_MAX_CM);
    const fullHeight = campHeightPx(cm, measure) * nearest.scale;
    const fullWidth = (fullHeight * piece.widthCm) / piece.heightCm;
    const make = (x: number, scale: number): CampBox & { text?: string } => ({
      id: `beside:${piece.pieceId}`,
      kind: "beside",
      lane: nearest.id,
      x,
      ground: nearest.y * H,
      width: fullWidth * scale,
      height: fullHeight * scale,
      label: null,
      text: piece.label,
    });
    let chosen: (CampBox & { text?: string }) | null = known ? make(known.x, 1) : null;
    // Nearest the fire with room for it and its name; failing that, room for it alone (the
    // chapter's end names it on the shared screen anyway).
    for (const named of [true, false]) {
      for (let step = 0; step < 200 && !chosen; step++) {
        for (const side of [-1, 1]) {
          const x = fx + side * step * 0.0025 * W;
          if (x < nearest.x0 * W || x > nearest.x1 * W) continue;
          const candidate = make(x, 1);
          if (rectOf(candidate).l < 0 || rectOf(candidate).r > W) continue;
          if (boxes.some((b) => overlaps(rectOf(candidate), rectOf(b)))) continue;
          const label: CampLabelBox = { text: piece.label, x, y: candidate.ground + GAP, width: labelWidth(piece.label, LABEL_PX), height: LABEL_PX * 1.3, size: LABEL_PX };
          if (named && !clear(label, candidate)) continue;
          chosen = candidate;
          break;
        }
      }
    }
    const box = chosen ?? make(fx + (i - ((input.beside?.length ?? 1) - 1) / 2) * 0.075 * W, 1);
    box.width *= k;
    box.height *= k;
    boxes.push(box);
    labelFor(box, true);
  });
  for (const box of boxes) delete (box as { text?: string }).text;
  return boxes;
}

/**
 * The largest figure factor, from 1 down to `MIN_FIGURE_SCALE`, at which none
 * of these boxes overlap (docs/camp.md §8.3): a party whose gear is too big
 * for the camp's fixed spots at full size is drawn a little smaller, never
 * piled up. 1 for every party the spots were spaced for.
 */
export function campRowScale(layout: CampLayout, input: Omit<CampBoxInput, "figureScale">): number {
  const fits = (k: number): boolean => campOverlaps(campBoxes(layout, { ...input, figureScale: k }).filter((b) => b.kind !== "beside")).length === 0;
  if (fits(1)) return 1;
  let lo = MIN_FIGURE_SCALE;
  let hi = 1;
  if (!fits(lo)) return lo;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** How high each box, and the label over it, stands above its ground at full size: what the focus band must also hold. */
export function campReachOf(layout: CampLayout, boxes: readonly CampBox[], figureScale = 1): CampReach[] {
  const H = layout.canvas.height;
  // Measured at `figureScale` and given back at full size, as the band scales it again.
  return boxes
    .filter((b) => b.kind !== "frame")
    .map((b) => ({ y: b.ground / H, head: Math.max(b.height, b.label && b.label.y < b.ground - b.height ? b.ground - b.label.y : 0) / H / figureScale }));
}

/**
 * `campFit` for this camp's party and pieces: the window's figure factor,
 * bounded by the row's (`campRowScale`), with the band holding every tent
 * and tall piece and the names over them.
 */
export function campFitFor(
  paneWidth: number,
  window: CampWindow,
  layout: CampLayout,
  input: Omit<CampBoxInput, "figureScale">,
  focusX = 0.5,
  heights: readonly number[] = input.heroes.map((h) => h.heightCm),
): CampFit {
  if (!layout.frame.hotspots) return campFit(paneWidth, window, layout, heights, focusX);
  const maxScale = campRowScale(layout, input);
  // A name over a tent keeps its size as the tent shrinks, so the band is measured again at the
  // factor it gives: the second pass holds the names exactly.
  let fit = campFit(paneWidth, window, layout, heights, focusX, { reach: campReachOf(layout, campBoxes(layout, { ...input, figureScale: 1 })), maxScale });
  for (let pass = 0; pass < 2; pass++) {
    const k = fit.figureScale;
    const reach = campReachOf(layout, campBoxes(layout, { ...input, figureScale: k }), k);
    fit = campFit(paneWidth, window, layout, heights, focusX, { reach, maxScale });
  }
  return fit;
}
