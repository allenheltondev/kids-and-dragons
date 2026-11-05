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
import {
  EDGE_KEEP_TOP,
  EDGE_MAX_SHARE,
  TALL_KEEP_TOP,
  TALL_MAX_COVERED,
  campBoxes,
  campCoverClashes,
  campCoveredShare,
  campDoorBoxes,
  campEdgeClashes,
  campEdgeShare,
  campFitFor,
  campLabelClashes,
  campOverlaps,
  campRowScale,
  campStandBoxes,
  labelRect,
  labelsOf,
  pieceKeepTop,
  rectOf,
  shapesOverlap,
  type CampBox,
  type CampBoxInput,
} from "./camp-boxes";
import { CAMP_KIT_STYLES } from "./camp-kit-art";
import { campPaint } from "./camp-paint";
import { CREW_PIECE_ART, TENT_ART, campSpots, pieceArt, pieceName } from "./camp-scene";
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
 * tent is taller than its hero and, with its guy ropes, far wider; the four
 * stand on two lanes (the outer two on the back lane, the inner two in front),
 * an inner tent's side in front of its neighbour's but never over its door,
 * with the awning between the inner two (their sides may stand in front of its
 * feet) and the lanterns and the banner pole at the ends on the near lane (each
 * may stand in front of the outer edge of the tent behind it). The small
 * parties are drawn nearly full size, even in their roomier tents, and four
 * bigfoots in their widest tents, or a bigfoot in an inner seat, go down to
 * about 0.64, never piled up and never under the floor (`MIN_FIGURE_SCALE`).
 */
const STAGES = [
  { stage: 1, minRow: 0.75, smallRow: 0.85, grownBy: [] as string[], styles: Object.keys(CAMP_KIT_STYLES) },
  { stage: 2, minRow: 0.6, smallRow: 0.95, grownBy: ["gemfall", "riftlight"], styles: TENT_ART.map((t) => t.id) },
] as const;
/** The small parties, drawn nearly full size at either stage (how near: each stage's `smallRow`). */
const SMALL = ["four kitsune", "four of kitsune", "four of dragonling"];
/** The small heroes, whose tents are roomier (camp-ownership.ts `tentHeightFit`). */
const SMALL_SPECIES = ["kitsune", "dragonling"];

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

describe("the lanterns and the banner pole in front of a farther tent's outer edge (#620)", () => {
  // Two tents, so the camp has a middle (x 960), and the lanterns on a nearer lane at the left one.
  const tent = (x: number, seat: number): CampBox => ({ id: `tent_${String(seat)}`, kind: "tent", lane: "back", seat, x, anchor: x, ground: 600, width: 200, height: 200, label: null });
  const lanterns = (x: number, height = 90, width = 40): CampBox => ({ id: "spot:lanterns", kind: "spot", lane: "middle", x, anchor: x, ground: 640, width, height, label: null, keepTop: TALL_KEEP_TOP });
  const camp = (piece: CampBox) => [tent(500, 0), tent(1420, 3), piece];

  it("allows its outer quarter, below its top half", () => {
    // The tent spans 400 to 600; its outer quarter is 400 to 450, its top half above 500.
    expect(campOverlaps(camp(lanterns(420)))).toEqual([]);
    expect(campEdgeShare(camp(lanterns(420)), "tent_0")).toBeCloseTo(40 / 200);
  });

  it("refuses more than a quarter of its width, its ridge, or its inner side", () => {
    expect(campEdgeClashes(camp(lanterns(440)))).toEqual([["spot:lanterns", "tent_0"]]);
    expect(campEdgeClashes(camp(lanterns(420, 160)))).toEqual([["spot:lanterns", "tent_0"]]);
    expect(campEdgeClashes(camp(lanterns(580)))).toEqual([["spot:lanterns", "tent_0"]]);
  });

  it("never lets them stand over a hero at her door or her souvenir line", () => {
    const door: CampBox = { id: "door:tent_0", kind: "door", lane: "back", seat: 0, x: 420, anchor: 420, ground: 600, width: 40, height: 100, label: null };
    expect(campOverlaps([...camp(lanterns(420)), door])).toContainEqual(["spot:lanterns", "door:tent_0"]);
    const line: CampBox = { id: "souvenirs_0", kind: "owned", lane: "back", seat: 0, x: 420, anchor: 420, ground: 600, width: 40, height: 60, label: null };
    expect(campOverlaps([...camp(lanterns(420)), line])).toContainEqual(["spot:lanterns", "souvenirs_0"]);
  });

  it("is only theirs: the awning and the shorter pieces may not stand in front of a farther tent's edge", () => {
    expect(campOverlaps(camp({ ...lanterns(420), id: "spot:awning" }))).toEqual([["tent_0", "spot:awning"]]);
  });
});

