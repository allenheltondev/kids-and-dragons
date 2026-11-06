// @vitest-environment jsdom
/**
 * The camp stage, frame by frame against the fake stage
 * (testing/fake-stage.ts), the same discipline as scene-motion.test.ts: what
 * the containers do over hand-driven frames, not pixels. The rules are
 * docs/camp.md §8.6; the pure modules hold them as curves, and this holds the
 * wiring to them.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { Sprite, Texture, type Application, type Container } from "pixi.js";
import { campLayoutFixture } from "../testing/camp-fixture";
import { fakeApp, installFakeCanvas2D, type FakeApp } from "../testing/fake-stage";
import { createCamp, type CampFigure, type CampFigureView, type CampStage } from "./camp";
import { ANCHOR_X, ANCHOR_Y } from "./actor-art";
import { laneAt, pieceHeightCm, standPoint } from "./camp-layout";
import { MAX_FRAME_S, campHeightPx, campMeasure } from "./camp-motion";
import { EDGE_MARGIN, MIN_FIGURE_SCALE, campFigureWidth, campFit, campWindow } from "./camp-framing";
import { fitCanvas } from "./figure-scale";
import { campPaint } from "./camp-paint";
import { MAX_WALKERS } from "./camp-wander";
import { CAMP_KIT_STYLES, campKitStyle } from "./camp-kit-art";
import { campOwnedScale } from "./camp-ownership";

beforeAll(installFakeCanvas2D);

it("resizes any owned piece with its hero without moving its ground contact or reloading art", async () => {
  const layout = campLayoutFixture();
  const owned = layout.frame.pieces.find(piece => piece.id === "pack")!;
  owned.ownerSeat = 0;
  const app = fakeApp();
  const urls: string[] = [];
  const stage = createCamp(app as unknown as Application, layout, { still: true, loadTexture: url => {
    urls.push(url);
    return Promise.resolve(Texture.WHITE);
  } });
  stage.resize(1280, 720);
  const hero: CampFigure = { id: "owner", url: null, heightCm: 85, stance: "standing", seat: 0 };
  const ground = stage.view.getChildByLabel("camp-ground") as Container;
  const pack = ground.children.find(child => child.label === "piece:pack")!;
  const fire = ground.children.find(child => child.label === "piece:campfire")!;
  const ratio = () => pack.scale.y / layout.lanes.get(owned.lane)!.scale
    / (fire.scale.y / layout.lanes.get("middle")!.scale);
  stage.setFigures([hero]);
  app.ticker.frame(16);
  await Promise.resolve();
  const at = { x: pack.x, y: pack.y };
  const count = urls.length;
  expect(ratio()).toBeCloseTo(campOwnedScale(hero, campMeasure(1080)));
  stage.setFigures([{ ...hero, heightCm: 215 }]);
  app.ticker.frame(16);
  expect(ratio()).toBeCloseTo(campOwnedScale({ heightCm: 215 }, campMeasure(1080)));
  expect({ x: pack.x, y: pack.y }).toEqual(at);
  expect(urls).toHaveLength(count);
  stage.setFigures([]);
  app.ticker.frame(16);
  expect(ratio()).toBeCloseTo(1);
  stage.destroy();
});

it.each([false, true])("loads a seated hero's kit and retains a bedroll if the variant fails (%s)", async failed => {
  const ownLayout = campLayoutFixture();
  ownLayout.frame.pieces.push({ id: "bedroll_0", path: "camp/frames/stage1/bedroll.png", lane: "back", x: .24 });
  ownLayout.frame.standPoints.find(p => p.seat === 0)!.hotspot = "bedroll_0";
  const urls: string[] = [];
  const stage = createCamp(fakeApp() as unknown as Application, ownLayout, { loadTexture: url => {
    urls.push(url);
    return failed && url.includes("/kits/") ? Promise.reject(new Error("missing")) : Promise.resolve(Texture.WHITE);
  } });
  const hero: CampFigure = { id: "hero-0", url: null, heightCm: 165, stance: "standing", seat: 0, accent: "#55aaff" };
  stage.setFigures([hero]);
  await Promise.resolve();
  await Promise.resolve();
  expect(urls).toContain(CAMP_KIT_STYLES[campKitStyle(hero.id)].path);
  const bed = stage.view.children.flatMap(c => (c as Container).children ?? []).find(c => c.label === "piece:bedroll_0") as Container;
  expect(bed.children.filter(c => c instanceof Sprite)).toHaveLength(1);
  // Its shadow lies on the camp's shadow layer, under it, cast from its art.
  const cast = (stage.view.getChildByLabel("camp-shadows") as Container).getChildByLabel("cast:piece:bedroll_0") as Container;
  expect(cast.children[0]!.label).toBe("camp-ground-shadow");
  expect(cast.getChildByLabel("camp-cast-body", true)).not.toBeNull();
  const count = urls.length;
  stage.setFigures([hero]);
  expect(urls).toHaveLength(count);
  stage.destroy();
});

it("restores an empty bedroll and ignores kit loads from removed or replaced owners", async () => {
  const layout = campLayoutFixture();
  layout.frame.pieces.push({ id: "bedroll_0", path: "camp/frames/stage1/bedroll.png", lane: "back", x: .24, ownerSeat: 0 });
  const neutral = new Texture();
  const requests: ((texture: Texture) => void)[] = [];
  const stage = createCamp(fakeApp() as unknown as Application, layout, { loadTexture: url =>
    url.includes("/kits/") ? new Promise(resolve => requests.push(resolve)) : Promise.resolve(neutral),
  });
  const bed = stage.view.children.flatMap(c => (c as Container).children ?? []).find(c => c.label === "piece:bedroll_0") as Container;
  const art = () => (bed.children.find(child => child instanceof Sprite) as Sprite).texture;
  const hero: CampFigure = { id: "first", url: null, heightCm: 85, stance: "standing", seat: 0, accent: "#55aaff" };
  await Promise.resolve();
  stage.setFigures([hero]);
  const firstKit = new Texture();
  requests[0]!(firstKit);
  await Promise.resolve();
  expect(art()).toBe(firstKit);
  stage.setFigures([]);
  expect(art()).toBe(neutral);
  stage.setFigures([hero]);
  stage.setFigures([{ ...hero, id: "replacement", accent: "#ff9955" }]);
  const replacementKit = new Texture();
  requests[2]!(replacementKit);
  await Promise.resolve();
  requests[1]!(firstKit);
  await Promise.resolve();
  expect(art()).toBe(replacementKit);
  stage.setFigures([hero]);
  stage.setFigures([]);
  requests[3]!(firstKit);
  await Promise.resolve();
  expect(art()).toBe(neutral);
  // Even the same hero returning must not accept an earlier pending request.
  stage.setFigures([hero]);
  stage.setFigures([]);
  stage.setFigures([hero]);
  requests[4]!(firstKit);
  await Promise.resolve();
  expect(art()).toBe(neutral);
  requests[5]!(replacementKit);
  await Promise.resolve();
  expect(art()).toBe(replacementKit);
  stage.destroy();
});

const layout = campLayoutFixture();
const W = layout.canvas.width;
const H = layout.canvas.height;

const CREW: CampFigure[] = [
  { id: "hero-0", url: null, heightCm: 165, stance: "standing", seat: 0 },
  { id: "hero-1", url: null, heightCm: 95, stance: "standing", seat: 1 },
  { id: "hero-2", url: null, heightCm: 215, stance: "standing", seat: 2 },
  { id: "hero-3", url: null, heightCm: 85, stance: "standing", seat: 3 },
  { id: "goat", url: null, heightCm: 45, stance: "standing" },
  { id: "wisp", url: null, heightCm: 20, stance: "hovering" },
];

const noArt = (): Promise<Texture> => Promise.reject(new Error("no art in tests"));

function camp(options: { seed?: number; still?: boolean; figures?: CampFigure[] } = {}): { camp: CampStage; app: FakeApp } {
  const app = fakeApp();
  const stage = createCamp(app as unknown as Application, layout, {
    seed: options.seed ?? 7,
    still: options.still ?? false,
    loadTexture: noArt,
  });
  stage.resize(1600, 900);
  stage.setFigures(options.figures ?? CREW);
  return { camp: stage, app };
}

const byId = (views: CampFigureView[]) => new Map(views.map((v) => [v.id, v]));

/** Run `seconds` of frames, `check(prev, next)` after each. */
function frames(app: FakeApp, stage: CampStage, seconds: number, ms = 16, check?: (prev: Map<string, CampFigureView>, next: Map<string, CampFigureView>) => void): void {
  let prev = byId(stage.figures());
  for (let i = 0; i < Math.round((seconds * 1000) / ms); i++) {
    app.ticker.frame(ms);
    const next = byId(stage.figures());
    check?.(prev, next);
    prev = next;
  }
}

