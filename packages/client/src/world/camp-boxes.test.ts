/**
 * The camp on the real manifest (docs/camp.md §4.2, §8.3, §8.6; #620), at
 * stage 1 and at stage 2, drawn as camp-boxes.ts lays it out, which is what
 * the moving camp and the still one draw: every hero's bedroll or tent at her
 * fitted size, every shared piece at its true height and width, the campfire
 * and the trailhead post, in the lobby's window on a 1280 x 720 and a
 * 1920 x 1080 TV. Nothing may overlap a hero's gear or another piece, no label
 * may land on another label or somebody else's piece, and all of it stays
 * inside the visible span and between the lobby's header and its panels.
 *
 * Worst cases: four bigfoots (the tallest), four kitsune (the smallest), a mix
 * (bigfoot, kitsune, unicorn, griffin), four of every other species, and for
 * each every piece the crew could have up at each spot.
 */

import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import catalog from "../../../../content/camp.json";
import { campLayout, parseCampManifest, type CampLayout } from "./camp-layout";
import { campVisibleSpan, campWindow } from "./camp-framing";
import { campBoxes, campFitFor, campLabelClashes, campOverlaps, campRowScale, labelRect, rectOf, type CampBoxInput } from "./camp-boxes";
import { CREW_PIECE_ART, campSpots, pieceName } from "./camp-scene";
import { FIGURE_SIZES } from "./figure-sizes";

const parsed = parseCampManifest((manifest as { camp: unknown }).camp);

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

/**
 * Each stage's spacing (docs/camp.md §8.3). Stage 2: the parties its spots
 * were spaced for are drawn at full size, and no party is shrunk under 0.9 to
 * fit the row. Stage 1: a bedroll is longer than its hero lying down
 * (camp-ownership.ts), and the four of them, the campfire on the clearing's
 * worn patch, the trailhead post at the trail, the lantern hooks and the
 * banner pole all stand side by side across the clearing, so only the small
 * parties fit at full size and the rest are drawn smaller, a party of four
 * bigfoots most.
 */
const STAGES = [
  { stage: 1, spacedFor: ["four kitsune", "four of kitsune", "four of dragonling"], minRow: 0.72, grownBy: [] as string[] },
  {
    stage: 2,
    spacedFor: ["four bigfoots", "four kitsune", "a mix", "the mix the other way round", "four of unicorn", "four of dragonling"],
    minRow: 0.9,
    grownBy: ["gemfall", "riftlight"],
  },
] as const;

/**
 * The crew pieces a camp at `stage` can own (content/camp.json): every find
 * and kept piece, the shop pieces of its shelf and the ones below, and its
 * frames' own pieces. A stage-1 crew has never seen the stage-2 shelf.
 */
function ownableAt(stage: number): Set<string> {
  return new Set(
    (catalog.crewPieces as { id: string; group: string; stage?: number }[])
      .filter((p) => !(p.group === "shop" || p.group === "frame") || (p.stage ?? 1) <= stage)
      .map((p) => p.id),
  );
}

const heroesOf = (species: string[]): CampBoxInput["heroes"] =>
  species.map((s, seat) => ({ seat, heightCm: heightOf(s), species: s, name: NAME, souvenirs: 4 }));

/** Every placement of the crew's pieces a stage's spots allow: each pickable spot shows each piece of its kind in turn. */
function placements(layout: CampLayout, stage: number, grownBy: readonly string[]): CampBoxInput["spots"][] {
  const ownable = ownableAt(stage);
  const art = CREW_PIECE_ART.filter((p) => ownable.has(p.id));
  const base = campSpots(layout, { placed: {}, grownBy: [...grownBy] }, { crewName: "The Bartholomewzzzzz crew" });
  const byKind = new Map<string, string[]>();
  for (const piece of art) byKind.set(piece.hotspot, [...(byKind.get(piece.hotspot) ?? []), piece.id]);
  const out: CampBoxInput["spots"][] = [];
  // The widest and the tallest of every kind together, and each piece on its own against them.
  const pick = (kind: string, by: "widthCm" | "heightCm") =>
    [...(byKind.get(kind) ?? [])].sort((a, b) => (CREW_PIECE_ART.find((p) => p.id === b)![by] ?? 0) - (CREW_PIECE_ART.find((p) => p.id === a)![by] ?? 0))[0]!;
  const dress = (choose: (kind: string) => string | null) =>
    base.map((spot) => {
      const id = spot.kind === "trophy" ? spot.pieceId : choose(spot.kind);
      const piece = CREW_PIECE_ART.find((p) => p.id === id);
      return piece ? { ...spot, pieceId: piece.id, label: pieceName(piece.id), heightCm: piece.heightCm, widthCm: piece.widthCm ?? piece.heightCm } : { ...spot, pieceId: null };
    });
  out.push(dress((kind) => pick(kind, "widthCm")));
  out.push(dress((kind) => pick(kind, "heightCm")));
  for (const piece of art.filter((p) => p.group !== "trophy" && base.some((spot) => spot.kind === p.hotspot))) {
    out.push(dress((kind) => (kind === piece.hotspot ? piece.id : pick(kind, "widthCm"))));
  }
  return out;
}

