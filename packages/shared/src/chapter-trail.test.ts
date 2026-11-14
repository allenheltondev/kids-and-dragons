import { describe, expect, it } from "vitest";
import { chanceStates, goalStepSaid, scenesThatCanStillSet, scenesToEnding, trailFraction } from "./chapter-trail.js";
import type { Chapter, GoalStep } from "./types/chapter.js";

/**
 * start → mill (the miller mentions her goat) → fork: the hedge (finds the goat) or the
 * road, both to gate → end; and a setback off the fork.
 */
function chapter(): Chapter {
  const go = (to: string, effects?: unknown[]) => ({ id: `to_${to}`, label: "On", icon: "forward", goto: to, ...(effects ? { effects } : {}) });
  const scenes: Record<string, unknown> = {
    start: { type: "story", narration: "A road.", choices: [go("mill")] },
    mill: { type: "story", narration: "My goat ran off!", choices: [go("fork")] },
    fork: { type: "story", narration: "Which way?", choices: [go("hedge"), go("road"), go("lost")] },
    hedge: { type: "story", narration: "A goat!", choices: [go("gate", [{ type: "setFlag", flag: "found_goat" }])] },
    road: { type: "story", narration: "Dust.", choices: [go("gate")] },
    gate: { type: "story", narration: "The gate.", choices: [go("end")] },
    end: { type: "story", narration: "Home.", choices: [] },
    lost: { type: "story", narration: "Lost.", outcome: "setback", choices: [] },
  };
  return {
    id: "test-01",
    title: "Test",
    estimatedMinutes: 30,
    xpAward: 100,
    entry: "start",
    scenes,
    objectives: [
      { id: "goat", label: "Found the miller's goat", hint: "Find the miller's goat?", reveal: "mill", flag: "found_goat", xp: 10 },
      { id: "secret", label: "Took the long road", flag: "long_road", xp: 5 },
    ],
  } as unknown as Chapter;
}

describe("goalStepSaid", () => {
  const step: GoalStep = { id: "ledger", label: "Get the ledger", flag: ["talked", "snuck"], doneLabel: { talked: "Talked our way in", snuck: "Snuck past the clerk" } };

  it("says how this party did it", () => {
    expect(goalStepSaid(step, { flags: { snuck: true } })).toBe("Snuck past the clerk");
    expect(goalStepSaid(step, { flags: { talked: true, snuck: true } })).toBe("Talked our way in");
  });

  it("falls back to one done label, then to the label", () => {
    expect(goalStepSaid({ id: "a", label: "Climb up", flag: "up", doneLabel: "Climbed up" }, { flags: { up: true } })).toBe("Climbed up");
    expect(goalStepSaid({ id: "a", label: "Climb up", flag: "up" }, { flags: { up: true } })).toBe("Climb up");
  });
});

describe("the trail", () => {
  it("runs from 0 at the entry to 1 at an ending, by the shortest road left", () => {
    const c = chapter();
    const d = scenesToEnding(c);
    expect(d.get("start")).toBe(5);
    expect(trailFraction(c, "start", d)).toBe(0);
    expect(trailFraction(c, "fork", d)).toBeCloseTo(0.4);
    expect(trailFraction(c, "end", d)).toBe(1);
    expect(trailFraction(c, null, d)).toBe(0);
  });

  it("counts a setback as an ending only where nothing better is left", () => {
    const d = scenesToEnding(chapter());
    expect(d.get("fork")).toBe(3);
    expect(d.get("lost")).toBe(0);
  });
});

describe("chances", () => {
  it("knows where a flag can still be set", () => {
    expect([...scenesThatCanStillSet(chapter(), "found_goat")].sort()).toEqual(["fork", "hedge", "mill", "start"]);
  });

  it("stays hidden until the story mentions it", () => {
    const [goat, secret] = chanceStates(chapter(), { flags: {}, visited: ["start"], sceneId: "start" });
    expect(goat!.state).toBe("hidden");
    expect(secret!.state).toBe("hidden");
  });

  it("opens once its scene is entered, and is missed once no road left can set it", () => {
    expect(chanceStates(chapter(), { flags: {}, visited: ["start"], sceneId: "mill" })[0]!.state).toBe("open");
    expect(chanceStates(chapter(), { flags: {}, visited: ["start", "mill", "fork"], sceneId: "road" })[0]!.state).toBe("missed");
  });

  describe("behind a gate", () => {
    /** The goat is only reachable by flying over the hedge, a griffin's way. */
    function gated(): Chapter {
      const c = chapter();
      const fork = c.scenes.fork as unknown as { choices: { goto: string; requiresSpecies?: string }[] };
      fork.choices[0]!.requiresSpecies = "griffin";
      return c;
    }

    it("counts a gated way only for a party that can take it", () => {
      expect(scenesThatCanStillSet(gated(), "found_goat").has("mill")).toBe(true);
      expect(scenesThatCanStillSet(gated(), "found_goat", "everyone").has("mill")).toBe(false);
      expect(scenesThatCanStillSet(gated(), "found_goat", { species: ["griffin"], classes: [] }).has("mill")).toBe(true);
      expect(scenesThatCanStillSet(gated(), "found_goat", { species: ["bigfoot"], classes: [] }).has("mill")).toBe(false);
    });

    it("reads as missed for a party without the species, and open for one with it", () => {
      const at = { flags: {}, visited: ["start"], sceneId: "mill" };
      expect(chanceStates(gated(), { ...at, party: { species: ["bigfoot"], classes: [] } })[0]!.state).toBe("missed");
      expect(chanceStates(gated(), { ...at, party: { species: ["griffin", "bigfoot"], classes: [] } })[0]!.state).toBe("open");
    });

    it("keeps a flag or item gate open, since it may open later", () => {
      const c = chapter();
      (c.scenes.fork as unknown as { choices: { requiresFlag?: string }[] }).choices[0]!.requiresFlag = "befriended_miller";
      expect(scenesThatCanStillSet(c, "found_goat", { species: [], classes: [] }).has("mill")).toBe(true);
    });
  });

  it("is met when its flag is set, revealed or a surprise", () => {
    const [goat, secret] = chanceStates(chapter(), { flags: { found_goat: true, long_road: true }, visited: ["start", "mill"], sceneId: "gate" });
    expect(goat).toMatchObject({ state: "met", revealed: true });
    expect(secret).toMatchObject({ state: "met", revealed: false });
  });
});
