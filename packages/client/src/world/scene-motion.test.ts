// @vitest-environment jsdom
/**
 * The stage's chapter-8 motion: the impact jolt and the scene-step veil,
 * run against the fake stage (testing/fake-stage.ts) with hand-driven
 * frames — the same discipline as scene.test.ts, and the same honesty about
 * what it covers: geometry over frames, not pixels.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Application, Container, Graphics } from "pixi.js";
import { beginEncounter, parseBoard } from "@kad/shared";
import type { EncounterEvent, ResolvedCharacter } from "@kad/shared";
import { makeRules } from "../../../shared/src/test-fixtures";
import { fakeApp, installFakeCanvas2D, type FakeApp } from "../testing/fake-stage";
import type { BoardViewState } from "./board";
import { createScene, SCENE_STEP_TAIL_MS, type PartyScene } from "./scene";
import { SHAKE_DURATION_S, SHAKE_MAX_FRACTION } from "./shake";

beforeAll(installFakeCanvas2D);

function scene(): { scene: PartyScene; app: FakeApp } {
  const app = fakeApp();
  const made = createScene(app as unknown as Application);
  made.resize(1600, 900);
  return { scene: made, app };
}

/** The smallest fight the engine will start — same fixture as scene.test.ts. */
function encounterView(): BoardViewState {
  const hero: ResolvedCharacter = {
    id: "c_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 2, quick: 9, clever: 3, heart: 5 },
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    maxHp: 10,
    steps: 4,
    guard: 11,
    attackStat: "heart",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
  };
  const encounter = beginEncounter(
    {
      board: parseBoard(["....", "....", "....", "...."]),
      party: [{ character: hero, at: { x: 0, y: 0 } }],
      enemies: [
        {
          spec: { id: "wisp", name: "Bramblewisp", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 },
          at: { x: 3, y: 3 },
        },
      ],
    },
    { rules: makeRules(), abilities: {}, rng: { next: () => 0.5 } },
  );
  return {
    encounter,
    biome: null,
    enemyArt: {},
    party: [
      { character: hero, playerId: "p_1", hp: hero.maxHp, down: false, connected: true, ready: true },
    ],
  };
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

  it("waits for the blow's own beat instead of flinching at the sequence head", () => {
    /*
     * The board paces a round's events across the hold (`beatOffsetsMs`), so
     * for moved → roll → damage the number pops two beats in — and the jolt
     * has to land there with it, not during the walk-up.
     */
    const { scene: s, app } = scene();
    s.setEncounter(encounterView());
    app.ticker.frame(16);

    const moved = { type: "moved", actorId: "c_1", to: { x: 1, y: 0 } } as EncounterEvent;
    const roll = { type: "roll", roll: {} } as unknown as EncounterEvent;
    const damage = { type: "damage", actorId: "wisp-0", amount: 3, hp: 3 } as EncounterEvent;
    // Beats at 400/800/1200ms of a 1900ms hold (step capped at 400).
    s.playCombatEvents([moved, roll, damage], 1900);

    app.ticker.frame(100); // mid-walk: nothing has hit anybody yet
    expect(app.stage.x).toBe(0);
    expect(app.stage.y).toBe(0);

    for (let i = 0; i < 12; i++) app.ticker.frame(100); // past the damage beat
    expect(Math.hypot(app.stage.x, app.stage.y)).toBeGreaterThan(0);
  });
});

describe("the backdrop under a jolt", () => {
  it("overscans the pane by at least one jolt's travel", () => {
    /*
     * On a pane with the design rect's own 16:9, plain cover fits the
     * framebuffer exactly — and then every nonzero offset drags a bare strip
     * of the DOM surface into view along the trailing edge. The cover has to
     * bleed by at least the maximum displacement on every side.
     */
    const { app } = scene(); // resize(1600, 900) — exactly 16:9
    const backdrop = app.stage.children[0] as Container;
    const art = backdrop.children[0] as Container;
    const maxJolt = 900 * SHAKE_MAX_FRACTION;

    const drawnWidth = 1600 * art.scale.x;
    const drawnHeight = 900 * art.scale.y;
    expect(art.x).toBeLessThanOrEqual(-maxJolt);
    expect(art.x + drawnWidth).toBeGreaterThanOrEqual(1600 + maxJolt);
    expect(art.y + drawnHeight).toBeGreaterThanOrEqual(900 + maxJolt);
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
