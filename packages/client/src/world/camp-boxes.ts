/**
 * Where everything in the camp is drawn, as boxes (docs/camp.md §4.2, §8.3,
 * §8.6; #620, #623): each frame piece at its true size (a hero's own gear
 * fitted to her, camp-ownership.ts), each shared hotspot's piece at its
 * `heightCm`, what waits beside the cookfire, the small label under or over
 * each and the crew's name under its banner pole, placed so no two labels
 * collide. Every painted piece is its painting's footprint (camp-paint.ts):
 * as wide as it is painted, centred where its paint is (a banner's flag flies
 * off to one side of its pole), and, for overlaps, the slices of its height it
 * actually covers; a piece not painted yet is its declared `widthCm`.
 *
 * The one reading of the layout the moving camp (camp.ts), the still camp
 * (StillCamp.tsx) and the overlap test (camp-boxes.test.ts) share, so a piece
 * is never drawn where the test did not look. Pure and Pixi-free.
 *
 * Every number is canvas px (the 1920 x 1080 backdrop canvas): `x` is a box's
 * painted middle, `anchor` its painting's ground contact, `ground` its foot,
 * and it rises `height` from there. Boxes shrink
 * about their foot with the camp's figure factor; labels keep their size.
 */

import { CAMP_KIT_STYLES, campKitStyle } from "./camp-kit-art";
import { campPaintBox, campPaintSlices } from "./camp-paint";
import { laneOf, pieceHeightCm, type CampLayout, type CampPiece } from "./camp-layout";
import { campHeightPx, campMeasure } from "./camp-motion";
import { campGearKind, campPieceOwner, fittedGear, heroDrawnBox, type CampOwner } from "./camp-ownership";
import { DEFAULT_SIZE } from "./figure-scale";
import { pieceArt, tentArt, type CampBesideView, type CampSpotView } from "./camp-scene";
import { MIN_FIGURE_SCALE, campFit, campFocusBand, type CampFit, type CampReach, type CampWindow } from "./camp-framing";

/** A seated hero, as her gear is sized and named. */
export interface CampBoxHero extends CampOwner {
  seat: number;
  id?: string;
  name?: string;
  kitStyle?: string | null;
  /** Her stored tent (`HeroKit.tent`); absent or null, her bedroll style's. */
  tent?: string | null;
  souvenirs?: number;
}

export interface CampBoxInput {
  heroes: readonly CampBoxHero[];
  spots?: readonly (Pick<CampSpotView, "id" | "lane" | "x" | "pieceId" | "label" | "heightCm" | "widthCm"> & { banner?: string | null })[];
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
  /**
   * `door`: a hero standing at her own tent's door (`campDoorBoxes`), kept in view;
   * `stand`: a hero at a tall shared piece's stand point (`campStandBoxes`), never hidden by a nearer tent.
   */
  kind: "frame" | "tent" | "owned" | "spot" | "beside" | "door" | "stand";
  lane: string;
  /** The hero whose gear it is. */
  seat?: number;
  /** The painted middle, canvas px: what the box is centred on. */
  x: number;
  /** The ground contact its painting is drawn from (the 1024 canvas's x 512), canvas px. */
  anchor: number;
  ground: number;
  width: number;
  height: number;
  /** Its name, shown over a stand-in while its painting is owed. */
  label: CampLabelBox | null;
  /** The crew's name on its banner pole, always shown: under the pole's foot, clear of the flag and everything else. */
  name?: CampLabelBox | null;
  /**
   * What of the box is painted (camp-paint.ts), canvas px: its painting cut
   * into slices of its height, each as wide as its paint there. Absent before
   * the piece is painted, when the whole box counts.
   */
  slices?: readonly Rect[];
}

/** A shared piece's label, and a tent's (her name is the one to find), canvas px. */
export const LABEL_PX = 22;
export const TENT_LABEL_PX = 24;
/** The smallest a tent's name shrinks to, and the room it may always take (a share of the canvas width). */
export const MIN_LABEL_PX = 16;
const TENT_LABEL_ROOM = 0.1;
/** Nothing beside the cookfire is drawn taller than this: it waits on the near lane, clear of the tents. */
export const BESIDE_MAX_CM = 90;
/** ...and where the near lane has no room for it at that, it waits a little smaller, down to the last. */
const BESIDE_FALLBACK_CM = [BESIDE_MAX_CM, 70, 48, 36];
/** The gap kept between two boxes that must not touch, canvas px. */
const GAP = 4;

