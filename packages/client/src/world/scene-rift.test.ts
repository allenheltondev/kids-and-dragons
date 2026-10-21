/**
 * A rift in plain view in a story scene (#401): which scene has one, what the
 * stage plays for it, and where the tear stands. Pure, like cast.test.ts.
 */

import { describe, expect, it } from "vitest";
import type { Chapter, RunState } from "@kad/shared";
import { makeState } from "../testing/fixtures";
import {
  groundFade,
  HOLE_TEXTURE_HEIGHT,
  HOLE_TEXTURE_WIDTH,
  holeTexturePixels,
  RIFT_DASHES,
  RIFT_FOOT,
  RIFT_GLOW_COLOR,
  RIFT_HOLE_COLOR,
  RIFT_INK_COLOR,
  RIFT_MOTES,
  RIFT_TEAR_CM,
  RIFT_TEAR_SHARE,
  riftPasses,
  riftPresence,
  riftStand,
  ringMarks,
  ringPoint,
  sceneRiftFor,
  TEAR_MIDDLE_PX,
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

  it("a shimmering rift is full size, its hole dark and its mist steady", () => {
    expect(riftPresence(loop, 0)).toEqual(riftPresence(loop, 7));
    const steady = riftPresence(loop, 0);
    expect(steady.size).toBe(1);
    expect(steady.hole).toBeGreaterThan(0.5);
    expect(steady.glow).toBeGreaterThan(0.5);
  });

  it("grows with an opening sheet and shrinks with a collapsing one", () => {
    expect(riftPresence(open, 0).size).toBeLessThan(riftPresence(open, 11).size);
    expect(riftPresence(open, 11).size).toBe(1);
    expect(riftPresence(collapse, 0).size).toBeGreaterThan(riftPresence(collapse, 11).size);
    expect(riftPresence(collapse, 11)).toEqual({ size: 0, glow: 0, hole: 0 });
    expect(riftPresence(null, 0)).toEqual({ size: 0, glow: 0, hole: 0 });
  });

  it("uses no palette colour, nor white, silver, gold or red: near-neutral darks and a grey", () => {
    for (const color of [RIFT_HOLE_COLOR, RIFT_GLOW_COLOR, RIFT_INK_COLOR]) {
      const [r, g, b] = [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
      // Near-neutral: no channel more than a little above the others.
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(16);
      // Not white or silver: nothing brighter than a pale grey.
      expect(Math.max(r, g, b)).toBeLessThan(0xe0);
    }
  });
});

describe("the rings around the tear", () => {
  const radius = (ring: typeof RIFT_DASHES, mark: { from: number; reach: number }) => {
    const p = ringPoint(ring, mark.from, mark.reach);
    return Math.hypot(p.x / ring.rx, p.y / ring.ry);
  };

  it("turn, the dashes one way and the motes the other", () => {
    const dashes = [ringMarks(RIFT_DASHES, 0, false), ringMarks(RIFT_DASHES, 1, false)];
    const motes = [ringMarks(RIFT_MOTES, 0, false), ringMarks(RIFT_MOTES, 1, false)];
    expect(dashes[1]![0]!.from - dashes[0]![0]!.from).toBeGreaterThan(0);
    expect(motes[1]![0]!.from - motes[0]![0]!.from).toBeLessThan(0);
  });

  /*
   * The shimmer is on every rift, on every screen, so it may not move like a
   * rule (brief Part A1): no ripple or spiral (a mark's distance changing),
   * no breath or flicker (its size or strength changing in a beat).
   */
  it("never ripple, spiral, breathe or flicker: every mark keeps its distance, length and thickness as it turns", () => {
    for (const ring of [RIFT_DASHES, RIFT_MOTES]) {
      const at = [0, 0.4, 1.3, 2.7, 6.1].map((t) => ringMarks(ring, t, false));
      for (const marks of at) {
        marks.forEach((mark, i) => {
          const first = at[0]![i]!;
          expect(radius(ring, mark)).toBeCloseTo(radius(ring, first));
          expect(mark.to - mark.from).toBeCloseTo(first.to - first.from);
          expect(mark.width).toBe(first.width);
        });
      }
    }
  });

  it("are brushwork, not a dashed line: neighbouring marks differ", () => {
    const marks = ringMarks(RIFT_DASHES, 0, false);
    expect(new Set(marks.map((m) => (m.to - m.from).toFixed(3))).size).toBeGreaterThan(3);
    expect(new Set(marks.map((m) => m.width)).size).toBeGreaterThan(3);
  });

  it("hold still under reduced motion", () => {
    expect(ringMarks(RIFT_DASHES, 0, true)).toEqual(ringMarks(RIFT_DASHES, 5, true));
    expect(ringMarks(RIFT_MOTES, 0, true)).toEqual(ringMarks(RIFT_MOTES, 5, true));
  });

  it("arch over the tear: full above, fading near the floor, gone under it", () => {
    expect(groundFade(-TEAR_MIDDLE_PX)).toBe(1);
    expect(groundFade(0)).toBe(1);
    const near = groundFade(TEAR_MIDDLE_PX * 0.8);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(1);
    expect(groundFade(TEAR_MIDDLE_PX)).toBe(0);
    expect(groundFade(TEAR_MIDDLE_PX * 1.4)).toBe(0);
  });
});

describe("the hole's painted inside", () => {
  const pixels = holeTexturePixels();
  const at = (u: number, v: number) => {
    const x = Math.floor(((u + 1) / 2) * (HOLE_TEXTURE_WIDTH - 1));
    const y = Math.floor(((v + 1) / 2) * (HOLE_TEXTURE_HEIGHT - 1));
    const i = (y * HOLE_TEXTURE_WIDTH + x) * 4;
    return { r: pixels[i]!, g: pixels[i + 1]!, b: pixels[i + 2]!, a: pixels[i + 3]! };
  };
  const light = (p: { r: number; g: number; b: number }) => (p.r + p.g + p.b) / 3;

  it("is the same picture every time, on every screen", () => {
    expect(holeTexturePixels()).toEqual(pixels);
  });

  it("is deep at the middle and lifts towards a misty rim", () => {
    expect(light(at(0, 0))).toBeLessThan(light(at(0, 0.75)));
    expect(light(at(0, 0))).toBeLessThan(light(at(0.75, 0)));
  });

  it("has a luminous band just inside its edge, brighter than the mist on either side", () => {
    const band = Array.from({ length: 9 }, (_, i) => light(at(0, -0.6 - i * 0.05)));
    const brightest = band.indexOf(Math.max(...band));
    expect(brightest).toBeGreaterThan(0);
    expect(brightest).toBeLessThan(band.length - 1);
  });

  it("is opaque inside, feathered at the edge, and empty outside the ellipse", () => {
    expect(at(0, 0).a).toBe(255);
    const edge = at(0, 0.93).a;
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    expect(at(0.99, 0.99).a).toBe(0);
  });

  it("is textured, not a flat band: neighbouring stretches differ", () => {
    const row = Array.from({ length: 30 }, (_, i) => light(at(-0.45 + i * 0.03, 0.2)));
    expect(Math.max(...row) - Math.min(...row)).toBeGreaterThan(4);
  });

  it("only mixes the hole's near-black with the mist's grey, so it keeps to the brief's colours", () => {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] === 0) continue;
      const [r, g, b] = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(16);
      expect(Math.max(r, g, b)).toBeLessThan(0xe0);
    }
  });
});
