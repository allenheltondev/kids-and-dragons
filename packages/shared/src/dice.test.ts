import { describe, expect, it } from "vitest";

import { makeRng, resolveAttack, resolveCheck, roll, rollD20 } from "./dice.js";

function series(seed: string | number, n: number): number[] {
  const rng = makeRng(seed);
  return Array.from({ length: n }, () => rollD20(rng));
}

describe("makeRng", () => {
  it("is deterministic for a seed — the same seed replays the same run", () => {
    expect(series("r_88c", 20)).toEqual(series("r_88c", 20));
  });

  it("separates similar seeds", () => {
    expect(series("r_88c", 10)).not.toEqual(series("r_88d", 10));
  });

  it("accepts numeric seeds too", () => {
    expect(series(7, 5)).toEqual(series(7, 5));
    expect(series(7, 5)).not.toEqual(series(8, 5));
  });

  it("stays inside 1..20 over a long run and covers both ends", () => {
    const rng = makeRng("coverage");
    const seen = new Set<number>();
    for (let i = 0; i < 20000; i++) {
      const die = rollD20(rng);
      expect(die).toBeGreaterThanOrEqual(1);
      expect(die).toBeLessThanOrEqual(20);
      seen.add(die);
    }
    expect(seen.size).toBe(20);
  });

  it("produces floats in [0, 1)", () => {
    const rng = makeRng("unit");
    for (let i = 0; i < 1000; i++) {
      const n = rng.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

/** A fixed die, for tests that care about the branch and not the randomness. */
function fixed(die: number) {
  return { next: () => (die - 1) / 20 + 0.001 };
}

describe("roll", () => {
  it("shapes a DiceRoll per types/state.ts", () => {
    const result = roll(fixed(14), { mod: 3, tn: 12, characterId: "c_1", stat: "quick" });
    expect(result).toEqual({
      die: 14,
      mod: 3,
      total: 17,
      tn: 12,
      result: "success",
      characterId: "c_1",
      stat: "quick",
    });
  });

  it("fails below the target number", () => {
    expect(roll(fixed(2), { mod: 1, tn: 12 }).result).toBe("failure");
  });

  it("succeeds on exactly the target number", () => {
    expect(roll(fixed(10), { mod: 2, tn: 12 }).result).toBe("success");
  });
});

describe("resolveCheck", () => {
  it("returns success/failure and records who rolled", () => {
    const hit = resolveCheck(fixed(20), { characterId: "c_1", stat: "heart", mod: 2, tn: 16 });
    expect(hit.result).toBe("success");
    expect(hit.characterId).toBe("c_1");
    expect(hit.stat).toBe("heart");

    const miss = resolveCheck(fixed(1), { characterId: "c_1", stat: "heart", mod: 2, tn: 16 });
    expect(miss.result).toBe("failure");
  });
});

describe("resolveAttack", () => {
  it("returns hit/miss against Guard, not success/failure", () => {
    expect(resolveAttack(fixed(20), { characterId: "c_1", mod: 3, guard: 11 }).result).toBe("hit");
    expect(resolveAttack(fixed(1), { characterId: "c_1", mod: 3, guard: 11 }).result).toBe("miss");
  });

  it("puts Guard in the tn field so the presentation layer has one shape", () => {
    const result = resolveAttack(fixed(12), { characterId: "c_1", mod: 3, guard: 11 });
    expect(result.tn).toBe(11);
    expect(result.total).toBe(15);
  });

  it("carries the class stat through to the roll, and omits it when there is none", () => {
    /*
     * The stat is the label the table reads — DiceOverlay and the roll prompt
     * render "might · beat 12" from it. Dropping it leaves a roll that says
     * what happened without saying what was rolled, and every assertion above
     * is about `result` and `total`, so nothing noticed.
     */
    const withStat = resolveAttack(fixed(12), {
      characterId: "c_1",
      mod: 3,
      guard: 11,
      stat: "might",
    });
    expect(withStat.stat).toBe("might");

    // A monster swings with no class stat at all, and the field must then be
    // absent rather than present-and-undefined — it crosses the wire as JSON.
    const without = resolveAttack(fixed(12), { characterId: "wisp#1", mod: 3, guard: 11 });
    expect("stat" in without).toBe(false);
  });
});

describe("the generator itself", () => {
  /*
   * A characterisation test, and the only kind that can hold this.
   *
   * Every other test here asks whether the stream is *self-consistent* — same
   * seed twice, different seeds differ, values in range — and all of those stay
   * green if the hash changes, because a different generator is still a
   * deterministic one. What they cannot see is the sequence *moving*.
   *
   * It has to be pinned because the event log replays through it: architecture
   * §4.1/§4.3 make "seeded from runId:seq so a replay re-rolls identically" a
   * property of stored history, not just of a single process. Retune `hashSeed`
   * or `next()` and every log written before the change replays into different
   * dice — a chapter that was won becoming one that was lost. If this test
   * fails, that is what happened, and the question is whether the old logs
   * still matter rather than whether the new numbers look fine.
   */
  it("produces exactly these dice for this seed", () => {
    expect(series("kad-golden", 12)).toEqual([16, 15, 5, 12, 17, 5, 14, 19, 3, 4, 15, 8]);
  });

  it("produces exactly these dice for a numeric seed", () => {
    // The numeric arm skips `hashSeed` entirely, so it needs its own pin.
    expect(series(12345, 6)).toEqual([20, 7, 10, 17, 11, 7]);
  });

  it("starts the stream at exactly this float", () => {
    // `rollD20` quantises to twenty buckets, which hides a small drift in the
    // underlying float. This is the unquantised version of the same promise.
    expect(makeRng("kad-golden").next()).toBe(0.7769988141953945);
  });
});