/**
 * Width over height for a frame piece with no painting yet (the souvenir
 * line's stand-in). A painted piece's shape is its painting's
 * (camp-paint.ts); a piece in neither is as wide as it is tall.
 */
export const FRAME_PIECE_ASPECT: Readonly<Record<string, number>> = {
  souvenirs: 1.1,
};

const aspectOf = (id: string): number => FRAME_PIECE_ASPECT[id.split("_")[0]!] ?? 1;

/** A name on two lines, cut between words where the lines come out most even; null for one word. */
function splitInTwo(text: string): string | null {
  const words = text.split(/\s+/);
  if (words.length < 2) return null;
  let best = 1;
  for (let i = 1; i < words.length; i++) {
    const gap = (cut: number) => Math.abs(words.slice(0, cut).join(" ").length - words.slice(cut).join(" ").length);
    if (gap(i) < gap(best)) best = i;
  }
  return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}

/** A label's width at `size` canvas px: a little wider than Nunito bold sets it, so a real clash is never missed. */
export function labelWidth(text: string, size: number): number {
  return Math.max(...text.split("\n").map((line) => line.length * size * 0.58 + size * 0.8));
}

/**
 * The painting a frame piece is drawn with for its owner, relative to
 * `assets/`, its authored height, and whether it is drawn mirrored: her
 * tent's (the one she picked, or her bedroll style's, or the rolled
 * fallback), her bedroll style's, or the piece's own.
 */
