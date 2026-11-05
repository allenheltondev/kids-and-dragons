// @vitest-environment jsdom
/**
 * The trailhead's line on the lobby's own camp (docs/camp.md §8.5, §8.6),
 * frame by frame against the fake stage, with the real layout
 * (assets/manifest.json → camp), the real heroes' sizes and the lobby's real
 * insets. What the TV lobby's screenshots caught: heroes who readied and took
 * it back in the same frame piled up at the trailhead, the bigfoot at the
 * front cut off by the screen's edge and the rest hidden behind him.
 *
 * Every frame holds §8.6's rules for the line: no two figures in one lane
 * stand inside each other (rule 4), and every figure that can be seen is
 * wholly inside the part of the painting the pane shows.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Application, Texture } from "pixi.js";
import { fakeApp, installFakeCanvas2D, type FakeApp } from "../testing/fake-stage";
import { BOX_FILL, STEP_OUT_S, createCamp, type CampFigure, type CampFigureView, type CampStage } from "./camp";
import { campFit, campVisibleSpan, campWindow, type CampSpan } from "./camp-framing";
import { NOMINAL_PAINT, paintAspect } from "./figure-scale";
import { FIGURE_SIZES } from "./figure-sizes";
import { lobbyCampLayout } from "./lobby-camp";

beforeAll(installFakeCanvas2D);

const layout = lobbyCampLayout()!;
const W = layout.canvas.width;
const cm = (species: string) => FIGURE_SIZES[`characters/${species}`]![0];

/** The TV lobby's party, in seat order: the e2e table's four heroes. */
const PARTY: CampFigure[] = [
  { id: "unicorn", url: null, heightCm: cm("unicorn"), stance: "standing", seat: 0 },
  { id: "griffin", url: null, heightCm: cm("griffin"), stance: "standing", seat: 1 },
  { id: "dragonling", url: null, heightCm: cm("dragonling"), stance: "standing", seat: 2 },
  { id: "bigfoot", url: null, heightCm: cm("bigfoot"), stance: "standing", seat: 3 },
];

/** Panes and the lobby's header reach and panel height over them, px (camp-framing.test.ts measures these). */
const PANES = [
  { name: "a 1280 × 720 TV", width: 1280, height: 720, top: 65, bottom: 446 },
  { name: "a 1024 × 600 TV", width: 1024, height: 600, top: 55, bottom: 372 },
  { name: "a 390 × 844 phone's World pane", width: 390, height: 668, top: 35, bottom: 348 },
  // Short panels: the painting is drawn so big that the line takes two rows.
  { name: "a phone's World pane under short panels", width: 390, height: 668, top: 35, bottom: 160 },
] as const;

const noArt = (): Promise<Texture> => Promise.reject(new Error("no art in tests"));

interface Table {
  camp: CampStage;
  app: FakeApp;
  span: CampSpan;
}

function table(pane: (typeof PANES)[number], still: boolean, seed = 7): Table {
  const app = fakeApp();
  const camp = createCamp(app as unknown as Application, layout, { seed, still, loadTexture: noArt });
  camp.resize(pane.width, pane.height);
  camp.setInset(pane.bottom, pane.top);
  camp.setFigures(PARTY);
  const fit = campFit(pane.width, campWindow(pane.height, pane.top, pane.bottom), layout, PARTY.map((f) => f.heightCm));
  // Settled into its frame and faded in.
  for (let i = 0; i < 180; i++) app.ticker.frame(16);
  return { camp, app, span: campVisibleSpan(pane.width, fit.framing, W) };
}

/** A figure's drawn width this frame, canvas px. */
const widthOf = (view: CampFigureView) => view.heightPx * paintAspect(NOMINAL_PAINT);

/** §8.6 for the line, this frame: nobody inside a lane-mate, nobody cut off by the screen's edge. */
function clean(views: CampFigureView[], span: CampSpan, when: string): void {
  const seen = views.filter((v) => v.alpha > 0.1);
  for (const v of seen) {
    const half = widthOf(v) / 2;
    expect(v.x - half, `${when}: ${v.id} cut off at the left edge`).toBeGreaterThanOrEqual(span.x0 * W - 1);
    expect(v.x + half, `${when}: ${v.id} cut off at the right edge`).toBeLessThanOrEqual(span.x1 * W + 1);
  }
  for (const [i, a] of seen.entries()) {
    for (const b of seen.slice(i + 1)) {
      if (!a.lane || a.lane !== b.lane) continue;
      const apart = Math.abs(a.x - b.x);
      const room = (BOX_FILL * (widthOf(a) + widthOf(b))) / 2;
      expect(apart, `${when}: ${a.id} and ${b.id} stand inside each other on the ${a.lane} lane`).toBeGreaterThanOrEqual(room - 1);
    }
  }
}