/**
 * Nothing slides (§8.6, rule 1): a standing figure's travel is all in hops,
 * moments included. A figure that has to be somewhere else at once fades out
 * and back in (rule 3), so it may move only while nobody can see it.
 */
function noSlide(prev: Map<string, CampFigureView>, next: Map<string, CampFigureView>): void {
  for (const [id, now] of next) {
    const was = prev.get(id);
    if (!was || CREW.find((f) => f.id === id)?.stance !== "standing") continue;
    const moved = Math.hypot(now.x - was.x, now.y - was.y);
    if (moved > 1e-6 && was.alpha >= 0.02) expect(was.airborne || now.airborne, `${id} slid ${moved}px`).toBe(true);
  }
}

/**
 * Where a hero at the front of the line stands, in canvas px: at the
 * trailhead, or moved in from the screen's edge so all of them is on it.
 */
function frontX(id: string, figureScale = 1): number {
  const hero = CREW.find((f) => f.id === id)!;
  const lane = layout.lanes.get(layout.frame.trailhead.lane)!;
  const width = campFigureWidth(hero.heightCm, lane.scale, figureScale, layout.canvas);
  return Math.min(layout.frame.trailhead.x, lane.x1, 1 - width / 2 - EDGE_MARGIN) * W;
}

describe("the camp stage", () => {
  it("seats every hero on their own bedroll and fades them in", () => {
    const { camp: c, app } = camp();
    const start = byId(c.figures());
    for (const seat of [0, 1, 2, 3]) {
      const hero = start.get(`hero-${seat}`)!;
      const bed = layout.frame.standPoints.find((p) => p.seat === seat)!;
      expect(hero.point).toBe(bed.id);
      expect(hero.x).toBeCloseTo(bed.x * W);
      expect(hero.y).toBeCloseTo(layout.lanes.get(bed.lane)!.y * H);
      expect(hero.alpha).toBe(0);
    }
    frames(app, c, 1);
    for (const view of c.figures()) expect(view.alpha).toBeGreaterThan(0.95);
    c.destroy();
  });

  it("holds the rules of clean motion for two minutes of a full camp", () => {
    const { camp: c, app } = camp({ seed: 2026 });
    const crossings = layout.backdrop.crossings.map((x) => x.x * W);
    let walked = 0;
    let peak = 0;
    frames(app, c, 120, 16, (prev, next) => {
      let walkers = 0;
      const points: string[] = [];
      for (const [id, now] of next) {
        const was = prev.get(id)!;
        const moved = Math.hypot(now.x - was.x, now.y - was.y);
        const standing = CREW.find((f) => f.id === id)!.stance === "standing";
        // Nothing slides: every pixel of a standing figure's travel is in a hop.
        if (standing && moved > 1e-6) expect(was.airborne || now.airborne, `${id} slid ${moved}px`).toBe(true);
        if (moved > 0) walked += moved;
        // Feet on the ground line: on a lane, or on a crossing between two.
        const onLane = laneAt(layout, now.y / H) !== null;
        expect(onLane || crossings.some((x) => Math.abs(x - now.x) < 1e-6), `${id} off the ground`).toBe(true);
        if (now.walking) walkers += 1;
        if (now.point) points.push(now.point);
      }
      peak = Math.max(peak, walkers);
      expect(walkers).toBeLessThanOrEqual(MAX_WALKERS);
      expect(new Set(points).size, `two on one stand point: ${points.join(", ")}`).toBe(points.length);
    });
    expect(walked).toBeGreaterThan(W);
    expect(peak).toBeGreaterThan(0);
    c.destroy();
  });

  it("draws nearer figures in front and slightly bigger", () => {
    const { camp: c, app } = camp();
    frames(app, c, 0.5);
    const view = c.view.getChildByLabel("camp-ground") as Container;
    const back = view.children.find((child) => child.label === "figure:hero-0")!;
    const goat = view.children.find((child) => child.label === "figure:goat")!;
    const goatAt = c.figures().find((f) => f.id === "goat")!;
    expect(goatAt.y).toBeGreaterThan(c.figures().find((f) => f.id === "hero-0")!.y);
    expect(goat.zIndex).toBeGreaterThan(back.zIndex);
    expect(goat.scale.x).toBeGreaterThan(back.scale.x);
    c.destroy();
  });

  it("steps by elapsed time: a dropped frame lands where two frames would", () => {
    const a = camp({ seed: 99 });
    const b = camp({ seed: 99 });
    for (let i = 0; i < 1500; i++) {
      a.app.ticker.frame(16);
      a.app.ticker.frame(16);
      b.app.ticker.frame(32);
    }
    const left = byId(a.camp.figures());
    for (const right of b.camp.figures()) {
      const twin = left.get(right.id)!;
      expect(right.x).toBeCloseTo(twin.x, 3);
      expect(right.y).toBeCloseTo(twin.y, 3);
      expect(right.lift).toBeCloseTo(twin.lift, 1);
    }
    a.camp.destroy();
    b.camp.destroy();
  });

  it("does not replay a long pause: a hidden screen picks up where it was", () => {
    const a = camp({ seed: 3 });
    const b = camp({ seed: 3 });
    frames(a.app, a.camp, 20);
    frames(b.app, b.camp, 20);
    a.app.ticker.frame(60_000);
    b.app.ticker.frame(MAX_FRAME_S * 1000);
    const left = byId(a.camp.figures());
    for (const right of b.camp.figures()) {
      expect(right.x).toBeCloseTo(left.get(right.id)!.x, 6);
      expect(right.y).toBeCloseTo(left.get(right.id)!.y, 6);
    }
    a.camp.destroy();
    b.camp.destroy();
  });

  it("animates a piece only while somebody uses it", () => {
    // Nobody but a hero on a bedroll: the campfire is a painting.
    const { camp: c, app } = camp({ figures: [CREW[0]!] });
    const fire = (c.view.getChildByLabel("camp-ground") as Container).children.find((child) => child.label === "piece:campfire") as Container;
    const flame = fire.children.find((child) => child.label === "part:campfire")!;
    frames(app, c, 1);
    expect(c.activePieces()).toEqual([]);
    expect(flame.scale.y).toBe(1);
    expect(flame.rotation).toBe(0);
    // A friend, who has no bedroll, is given the first free spot: the campfire.
    c.setFigures([CREW[0]!, CREW[4]!]);
    frames(app, c, 2);
    const goat = c.figures().find((f) => f.id === "goat")!;
    expect(standPoint(layout, goat.point!)?.hotspot).toBe("campfire");
    expect(c.activePieces()).toEqual(["campfire"]);
    let changed = false;
    frames(app, c, 1, 16, () => {
      if (flame.scale.y !== 1) changed = true;
    });
    expect(changed).toBe(true);
    c.destroy();
  });

  it("walks a hero who taps Ready to the trailhead, and faces the trail", () => {
    const { camp: c, app } = camp();
    frames(app, c, 1);
    c.moment("ready", "hero-1");
    frames(app, c, 0.1);
    expect(c.figures().find((f) => f.id === "hero-1")!.point).toBeNull();
    frames(app, c, 40, 16, noSlide);
    const hero = c.figures().find((f) => f.id === "hero-1")!;
    const t = layout.frame.trailhead;
    expect(hero.x).toBeCloseTo(frontX("hero-1"));
    expect(hero.lane).toBe(t.lane);
    // Facing right, down the trail: art drawn facing left is flipped.
    expect(hero.artScaleX).toBe(-1);
    // And waits there: a moment's figure does not wander off again.
    frames(app, c, 60);
    expect(c.figures().find((f) => f.id === "hero-1")!.x).toBeCloseTo(frontX("hero-1"));
    c.destroy();
  });

  it("queues Ready heroes behind the trailhead in the order they tapped, and sets them off in that order", () => {
    const { camp: c, app } = camp();
    frames(app, c, 1);
    const order = ["hero-2", "hero-0", "hero-3", "hero-1"];
    for (const id of order) {
      c.moment("ready", id);
      frames(app, c, 0.5);
    }
    frames(app, c, 60, 16, noSlide);
    const t = layout.frame.trailhead;
    const xs = order.map((id) => c.figures().find((f) => f.id === id)!.x);
    expect(xs[0]).toBeCloseTo(frontX("hero-2"));
    for (let i = 1; i < xs.length; i++) {
      // Behind the one before (away from the edge it leaves by), with room between them.
      expect(xs[i]!).toBeLessThan(xs[i - 1]! - 0.03 * W);
    }
    for (const id of order) expect(c.figures().find((f) => f.id === id)!.lane).toBe(t.lane);
    // One steps away: the line closes up behind the front.
    c.moment("away", "hero-0");
    frames(app, c, 30);
    const closed = ["hero-2", "hero-3"].map((id) => c.figures().find((f) => f.id === id)!.x);
    expect(closed[1]!).toBeGreaterThan(xs[2]!);
    // Begin: the queue leaves front first.
    c.moment("ready", "hero-0");
    frames(app, c, 30);
    c.moment("setOff");
    const gone: string[] = [];
    const edge = layout.lanes.get(t.lane)!.x1 * W;
    frames(app, c, 30, 16, (_, next) => {
      for (const [id, view] of next) if (view.x > edge && !gone.includes(id)) gone.push(id);
    });
    expect(gone.slice(0, 4)).toEqual(["hero-2", "hero-3", "hero-1", "hero-0"]);
    c.destroy();
  });

  it("walks a stepped-away hero home and fades them half out", () => {
    const { camp: c, app } = camp();
    frames(app, c, 1);
    c.moment("ready", "hero-2");
    frames(app, c, 30);
    c.moment("away", "hero-2");
    frames(app, c, 40, 16, noSlide);
    const hero = c.figures().find((f) => f.id === "hero-2")!;
    expect(hero.point).toBe("bedroll-2");
    expect(hero.alpha).toBeCloseTo(0.5, 2);
    c.destroy();
  });

  it("sets everyone off down the trail at once on Begin, and lets anything cut it short", () => {
    const { camp: c, app } = camp();
    frames(app, c, 2);
    c.moment("setOff");
    // Nothing waits: within the stagger, everybody is under way.
    frames(app, c, 3, 16, noSlide);
    for (const view of c.figures()) expect(view.point).toBeNull();
    frames(app, c, 60, 16, noSlide);
    for (const view of c.figures()) {
      expect(view.alpha).toBeLessThan(0.02);
      expect(view.x).toBeGreaterThan(layout.lanes.get("near")!.x1 * W);
    }
    // A sitting-down kid brings their hero straight back: home, and waving.
    c.moment("arrive", "hero-0");
    frames(app, c, 1);
    const hero = c.figures().find((f) => f.id === "hero-0")!;
    expect(hero.point).toBe("bedroll-0");
    expect(hero.alpha).toBeGreaterThan(0.9);
  });

  it("can be torn down mid-departure", () => {
    const { camp: c, app } = camp();
    frames(app, c, 1);
    c.moment("setOff");
    app.ticker.frame(16);
    c.destroy();
    expect(app.ticker.count).toBe(0);
    expect(() => {
      c.moment("arrive", "hero-0");
      c.setFigures(CREW);
      c.setSeed(5);
      c.setStill(true);
      app.ticker.frame(16);
    }).not.toThrow();
  });

  it("waves a hero who sits down: a hop and a look round, at home", () => {
    const { camp: c, app } = camp({ figures: [CREW[0]!] });
    frames(app, c, 1);
    c.moment("arrive", "hero-0");
    let hopped = 0;
    let turned = false;
    frames(app, c, 2, 16, (_, next) => {
      const hero = next.get("hero-0")!;
      hopped = Math.max(hopped, hero.lift);
      if (hero.artScaleX === 1) turned = true;
    });
    // Bedroll 0 faces right (artScaleX -1); the look round turns it left.
    expect(turned).toBe(true);
    expect(hopped).toBeGreaterThan(0);
    expect(c.figures()[0]!.point).toBe("bedroll-0");
    c.destroy();
  });

  it("re-plans from a new seed without moving anybody", () => {
    const { camp: c, app } = camp({ seed: 1 });
    frames(app, c, 30);
    const before = byId(c.figures());
    c.setSeed(2);
    app.ticker.frame(16);
    for (const view of c.figures()) {
      const was = before.get(view.id)!;
      expect(Math.abs(view.x - was.x)).toBeLessThan(10);
    }
    frames(app, c, 60);
    c.destroy();
  });

  it("lets a figure leave by fading out, and removes it", () => {
    const { camp: c, app } = camp();
    frames(app, c, 1);
    c.setFigures(CREW.filter((f) => f.id !== "goat"));
    frames(app, c, 0.1);
    expect(c.figures().find((f) => f.id === "goat")!.alpha).toBeGreaterThan(0.1);
    frames(app, c, 2);
    expect(c.figures().find((f) => f.id === "goat")).toBeUndefined();
    c.destroy();
  });
});

