// @vitest-environment jsdom
/**
 * A hero's own gear fits that hero (docs/camp.md §4.5; camp-ownership.ts), in
 * both renderers: the moving camp (camp.ts, Pixi) and the still one
 * (StillCamp.tsx, which a phone's Camp panel draws too). For every species a
 * hero can be, her bedroll is longer than she is and her tent bigger, judged
 * on the same lane as she rests on; and a bigfoot's gear is about 215/85 of a
 * kitsune's.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Application, Container, Texture } from "pixi.js";
import { cleanup, render } from "@testing-library/react";
import type { CampView, RunState, SpeciesId } from "@kad/shared";
import { makeCharacter, makeMember, makeState } from "../testing/fixtures";
import { fakeApp, installFakeCanvas2D } from "../testing/fake-stage";
import { createCamp } from "./camp";
import { campLayoutFor } from "./lobby-camp";
import { BEDROLL_LENGTH_FIT, HERO_PAINT, TENT_HEIGHT_FIT, TENT_WIDTH_FIT } from "./camp-ownership";
import { standInSize } from "./camp-stand-in";
import { CAMP_KIT_STYLES, campKitStyle } from "./camp-kit-art";
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

/** The moving camp: her drawn box, and her bedroll's and tent's, in canvas px on her own lane. */
async function pixiFit(species: string): Promise<Fit> {
  const id = `c_${species}`;
  const figure = { id, url: null, heightCm: heightOf(species), stance: "standing" as const, seat: 0, species, accent: "#E0C470", name: "Hero" };
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
      const style = CAMP_KIT_STYLES[campKitStyle(id, null)];
      const base = layout.frame.pieces.find((p) => p.id === "bedroll_0")!;
      const heightPx = (0.26 * 1080 * (base.heightCm ?? 40)) / 160;
      const height = heightPx * piece.scale.y;
      out.bedroll = { height, length: (height * style.paintWidth) / style.paintHeight };
    } else {
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
function stillFit(species: string): Fit {
  const id = `c_${species}`;
  const party = [makeMember({ character: makeCharacter({ id, ownerPlayerId: "p_1", species: species as SpeciesId, name: "Hero" }), playerId: "p_1" })];
  const out: Partial<Fit> = {};
  const PAINT = ANCHOR_Y - NOMINAL_PAINT.top;
  for (const stage of [1, 2]) {
    const state = { ...makeState({ phase: "lobby", party }), camp: campView(stage) } as RunState;
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
      const el = document.querySelector(`[data-piece="tent_0"]`)!;
      const height = pct(el) * PAINT;
      out.tent = { height, width: height * Number(el.getAttribute("data-aspect")) };
    }
    cleanup();
  }
  return out as Fit;
}

describe("a hero's own gear fits her (camp-ownership.ts)", () => {
  for (const [renderer, measure] of [["the moving camp", pixiFit], ["the still camp", async (s: string) => stillFit(s)]] as const) {
    describe(renderer, () => {
      for (const species of SPECIES) {
        it(`a ${species}'s bedroll is longer than she is, and her tent bigger`, async () => {
          const fit = await measure(species);
          const body = Math.max(fit.bedrollHero.height, fit.bedrollHero.width);
          expect(fit.bedroll.length / body, "bedroll over her body length").toBeGreaterThanOrEqual(1.15);
          expect(fit.bedroll.length / body).toBeLessThanOrEqual(BEDROLL_LENGTH_FIT + 0.06);
          expect(fit.tent.height / fit.hero.height, "tent over her height").toBeGreaterThanOrEqual(1.2);
          expect(fit.tent.height / fit.hero.height).toBeLessThanOrEqual(TENT_HEIGHT_FIT + 0.06);
          expect(fit.tent.width / fit.hero.width, "tent over her width").toBeGreaterThanOrEqual(TENT_WIDTH_FIT - 1e-3);
        });
      }

      it("draws a bigfoot's tent and bedroll about 215/85 of a kitsune's", async () => {
        const big = await measure("bigfoot");
        const small = await measure("kitsune");
        const ratio = heightOf("bigfoot") / heightOf("kitsune");
        expect(big.tent.height / small.tent.height).toBeCloseTo(ratio, 1);
        // Her bedroll fits her body length: a bigfoot's is her height, a kitsune's her (longer) width.
        expect(big.bedroll.length / small.bedroll.length).toBeGreaterThan(ratio * 0.9);
        expect(big.bedroll.length / small.bedroll.length).toBeLessThan(ratio * 1.1);
      });
    });
  }
});
