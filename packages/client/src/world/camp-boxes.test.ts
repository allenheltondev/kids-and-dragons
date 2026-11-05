/**
 * The camp on the real manifest (docs/camp.md §4.2, §8.3, §8.6; #620), at
 * stage 1 and at stage 2, drawn as camp-boxes.ts lays it out, which is what
 * the moving camp and the still one draw: every hero's bedroll or tent at her
 * fitted size, every shared piece at its true height, the campfire and the
 * trailhead post, each as its painting's real footprint (camp-paint.ts, slice
 * by slice), in the lobby's window on a 1280 x 720 and a 1920 x 1080 TV.
 * Nothing may overlap a hero's gear or another piece, no label may land on
 * another label or somebody else's piece (nor the crew's name on its own
 * banner's flag), and all of it stays inside the visible span and between the
 * lobby's header and its panels.
 *
 * Worst cases: four bigfoots (the tallest), four kitsune (the smallest), a mix
 * (bigfoot, kitsune, unicorn, griffin), four of every other species, and for
 * each every piece the crew could have up at each spot, in the styles their
 * seats hash to and in every tent (stage 2) or bedroll style (stage 1) a kid
 * could pick for all four.
 */

import { describe, expect, it } from "vitest";
import manifest from "../../../../assets/manifest.json";
import catalog from "../../../../content/camp.json";
import { campLayout, parseCampManifest, type CampLayout } from "./camp-layout";
import { campVisibleSpan, campWindow } from "./camp-framing";
import { campBoxes, campFitFor, campLabelClashes, campOverlaps, campRowScale, labelRect, labelsOf, rectOf, shapesOverlap, type CampBoxInput } from "./camp-boxes";
import { CAMP_KIT_STYLES } from "./camp-kit-art";
import { campPaint } from "./camp-paint";
import { CREW_PIECE_ART, TENT_ART, campSpots, pieceName } from "./camp-scene";
import { FIGURE_SIZES } from "./figure-sizes";

const parsed = parseCampManifest((manifest as { camp: unknown }).camp);

/** The TV lobby's header and panels, measured on the dev table with four heroes seated (tools/playtest/table.ts). */
const LOBBY = [
  { width: 1280, height: 720, top: 66, bottom: 237 },
  { width: 1920, height: 1080, top: 66, bottom: 232 },
  // With the campaign picker under the party (the screenshots of #623).
  { width: 1280, height: 720, top: 66, bottom: 320 },
  { width: 1920, height: 1080, top: 66, bottom: 316 },
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
 * Each stage's spacing (docs/camp.md §8.3), on the paintings' real
 * footprints. Stage 1: a bedroll is longer than its hero lying down
 * (camp-ownership.ts), and the four of them, the campfire on the clearing's
 * worn patch, the trailhead post at the trail, the lantern hooks and the
 * banner pole all stand side by side across the clearing: the small parties
 * are drawn nearly full size, four bigfoots about three quarters. Stage 2: a
 * tent with its guy ropes is far wider than its hero, and four of them, the
 * awning between them and the lanterns and the banner pole at the ends fill
 * the clearing, so only the small parties are drawn nearly full size and four
 * bigfoots in their widest tents go down to the floor (`MIN_FIGURE_SCALE`),
 * never piled up.
 */
const STAGES = [
  { stage: 1, minRow: 0.75, grownBy: [] as string[], styles: Object.keys(CAMP_KIT_STYLES) },
  { stage: 2, minRow: 0.6, grownBy: ["gemfall", "riftlight"], styles: TENT_ART.map((t) => t.id) },
] as const;
/** The parties drawn nearly full size at either stage, and how near. */
const SMALL = ["four kitsune", "four of kitsune", "four of dragonling"];
const SMALL_ROW = 0.9;

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

/** The party, all in `style` (a tent at stage 2, a bedroll style at stage 1), or each in the style her seat hashes to. */
const heroesOf = (species: string[], style: string | null = null, stage = 2): CampBoxInput["heroes"] =>
  species.map((s, seat) => ({
    seat,
    heightCm: heightOf(s),
    species: s,
    name: NAME,
    souvenirs: 4,
    ...(style ? (stage === 2 ? { tent: style } : { id: `hero_${String(seat)}`, kitStyle: style }) : {}),
  }));

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
      // Only the crew's own banner flies the crew's name.
      return piece
        ? { ...spot, pieceId: piece.id, label: pieceName(piece.id), heightCm: piece.heightCm, widthCm: piece.widthCm ?? piece.heightCm, banner: piece.id === "kept_crew_banner" ? spot.banner : null }
        : { ...spot, pieceId: null, banner: null };
    });
  out.push(dress((kind) => pick(kind, "widthCm")));
  out.push(dress((kind) => pick(kind, "heightCm")));
  for (const piece of art.filter((p) => p.group !== "trophy" && base.some((spot) => spot.kind === p.hotspot))) {
    out.push(dress((kind) => (kind === piece.hotspot ? piece.id : pick(kind, "widthCm"))));
  }
  return out;
}

it("has every piece's true width in the manifest: its painting's, at its height", () => {
  for (const piece of CREW_PIECE_ART) {
    expect(piece.widthCm, piece.id).toBeGreaterThan(0);
    const paint = campPaint(piece.path);
    if (!paint) continue;
    const painted = (piece.heightCm * (paint.right - paint.left)) / (paint.bottom - paint.top);
    expect(Math.abs(piece.widthCm! - painted), `${piece.id} widthCm (painted ${painted.toFixed(0)} cm wide at ${String(piece.heightCm)} cm)`).toBeLessThanOrEqual(1);
  }
});