describe("the camp in the lobby (#614)", () => {
  it("hands a hero who takes back Ready out of the line and back to wandering", () => {
    const { camp: c, app } = camp();
    frames(app, c, 1);
    c.moment("ready", "hero-1");
    c.moment("ready", "hero-2");
    frames(app, c, 40, 16, noSlide);
    const t = layout.frame.trailhead;
    expect(c.figures().find((f) => f.id === "hero-1")!.x).toBeCloseTo(frontX("hero-1"));
    c.moment("unready", "hero-1");
    // The line closes up: the second hero takes the front.
    frames(app, c, 40, 16, noSlide);
    expect(c.figures().find((f) => f.id === "hero-2")!.x).toBeCloseTo(frontX("hero-2"));
    // And the first wanders off again in time, where a lined-up hero would stand forever.
    let left = false;
    frames(app, c, 90, 16, (_, next) => {
      if (Math.abs(next.get("hero-1")!.x - frontX("hero-1")) > 1) left = true;
    });
    expect(left).toBe(true);
    c.destroy();
  });

  it("covers the pane and slides the camp into the lobby's window, easing there as the panels grow", () => {
    const { camp: c, app } = camp();
    const window = campWindow(900, 100, 300);
    const target = campFit(1600, window, layout, CREW.map((f) => f.heightCm)).framing;
    const start = c.view.y;
    c.setInset(300, 100);
    // No jump: the frame eases toward the new one.
    app.ticker.frame(16);
    expect(c.view.y).not.toBeCloseTo(target.y);
    expect(Math.abs(c.view.y - start)).toBeLessThan(Math.abs(target.y - start));
    frames(app, c, 3);
    expect(c.view.y).toBeCloseTo(target.y, 0);
    expect(c.view.scale.x).toBeCloseTo(target.scale);
    // One painting across the whole width, and over the whole window.
    expect(c.view.x).toBeLessThanOrEqual(1e-6);
    expect(c.view.x + W * c.view.scale.x).toBeGreaterThanOrEqual(1600 - 1e-6);
    expect(c.view.y).toBeLessThanOrEqual(window.top + 0.5);
    expect(c.view.y + H * c.view.scale.y).toBeGreaterThanOrEqual(window.bottom - 0.5);
    c.destroy();
  });

  it("shrinks the figures, not the painting, when the window is too short for them, easing there", () => {
    const { camp: c, app } = camp();
    frames(app, c, 1);
    for (const view of c.figures()) expect(view.figureScale).toBe(1);
    // 420 px of panels under a 120 px header: a 360 px window on a 900 px pane.
    const window = campWindow(900, 120, 420);
    const fit = campFit(1600, window, layout, CREW.map((f) => f.heightCm));
    expect(fit.figureScale).toBeLessThan(1);
    expect(fit.figureScale).toBeGreaterThan(MIN_FIGURE_SCALE);
    c.setInset(420, 120);
    app.ticker.frame(16);
    // No jump: one frame in, the figures are only a little smaller.
    const first = c.figures()[0]!.figureScale;
    expect(first).toBeLessThan(1);
    expect(first).toBeGreaterThan(fit.figureScale);
    frames(app, c, 3);
    for (const view of c.figures()) expect(view.figureScale).toBeCloseTo(fit.figureScale, 3);
    // The painting is still cover-fit, edge to edge.
    expect(c.view.scale.x).toBeCloseTo(fit.framing.scale);
    expect(c.view.x + W * c.view.scale.x).toBeGreaterThanOrEqual(1600 - 1e-6);
    // Every figure is drawn at its lane's scale times the factor, pieces too.
    const ground = c.view.getChildByLabel("camp-ground") as Container;
    for (const view of c.figures()) {
      const drawn = ground.children.find((child) => child.label === `figure:${view.id}`)!;
      const lane = layout.lanes.get(view.lane!)!;
      if (view.lane) expect(drawn.scale.y).toBeCloseTo(lane.scale * fit.figureScale);
    }
    const piece = layout.frame.pieces[0]!;
    const pieceView = ground.children.find((child) => child.label === `piece:${piece.id}`)!;
    expect(pieceView.scale.y).toBeCloseTo(layout.lanes.get(piece.lane)!.scale * fit.figureScale);
    // And every hero stands whole in the window, head to feet, wherever it is.
    const at = fit.framing;
    for (const view of c.figures()) {
      const feet = at.y + view.y * at.scale;
      const head = feet - view.heightPx * at.scale;
      expect(feet).toBeLessThanOrEqual(window.bottom + 0.5);
      expect(head).toBeGreaterThanOrEqual(window.top - 0.5);
    }
    c.destroy();
  });

  it("holds the rules of clean motion at a smaller size: nothing slides, feet on the ground", () => {
    const { camp: c, app } = camp({ seed: 31 });
    c.setInset(560, 120);
    frames(app, c, 3);
    const k = c.figures()[0]!.figureScale;
    expect(k).toBeLessThan(0.9);
    const crossings = layout.backdrop.crossings.map((x) => x.x * W);
    let walked = 0;
    frames(app, c, 90, 16, (prev, next) => {
      noSlide(prev, next);
      for (const [id, now] of next) {
        const was = prev.get(id)!;
        walked += Math.hypot(now.x - was.x, now.y - was.y);
        const onLane = laneAt(layout, now.y / H) !== null;
        expect(onLane || crossings.some((x) => Math.abs(x - now.x) < 1e-6), `${id} off the ground`).toBe(true);
      }
    });
    expect(walked).toBeGreaterThan(W / 2);
    c.destroy();
  });

  it("draws the stand-in backdrop when the camp's own painting does not load", async () => {
    const app = fakeApp();
    const asked: string[] = [];
    const stage = createCamp(app as unknown as Application, layout, {
      still: true,
      assetUrl: (path) => `/assets/${path}`,
      fallbackBackdrop: "/assets/biomes/plains/bg.webp",
      loadTexture: (url) => {
        asked.push(url);
        return url.endsWith("plains/bg.webp") ? Promise.resolve(Texture.WHITE) : Promise.reject(new Error("not painted yet"));
      },
    });
    stage.resize(1600, 900);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked).toContain("/assets/biomes/plains/bg.webp");
    const backdrop = stage.view.children[0] as Container;
    // The painting at canvas size, undimmed, and its two edge strips: no copy at another scale.
    const sprites = backdrop.children.filter((child): child is Sprite => child instanceof Sprite);
    expect(sprites.map((sprite) => sprite.label)).toEqual(["camp-bleed-top", "camp-bleed-bottom", "camp-backdrop"]);
    const painting = sprites[2]!;
    expect(painting.width).toBeCloseTo(W);
    expect(painting.height).toBeCloseTo(H);
    expect(painting.tint).toBe(0xffffff);
    // Slid up into a window, the painting stops short of the pane's bottom, and its own
    // bottom edge, flipped, carries on to it.
    stage.setInset(600, 0);
    const bottom = sprites[1]!;
    const view = stage.view;
    expect(view.y + H * view.scale.y).toBeLessThan(900);
    expect(bottom.visible).toBe(true);
    expect(bottom.scale.y).toBeLessThan(0);
    expect(bottom.y).toBeGreaterThan(H);
    expect(view.y + bottom.y * view.scale.y).toBeCloseTo(900);
    expect(bottom.scale.x * bottom.texture.frame.width).toBeCloseTo(W);
    expect(sprites[0]!.visible).toBe(false);
    stage.destroy();
  });
});

