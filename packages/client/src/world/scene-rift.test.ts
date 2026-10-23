/**
 * A rift in plain view in a story scene (#401): which scene has one, what the
 * stage plays for it, and where the tear stands. Pure, like cast.test.ts.
 */

import { describe, expect, it } from "vitest";
import type { Chapter, RunState } from "@kad/shared";
import { makeState } from "../testing/fixtures";
import {
  RIFT_FOOT,
  RIFT_TEAR_CM,
  RIFT_TEAR_SHARE,
  riftCueFor,
  riftPasses,
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
    expect(crowded.x + crowded.frame * 0.36).toBeLessThanOrEqual(1600);
  });

  it("with nobody on stage, in the middle", () => {
    expect(riftStand({ party: [], partySlot: 0, castLeft: [] }, -200, 2000, k).x).toBe(800);
  });
});

describe("when a scene's rift sounds", () => {
  const opening = {
    id: "c1",
    scenes: {
      shimmer: { type: "story", narration: "The fold opens.", rift: "open", choices: [] },
      through: { type: "story", narration: "It pinches shut.", rift: "collapse", choices: [] },
      plain: { type: "story", narration: "Fish.", choices: [] },
    },
  } as unknown as Chapter;

  it("sounds once as the scene opens, and not again for the same scene", () => {
    const first = riftCueFor(null, opening, at("shimmer"));
    expect(first).toEqual({ heard: "c1/shimmer", cue: "rift-open" });
    expect(riftCueFor(first.heard, opening, at("shimmer")).cue).toBeNull();
    expect(riftCueFor(first.heard, opening, at("through")).cue).toBe("rift-collapse");
  });

  it("waits for the chapter: a scene named before its chapter loads is pending, not heard", () => {
    const early = riftCueFor(null, null, at("shimmer"));
    expect(early).toEqual({ heard: null, cue: null });
    const stale = riftCueFor(early.heard, { ...opening, id: "c0" } as Chapter, at("shimmer"));
    expect(stale).toEqual({ heard: null, cue: null });
    expect(riftCueFor(stale.heard, opening, at("shimmer"))).toEqual({ heard: "c1/shimmer", cue: "rift-open" });
  });

  it("judges the scene the state names when the chapter lands, not one it passed through while waiting", () => {
    const passed = riftCueFor(riftCueFor(null, null, at("shimmer")).heard, null, at("plain"));
    expect(riftCueFor(passed.heard, opening, at("plain"))).toEqual({ heard: "c1/plain", cue: null });
  });

  it("is silent for a scene with no rift, and outside a chapter", () => {
    expect(riftCueFor(null, opening, at("plain")).cue).toBeNull();
    expect(riftCueFor("c1/plain", opening, makeState({ phase: "lobby" }))).toEqual({ heard: null, cue: null });
  });
});
