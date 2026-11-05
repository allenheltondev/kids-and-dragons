/**
 * A phone's Camp chips (camp-chips.ts; #620, #623): on every phone width, at
 * stage 1 and stage 2, with each spot's widest piece up, no two chips touch,
 * each line lands inside its own chip, no line runs through another chip on
 * its way up or alongside another line, and everything stays on the panel.
 */

import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import { campLayout, parseCampManifest } from "./camp-layout";
import { campBoxes, campRowScale, rectOf } from "./camp-boxes";
import { chipRows, type Chip, type ChipSpot } from "./camp-chips";
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

function expectTidy(chips: readonly Chip[], spots: readonly ChipSpot[], paneWidth: number): void {
  expect(chips).toHaveLength(spots.length);
  for (const chip of chips) {
    const spot = spots.find((s) => s.id === chip.id)!;
    expect(chip.left, `${chip.id} on the panel`).toBeGreaterThanOrEqual(0);
    expect(chip.left + chip.width, `${chip.id} on the panel`).toBeLessThanOrEqual(paneWidth);
    expect(chip.x, `${chip.id}'s line inside its chip`).toBeGreaterThan(chip.left + 4);
    expect(chip.x, `${chip.id}'s line inside its chip`).toBeLessThan(chip.left + chip.width - 4);
    expect(chip.x, `${chip.id}'s line drops from its piece`).toBeGreaterThanOrEqual(Math.min(spot.x, spot.x0 ?? spot.x) - 1);
    expect(chip.x, `${chip.id}'s line drops from its piece`).toBeLessThanOrEqual(Math.max(spot.x, spot.x1 ?? spot.x) + 1);
    for (const other of chips) {
      if (other === chip) continue;
      if (other.row === chip.row) expect(other.left >= chip.left + chip.width || other.left + other.width <= chip.left, `${chip.id} and ${other.id} apart`).toBe(true);
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
        // Two rows at most: the awning stands behind the cookfire, so their chips take a row each.
        expect(Math.max(...chips.map((c) => c.row)) + 1).toBeLessThanOrEqual(2);
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
});
