/**
 * A rift in plain view in a story scene (#401): which scene has one, what the
 * stage plays for it, and where the tear stands. Pure, like cast.test.ts.
 */

import { describe, expect, it } from "vitest";
import type { Chapter, RunState } from "@kad/shared";
import { makeState } from "../testing/fixtures";
import {
  RIFT_FOOT,
  RIFT_GLOW_COLOR,
  RIFT_HOLE_COLOR,
  RIFT_TEAR_CM,
  RIFT_TEAR_SHARE,
  riftPasses,
  riftPresence,
  riftStand,
  sceneRiftFor,
} from "./scene-rift";

const chapter = {
  id: "c1",
  scenes: {
    quay: { type: "story", narration: "A fold hangs over the quay.", rift: "steady", choices: [] },
    plain: { type: "story", narration: "Fish.", choices: [] },
    fight: { type: "encounter", enemies: [], onVictory: "plain", onDefeat: "plain" },
  },
} as unknown as Chapter;

const at = (sceneId: string, over: Partial<RunState> = {}): RunState =>
  makeState({ phase: "scene", chapterId: "c1", sceneId, ...over });

describe("which scene has a rift", () => {
  it("is the tagged scene of the chapter on screen", () => {
    expect(sceneRiftFor(chapter, at("quay"))).toBe("steady");
    expect(sceneRiftFor(chapter, at("plain"))).toBeNull();
  });

  it("is none for another chapter's state, a fight, or no chapter yet", () => {
    expect(sceneRiftFor(chapter, at("quay", { chapterId: "c2" }))).toBeNull();
    expect(sceneRiftFor(chapter, at("quay", { encounter: {} as RunState["encounter"] }))).toBeNull();
    expect(sceneRiftFor(null, at("quay"))).toBeNull();
    expect(sceneRiftFor(chapter, at("fight"))).toBeNull();
  });
});

describe("what the stage plays", () => {
  it("shimmers for a steady rift, unfolds then shimmers for an opening one, folds away for a collapsing one", () => {
    expect(riftPasses("steady", false)).toEqual([{ effect: "rift_neutral", loop: true }]);
    expect(riftPasses("open", false)).toEqual([
      { effect: "rift_open", loop: false },
      { effect: "rift_neutral", loop: true },
    ]);
    expect(riftPasses("collapse", false)).toEqual([{ effect: "rift_collapse", loop: false }]);
    expect(riftPasses(null, false)).toEqual([]);
  });

  it("under reduced motion, nothing unfolds or folds: there, or gone", () => {
    expect(riftPasses("open", true)).toEqual([{ effect: "rift_neutral", loop: true }]);
    expect(riftPasses("collapse", true)).toEqual([]);
    expect(riftPasses("steady", true)).toEqual([{ effect: "rift_neutral", loop: true }]);
  });

  it("is neutral on every screen: no colour layer is ever on the stage", () => {
    for (const rift of ["steady", "open", "collapse"] as const) {
      for (const pass of [...riftPasses(rift, false), ...riftPasses(rift, true)]) {
        expect(pass.effect).toMatch(/^rift_(neutral|open|collapse)$/);
      }
    }
  });
});

describe("where the tear stands", () => {
  const k = 1;
  const tear = RIFT_TEAR_CM * 2.5;

  it("is as tall as its measure says, its frame sized so the painted tear is that tall", () => {
    const { frame } = riftStand({ party: [400], partySlot: 300, castLeft: [] }, 0, 1600, k);
    expect(frame * RIFT_TEAR_SHARE).toBeCloseTo(tear);
    expect(riftStand({ party: [400], partySlot: 300, castLeft: [] }, 0, 1600, 0.85).frame).toBeCloseTo(frame * 0.85);
    expect(RIFT_FOOT).toBeGreaterThan(0.5);
  });

  it("with company, fills the gap between the party and the cast", () => {
    const { x } = riftStand({ party: [500, 800], partySlot: 300, castLeft: [1100, 1300] }, 0, 1600, k);
    expect(x).toBe((800 + 150 + 1100) / 2);
  });

  it("with the party alone, stands just past the last hero, inside the stage", () => {
    const alone = riftStand({ party: [600, 1000], partySlot: 400, castLeft: [] }, 0, 1600, k);
    expect(alone.x).toBeGreaterThan(1000 + 200);
    const crowded = riftStand({ party: [1400], partySlot: 400, castLeft: [] }, 0, 1600, k);
    expect(crowded.x + crowded.frame * 0.18).toBeLessThanOrEqual(1600);
  });

  it("with nobody on stage, in the middle", () => {
    expect(riftStand({ party: [], partySlot: 0, castLeft: [] }, -200, 2000, k).x).toBe(800);
  });
});

describe("how plainly the tear shows", () => {
  const loop = { effect: "rift_neutral", loop: true } as const;
  const open = { effect: "rift_open", loop: false } as const;
  const collapse = { effect: "rift_collapse", loop: false } as const;

  it("a shimmering rift is full size, its hole dark and its mist breathing", () => {
    const breaths = [0, 0.6, 1.2, 1.8].map((t) => riftPresence(loop, 0, t, false));
    for (const p of breaths) {
      expect(p.size).toBe(1);
      expect(p.hole).toBeGreaterThan(0.5);
      expect(p.glow).toBeGreaterThanOrEqual(0.55 - 1e-9);
      expect(p.glow).toBeLessThanOrEqual(0.85 + 1e-9);
    }
    expect(new Set(breaths.map((p) => p.glow.toFixed(2))).size).toBeGreaterThan(1);
  });

  it("holds the breath under reduced motion", () => {
    expect(riftPresence(loop, 0, 0.6, true)).toEqual(riftPresence(loop, 0, 1.8, true));
  });

  it("grows with an opening sheet and shrinks with a collapsing one", () => {
    expect(riftPresence(open, 0, 0, false).size).toBeLessThan(riftPresence(open, 11, 0, false).size);
    expect(riftPresence(open, 11, 0, false).size).toBe(1);
    expect(riftPresence(collapse, 0, 0, false).size).toBeGreaterThan(riftPresence(collapse, 11, 0, false).size);
    expect(riftPresence(collapse, 11, 0, false)).toEqual({ size: 0, glow: 0, hole: 0 });
    expect(riftPresence(null, 0, 0, false)).toEqual({ size: 0, glow: 0, hole: 0 });
  });

  it("uses no palette colour, nor white, silver, gold or red: a dark hole and a grey mist", () => {
    for (const color of [RIFT_HOLE_COLOR, RIFT_GLOW_COLOR]) {
      const [r, g, b] = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
      // Near-neutral: no channel more than a little above the others.
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(16);
      // Not white or silver: the mist stays below a pale grey.
      expect(Math.max(r, g, b)).toBeLessThan(0xe0);
    }
  });
});
