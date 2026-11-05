/**
 * The stage-2 camp on the real manifest (docs/camp.md §4.2, §8.3, §8.6; #620),
 * drawn as camp-boxes.ts lays it out, which is what the moving camp and the
 * still one draw: every hero's tent at her fitted size, every shared piece at
 * its true height and width, in the lobby's window on a 1280 x 720 and a
 * 1920 x 1080 TV. Nothing may overlap a tent or another piece, no label may
 * land on another label or somebody else's piece, and all of it stays inside
 * the visible span and between the lobby's header and its panels.
 *
 * Worst cases: four bigfoots (the tallest), four kitsune (the smallest), a mix
 * (bigfoot, kitsune, unicorn, griffin), four of every other species, and for
 * each every piece the crew could have up at each spot.
 */

import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import { campLayout, parseCampManifest } from "./camp-layout";
import { campVisibleSpan, campWindow } from "./camp-framing";
import { campBoxes, campFitFor, campLabelClashes, campOverlaps, campRowScale, labelRect, rectOf, type CampBoxInput } from "./camp-boxes";
import { CREW_PIECE_ART, campSpots, pieceName } from "./camp-scene";
import { FIGURE_SIZES } from "./figure-sizes";

const layout = campLayout(parseCampManifest((manifest as { camp: unknown }).camp), "open_plains", 2);
const W = layout.canvas.width;
const H = layout.canvas.height;

/** The TV lobby's header and panels, measured on the dev table with four heroes seated (tools/playtest/table.ts). */
const LOBBY = [
  { width: 1280, height: 720, top: 66, bottom: 237 },
  { width: 1920, height: 1080, top: 66, bottom: 232 },
] as const;

const SPECIES = Object.keys(FIGURE_SIZES).filter((id) => id.startsWith("characters/")).map((id) => id.slice("characters/".length));
const heightOf = (species: string): number => FIGURE_SIZES[`characters/${species}`]![0];
/** The longest name creation allows (16 characters), so every label is its widest. */
const NAME = "Bartholomewzzzzz";

const PARTIES: Record<string, string[]> = {
  "four bigfoots": ["bigfoot", "bigfoot", "bigfoot", "bigfoot"],
  "four kitsune": ["kitsune", "kitsune", "kitsune", "kitsune"],
  "a mix": ["bigfoot", "kitsune", "unicorn", "griffin"],
  "the mix the other way round": ["griffin", "unicorn", "kitsune", "bigfoot"],
  ...Object.fromEntries(SPECIES.map((s) => [`four of ${s}`, [s, s, s, s]])),
};
/** The parties the spots were spaced for: drawn at full size, never shrunk to fit the row. */
const SPACED_FOR = ["four bigfoots", "four kitsune", "a mix", "the mix the other way round", "four of unicorn", "four of dragonling"];

const heroesOf = (species: string[]): CampBoxInput["heroes"] =>
  species.map((s, seat) => ({ seat, heightCm: heightOf(s), species: s, name: NAME, souvenirs: 4 }));

/** Every placement of the crew's pieces the stage-2 spots allow: each pickable spot shows each piece of its kind in turn. */
function placements(): CampBoxInput["spots"][] {
  const base = campSpots(layout, { placed: {}, grownBy: ["gemfall", "riftlight"] }, { crewName: "The Bartholomewzzzzz crew" });
  const byKind = new Map<string, string[]>();
  for (const piece of CREW_PIECE_ART) byKind.set(piece.hotspot, [...(byKind.get(piece.hotspot) ?? []), piece.id]);
  const out: CampBoxInput["spots"][] = [];
  // The widest and the tallest of every kind together, and each piece on its own against them.
  const pick = (kind: string, by: "widthCm" | "heightCm") =>
    [...(byKind.get(kind) ?? [])].sort((a, b) => (CREW_PIECE_ART.find((p) => p.id === b)![by] ?? 0) - (CREW_PIECE_ART.find((p) => p.id === a)![by] ?? 0))[0]!;
  const dress = (choose: (kind: string, spot: string) => string | null) =>
    base.map((spot) => {
      const id = spot.kind === "trophy" ? spot.pieceId : choose(spot.kind, spot.id);
      const art = CREW_PIECE_ART.find((p) => p.id === id);
      return art ? { ...spot, pieceId: art.id, label: pieceName(art.id), heightCm: art.heightCm, widthCm: art.widthCm ?? art.heightCm } : { ...spot, pieceId: null };
    });
  out.push(dress((kind) => pick(kind, "widthCm")));
  out.push(dress((kind) => pick(kind, "heightCm")));
  for (const piece of CREW_PIECE_ART.filter((p) => p.group !== "trophy")) {
    out.push(dress((kind) => (kind === piece.hotspot ? piece.id : pick(kind, "widthCm"))));
  }
  return out;
}

