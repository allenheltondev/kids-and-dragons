// @vitest-environment jsdom
/**
 * A hero's own gear fits that hero (docs/camp.md §4.5; camp-ownership.ts), in
 * both renderers: the moving camp (camp.ts, Pixi) and the still one
 * (StillCamp.tsx, which a phone's Camp panel draws too). For every species a
 * hero can be, in every bedroll style and every tent, her bedroll is longer
 * than she is and her tent bigger (taller and wider, the patched lean-to and
 * the milestone tents too: a tent always stands taller than its hero), judged on the same lane as she rests on and on the painting's real
 * footprint (camp-paint.ts); and a bigfoot's gear is about 215/85 of a
 * kitsune's.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Application, Container, Texture } from "pixi.js";
import { cleanup, render } from "@testing-library/react";
import type { CampView, HeroKitView, KitStyleId, RunState, SpeciesId, TentStyleId } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { fakeApp, installFakeCanvas2D } from "../testing/fake-stage";
import { createCamp } from "./camp";
import { campLayoutFor } from "./lobby-camp";
import { BEDROLL_LENGTH_FIT, HERO_PAINT, TENT_HEIGHT_FIT, TENT_WIDTH_FIT } from "./camp-ownership";
import { standInSize } from "./camp-stand-in";
import { CAMP_KIT_STYLES, type CampKitStyle } from "./camp-kit-art";
import { campPaint, campPaintBox } from "./camp-paint";
import { TENT_ART } from "./camp-scene";
import { FIGURE_SIZES } from "./figure-sizes";
import { ANCHOR_Y } from "./art-paths";
import { NOMINAL_PAINT } from "./figure-scale";
import { StillCamp } from "./StillCamp";

beforeAll(installFakeCanvas2D);
afterEach(cleanup);

const SPECIES = Object.keys(FIGURE_SIZES).filter((id) => id.startsWith("characters/")).map((id) => id.slice("characters/".length));
const heightOf = (species: string): number => FIGURE_SIZES[`characters/${species}`]![0];
const noArt = (): Promise<Texture> => Promise.reject(new Error("not painted yet"));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

/** A kit: a bedroll style, and a tent (a catalog tent is its style's own). */
interface Kit {
  style: CampKitStyle;
  tent: string;
}
const KITS: Kit[] = TENT_ART.map((t) => ({ style: (t.kit ?? "rolled") as CampKitStyle, tent: t.id }));

interface Fit {
  /** Her drawn box at stage 2, beside her tent, and at stage 1, beside her bedroll (the two may be on different lanes). */
  hero: { height: number; width: number };
  bedrollHero: { height: number; width: number };
  bedroll: { height: number; length: number };
  tent: { height: number; width: number };
}

const find = (root: Container, label: string): Container | undefined => {
  if (root.label === label) return root;
  for (const child of root.children) {
    const hit = find(child as Container, label);
    if (hit) return hit;
  }
  return undefined;
};

const tentPath = (tent: string): string => TENT_ART.find((t) => t.id === tent)!.path;

/** The moving camp: her drawn box, and her bedroll's and tent's, in canvas px on her own lane. */
async function pixiFit(species: string, kit: Kit): Promise<Fit> {
  const id = `c_${species}`;
  const figure = { id, url: null, heightCm: heightOf(species), stance: "standing" as const, seat: 0, species, accent: "#E0C470", name: "Hero", kitStyle: kit.style, tent: kit.tent };
  const out: Partial<Fit> = {};
  for (const stage of [1, 2]) {
    const layout = campLayoutFor(stage)!;
    const app = fakeApp();
    const camp = createCamp(app as unknown as Application, layout, { still: true, loadTexture: noArt });
    camp.resize(1920, 1080);
    camp.setFigures([figure]);
    await settle();
    app.ticker.frame(16);
    const me = camp.figures().find((f) => f.id === id)!;
    const paint = HERO_PAINT[species]!;
    // Her nominal paint is her drawn height (camp.ts fitArt); her painting covers HERO_PAINT of it.
    out[stage === 1 ? "bedrollHero" : "hero"] = { height: me.heightPx * paint.height, width: me.heightPx * paint.width };
    const rest = layout.frame.standPoints.find((p) => p.seat === 0)!;
    expect(me.lane, "she rests on her gear's own lane").toBe(layout.frame.pieces.find((p) => p.id === rest.hotspot)!.lane);
    if (stage === 1) {
      const piece = find(camp.view, "piece:bedroll_0")!;
      const style = CAMP_KIT_STYLES[kit.style];
      const base = layout.frame.pieces.find((p) => p.id === "bedroll_0")!;
      const heightPx = (0.26 * 1080 * (base.heightCm ?? 40)) / 160;
      const height = heightPx * piece.scale.y;
      out.bedroll = { height, length: (height * style.paintWidth) / style.paintHeight };
    } else {
      // Her tent's painting is owed here, so it is its stand-in, drawn at the painting's own shape.
      const piece = find(camp.view, "piece:tent_0")!;
      const size = standInSize(find(piece, "camp-stand-in:tent")!)!;
      out.tent = { height: size.height * piece.scale.y, width: size.width * piece.scale.x };
    }
    camp.destroy();
  }
  return out as Fit;
}