function run(t: Table, seconds: number, label: string, each?: (views: CampFigureView[], at: number) => void): void {
  for (let i = 0; i < Math.round((seconds * 1000) / 16); i++) {
    t.app.ticker.frame(16);
    const views = t.camp.figures();
    clean(views, t.span, `${label} ${((i + 1) * 0.016).toFixed(2)}s`);
    each?.(views, (i + 1) * 0.016);
  }
}

const view = (t: Table, id: string) => t.camp.figures().find((f) => f.id === id)!;

/** Everybody readies in one frame, the way a state with every `ready` flipped arrives; then the line has formed. */
function lineUp(t: Table, order: readonly string[], label: string): void {
  for (const id of order) t.camp.moment("ready", id);
  run(t, 30, label);
  const trail = layout.frame.trailhead;
  const line = order.map((id) => view(t, id));
  for (const hero of line) {
    expect(hero.walking, `${label}: ${hero.id} still on its way`).toBe(false);
    expect(hero.point, `${label}: ${hero.id} in the line, not at a stand point`).toBeNull();
    expect(hero.alpha).toBeGreaterThan(0.95);
  }
  // The first tap at the front, on the trailhead's lane; a pane too narrow for
  // the whole party gets a second row behind it, the later taps.
  expect(line[0]!.lane).toBe(trail.lane);
  const rows = [...new Set(line.map((hero) => hero.lane))];
  expect(line.map((hero) => rows.indexOf(hero.lane))).toEqual([...line.map((hero) => rows.indexOf(hero.lane))].sort());
  // In tap order along each row, front first, each one behind the one before it with room to spare.
  for (const lane of rows) {
    const row = line.filter((hero) => hero.lane === lane);
    for (let i = 1; i < row.length; i++) {
      const [front, back] = [row[i - 1]!, row[i]!];
      expect(front.x - back.x, `${label}: ${back.id} behind ${front.id}`).toBeGreaterThanOrEqual((widthOf(front) + widthOf(back)) / 2 - 1);
    }
  }
  if (rows.length > 1) expect(label).toContain("short panels");
}

for (const still of [false, true]) {
  describe(`the trailhead's line on the lobby's camp${still ? ", in reduced motion" : ""}`, () => {
    for (const pane of PANES) {
      it(`forms in tap order on ${pane.name} when everyone readies in one frame, through nobody and all on screen`, () => {
        for (const order of [PARTY.map((f) => f.id), PARTY.map((f) => f.id).reverse(), ["dragonling", "bigfoot", "unicorn", "griffin"]]) {
          const t = table(pane, still);
          lineUp(t, order, `${pane.name}, ${order.join(" ")}`);
          t.camp.destroy();
        }
      });

      it(`lets everyone out promptly on ${pane.name} when they all take back Ready in one frame, and nobody piles up`, () => {
        const t = table(pane, still);
        const order = PARTY.map((f) => f.id);
        lineUp(t, order, pane.name);
        const placed = new Map(order.map((id) => [id, view(t, id)]));
        for (const id of order) t.camp.moment("unready", id);
        // Within a few seconds of camp time every hero is out of its place in the
        // line (at a stand point, walking, fading, or somewhere else), and nobody
        // stood inside anybody on the way.
        run(t, STEP_OUT_S + 1.5, `${pane.name}, taking back Ready`);
        for (const id of order) {
          const now = view(t, id);
          const was = placed.get(id)!;
          const moved = now.lane !== was.lane || Math.abs(now.x - was.x) > widthOf(was) / 2;
          const left = now.point !== null || now.walking || now.alpha < 0.5 || moved;
          expect(left, `${id} is still standing in the line`).toBe(true);
        }
        // And back to the camp: each at a stand point of its own, seen whole.
        run(t, 30, `${pane.name}, back in camp`);
        const settled = t.camp.figures().filter((f) => !f.walking);
        const points = settled.map((f) => f.point).filter((p): p is string => p !== null);
        expect(new Set(points).size).toBe(points.length);
        if (still) {
          expect(points.length).toBe(PARTY.length);
          for (const f of t.camp.figures()) expect(f.alpha).toBeGreaterThan(0.95);
        }
        t.camp.destroy();
      });
    }

    it("lines up and lets go again and again without anybody piling up", () => {
      const t = table(PANES[0], still, 2026);
      const ids = PARTY.map((f) => f.id);
      for (let round = 0; round < 3; round++) {
        for (const id of ids) t.camp.moment("ready", id);
        run(t, 4 + round, `round ${round}, ready`);
        for (const id of ids) t.camp.moment("unready", id);
        run(t, 3 + round, `round ${round}, unready`);
      }
      // The e2e table's order of things: readied one at a time, then all taken back.
      for (const id of ids) {
        t.camp.moment("ready", id);
        run(t, 1.5, `${id} readies`);
      }
      for (const id of ids) t.camp.moment("unready", id);
      run(t, 20, "all taken back");
      t.camp.destroy();
    });
  });
}

describe("the lobby's camp on a phone's World pane", () => {
  it("wanders only where the pane shows a hero whole", () => {
    const t = table(PANES[2], false, 31);
    run(t, 120, "wandering");
    t.camp.destroy();
  });
});