describe("a shrunk camp's sides (#625)", () => {
  it("fills the pane beside a painting drawn narrower than it with the painting again, mirrored", async () => {
    const app = fakeApp();
    const stage = createCamp(app as unknown as Application, layout, { still: true, shrink: true, loadTexture: () => Promise.resolve(Texture.WHITE) });
    stage.setFigures([0, 1, 2, 3].map((seat) => ({ id: `h${String(seat)}`, url: null, heightCm: 260, stance: "standing" as const, seat })));
    stage.resize(1280, 720);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const backdrop = stage.view.children[0] as Container;
    const side = (label: string) => backdrop.children.find((child) => child.label === label) as Container;
    const [left, right] = [side("camp-side-left"), side("camp-side-right")];
    // Room for the whole band: nothing beside the painting.
    stage.setInset(100, 40);
    expect(left.visible).toBe(false);
    expect(right.visible).toBe(false);
    // Under a tall goal card: the camp shrinks, and the mirrored copies fill each side.
    stage.setInset(317, 230);
    const { framing } = stage.fitted()!.fit;
    expect(framing.x).toBeGreaterThan(0);
    expect(left.visible).toBe(true);
    expect(right.visible).toBe(true);
    expect(left.scale.x).toBe(-1);
    expect(right.scale.x).toBe(-1);
    // Flipped about the painting's left and right edges: -W..0 and W..2W of the canvas.
    expect(framing.x - W * framing.scale).toBeLessThanOrEqual(0);
    expect(framing.x + right.x * framing.scale).toBeGreaterThanOrEqual(1280);
    expect(right.x).toBe(2 * W);
    stage.destroy();
  });

  it("is never drawn beside a camp that covers the pane, as the lobby's does", async () => {
    const app = fakeApp();
    const stage = createCamp(app as unknown as Application, layout, { still: true, loadTexture: () => Promise.resolve(Texture.WHITE) });
    stage.resize(1280, 720);
    await new Promise((resolve) => setTimeout(resolve, 0));
    stage.setInset(317, 230);
    const backdrop = stage.view.children[0] as Container;
    expect(backdrop.children.some((child) => child.label?.startsWith("camp-side"))).toBe(false);
    expect(stage.fitted()!.fit.framing.x).toBeLessThanOrEqual(0);
    stage.destroy();
  });
});