const campView = (stage: number): CampView => ({ revision: 1, frameStage: stage as CampView["frameStage"], grownBy: stage > 1 ? ["gemfall"] : [], dashCash: 0, owned: [], placed: {}, friends: [], buddies: {}, shopOpen: false });

/** The still camp: the same, from the percentages it places its images at. */
function stillFit(species: string, kit: Kit): Fit {
  const id = `c_${species}`;
  const party = [makeMember({ character: makeCharacter({ id, ownerPlayerId: "p_1", species: species as SpeciesId, name: "Hero" }), playerId: "p_1" })];
  const kits: Record<string, HeroKitView> = { [id]: { revision: 1, style: kit.style as KitStyleId, tent: kit.tent as TentStyleId, color: null, slots: [], unlocked: [] } };
  const out: Partial<Fit> = {};
  const PAINT = ANCHOR_Y - NOMINAL_PAINT.top;
  for (const stage of [1, 2]) {
    const state = { ...makeState({ phase: "lobby", party }), camp: campView(stage), kits } as RunState;
    render(<StillCamp layout={campLayoutFor(stage)!} state={state} insets={{ top: 0, bottom: 0 }} />);
    const pct = (el: Element | null) => parseFloat((el as HTMLElement).style.height) / 100;
    const hero = pct(document.querySelector(`[data-hero="${id}"]`)) * PAINT;
    const paint = HERO_PAINT[species]!;
    out[stage === 1 ? "bedrollHero" : "hero"] = { height: hero * paint.height, width: hero * paint.width };
    if (stage === 1) {
      const el = document.querySelector(`[data-piece="bedroll_0"]`)!;
      const style = CAMP_KIT_STYLES[el.querySelector("[data-camp-kit]")!.getAttribute("data-camp-kit") as keyof typeof CAMP_KIT_STYLES];
      out.bedroll = { height: pct(el) * style.paintHeight, length: pct(el) * style.paintWidth };
    } else {
      // Her tent's canvas, as a share of the frame, times the share of it its painting covers.
      const el = document.querySelector(`[data-piece="tent_0"]`)!;
      const painted = campPaint(tentPath(kit.tent))!;
      const height = pct(el) * (painted.bottom - painted.top);
      out.tent = { height, width: height * Number(el.getAttribute("data-aspect")) };
    }
    cleanup();
  }
  return out as Fit;
}

describe("a hero's own gear fits her (camp-ownership.ts)", () => {
  for (const [renderer, measure] of [["the moving camp", pixiFit], ["the still camp", async (s: string, kit: Kit) => stillFit(s, kit)]] as const) {
    describe(renderer, () => {
      for (const species of SPECIES) {
        it(`a ${species}'s bedroll is longer than she is, and her tent bigger, in every style`, async () => {
          for (const kit of KITS) {
            const fit = await measure(species, kit);
            const at = `${kit.style} bedroll, ${kit.tent} tent`;
            const body = Math.max(fit.bedrollHero.height, fit.bedrollHero.width);
            expect(fit.bedroll.length / body, `bedroll over her body length (${at})`).toBeGreaterThanOrEqual(1.15);
            expect(fit.bedroll.length / body, at).toBeLessThanOrEqual(BEDROLL_LENGTH_FIT + 0.06);
            const aspect = campPaintBox(tentPath(kit.tent), 1)!.width;
            expect(fit.tent.width / fit.tent.height, `the tent drawn at its painting's shape (${at})`).toBeCloseTo(aspect, 2);
            expect(fit.tent.width / fit.hero.width, `tent over her width (${at})`).toBeGreaterThanOrEqual(TENT_WIDTH_FIT - 1e-3);
            // Every tent stands taller than its hero, the patched lean-to and the milestone tents
            // included (#620): its painted height, cloth and poles, over her painted height.
            expect(fit.tent.height / fit.hero.height, `tent over her height (${at})`).toBeGreaterThanOrEqual(TENT_HEIGHT_FIT - 0.02);
            expect(fit.tent.height, `tent taller than she is (${at})`).toBeGreaterThan(fit.hero.height);
          }
        });
      }

      it("stands every tent taller than its hero and every bedroll longer, for every species in every tent style (#620)", async () => {
        // The owner's rule, on its own: no exception for the patched lean-to, whatever its shape.
        expect(KITS.map((k) => k.tent).sort()).toEqual(TENT_ART.map((t) => t.id).sort());
        for (const species of SPECIES) {
          for (const kit of KITS) {
            const fit = await measure(species, kit);
            expect(fit.tent.height, `${species} in a ${kit.tent} tent: its painted height over hers`).toBeGreaterThan(fit.hero.height);
            expect(fit.bedroll.length, `${species} on a ${kit.style} bedroll: longer than she is`).toBeGreaterThan(Math.max(fit.bedrollHero.height, fit.bedrollHero.width));
          }
        }
      });

      it("draws a bigfoot's tent and bedroll about 215/85 of a kitsune's", async () => {
        const ratio = heightOf("bigfoot") / heightOf("kitsune");
        for (const kit of KITS) {
          const big = await measure("bigfoot", kit);
          const small = await measure("kitsune", kit);
          // Each camp draws its one hero at its own figure factor (a bigfoot's wide tent may draw
          // the row a little smaller), so her gear is compared in her own drawn heights, as cm.
          const cm = (px: number, species: string, hero: Fit["hero"]) => (px / hero.height) * HERO_PAINT[species]!.height * heightOf(species);
          const tents = cm(big.tent.height, "bigfoot", big.hero) / cm(small.tent.height, "kitsune", small.hero);
          const bedrolls = cm(big.bedroll.length, "bigfoot", big.bedrollHero) / cm(small.bedroll.length, "kitsune", small.bedrollHero);
          // Fitted to her height, a bigfoot's tent is her height's share bigger; a narrow tent for a
          // wide kitsune is fitted to her width, which is less apart.
          expect(tents, kit.tent).toBeGreaterThan(ratio * 0.75);
          expect(tents, kit.tent).toBeLessThan(ratio * 1.15);
          // Her bedroll fits her body length: a bigfoot's is her height, a kitsune's her (longer) width.
          expect(bedrolls).toBeGreaterThan(ratio * 0.9);
          expect(bedrolls).toBeLessThan(ratio * 1.1);
        }
      });
    });
  }
});

