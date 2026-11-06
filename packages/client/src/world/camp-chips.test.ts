/**
 * A phone's Camp chips (camp-chips.ts; #620, #623): on every phone width, at
 * stage 1 and stage 2, with each spot's widest piece up, no two chips touch,
 * each line lands inside its own chip, no line runs through another chip on
 * its way up or alongside another line, and everything stays on the panel.
 * And whatever the spots, there is always an answer (#620): random spots on
 * every width from 320 to 768 px always get a tidy layout, with lines where
 * the pieces leave room for them and a plain list where they do not.
 */

import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import { campLayout, parseCampManifest } from "./camp-layout";
import { campBoxes, campRowScale, rectOf } from "./camp-boxes";
import { apartLines, chipRows, type Chip, type ChipSpot } from "./camp-chips";
import { CREW_PIECE_ART, campSpots, hotspotName, pieceName } from "./camp-scene";
import { FIGURE_SIZES } from "./figure-sizes";

const parsed = parseCampManifest((manifest as { camp: unknown }).camp);
const heroes = ["bigfoot", "kitsune", "unicorn", "griffin"].map((s, seat) => ({ seat, heightCm: FIGURE_SIZES[`characters/${s}`]![0], species: s }));

/** The chip spots StillCamp hands chipRows for this stage at `paneWidth`, each spot dressed in its widest piece. */
function spotsAt(stage: number, paneWidth: number): ChipSpot[] {
  const layout = campLayout(parsed, "open_plains", stage);
  const spots = campSpots(layout, { placed: {}, grownBy: stage > 1 ? ["gemfall", "riftlight"] : [] }).map((spot) => {
    if (!spot.pickable) return spot;
    const piece = CREW_PIECE_ART.filter((p) => p.hotspot === spot.kind && (stage > 1 || !/stage2|frame/.test(p.group))).sort((a, b) => (b.widthCm ?? 0) - (a.widthCm ?? 0))[0]!;
    return { ...spot, pieceId: piece.id, label: pieceName(piece.id), heightCm: piece.heightCm, widthCm: piece.widthCm ?? piece.heightCm, path: piece.path };
  });
  const input = { heroes, spots };
  const boxes = campBoxes(layout, { ...input, figureScale: campRowScale(layout, input) });
  const s = paneWidth / layout.canvas.width;
  return spots
    .filter((spot) => spot.pickable)
    .map((spot) => {
      const r = rectOf(boxes.find((b) => b.id === `spot:${spot.id}`)!);
      const inset = (r.r - r.l) * 0.1;
      return { id: spot.id, label: hotspotName(spot.kind), x: spot.x * layout.canvas.width * s, x0: (r.l + inset) * s, x1: (r.r - inset) * s };
    });
}

function expectTidy(chips: readonly Chip[], spots: readonly ChipSpot[], paneWidth: number, lines = true): void {
  expect(chips).toHaveLength(spots.length);
  expect(new Set(chips.map((c) => c.id)).size).toBe(spots.length);
  const rows = Math.max(...chips.map((c) => c.row)) + 1;
  // No empty rows, and never more rows than chips.
  expect(new Set(chips.map((c) => c.row)).size).toBe(rows);
  expect(rows).toBeLessThanOrEqual(spots.length);
  // Either every chip has its line or none does (the plain list).
  const listed = chips.every((c) => c.x === null);
  if (lines) expect(listed, "every chip joined to its spot").toBe(false);
  else expect(listed || chips.every((c) => c.x !== null)).toBe(true);
  for (const chip of chips) {
    const spot = spots.find((s) => s.id === chip.id)!;
    expect(chip.label.replace("\n", " "), `${chip.id} keeps its name`).toBe(spot.label);
    expect(chip.left, `${chip.id} on the panel`).toBeGreaterThanOrEqual(0);
    expect(chip.left + chip.width, `${chip.id} on the panel`).toBeLessThanOrEqual(paneWidth);
    expect(chip.width, `${chip.id} big enough for a finger`).toBeGreaterThanOrEqual(44);
    for (const other of chips) {
      if (other === chip) continue;
      if (other.row === chip.row) expect(other.left >= chip.left + chip.width || other.left + other.width <= chip.left, `${chip.id} and ${other.id} apart`).toBe(true);
    }
    if (chip.x === null) continue;
    expect(chip.x, `${chip.id}'s line inside its chip`).toBeGreaterThan(chip.left + 4);
    expect(chip.x, `${chip.id}'s line inside its chip`).toBeLessThan(chip.left + chip.width - 4);
    // From its piece, or as near it as a line inside a chip on the panel can be (a spot at the very edge).
    const inside = (v: number) => Math.min(paneWidth - 13, Math.max(13, v));
    expect(chip.x, `${chip.id}'s line drops from its piece`).toBeGreaterThanOrEqual(inside(Math.min(spot.x, spot.x0 ?? spot.x)) - 1);
    expect(chip.x, `${chip.id}'s line drops from its piece`).toBeLessThanOrEqual(inside(Math.max(spot.x, spot.x1 ?? spot.x)) + 1);
    for (const other of chips) {
      if (other === chip || other.x === null) continue;
      // A line passes up through every row above its chip's.
      if (other.row < chip.row) expect(chip.x <= other.left || chip.x >= other.left + other.width, `${chip.id}'s line clear of ${other.id}`).toBe(true);
      expect(Math.abs(chip.x - other.x), `${chip.id}'s and ${other.id}'s lines apart`).toBeGreaterThanOrEqual(8);
    }
  }
}