export function piecePainting(
  piece: CampPiece,
  owner: (CampOwner & { id?: string; kitStyle?: string | null; tent?: string | null }) | undefined,
): { path: string; heightCm: number; mirrored: boolean } {
  const kind = campGearKind(piece.id);
  if (kind === "tent") {
    const tent = tentArt(owner?.tent ?? null, owner ? campKitStyle(owner.id ?? piece.id, owner.kitStyle) : "rolled");
    return { path: tent?.path ?? piece.path, heightCm: tent?.heightCm ?? pieceHeightCm(piece), mirrored: false };
  }
  const mirrored = kind === "bedroll" && piece.x > 0.5;
  if (kind === "bedroll" && owner) {
    const style = CAMP_KIT_STYLES[campKitStyle(owner.id ?? piece.id, owner.kitStyle)];
    return { path: style.path.replace(/^\/assets\//, ""), heightCm: pieceHeightCm(piece), mirrored };
  }
  return { path: piece.path, heightCm: pieceHeightCm(piece), mirrored };
}

/**
 * The size a piece of a hero's gear is drawn at before its lane and the
 * figure factor, its scale over its authored height, and its painted middle's
 * offset from its ground contact (camp-paint.ts).
 */
export function ownedPieceSize(
  layout: CampLayout,
  piece: CampPiece,
  owner: (CampOwner & { id?: string; kitStyle?: string | null; tent?: string | null }) | undefined,
): { height: number; width: number; scale: number; offset: number } {
  const measure = campMeasure(layout.canvas.height);
  const painting = piecePainting(piece, owner);
  const base = campHeightPx(painting.heightCm, measure);
  const kind = campGearKind(piece.id);
  const shape = campPaintBox(painting.path, 1);
  let aspect: number | null = shape?.width ?? aspectOf(piece.id);
  if (!shape && kind === "bedroll") {
    const style = CAMP_KIT_STYLES[campKitStyle(owner?.id ?? piece.id, owner?.kitStyle)];
    aspect = style.paintWidth / style.paintHeight;
  } else if (!shape && kind === "tent") {
    // Before her tent is painted, the stand-in is drawn at whatever width fits her.
    aspect = null;
  }
  const size = fittedGear(kind, base, aspect, owner, measure);
  const offset = shape ? (painting.mirrored ? -shape.offset : shape.offset) * size.height : 0;
  return { ...size, scale: size.height / base, offset };
}

/** A crew piece drawn `height` tall: its painted width and offset, or its declared width before it is painted. */
function crewPieceBox(pieceId: string | null, height: number, heightCm: number, widthCm: number): { width: number; offset: number; path: string | null } {
  const path = pieceId ? pieceArt(pieceId)?.path ?? null : null;
  const painted = campPaintBox(path, height);
  return painted ? { ...painted, path } : { width: (height * widthCm) / heightCm, offset: 0, path: null };
}

interface Rect {
  l: number;
  r: number;
  t: number;
  b: number;
}

const overlaps = (a: Rect, b: Rect): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

export const rectOf = (box: Pick<CampBox, "x" | "ground" | "width" | "height">): Rect => ({
  l: box.x - box.width / 2,
  r: box.x + box.width / 2,
  t: box.ground - box.height,
  b: box.ground,
});

/** What of a box is painted: its painting's slices (camp-paint.ts), or the whole box before it is painted. */
export const shapeOf = (box: Pick<CampBox, "x" | "ground" | "width" | "height" | "slices">): readonly Rect[] => box.slices ?? [rectOf(box)];

/** Whether two boxes' paint overlaps, slice by slice. */
export function shapesOverlap(a: Pick<CampBox, "x" | "ground" | "width" | "height" | "slices">, b: Pick<CampBox, "x" | "ground" | "width" | "height" | "slices">): boolean {
  if (!overlaps(rectOf(a), rectOf(b))) return false;
  return shapeOf(a).some((sa) => shapeOf(b).some((sb) => overlaps(sa, sb)));
}

const rectOverlapsShape = (rect: Rect, box: CampBox): boolean => overlaps(rect, rectOf(box)) && shapeOf(box).some((s) => overlaps(rect, s));

/** The slices of a box's painting, drawn at the box's height on its ground contact. */
function sliced(box: CampBox, path: string | null | undefined, mirrored = false): CampBox {
  const slices = campPaintSlices(path, box.height, mirrored);
  if (slices) box.slices = slices.map((s) => ({ l: box.anchor + s.l, r: box.anchor + s.r, t: box.ground + s.t, b: box.ground + s.b }));
  else delete box.slices;
  return box;
}
export const labelRect = (label: CampLabelBox) => ({ l: label.x - label.width / 2, r: label.x + label.width / 2, t: label.y, b: label.y + label.height });

/** A hero's souvenir line hangs on her own tent, and she stands at its door; nothing else may touch another thing but as `mayStandBefore` allows. */
function mayTouch(a: CampBox, b: CampBox): boolean {
  return a.seat !== undefined && a.seat === b.seat;
}

/**
 * The tall shared pieces (docs/camp.md §8.3): the awning, the lanterns and the
 * banner pole, and the shop pieces on those spots. Each may stand partly
 * behind a nearer tent, as `campCoverClashes` allows.
 */
export const TALL_SPOTS: ReadonlySet<string> = new Set(["awning", "lanterns", "banner_pole"]);
/** How much of a tall piece nearer tents may cover: under this share of its painted area... */
export const TALL_MAX_COVERED = 0.5;
/** ...and none of this top share of its painted height. */
export const TALL_KEEP_TOP = 0.5;
/** How high up a farther tent a short near-lane piece may stand in front of it: its lower half. */
export const LOW_FRONT_SHARE = 0.5;

const isTallSpot = (box: CampBox): boolean => box.kind === "spot" && TALL_SPOTS.has(box.id.slice("spot:".length));
/** A hero's tent, or the souvenir line hanging on it. */
const isTentGear = (box: CampBox): boolean => box.seat !== undefined && (box.kind === "tent" || (box.kind === "owned" && box.id.startsWith("souvenirs_")));

/**
 * Whether `a` may be drawn over `b`'s paint, or `b` over `a`'s (docs/camp.md
 * §8.3): the stage-2 tents stand on two lanes, so a tent on the nearer lane
 * (and the souvenir line on it) may stand in front of a tent further back, the
 * nearer drawn in front; and a hero at her door may stand in front of a tent
 * further back. Never over anybody's door: a hero at her tent's door is seen
 * whole, so nothing on her lane or a nearer one covers her (`campDoorBoxes`),
 * nor another hero; and never over a farther tent's souvenir line.
 *
 * Two more, both decided (#620): a tall shared piece may stand partly behind a
 * nearer tent (how much, `campCoverClashes` judges with every nearer tent
 * together), never behind or in front of a hero at her door; and a short
 * shared piece on the near lane (`nearest`, its ground) may stand in front of
 * the lower half of a farther tent (`LOW_FRONT_SHARE`), never its door. A hero
 * at a tall piece's stand point (`campStandBoxes`) is never covered by a
 * nearer tent, and is otherwise passed like any walking hero.
 */
function mayStandBefore(a: CampBox, b: CampBox, nearest?: number): boolean {
  if (mayTouch(a, b)) return true;
  if (a.kind === "stand" || b.kind === "stand") {
    const [stand, other] = a.kind === "stand" ? [a, b] : [b, a];
    return !(isTentGear(other) && other.ground > stand.ground);
  }
  if (a.ground === b.ground) return false;
  const [near, far] = a.ground > b.ground ? [a, b] : [b, a];
  if (isTallSpot(far) && isTentGear(near)) return true;
  if (far.kind === "tent" && near.kind === "spot" && !isTallSpot(near) && near.ground === nearest) {
    return near.ground - near.height >= far.ground - far.height * LOW_FRONT_SHARE;
  }
  if (a.seat === undefined || b.seat === undefined) return false;
  return far.kind === "tent" && (near.kind === "tent" || near.kind === "door" || (near.kind === "owned" && near.id.startsWith("souvenirs_")));
}

/** The area of the union of some rectangles. */
function unionArea(rects: readonly Rect[]): number {
  const xs = [...new Set(rects.flatMap((r) => [r.l, r.r]))].sort((p, q) => p - q);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const spans = rects.filter((r) => r.l <= x0 && r.r >= x1).map((r) => [r.t, r.b] as const).sort((p, q) => p[0] - q[0]);
    let covered = 0;
    let top = 0;
    let bottom = 0;
    let open = false;
    for (const [t, b] of spans) {
      if (!open || t > bottom) {
        if (open) covered += bottom - top;
        top = t;
        bottom = b;
        open = true;
      } else bottom = Math.max(bottom, b);
    }
    if (open) covered += bottom - top;
    area += covered * (x1 - x0);
  }
  return area;
}

const intersect = (a: Rect, b: Rect): Rect | null => {
  const r = { l: Math.max(a.l, b.l), r: Math.min(a.r, b.r), t: Math.max(a.t, b.t), b: Math.min(a.b, b.b) };
  return r.l < r.r && r.t < r.b ? r : null;
};

/**
 * Every tall shared piece nearer tents cover too much of (docs/camp.md §8.3),
 * paired with a tent that covers it. It must still read as itself: no nearer
 * tent or souvenir line covers any of the top `TALL_KEEP_TOP` of its painted
 * height (where a banner's flag, a pole's vane or pinwheel, the lamps and an
 * awning's canopy are painted), and all of them together cover less than
 * `TALL_MAX_COVERED` of its painted area, slice by slice.
 */
export function campCoverClashes(boxes: readonly CampBox[]): [string, string][] {
  const out = new Map<string, [string, string]>();
  for (const piece of boxes.filter(isTallSpot)) {
    const nearer = boxes.filter((b) => isTentGear(b) && b.ground > piece.ground && shapesOverlap(b, piece));
    if (nearer.length === 0) continue;
    const keepBelow = piece.ground - piece.height * (1 - TALL_KEEP_TOP);
    const mine = shapeOf(piece);
    const covered: Rect[] = [];
    for (const tent of nearer) {
      for (const s of mine) {
        for (const t of shapeOf(tent)) {
          const hit = intersect(s, t);
          if (!hit) continue;
          covered.push(hit);
          if (hit.t < keepBelow - 1e-6) out.set(`${piece.id}|${tent.id}`, [piece.id, tent.id]);
        }
      }
    }
    const total = mine.reduce((sum, s) => sum + (s.r - s.l) * (s.b - s.t), 0);
    if (unionArea(covered) >= TALL_MAX_COVERED * total) out.set(`${piece.id}|${nearer[0]!.id}`, [piece.id, nearer[0]!.id]);
  }
  return [...out.values()];
}

/** How much of a tall piece's painted area nearer tents cover, 0 to 1 (for tests and the docs' numbers). */
export function campCoveredShare(boxes: readonly CampBox[], pieceId: string): number {
  const piece = boxes.find((b) => b.id === pieceId);
  if (!piece) return 0;
  const mine = shapeOf(piece);
  const covered = boxes
    .filter((b) => isTentGear(b) && b.ground > piece.ground)
    .flatMap((tent) => mine.flatMap((s) => shapeOf(tent).map((t) => intersect(s, t)).filter((r): r is Rect => r !== null)));
  return unionArea(covered) / mine.reduce((sum, s) => sum + (s.r - s.l) * (s.b - s.t), 0);
}

/** Every pair of boxes that overlap and may not, and every tall piece nearer tents cover too much of (`campCoverClashes`). */
export function campOverlaps(boxes: readonly CampBox[]): [string, string][] {
  const out: [string, string][] = [];
  const nearest = Math.max(...boxes.filter((b) => b.kind !== "door" && b.kind !== "stand").map((b) => b.ground));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (mayStandBefore(a, b, nearest)) continue;
      if (shapesOverlap(a, b)) out.push([a.id, b.id]);
    }
  }
  return [...out, ...campCoverClashes(boxes)];
}