/**
 * The stage-2 tents stand on two lanes (docs/camp.md §8.3), so where a nearer
 * tent's side stands in front of one further back, the nearer must draw in
 * front, in both renderers; and each hero resting at her door draws in front
 * of her own tent. (That no tent covers a hero at her door is camp-boxes.ts's
 * rule, held by camp-boxes.test.ts.)
 */
describe("the staggered stage-2 tents draw in depth order (#620)", () => {
  const layout = campLayoutFor(2)!;
  const laneY = (pieceId: string) => layout.lanes.get(layout.frame.pieces.find((p) => p.id === pieceId)!.lane)!.y;
  const tents = [0, 1, 2, 3].map((seat) => `tent_${String(seat)}`);
  const species = ["bigfoot", "kitsune", "unicorn", "griffin"];

  it("stands the outer two tents on one lane and the inner two on a nearer one", () => {
    expect(laneY("tent_0")).toBe(laneY("tent_3"));
    expect(laneY("tent_1")).toBe(laneY("tent_2"));
    expect(laneY("tent_1")).toBeGreaterThan(laneY("tent_0"));
  });

  it("in the moving camp", async () => {
    const app = fakeApp();
    const camp = createCamp(app as unknown as Application, layout, { still: true, loadTexture: noArt });
    camp.resize(1920, 1080);
    camp.setFigures(species.map((s, seat) => ({ id: `c_${s}`, url: null, heightCm: heightOf(s), stance: "standing" as const, seat, species: s, accent: "#E0C470", name: s })));
    await settle();
    app.ticker.frame(16);
    const z = (label: string) => find(camp.view, label)!.zIndex;
    for (const a of tents) {
      for (const b of tents) if (laneY(a) > laneY(b)) expect(z(`piece:${a}`), `${a} in front of ${b}`).toBeGreaterThan(z(`piece:${b}`));
    }
    species.forEach((s, seat) => expect(z(`figure:c_${s}`), `${s} in front of her tent`).toBeGreaterThan(z(`piece:tent_${String(seat)}`)));
    camp.destroy();
  });

  it("in the still camp", () => {
    const party = species.map((s, i) => makeMember({ character: makeCharacter({ id: `c_${s}`, ownerPlayerId: `p_${String(i)}`, species: s as SpeciesId, name: s }), playerId: `p_${String(i)}` }));
    const state = { ...makeState({ phase: "lobby", party }), camp: campView(2) } as RunState;
    render(<StillCamp layout={layout} state={state} insets={{ top: 0, bottom: 0 }} />);
    const z = (el: Element | null) => Number((el as HTMLElement).style.zIndex);
    const tentZ = (id: string) => z(document.querySelector(`[data-piece="${id}"]`));
    for (const a of tents) {
      for (const b of tents) if (laneY(a) > laneY(b)) expect(tentZ(a), `${a} in front of ${b}`).toBeGreaterThan(tentZ(b));
    }
    species.forEach((s, seat) => expect(z(document.querySelector(`[data-hero="c_${s}"]`)), `${s} in front of her tent`).toBeGreaterThan(tentZ(`tent_${String(seat)}`)));
  });
});