describe("a banner pole's pennant (#620)", () => {
  it("is kept whole, however far below the pole's top half its streamers hang", () => {
    // The weathervane's streamers hang to about two thirds of the way down; the crew's flag and the pinwheel stay in the top half.
    expect(pieceKeepTop("banner_pole", "shop_weathervane_pole")).toBeGreaterThan(0.65);
    expect(pieceKeepTop("banner_pole", "kept_crew_banner")).toBe(TALL_KEEP_TOP);
    expect(pieceKeepTop("banner_pole", "shop_pinwheel_pole")).toBe(TALL_KEEP_TOP);
    expect(pieceKeepTop("lanterns", "shop_lantern_arch")).toBe(TALL_KEEP_TOP);
    for (const piece of CREW_PIECE_ART.filter((p) => p.hotspot === "banner_pole")) {
      const base = campPaint(piece.path)!;
      for (const part of pieceArt(piece.id)!.movingParts!.filter((m) => m.motion === "ripple")) {
        const pennant = campPaint(part.path);
        expect(pennant, part.path).toBeTruthy();
        expect(pieceKeepTop("banner_pole", piece.id), piece.id).toBeGreaterThanOrEqual((pennant!.bottom - base.top) / (base.bottom - base.top) - 1e-9);
      }
    }
  });

  it("is never covered by a nearer tent, even below the pole's top half", () => {
    const layout = campLayout(parsed, "open_plains", 2);
    const spots = campSpots(layout, { placed: { banner_pole: "shop_weathervane_pole" }, grownBy: ["gemfall", "riftlight"] }, { crewName: "The crew" }).map((spot) => {
      if (spot.id !== "banner_pole") return spot;
      const art = CREW_PIECE_ART.find((p) => p.id === "shop_weathervane_pole")!;
      return { ...spot, pieceId: art.id, label: pieceName(art.id), heightCm: art.heightCm, widthCm: art.widthCm ?? art.heightCm, banner: null };
    });
    const pole = campBoxes(layout, { heroes: [], spots }).find((b) => b.id === "spot:banner_pole")!;
    // A nearer tent reaching up to 62% of the pole's height from its top: under the half, over the streamers.
    const top = pole.ground - pole.height * (1 - 0.62);
    const streamers = (pole.slices ?? [rectOf(pole)]).find((s) => s.t < top && s.b > top)!;
    const nearer: CampBox = { id: "tent_3", kind: "tent", lane: "near", seat: 3, x: streamers.r - 5, anchor: streamers.r - 5, ground: pole.ground + 20, width: 10, height: pole.ground + 20 - top, label: null };
    expect(campCoverClashes([pole, nearer])).toEqual([["spot:banner_pole", "tent_3"]]);
    // With only the top half kept, as before #620's pennant rule, the same tent would have passed.
    expect(campCoverClashes([{ ...pole, keepTop: TALL_KEEP_TOP }, nearer])).toEqual([]);
  });
});