/**
 * Each tent's hero standing at its door (her seat's stand point), as a box at
 * the camp's figure factor: her species' painted box (camp-ownership.ts
 * `HERO_PAINT`) on her tent's lane, centred on the stand point. An empty
 * seat's door is a standing person's (`DEFAULT_SIZE`), so a hero sitting down
 * never finds her door covered. None at a frame with no tents (stage 1's
 * heroes rest beside their bedrolls).
 */
export function campDoorBoxes(layout: CampLayout, input: Pick<CampBoxInput, "heroes" | "figureScale">): CampBox[] {
  const k = input.figureScale ?? 1;
  const measure = campMeasure(layout.canvas.height);
  const W = layout.canvas.width;
  const H = layout.canvas.height;
  const out: CampBox[] = [];
  for (const point of layout.frame.standPoints) {
    if (point.seat === undefined || !point.hotspot?.startsWith("tent_")) continue;
    if (!layout.frame.pieces.some((p) => p.id === point.hotspot)) continue;
    const lane = laneOf(layout, point.lane);
    const hero = input.heroes.find((h) => h.seat === point.seat);
    const box = heroDrawnBox(hero ?? { heightCm: DEFAULT_SIZE.heightCm }, measure);
    out.push({
      id: `door:${point.id}`,
      kind: "door",
      lane: point.lane,
      seat: point.seat,
      x: point.x * W,
      anchor: point.x * W,
      ground: lane.y * H,
      width: box.width * lane.scale * k,
      height: box.height * lane.scale * k,
      label: null,
    });
  }
  return out;
}