for (const { stage, minRow, grownBy, styles } of STAGES) {
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
        it(`${name}: nothing overlaps her gear or another piece, and no label collides, at ${view.width} x ${view.height} under ${view.bottom}px of panels`, () => {
          // Every placement in the styles their seats hash to, and the widest and the tallest in every style.
          const cases = [
            ...all.map((spots) => ({ heroes: heroesOf(species, null, stage), spots })),
            ...styles.flatMap((style) => all.slice(0, 2).map((spots) => ({ heroes: heroesOf(species, style, stage), spots }))),
          ];
          for (const { heroes, spots } of cases) {
            const input = { heroes, spots, allSouvenirs: true };
            const window = campWindow(view.height, view.top, view.bottom);
            const fit = campFitFor(view.width, window, layout, input);
            if (SMALL.includes(name)) expect(campRowScale(layout, input), "a small party is drawn nearly full size").toBeGreaterThanOrEqual(SMALL_ROW);
            expect(campRowScale(layout, input), "never drawn much smaller to fit the row").toBeGreaterThanOrEqual(minRow);
            const boxes = campBoxes(layout, { ...input, figureScale: fit.figureScale });
            expect(gearOf(boxes)).toHaveLength(4);
            expect(campOverlaps(boxes)).toEqual([]);
            expect(campLabelClashes(boxes)).toEqual([]);
            // Inside the visible span, and between the header and the panels.
            const span = campVisibleSpan(view.width, fit.framing, W);
            const screenY = (y: number) => fit.framing.y + y * fit.framing.scale;
            for (const box of boxes) {
              const rects = [rectOf(box), ...labelsOf(box).map((l) => labelRect(l.label))];
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
      for (const style of [null, ...styles]) {
        const input = { heroes: heroesOf(PARTIES["four bigfoots"]!, style, stage), spots: all[1], allSouvenirs: true };
        const boxes = campBoxes(layout, { ...input, figureScale: campRowScale(layout, input) });
        const gear = gearOf(boxes);
        const shortest = Math.min(...gear.map((b) => b.height));
        const tall = boxes.filter((b) => b.kind === "spot" && b.height > shortest * 0.6);
        for (const id of stage === 1 ? ["spot:banner_pole", "spot:lanterns"] : ["spot:awning", "spot:banner_pole", "spot:lanterns"]) {
          expect(tall.map((b) => b.id), String(style)).toContain(id);
        }
        // Not one painted slice of a tall piece in front of, or behind, a hero's gear.
        for (const piece of tall) for (const mine of gear) expect(shapesOverlap(piece, mine), `${piece.id} over ${mine.id} (${String(style)})`).toBe(false);
        if (stage === 1) continue;
        // At stage 2 the awning stands behind the cookfire, between the tents, and the lanterns and the banner pole at the ends.
        const at = (id: string) => boxes.find((b) => b.id === id)!.anchor;
        expect(at("spot:lanterns")).toBeLessThan(Math.min(...gear.map((b) => b.anchor)));
        expect(at("spot:banner_pole")).toBeGreaterThan(Math.max(...gear.map((b) => b.anchor)));
        expect(at("tent_1")).toBeLessThan(at("spot:awning"));
        expect(at("tent_2")).toBeGreaterThan(at("spot:awning"));
      }
    });

    it("puts the crew's name under or beside its banner pole, clear of the flag", () => {
      const spots = all.find((s) => s?.some((spot) => spot.pieceId === "kept_crew_banner"));
      const input = { heroes: heroesOf(PARTIES["a mix"]!, null, stage), spots, allSouvenirs: true };
      for (const k of [1, campRowScale(layout, input), 0.6]) {
        const pole = campBoxes(layout, { ...input, figureScale: k }).find((b) => b.id === "spot:banner_pole")!;
        expect(pole.name?.text.replace("\n", " ")).toBe("The Bartholomewzzzzz crew");
        const name = labelRect(pole.name!);
        // Never on the painting: under the foot, or on the grass beside the pole below the flag.
        expect(shapesOverlap({ ...pole, slices: [name], x: (name.l + name.r) / 2, width: name.r - name.l, ground: name.b, height: name.b - name.t }, pole)).toBe(false);
        expect(name.t >= pole.ground || name.b <= pole.ground).toBe(true);
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
        const input = { heroes: heroesOf(species, null, stage), spots: all[0], allSouvenirs: true };
        const boxes = campBoxes(layout, { ...input, beside, figureScale: campRowScale(layout, input) });
        expect(boxes.filter((b) => b.kind === "beside")).toHaveLength(3);
        expect(campOverlaps(boxes)).toEqual([]);
        expect(campLabelClashes(boxes)).toEqual([]);
      }
    });

    it("draws a party's row smaller only when its gear is too big for the spots", () => {
      for (const s of SPECIES) {
        const k = campRowScale(layout, { heroes: heroesOf([s, s, s, s], null, stage), spots: all[0], allSouvenirs: true });
        expect(k, s).toBeGreaterThanOrEqual(minRow);
        expect(k, s).toBeLessThanOrEqual(1);
      }
      expect(layout.canvas.height).toBe(1080);
    });
  });
}