describe("the camp's pieces", () => {
  it("draws a piece at its true size on the figures' canvas contract, its moving part registered over it", async () => {
    const app = fakeApp();
    const stage = createCamp(app as unknown as Application, layout, {
      seed: 1,
      still: false,
      // Every file loads: a square canvas, as the art contract paints them.
      loadTexture: () => Promise.resolve(Texture.WHITE),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ground = stage.view.getChildByLabel("camp-ground") as Container;
    const fire = ground.children.find((child) => child.label === "piece:campfire") as Container;
    const sprite = fire.children.find((child) => child instanceof Sprite) as Sprite;
    const part = (fire.children.find((child) => child.label === "part:campfire") as Container).children[0] as Sprite;
    // Sized by its painting's footprint (camp-paint.ts), the one the layout's boxes are laid out by.
    const { canvas } = fitCanvas(campHeightPx(pieceHeightCm({ id: "campfire" }), campMeasure(H)), campPaint("camp/frames/stage1/campfire.png"));
    expect(sprite.height).toBeCloseTo(canvas);
    expect(sprite.anchor.x).toBeCloseTo(ANCHOR_X);
    expect(sprite.anchor.y).toBeCloseTo(ANCHOR_Y);
    expect(part.height).toBeCloseTo(sprite.height);
    expect(part.anchor.y).toBeCloseTo(sprite.anchor.y);
    expect(part.y).toBeCloseTo(sprite.y);
    // And the lane's scale on top: the campfire's lane is the middle one.
    expect(fire.scale.x).toBeCloseTo(layout.lanes.get("middle")!.scale);
    stage.destroy();
  });
});

describe("the camp in reduced motion (§8.7)", () => {
  it("stands everybody at their stand points: nobody wanders, nothing hops, nothing burns", () => {
    const { camp: c, app } = camp({ still: true, figures: [...CREW.slice(0, 4), CREW[4]!] });
    frames(app, c, 1);
    const start = byId(c.figures());
    frames(app, c, 90, 16, (_, next) => {
      for (const view of next.values()) {
        expect(view.walking).toBe(false);
        expect(view.lift).toBeCloseTo(0, 9);
      }
    });
    for (const view of c.figures()) expect(view.x).toBe(start.get(view.id)!.x);
    expect(c.activePieces()).toEqual([]);
    c.destroy();
  });

  it("makes a moment a soft fade at the new spot, never a walk", () => {
    const { camp: c, app } = camp({ still: true });
    frames(app, c, 1);
    c.moment("ready", "hero-1");
    const bed = c.figures().find((f) => f.id === "hero-1")!;
    let lowest = 1;
    frames(app, c, 3, 16, (prev, next) => {
      const was = prev.get("hero-1")!;
      const now = next.get("hero-1")!;
      lowest = Math.min(lowest, now.alpha);
      expect(now.walking).toBe(false);
      // It moves only while nobody can see it.
      if (now.x !== was.x) expect(was.alpha).toBeLessThan(0.02);
    });
    const hero = c.figures().find((f) => f.id === "hero-1")!;
    expect(lowest).toBeLessThan(0.02);
    expect(hero.x).not.toBe(bed.x);
    expect(hero.x).toBeCloseTo(frontX("hero-1"));
    expect(hero.alpha).toBeGreaterThan(0.95);
    c.destroy();
  });

  it("brings walkers to where they were going by a fade when reduced motion turns on", () => {
    const { camp: c, app } = camp({ seed: 2026 });
    let walking: string | null = null;
    for (let i = 0; i < 4000 && !walking; i++) {
      app.ticker.frame(16);
      walking = c.figures().find((f) => f.walking)?.id ?? null;
    }
    expect(walking).not.toBeNull();
    c.setStill(true);
    frames(app, c, 3);
    const view = c.figures().find((f) => f.id === walking)!;
    expect(view.walking).toBe(false);
    expect(view.point).not.toBeNull();
    expect(view.alpha).toBeGreaterThan(0.95);
    c.destroy();
  });
});

describe("the camp's light (camp-light.ts)", () => {
  it("lays every shadow on one layer between the painting and the camp, each following what casts it", () => {
    const { camp: c, app } = camp();
    const layers = c.view.children.map((child) => child.label);
    expect(layers.indexOf("camp-shadows")).toBe(layers.indexOf("camp-ground") - 1);
    const shadows = c.view.getChildByLabel("camp-shadows") as Container;
    const ground = c.view.getChildByLabel("camp-ground") as Container;
    frames(app, c, 4);
    // A figure walking about: its shadow stands where its feet are, at its size.
    for (const view of c.figures()) {
      const figure = ground.getChildByLabel(`figure:${view.id}`)!;
      const cast = shadows.getChildByLabel(`cast:figure:${view.id}`)!;
      expect(cast.position.x).toBeCloseTo(figure.position.x);
      expect(cast.position.y).toBeCloseTo(figure.position.y);
      expect(cast.scale.y).toBeCloseTo(figure.scale.y);
      expect(cast.alpha).toBeCloseTo(figure.alpha);
    }
    // Every frame piece casts one too.
    for (const piece of layout.frame.pieces) expect(shadows.getChildByLabel(`cast:piece:${piece.id}`)).not.toBeNull();
    // Nobody left: no shadow of anybody left behind.
    c.setFigures([]);
    frames(app, c, 3);
    expect(shadows.children.filter((child) => child.label.startsWith("cast:figure:"))).toEqual([]);
    c.destroy();
  });
});