/**
 * A hero at each tall shared piece's stand point (the awning's, the lanterns',
 * the banner pole's; `TALL_SPOTS`), as a box at the camp's figure factor: the
 * party's tallest and widest painted box (`HERO_PAINT`), or a standing
 * person's for an empty table, on the stand point's lane. A tall piece may
 * stand partly behind a nearer tent, but whoever goes to look at it is never
 * hidden by one (`mayStandBefore`).
 */
export function campStandBoxes(layout: CampLayout, input: Pick<CampBoxInput, "heroes" | "figureScale">): CampBox[] {
  const k = input.figureScale ?? 1;
  const measure = campMeasure(layout.canvas.height);
  const W = layout.canvas.width;
  const H = layout.canvas.height;
  const drawn = (input.heroes.length ? input.heroes : [{ heightCm: DEFAULT_SIZE.heightCm }]).map((h) => heroDrawnBox(h, measure));
  const hero = { height: Math.max(...drawn.map((b) => b.height)), width: Math.max(...drawn.map((b) => b.width)) };
  const out: CampBox[] = [];
  for (const point of layout.frame.standPoints) {
    if (!point.hotspot || !TALL_SPOTS.has(point.hotspot) || !layout.frame.hotspots?.some((h) => h.id === point.hotspot)) continue;
    const lane = laneOf(layout, point.lane);
    out.push({
      id: `stand:${point.id}`,
      kind: "stand",
      lane: point.lane,
      x: point.x * W,
      anchor: point.x * W,
      ground: lane.y * H,
      width: hero.width * lane.scale * k,
      height: hero.height * lane.scale * k,
      label: null,
    });
  }
  return out;
}

/** A box's labels: its own, and the crew's name on its banner. */
export const labelsOf = (box: CampBox): { id: string; label: CampLabelBox }[] => [
  ...(box.label ? [{ id: `label:${box.id}`, label: box.label }] : []),
  ...(box.name ? [{ id: `name:${box.id}`, label: box.name }] : []),
];

