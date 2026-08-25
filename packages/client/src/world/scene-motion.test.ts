// @vitest-environment jsdom
/**
 * The stage's chapter-8 motion: the impact jolt and the scene-step veil,
 * run against the fake stage (testing/fake-stage.ts) with hand-driven
 * frames — the same discipline as scene.test.ts, and the same honesty about
 * what it covers: geometry over frames, not pixels.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Application, Graphics } from "pixi.js";
import { fakeApp, installFakeCanvas2D, type FakeApp } from "../testing/fake-stage";
import { createScene, SCENE_STEP_TAIL_MS, type PartyScene } from "./scene";
import { SHAKE_DURATION_S } from "./shake";

beforeAll(installFakeCanvas2D);

function scene(): { scene: PartyScene; app: FakeApp } {
  const app = fakeApp();
  const made = createScene(app as unknown as Application);
  made.resize(1600, 900);
  return { scene: made, app };
}

describe("the jolt", () => {
  it("moves the whole stage, then puts it back exactly", () => {
    const { scene: s, app } = scene();
    expect(app.stage.x).toBe(0);

    s.shake(1);
    app.ticker.frame(32);
    const displaced = Math.hypot(app.stage.x, app.stage.y);
    expect(displaced).toBeGreaterThan(0);

    // Ring all the way down: past the duration, the stage is *exactly* home —
    // a residual half-pixel offset would blur every sprite forever after.
    for (let i = 0; i < Math.ceil((SHAKE_DURATION_S * 1000) / 16) + 2; i++) app.ticker.frame(16);
    expect(app.stage.x).toBe(0);
    expect(app.stage.y).toBe(0);
  });

  it("does nothing when the viewer asked for reduced motion", () => {
    const original = globalThis.matchMedia;
    globalThis.matchMedia = ((query: string) =>
      ({ matches: query.includes("prefers-reduced-motion"), media: query }) as MediaQueryList) as typeof matchMedia;
    try {
      const { scene: s, app } = scene();
      s.shake(1);
      app.ticker.frame(32);
      expect(app.stage.x).toBe(0);
      expect(app.stage.y).toBe(0);
    } finally {
      globalThis.matchMedia = original;
    }
  });

  it("leaves the stage home after a teardown mid-jolt", () => {
    const { scene: s, app } = scene();
    s.shake(1);
    app.ticker.frame(32);
    s.destroy();
    expect(app.stage.x).toBe(0);
    expect(app.stage.y).toBe(0);
  });
});

describe("the scene step", () => {
  /** The veil is the topmost child of the stage — see createScene. */
  function veilOf(app: FakeApp): Graphics {
    return app.stage.children[app.stage.children.length - 1] as Graphics;
  }

  it("peaks when the patch lands, and keeps the swap covered", () => {
    /*
     * The timing that matters: SCENE_ENTER's patch is gated until the hold
     * elapses, so the veil's deepest point has to sit at the hold's *end* —
     * a symmetric dip inside the hold is transparent again at exactly the
     * moment the scene actually changes, and the swap plays fully visible.
     */
    const { scene: s, app } = scene();
    const veil = veilOf(app);
    expect(veil.alpha).toBe(0);

    s.playSceneStep(320);
    app.ticker.frame(160); // mid-hold: rising
    const mid = veil.alpha;
    expect(mid).toBeGreaterThan(0);

    app.ticker.frame(156); // just before the hold ends: the deepest point
    const atSwap = veil.alpha;
    expect(atSwap).toBeGreaterThan(mid);
    // A veil, not a blackout — the party never disappears.
    expect(atSwap).toBeLessThan(0.6);

    app.ticker.frame(20); // the patch has applied; the new scene is behind it
    expect(veil.alpha).toBeGreaterThan(0);

    app.ticker.frame(SCENE_STEP_TAIL_MS + 20); // the tail has lifted
    expect(veil.alpha).toBe(0);
  });

  it("ignores a nonsense window instead of wedging the veil up", () => {
    const { scene: s, app } = scene();
    s.playSceneStep(0);
    app.ticker.frame(16);
    expect(veilOf(app).alpha).toBe(0);
  });
});