describe("a phone's Camp chips", () => {
  for (const stage of [1, 2]) {
    for (const width of [320, 360, 390, 430, 768]) {
      it(`are tidy at stage ${String(stage)} on a ${String(width)} px panel`, () => {
        const spots = spotsAt(stage, width);
        const chips = chipRows(spots, width);
        expectTidy(chips, spots, width);
        // Two rows at most at stage 1. At stage 2 the awning stands behind the cookfire, so their
        // chips take a row each, and on a phone the lanterns and the friends' corner, side by side
        // in front of the left-hand tents, may take a third.
        expect(Math.max(...chips.map((c) => c.row)) + 1).toBeLessThanOrEqual(stage === 1 || width >= 768 ? 2 : 3);
      });
    }
  }

  it("gives two spots stacked one behind the other a line each", () => {
    const spots: ChipSpot[] = [
      { id: "awning", label: "Awning", x: 195, x0: 175, x1: 215 },
      { id: "cookfire", label: "Cookfire", x: 195, x0: 186, x1: 204 },
    ];
    const chips = chipRows(spots, 390);
    expectTidy(chips, spots, 390);
  });

  it("finds rows for the cookfire moved a little off the awning's middle (the 768 px panel that once had none)", () => {
    // The stage-2 spots on a 768 px panel with the cookfire at 0.523: the search once kept each
    // line nearest its spot even where its chip could not then stand, and gave up.
    const spots: ChipSpot[] = [
      { id: "cookfire", label: "Cookfire", x: 402, x0: 377, x1: 426 },
      { id: "awning", label: "Awning", x: 392, x0: 352, x1: 433 },
      { id: "lanterns", label: "Lanterns", x: 61, x0: 25, x1: 98 },
      { id: "friends_corner", label: "Friends' corner", x: 179, x0: 135, x1: 223 },
      { id: "banner_pole", label: "Banner pole", x: 701, x0: 671, x1: 732 },
    ];
    const chips = chipRows(spots, 768);
    expectTidy(chips, spots, 768);
    expect(Math.max(...chips.map((c) => c.row)) + 1).toBeLessThanOrEqual(2);
  });

  it("steps the chips down one a row where no fewer rows keep the rules", () => {
    // Six spots crowded at the left of a narrow panel, each piece narrow: no two chips can share a
    // row, more rows than the search tries, so they step down one a row, each still on its line.
    const spots: ChipSpot[] = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `s${String(i)}`, label: "Lanterns", x: 30 + i * 14, x0: 26 + i * 14, x1: 34 + i * 14 }));
    const chips = chipRows(spots, 320);
    expectTidy(chips, spots, 320);
    expect(new Set(chips.map((c) => c.row)).size).toBe(6);
  });

  it("falls back to a plain list, with no lines, where no lines can be kept apart", () => {
    // Three spots on one spot: three lines cannot drop 10 px apart from one point.
    const spots: ChipSpot[] = ["Awning", "Cookfire", "Banner pole"].map((label, i) => ({ id: `s${String(i)}`, label, x: 160 }));
    expect(apartLines(spots, 320)).toBeNull();
    const chips = chipRows(spots, 320);
    expectTidy(chips, spots, 320, false);
    expect(chips.every((c) => c.x === null)).toBe(true);
    // In the order of their spots, flowed into as few rows as fit.
    expect(chips.map((c) => c.row)).toEqual([0, 0, 0]);
  });

  it("always answers with a tidy layout, whatever the spots, on every width from 320 to 768 px", () => {
    // A seeded generator, so a failure names a case that can be run again.
    let seed = 620;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const NAMES = ["Cookfire", "Awning", "Lanterns", "Friends' corner", "Banner pole", "Trophy"];
    let withLines = 0;
    for (let n = 0; n < 400; n++) {
      const width = Math.round(320 + random() * 448);
      const count = 1 + Math.floor(random() * 7);
      const spots: ChipSpot[] = Array.from({ length: count }, (_, i) => {
        const x = random() * width;
        // Most pieces are as wide as a real one at this width (3% to 15% of the panel); some only a point.
        const half = random() < 0.15 ? 0 : (0.015 + random() * 0.06) * width;
        return { id: `spot${String(i)}`, label: NAMES[Math.floor(random() * NAMES.length)]!, x, ...(half > 0 ? { x0: x - half, x1: x + half } : {}) };
      });
      const chips = chipRows(spots, width);
      const at = `case ${String(n)}: ${JSON.stringify({ width, spots })}`;
      try {
        expectTidy(chips, spots, width, false);
      } catch (e) {
        throw new Error(`${at}\n${String(e)}`);
      }
      // Lines wherever the pieces leave room to keep them apart, unless no staircase fits either.
      if (chips[0]!.x !== null) withLines++;
      else if (apartLines(spots, width) === null) continue;
    }
    // Most random camps still get their lines.
    expect(withLines).toBeGreaterThan(300);
  });

  it("keeps lines wherever the real camp's spots go, at every phone width", () => {
    // The real stage-2 spots, each moved anywhere along its lane: the cookfire from 0.40 to 0.62.
    for (const cook of [0.4, 0.45, 0.5, 0.512, 0.523, 0.55, 0.6, 0.62]) {
      for (const width of [320, 360, 390, 430, 600, 768]) {
        const spots = spotsAt(2, width).map((s) => (s.id === "cookfire" ? { ...s, x: s.x + (cook - 0.5) * width, x0: s.x0! + (cook - 0.5) * width, x1: s.x1! + (cook - 0.5) * width } : s));
        const chips = chipRows(spots, width);
        expectTidy(chips, spots, width);
      }
    }
  });
});