it("has every piece's true width in the manifest: its painting's, at its height", () => {
  for (const piece of CREW_PIECE_ART) {
    expect(piece.widthCm, piece.id).toBeGreaterThan(0);
    const paint = campPaint(piece.path);
    if (!paint) continue;
    const painted = (piece.heightCm * (paint.right - paint.left)) / (paint.bottom - paint.top);
    expect(Math.abs(piece.widthCm! - painted), `${piece.id} widthCm (painted ${painted.toFixed(0)} cm wide at ${String(piece.heightCm)} cm)`).toBeLessThanOrEqual(1);
  }
});

for (const { stage, minRow, smallRow, grownBy, styles } of STAGES) {
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
            if (SMALL.includes(name)) expect(campRowScale(layout, input), "a small party is drawn nearly full size").toBeGreaterThanOrEqual(smallRow);
            expect(campRowScale(layout, input), "never drawn much smaller to fit the row").toBeGreaterThanOrEqual(minRow);
            // Every hero at her tent's door too (stage 2): nothing on her lane or a nearer one covers her.
            const boxes = [...campBoxes(layout, { ...input, figureScale: fit.figureScale }), ...campDoorBoxes(layout, { heroes, figureScale: fit.figureScale })];
            expect(gearOf(boxes)).toHaveLength(4);
            expect(boxes.filter((b) => b.kind === "door")).toHaveLength(stage === 2 ? 4 : 0);
            // ...and whoever goes to look at a tall shared piece is never hidden by a nearer tent.
            const stands = campStandBoxes(layout, { heroes, figureScale: fit.figureScale });
            expect(stands.length).toBeGreaterThanOrEqual(stage === 2 ? 3 : 2);
            expect(campOverlaps([...boxes, ...stands])).toEqual([]);
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
        // Not one painted slice of a tall piece in front of, or beside, a hero's gear: only behind a
        // nearer tent (stage 2), and then only as much as `campCoverClashes` allows, or (the lanterns
        // and the banner pole) in front of a farther tent's outer edge, as `campEdgeClashes` allows.
        for (const piece of tall) {
          for (const mine of gear) {
            if (!shapesOverlap(piece, mine) || piece.ground < mine.ground) continue;
            expect(["spot:lanterns", "spot:banner_pole"], `${piece.id} over ${mine.id} (${String(style)})`).toContain(piece.id);
            expect(mine.kind, `${piece.id} over ${mine.id} (${String(style)})`).toBe("tent");
            expect(piece.ground, `${piece.id} over ${mine.id} (${String(style)})`).toBeGreaterThan(mine.ground);
          }
        }
        expect(campCoverClashes(boxes)).toEqual([]);
        expect(campEdgeClashes(boxes)).toEqual([]);
        if (stage === 1) continue;
        // At stage 2 the awning stands behind the cookfire, between the tents, and the lanterns and the banner pole at the ends.
        const at = (id: string) => boxes.find((b) => b.id === id)!.anchor;
        expect(at("spot:lanterns")).toBeLessThan(Math.min(...gear.map((b) => b.anchor)));
        expect(at("spot:banner_pole")).toBeGreaterThan(Math.max(...gear.map((b) => b.anchor)));
        expect(at("tent_1")).toBeLessThan(at("spot:awning"));
        expect(at("tent_2")).toBeGreaterThan(at("spot:awning"));
      }
    });

    it("lets a tall shared piece stand partly behind a nearer tent, still reading as itself (#620)", () => {
      // The owner's rule: never behind or in front of a hero at her door, at most half of it covered,
      // none of its top half (the flag, the vane, the lamps, the canopy), and whoever looks at it seen whole.
      let behind = 0;
      for (const species of Object.values(PARTIES)) {
        for (const style of [null, ...styles]) {
          for (const spots of style === null ? all : all.slice(0, 2)) {
            const input = { heroes: heroesOf(species, style, stage), spots, allSouvenirs: true };
            const k = campRowScale(layout, input);
            const boxes = campBoxes(layout, { ...input, figureScale: k });
            const doors = campDoorBoxes(layout, { heroes: input.heroes, figureScale: k });
            const stands = campStandBoxes(layout, { heroes: input.heroes, figureScale: k });
            const nearerGear = (piece: CampBox) => boxes.filter((b) => b.seat !== undefined && (b.kind === "tent" || b.id.startsWith("souvenirs_")) && b.ground > piece.ground);
            for (const piece of boxes.filter((b) => ["spot:awning", "spot:lanterns", "spot:banner_pole"].includes(b.id))) {
              const at = `${piece.id}, ${species.join("/")} in ${String(style)}`;
              for (const door of doors) expect(shapesOverlap(piece, door), `${at} by ${door.id}`).toBe(false);
              const covering = nearerGear(piece).filter((t) => shapesOverlap(t, piece));
              if (covering.length === 0) continue;
              behind++;
              expect(campCoveredShare(boxes, piece.id), at).toBeLessThan(TALL_MAX_COVERED);
              // Its top half, and all of a banner pole's pennant where it hangs lower.
              const keep = piece.keepTop ?? TALL_KEEP_TOP;
              expect(keep, at).toBeGreaterThanOrEqual(TALL_KEEP_TOP);
              const foot = piece.ground - piece.height * (1 - keep);
              const top = { x: piece.x, width: piece.width, ground: foot, height: piece.height * keep, slices: (piece.slices ?? [rectOf(piece)]).filter((s) => s.t < foot).map((s) => ({ ...s, b: Math.min(s.b, foot) })) };
              for (const tent of covering) expect(shapesOverlap(top, tent), `${at}: its top (${keep.toFixed(2)}) under ${tent.id}`).toBe(false);
            }
            for (const stand of stands) {
              for (const tent of boxes.filter((b) => b.kind === "tent" && b.ground > stand.ground)) expect(shapesOverlap(stand, tent), `${stand.id} hidden by ${tent.id}`).toBe(false);
            }
          }
        }
      }
      if (stage === 2) expect(behind, "the stage-2 layout uses the rule somewhere").toBeGreaterThan(0);
    });

    it("lets the lanterns and the banner pole stand in front of a back tent's outer edge, never its door (#620)", () => {
      // The owner's rule: only in front of the side away from the middle of the camp, at most a quarter
      // of its painted width (its guy ropes and stakes) and none of its top half (its ridge and roof);
      // never over its door, the hero at it, or its souvenir line; the pieces themselves uncovered.
      let edges = 0;
      for (const species of Object.values(PARTIES)) {
        for (const style of [null, ...styles]) {
          for (const spots of style === null ? all : all.slice(0, 2)) {
            const input = { heroes: heroesOf(species, style, stage), spots, allSouvenirs: true };
            const k = campRowScale(layout, input);
            const boxes = campBoxes(layout, { ...input, figureScale: k });
            const doors = campDoorBoxes(layout, { heroes: input.heroes, figureScale: k });
            const tents = boxes.filter((b) => b.kind === "tent");
            const middle = (Math.min(...tents.map((t) => t.anchor)) + Math.max(...tents.map((t) => t.anchor))) / 2;
            for (const piece of boxes.filter((b) => b.id === "spot:lanterns" || b.id === "spot:banner_pole")) {
              const at = `${piece.id}, ${species.join("/")} in ${String(style)}`;
              for (const door of doors) expect(shapesOverlap(piece, door), `${at} over ${door.id}`).toBe(false);
              for (const line of boxes.filter((b) => b.id.startsWith("souvenirs_"))) expect(shapesOverlap(piece, line), `${at} over ${line.id}`).toBe(false);
              for (const tent of tents.filter((t) => t.ground < piece.ground && shapesOverlap(t, piece))) {
                edges++;
                const r = rectOf(tent);
                const outward = tent.anchor < middle ? -1 : 1;
                expect(Math.sign(piece.anchor - tent.anchor), `${at}: on ${tent.id}'s outer side`).toBe(outward);
                expect(campEdgeShare(boxes, tent.id), `${at}: ${tent.id}'s edge`).toBeLessThanOrEqual(EDGE_MAX_SHARE + 1e-9);
                // Its middle half (the door) and its top half (the ridge) untouched.
                const keep = (rect: { l: number; r: number; t: number; b: number }) => ({ x: (rect.l + rect.r) / 2, width: rect.r - rect.l, ground: rect.b, height: rect.b - rect.t, slices: [rect] });
                const door = keep({ l: r.l + (r.r - r.l) * EDGE_MAX_SHARE, r: r.r - (r.r - r.l) * EDGE_MAX_SHARE, t: r.t, b: r.b });
                const ridge = keep({ l: r.l, r: r.r, t: r.t, b: tent.ground - tent.height * (1 - EDGE_KEEP_TOP) });
                const paintOf = (box: CampBox) => ({ ...box, slices: (box.slices ?? [rectOf(box)]).flatMap((s) => (tent.slices ?? [r]).map((t) => ({ l: Math.max(s.l, t.l), r: Math.min(s.r, t.r), t: Math.max(s.t, t.t), b: Math.min(s.b, t.b) })).filter((x) => x.l < x.r && x.t < x.b)) });
                expect(shapesOverlap(paintOf(piece), door), `${at}: ${tent.id}'s door`).toBe(false);
                expect(shapesOverlap(paintOf(piece), ridge), `${at}: ${tent.id}'s ridge`).toBe(false);
              }
              // Nothing stands in front of the piece's own top (its lamps, its flag, its pennant).
              const foot = piece.ground - piece.height * (1 - (piece.keepTop ?? TALL_KEEP_TOP));
              const top = { ...piece, ground: foot, height: piece.height * (piece.keepTop ?? TALL_KEEP_TOP), slices: (piece.slices ?? [rectOf(piece)]).filter((s) => s.t < foot).map((s) => ({ ...s, b: Math.min(s.b, foot) })) };
              for (const other of boxes.filter((b) => b !== piece && b.ground > piece.ground)) expect(shapesOverlap(top, other), `${at}: its top under ${other.id}`).toBe(false);
            }
            expect(campEdgeClashes(boxes), `${species.join("/")} in ${String(style)}`).toEqual([]);
          }
        }
      }
      if (stage === 2) expect(edges, "the stage-2 layout uses the rule somewhere").toBeGreaterThan(0);
    });

    it("stands every hero at her door below her tent's top, a small hero's ears clearly so (#620)", () => {
      if (stage === 1) return;
      for (const species of [...Object.values(PARTIES), ["kitsune", "dragonling", "kitsune", "dragonling"]]) {
        for (const style of styles) {
          const input = { heroes: heroesOf(species, style, stage), spots: all[0], allSouvenirs: true };
          const k = campRowScale(layout, input);
          const boxes = campBoxes(layout, { ...input, figureScale: k });
          for (const door of campDoorBoxes(layout, { heroes: input.heroes, figureScale: k })) {
            const tent = boxes.find((b) => b.kind === "tent" && b.seat === door.seat)!;
            const s = species[door.seat!]!;
            // Her feet on her tent's own ground (no perspective lift), her head under its top.
            expect(door.ground, `${s} at ${tent.id}`).toBe(tent.ground);
            const room = SMALL_SPECIES.includes(s) ? 0.15 : 0.05;
            expect(tent.height - door.height, `${s} in a ${style} tent: head room`).toBeGreaterThanOrEqual(room * door.height - 0.5);
          }
        }
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
        const k = campRowScale(layout, input);
        const boxes = [...campBoxes(layout, { ...input, beside, figureScale: k }), ...campDoorBoxes(layout, { heroes: input.heroes, figureScale: k })];
        expect(boxes.filter((b) => b.kind === "beside")).toHaveLength(3);
        expect(campOverlaps([...boxes, ...campStandBoxes(layout, { heroes: input.heroes, figureScale: k })])).toEqual([]);
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