it("has every piece's true width in the manifest", () => {
  for (const piece of CREW_PIECE_ART) expect(piece.widthCm, piece.id).toBeGreaterThan(0);
});

for (const { stage, spacedFor, minRow, grownBy } of STAGES) {
  describe(`the stage-${String(stage)} camp's boxes (#620)`, () => {
    const layout = campLayout(parsed, "open_plains", stage);
    const W = layout.canvas.width;
    const all = placements(layout, stage, grownBy);
    /** A hero's own gear: her tent at stage 2, her bedroll and pack at stage 1. */
    const gearOf = (boxes: ReturnType<typeof campBoxes>) => boxes.filter((b) => b.kind === "tent" || (b.kind === "owned" && b.id.startsWith("bedroll_")));

    it("has a shared spot for every kind of piece it can own", () => {
      expect(layout.frame.stage).toBe(stage);
      expect(all.length).toBeGreaterThan(2);
      expect(all[0]!.filter((spot) => spot.pieceId).length).toBeGreaterThanOrEqual(3);
    });

    for (const [name, species] of Object.entries(PARTIES)) {
      for (const view of LOBBY) {
        it(`${name}: nothing overlaps her gear or another piece, and no label collides, at ${view.width} x ${view.height}`, () => {
          const heroes = heroesOf(species);
          for (const spots of all) {
            const input = { heroes, spots, allSouvenirs: true };
            const window = campWindow(view.height, view.top, view.bottom);
            const fit = campFitFor(view.width, window, layout, input);
            if ((spacedFor as readonly string[]).includes(name)) expect(campRowScale(layout, input), "spaced for this party at full size").toBe(1);
            expect(fit.figureScale, "never drawn much smaller to fit the row").toBeGreaterThanOrEqual(minRow);
            const boxes = campBoxes(layout, { ...input, figureScale: fit.figureScale });
            expect(gearOf(boxes)).toHaveLength(4);
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

    it("keeps the tall pieces at the sides or behind, never in front of a hero's gear", () => {
      const input = { heroes: heroesOf(PARTIES["four bigfoots"]!), spots: all[1], allSouvenirs: true };
      const boxes = campBoxes(layout, { ...input, figureScale: campRowScale(layout, input) });
      const gear = gearOf(boxes);
      const tallest = Math.max(...gear.map((b) => b.height));
      const tall = boxes.filter((b) => b.kind === "spot" && b.height > tallest * 0.6);
      expect(tall.map((b) => b.id).sort()).toEqual(stage === 1 ? ["spot:banner_pole", "spot:lanterns"] : ["spot:awning", "spot:banner_pole", "spot:lanterns"]);
      const back = layout.lanes.get("back")!.y;
      for (const piece of tall) {
        if (stage === 1) {
          // Stage 1 has no tents to stand behind: a tall piece stands out past every bedroll.
          const lo = Math.min(...gear.map((b) => rectOf(b).l));
          const hi = Math.max(...gear.map((b) => rectOf(b).r));
          expect(rectOf(piece).r <= lo || rectOf(piece).l >= hi, `${piece.id} out at a side`).toBe(true);
          continue;
        }
        const nearer = layout.lanes.get(piece.lane)!.y > back;
        if (!nearer) continue;
        // A tall piece nearer than the tents stands outside every tent's span.
        for (const tent of gear) expect(rectOf(piece).r <= rectOf(tent).l || rectOf(piece).l >= rectOf(tent).r, `${piece.id} in front of ${tent.id}`).toBe(true);
      }
    });

    it("finds room on the near lane beside the fire for what the chapter handed over", () => {
      const ownable = ownableAt(stage);
      const fits = (id: string) => layout.frame.hotspots?.some((h) => h.kind === CREW_PIECE_ART.find((p) => p.id === id)!.hotspot);
      const beside = CREW_PIECE_ART.filter((p) => (p.group === "find" || p.group === "starter-shop") && ownable.has(p.id) && fits(p.id))
        .slice(0, 3)
        .map((p) => ({ pieceId: p.id, label: pieceName(p.id), heightCm: p.heightCm, widthCm: p.widthCm ?? p.heightCm }));
      expect(beside).toHaveLength(3);
      for (const species of [PARTIES["four bigfoots"]!, PARTIES["a mix"]!, PARTIES["four kitsune"]!]) {
        const input = { heroes: heroesOf(species), spots: all[0], allSouvenirs: true };
        const boxes = campBoxes(layout, { ...input, beside, figureScale: campRowScale(layout, input) });
        expect(boxes.filter((b) => b.kind === "beside")).toHaveLength(3);
        expect(campOverlaps(boxes)).toEqual([]);
        expect(campLabelClashes(boxes)).toEqual([]);
      }
    });

    it("draws a party's row smaller only when its gear is too big for the spots", () => {
      for (const s of SPECIES) {
        const k = campRowScale(layout, { heroes: heroesOf([s, s, s, s]), spots: all[0], allSouvenirs: true });
        expect(k, s).toBeGreaterThanOrEqual(minRow);
        expect(k, s).toBeLessThanOrEqual(1);
      }
      expect(layout.canvas.height).toBe(1080);
    });
  });
}