describe("the stage-2 camp's boxes (#620)", () => {
  it("has every piece's true width in the manifest", () => {
    for (const piece of CREW_PIECE_ART) expect(piece.widthCm, piece.id).toBeGreaterThan(0);
  });

  for (const [name, species] of Object.entries(PARTIES)) {
    for (const view of LOBBY) {
      it(`${name}: nothing overlaps a tent or another piece, and no label collides, at ${view.width} x ${view.height}`, () => {
        const heroes = heroesOf(species);
        for (const spots of placements()) {
          const input = { heroes, spots, allSouvenirs: true };
          const window = campWindow(view.height, view.top, view.bottom);
          const fit = campFitFor(view.width, window, layout, input);
          if (SPACED_FOR.includes(name)) expect(campRowScale(layout, input), "spaced for this party at full size").toBe(1);
          expect(fit.figureScale, "never drawn much smaller to fit the row").toBeGreaterThanOrEqual(0.9);
          const boxes = campBoxes(layout, { ...input, figureScale: fit.figureScale });
          expect(campOverlaps(boxes)).toEqual([]);
          expect(campLabelClashes(boxes)).toEqual([]);
          // Inside the visible span, and between the header and the panels.
          const span = campVisibleSpan(view.width, fit.framing, W);
          const screenY = (y: number) => fit.framing.y + y * fit.framing.scale;
          for (const box of boxes) {
            const rects = [rectOf(box), ...(box.label ? [labelRect(box.label)] : [])];
            for (const r of rects) {
              expect(r.l / W, `${box.id} on screen at the left`).toBeGreaterThanOrEqual(span.x0);
              expect(r.r / W, `${box.id} on screen at the right`).toBeLessThanOrEqual(span.x1);
              expect(screenY(r.t), `${box.id} under the header`).toBeGreaterThanOrEqual(window.top - 1);
              expect(screenY(r.b), `${box.id} behind the panels`).toBeLessThanOrEqual(window.bottom + 1);
            }
          }
        }
      });
    }
  }

  it("keeps the tall pieces at the sides or behind, never in front of a tent", () => {
    const boxes = campBoxes(layout, { heroes: heroesOf(PARTIES["four bigfoots"]!), spots: placements()[1], allSouvenirs: true });
    const tents = boxes.filter((b) => b.kind === "tent");
    const tall = boxes.filter((b) => b.kind === "spot" && b.height > tents[0]!.height * 0.6);
    expect(tall.map((b) => b.id).sort()).toEqual(["spot:awning", "spot:banner_pole", "spot:lanterns"]);
    for (const piece of tall) {
      const nearer = layout.lanes.get(piece.lane)!.y > layout.lanes.get("back")!.y;
      if (!nearer) continue;
      // A tall piece nearer than the tents stands outside every tent's span.
      for (const tent of tents) expect(rectOf(piece).r <= rectOf(tent).l || rectOf(piece).l >= rectOf(tent).r, `${piece.id} in front of ${tent.id}`).toBe(true);
    }
  });

  it("finds room on the near lane beside the cookfire for what the chapter handed over", () => {
    const beside = CREW_PIECE_ART.filter((p) => p.group === "find" || p.group === "starter-shop").slice(0, 3).map((p) => ({ pieceId: p.id, label: pieceName(p.id), heightCm: p.heightCm, widthCm: p.widthCm ?? p.heightCm }));
    for (const species of [PARTIES["four bigfoots"]!, PARTIES["a mix"]!]) {
      const boxes = campBoxes(layout, { heroes: heroesOf(species), spots: placements()[0], beside, allSouvenirs: true });
      expect(boxes.filter((b) => b.kind === "beside")).toHaveLength(3);
      expect(campOverlaps(boxes)).toEqual([]);
      expect(campLabelClashes(boxes)).toEqual([]);
    }
  });

  it("draws a smaller party's row a little smaller only when its gear is too big for the spots", () => {
    for (const s of SPECIES) {
      const k = campRowScale(layout, { heroes: heroesOf([s, s, s, s]), spots: placements()[0], allSouvenirs: true });
      expect(k, s).toBeGreaterThanOrEqual(0.9);
      expect(k, s).toBeLessThanOrEqual(1);
    }
    expect(H).toBe(1080);
  });
});