/** Every pair of labels that collide, every label over somebody else's box, and the crew's name over its own banner's flag. */
export function campLabelClashes(boxes: readonly CampBox[]): [string, string][] {
  const out: [string, string][] = [];
  const all = boxes.flatMap((box) => labelsOf(box).map((l) => ({ ...l, box })));
  for (const a of all) {
    for (const b of all) if (a.id < b.id && overlaps(labelRect(a.label), labelRect(b.label))) out.push([a.id, b.id]);
    for (const b of boxes) {
      if (a.box === b ? a.id.startsWith("name:") : !mayTouch(a.box, b)) {
        if (rectOverlapsShape(labelRect(a.label), b)) out.push([a.id, b.id]);
      }
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
    const painting = piecePainting(piece, owner);
    const kind = piece.id.startsWith("tent_") ? "tent" : owner || piece.ownerSeat !== undefined ? "owned" : "frame";
    const seat = piece.ownerSeat ?? layout.frame.standPoints.find((p) => p.hotspot === piece.id && p.seat !== undefined)?.seat;
    boxes.push(sliced({
      id: piece.id,
      kind,
      lane: piece.lane,
      ...(seat !== undefined ? { seat } : {}),
      x: piece.x * W + size.offset * lane.scale * k,
      anchor: piece.x * W,
      ground: lane.y * H,
      width: size.width * lane.scale * k,
      height: size.height * lane.scale * k,
      label: null,
      ...(kind === "tent" && owner?.name?.trim() ? { text: owner.name.trim() } : {}),
    } as CampBox & { text?: string }, painting.path, painting.mirrored));
  }
  for (const spot of input.spots ?? []) {
    if (!spot.pieceId) continue;
    const lane = laneOf(layout, spot.lane);
    const height = campHeightPx(spot.heightCm, measure) * lane.scale * k;
    const painted = crewPieceBox(spot.pieceId, height, spot.heightCm, spot.widthCm);
    boxes.push(sliced({
      id: `spot:${spot.id}`,
      kind: "spot",
      lane: spot.lane,
      x: spot.x * W + painted.offset,
      anchor: spot.x * W,
      ground: lane.y * H,
      width: painted.width,
      height,
      label: null,
      text: spot.label,
      // A banner pole flying the crew's name is named by it, painted or not.
      ...(spot.banner?.trim() ? { banner: spot.banner.trim(), text: undefined } : {}),
    } as CampBox & { text?: string; banner?: string }, painted.path));
  }
  // Labels, most important first: her tent, then the crew's spots. None lands on a hero at her door.
  const doors = campDoorBoxes(layout, { heroes: input.heroes, figureScale: k });
  const placed: CampBox[] = [];
  const clear = (label: CampLabelBox, self: CampBox): boolean =>
    label.x - label.width / 2 >= 0 &&
    label.x + label.width / 2 <= W &&
    [...boxes, ...doors].every((other) => other === self || mayTouch(self, other) || !rectOverlapsShape(labelRect(label), other)) &&
    placed.every((other) => labelsOf(other).every((l) => l.label === label || !overlaps(labelRect(label), labelRect(l.label))));
  const nearest = [...layout.lanes.values()].sort((a, b) => b.y - a.y)[0]!;
  const labelFor = (box: CampBox & { text?: string }, optional = false, twoLines = false): void => {
    if (!box.text) return;
    // A tent's name shrinks to its tent's width (never under MIN_LABEL_PX), rather than reach a neighbour's.
    const room = Math.max(box.width, TENT_LABEL_ROOM * W);
    const size = box.kind === "tent"
      ? Math.max(MIN_LABEL_PX, Math.min(TENT_LABEL_PX, TENT_LABEL_PX * (room / labelWidth(box.text, TENT_LABEL_PX))))
      : LABEL_PX;
    const top = box.ground - box.height;
    const placings = (text: string): CampLabelBox[] => {
      const width = labelWidth(text, size);
      const height = size * 1.3 * text.split("\n").length;
      const at = (y: number): CampLabelBox => ({ text, x: box.x, y, width, height, size });
      const under = at(box.ground + GAP);
      const inside = at(box.ground - height - GAP);
      const over = at(top - height - GAP);
      // A tent on the back lane may have a nearer one in front of its side: its name may then
      // slide along its ridge, toward its open side, rather than land on the nearer tent.
      const along = (label: CampLabelBox): CampLabelBox[] => [-0.25, 0.25, -0.4, 0.4].map((f) => ({ ...label, x: box.x + f * box.width }));
      return box.kind === "tent" ? [over, inside, under, ...along(over), ...along(inside)] : box.kind === "beside" ? [under] : box.lane === nearest.id ? [under, over] : [inside, over, under];
    };
    // A shared piece's name takes two lines where one has no room, or where two names side by
    // side would otherwise meet (two trophies: `twoLines`, below).
    const split = box.kind === "spot" ? splitInTwo(box.text) : null;
    const options = !split ? placings(box.text) : twoLines ? [...placings(split), ...placings(box.text)] : [...placings(box.text), ...placings(split)];
    // Something waiting beside the fire is named only where its name has room.
    box.label = options.find((option) => clear(option, box)) ?? (optional ? null : options[0]!);
    placed.push(box);
  };
  /** The crew's name under its banner pole's foot, on the pole (its anchor), on one line or two: never on the flag. */
  const nameFor = (box: CampBox & { banner?: string }): void => {
    if (!box.banner) return;
    const split = splitInTwo(box.banner);
    const texts = [box.banner, ...(split ? [split] : [])];
    const sized = (text: string, x: number, y: number): CampLabelBox => {
      const width = labelWidth(text, LABEL_PX);
      return { text, x: Math.max(width / 2, Math.min(W - width / 2, x)), y, width, height: LABEL_PX * 1.3 * text.split("\n").length, size: LABEL_PX };
    };
    // Under the pole's foot, on one line or two; failing that, on the grass beside the pole
    // under the flag, where the painting is only pole.
    const options = texts.map((text) => sized(text, box.anchor, box.ground + GAP));
    // Still under the foot, slid toward the screen's nearer edge, clear of a piece on the lane in front.
    const edge = box.anchor > W / 2 ? 1 : -1;
    for (const text of texts) options.push(sized(text, box.anchor + (edge * labelWidth(text, LABEL_PX)) / 4, box.ground + GAP));
    for (let f = 0.5; f >= 0.2 - 1e-9; f -= 0.05) {
      for (const side of [1, -1]) {
        for (const text of texts) {
          const probe = sized(text, 0, box.ground - f * box.height);
          const rect = labelRect(probe);
          const beside = shapeOf(box).filter((s) => s.t < rect.b && rect.t < s.b);
          if (beside.length === 0) continue;
          const edge = side > 0 ? Math.max(...beside.map((s) => s.r)) + GAP + probe.width / 2 : Math.min(...beside.map((s) => s.l)) - GAP - probe.width / 2;
          options.push({ ...probe, x: edge });
        }
      }
    }
    // Last, over the pole's top, in the sky.
    for (const text of texts) {
      const probe = sized(text, box.anchor, 0);
      options.push({ ...probe, y: box.ground - box.height - GAP - probe.height });
    }
    box.name = options.find((option) => !rectOverlapsShape(labelRect(option), box) && clear(option, box)) ?? options[texts.length - 1]!;
    placed.push(box);
  };
  for (const box of boxes) labelFor(box);
  // Two shared pieces' names that still meet are both set again, on two lines first.
  for (const a of boxes) {
    for (const b of boxes) {
      if (a === b || a.kind !== "spot" || b.kind !== "spot" || !a.label || !b.label || !overlaps(labelRect(a.label), labelRect(b.label))) continue;
      for (const box of [a, b]) {
        placed.splice(placed.indexOf(box), 1);
        box.label = null;
      }
      for (const box of [a, b]) labelFor(box, false, true);
    }
  }
  for (const box of boxes) nameFor(box);
  // Beside the cookfire (§12.5): the free near-lane ground nearest the fire.
  const fire = layout.frame.hotspots?.find((h) => h.kind === "cookfire") ?? layout.frame.pieces.find((p) => p.id === "campfire");
  const fx = (fire?.x ?? 0.5) * W;
  const fullSize = k === 1 || !(input.beside?.length) ? null : campBoxes(layout, { ...input, figureScale: 1 });
  // What waits beside the fire is placed at full size (below), so it keeps clear of the doors at full size.
  const fullDoors = campDoorBoxes(layout, { heroes: input.heroes, figureScale: 1 });
  (input.beside ?? []).forEach((piece, i) => {
    const known = fullSize?.find((b) => b.id === `beside:${piece.pieceId}`);
    const path = piece.pieceId ? pieceArt(piece.pieceId)?.path ?? null : null;
    const make = (anchor: number, cm: number): CampBox & { text?: string } => {
      const height = campHeightPx(cm, measure) * nearest.scale;
      const full = crewPieceBox(piece.pieceId, height, piece.heightCm, piece.widthCm);
      return sliced({
        id: `beside:${piece.pieceId}`,
        kind: "beside",
        lane: nearest.id,
        x: anchor + full.offset,
        anchor,
        ground: nearest.y * H,
        width: full.width,
        height,
        label: null,
        text: piece.label,
      } as CampBox & { text?: string }, path);
    };
    const tallest = Math.min(piece.heightCm, BESIDE_MAX_CM);
    // Where the full-size camp put it, at the size it found room for there, so it never slides as the factor eases.
    const knownCm = known ? BESIDE_FALLBACK_CM.map((f) => Math.min(tallest, f)).find((cm) => Math.abs(campHeightPx(cm, measure) * nearest.scale - known.height) < 0.5) : undefined;
    let chosen: (CampBox & { text?: string }) | null = known ? make(known.anchor, knownCm ?? tallest) : null;
    // Nearest the fire with room for it and its name; failing that, room for it alone (the
    // chapter's end names it on the shared screen anyway); failing that, the same a little
    // smaller, down to low enough to wait in front of the lane behind.
    for (const cm of BESIDE_FALLBACK_CM.map((f) => Math.min(tallest, f))) {
      for (const named of [true, false]) {
        for (let step = 0; step < 200 && !chosen; step++) {
          for (const side of [-1, 1]) {
            const x = fx + side * step * 0.0025 * W;
            if (x < nearest.x0 * W || x > nearest.x1 * W) continue;
            const candidate = make(x, cm);
            if (rectOf(candidate).l < 0 || rectOf(candidate).r > W) continue;
            if ([...boxes, ...fullDoors].some((b) => shapesOverlap(candidate, b))) continue;
            const label: CampLabelBox = { text: piece.label, x: candidate.x, y: candidate.ground + GAP, width: labelWidth(piece.label, LABEL_PX), height: LABEL_PX * 1.3, size: LABEL_PX };
            if (named && !clear(label, candidate)) continue;
            chosen = candidate;
            break;
          }
        }
      }
    }
    const full = chosen ?? make(fx + (i - ((input.beside?.length ?? 1) - 1) / 2) * 0.075 * W, BESIDE_FALLBACK_CM.at(-1)!);
    // Shrunk with the figures, about its foot.
    const box = sliced({ ...full, x: full.anchor + (full.x - full.anchor) * k, width: full.width * k, height: full.height * k }, path);
    boxes.push(box);
    labelFor(box, true);
  });
  // A name that something waiting beside the fire has come to stand under is set again, clear of it.
  const waiting = boxes.filter((b) => b.kind === "beside");
  for (const box of boxes) {
    if (box.kind === "beside" || !box.label || !waiting.some((w) => rectOverlapsShape(labelRect(box.label!), w))) continue;
    placed.splice(placed.indexOf(box), 1);
    box.label = null;
    labelFor(box);
  }
  for (const box of boxes) {
    delete (box as { text?: string }).text;
    delete (box as { banner?: string }).banner;
  }
  return boxes;
}

/**
 * The largest figure factor, from 1 down to `MIN_FIGURE_SCALE`, at which none
 * of these boxes overlap, nor covers a hero at her tent's door (docs/camp.md §8.3,
 * `campDoorBoxes`), nor hides a hero at a tall piece's stand point
 * (`campStandBoxes`): a party whose gear is too big
 * for the camp's fixed spots at full size is drawn a little smaller, never
 * piled up. 1 for every party the spots were spaced for.
 */
export function campRowScale(layout: CampLayout, input: Omit<CampBoxInput, "figureScale">): number {
  const fits = (k: number): boolean =>
    campOverlaps([
      ...campBoxes(layout, { ...input, figureScale: k }).filter((b) => b.kind !== "beside"),
      ...campDoorBoxes(layout, { heroes: input.heroes, figureScale: k }),
      ...campStandBoxes(layout, { heroes: input.heroes, figureScale: k }),
    ]).length === 0;
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
    .map((b) => {
      // A name under the foot keeps its size, so its reach below the ground is not scaled.
      const foot = Math.max(0, ...labelsOf(b).map(({ label }) => label.y + label.height - b.ground)) / H;
      return {
        y: b.ground / H,
        head: Math.max(b.height, ...labelsOf(b).map(({ label }) => (label.y < b.ground - b.height ? b.ground - label.y : 0))) / H / figureScale,
        ...(foot > 0 ? { foot } : {}),
      };
    });
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
  const reach: CampReach[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const k = fit.figureScale;
    const at = campReachOf(layout, campBoxes(layout, { ...input, figureScale: k }), k);
    reach.push(...at);
    fit = campFit(paneWidth, window, layout, heights, focusX, { reach: at, maxScale });
  }
  // A name may also take another place at another factor (over a back tent's ridge at one, beside
  // it at the next), and then the band misses it: while the names drawn at this factor reach past
  // the band by more than half a pixel, the band holds every place a pass found, so the factor
  // only falls, and settles.
  for (let pass = 0; pass < 4; pass++) {
    const k = fit.figureScale;
    const now = campReachOf(layout, campBoxes(layout, { ...input, figureScale: k }), k);
    const band = campFocusBand(layout, heights, k, now);
    if (band.top >= fit.band.top - 0.5 / layout.canvas.height && band.bottom <= fit.band.bottom + 0.5 / layout.canvas.height) break;
    reach.push(...now);
    fit = campFit(paneWidth, window, layout, heights, focusX, { reach, maxScale });
  }
  return fit;
}
