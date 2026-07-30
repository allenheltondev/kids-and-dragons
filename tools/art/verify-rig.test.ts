/**
 * `compareRigToContract` — the judgement half of the rig verifier.
 *
 * These tests exist because of the shape of the problem. `introspectRiv` turns a
 * `.riv` into a `RigIntrospection` and cannot currently run headlessly (see its
 * note), so if the comparison logic lived inside it, the first exercise it ever
 * got would be the first rig somebody delivered — at which point a false pass is
 * indistinguishable from a real one, and a false failure sends an artist back to
 * re-export art that was fine.
 *
 * So the introspection is a thin adapter and everything with an opinion is here,
 * fed fabricated rigs. The contract is the real one out of `assets/manifest.json`
 * on purpose: a test against a fixture contract would keep passing after somebody
 * renamed a clip.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareRigToContract, type RigIntrospection } from "./verify-rig.ts";

const MANIFEST = fileURLToPath(new URL("../../assets/manifest.json", import.meta.url));
const contract = (JSON.parse(readFileSync(MANIFEST, "utf8")) as {
  rigContract: Parameters<typeof compareRigToContract>[1];
}).rigContract;

/** A rig that satisfies the contract for `kind`, built from the contract itself. */
function goodRig(kind: "hero" | "enemy"): RigIntrospection {
  const clips = (contract.sets[kind] ?? []).map((name) => {
    const spec = contract.clips[name];
    return { name, ticks: spec?.ticks ?? 0, loop: spec?.loop === true };
  });
  const inputs = [
    ...contract.inputs.triggers.map((name) => ({ name, kind: "trigger" as const })),
    ...contract.inputs.booleans.map((name) => ({ name, kind: "boolean" as const })),
    ...contract.inputs.numbers.map((name) => ({ name, kind: "number" as const })),
  ];
  return { clips, inputs };
}

/** The labels of the problems found, for compact assertions. */
function labels(rig: RigIntrospection, kind = "hero"): string[] {
  return compareRigToContract(rig, contract, kind).map((p) => p.label);
}

describe("a rig that matches the contract", () => {
  it("passes clean for a hero", () => {
    expect(compareRigToContract(goodRig("hero"), contract, "hero")).toEqual([]);
  });

  it("passes clean for an enemy, with five clips and not twelve", () => {
    // §9.5.2: an enemy gets idle, walk, attack, hurt, down. If this ever needs
    // the hero set, the contract changes first — the excluded six each have a
    // reason there and every reason is an engine fact.
    const rig = goodRig("enemy");
    expect(rig.clips).toHaveLength(5);
    expect(compareRigToContract(rig, contract, "enemy")).toEqual([]);
  });

  it("passes without the deferred clip", () => {
    // `transform` is Chapter 5's and marked deferred, so its absence is not a
    // failure. Nothing else in the set may go missing this way.
    const rig = goodRig("hero");
    rig.clips = rig.clips.filter((c) => c.name !== "transform");
    expect(compareRigToContract(rig, contract, "hero")).toEqual([]);
  });

  it("still checks a deferred clip that shipped anyway", () => {
    // Deferred means "may be absent", not "unchecked". A wrong transform is
    // worse than no transform: it plays at the most-watched moment in the game.
    const rig = goodRig("hero");
    const transform = rig.clips.find((c) => c.name === "transform");
    if (!transform) throw new Error("bad fixture");
    transform.ticks = 90;
    expect(labels(rig)).toEqual(['clip "transform"  length']);
  });
});

describe("clips", () => {
  it("reports one that is missing", () => {
    const rig = goodRig("hero");
    rig.clips = rig.clips.filter((c) => c.name !== "celebrate");
    expect(labels(rig)).toEqual(['clip "celebrate"']);
  });

  it("reports every missing clip, not just the first", () => {
    // A rigger should get one list and one re-export, not four rounds of CI.
    const rig = goodRig("hero");
    rig.clips = rig.clips.filter((c) => !["guard", "leap", "lift"].includes(c.name));
    expect(labels(rig)).toEqual(['clip "guard"', 'clip "leap"', 'clip "lift"']);
  });

  it("reports a clip whose length disagrees, by one tick", () => {
    /*
     * Equality, not a tolerance. Ticks are whole frames at 12fps and §9.2 derives
     * every count from the turn budget, so "one off" is a desynchronised effect
     * and a budget nobody re-checked. A tolerance here would let the drift become
     * permanent one tick at a time.
     */
    const rig = goodRig("hero");
    const attack = rig.clips.find((c) => c.name === "attack");
    if (!attack) throw new Error("bad fixture");
    attack.ticks += 1;
    const [problem] = compareRigToContract(rig, contract, "hero");
    expect(problem?.label).toBe('clip "attack"  length');
    expect(problem?.expected).toContain("8 ticks");
    expect(problem?.actual).toBe("9 ticks");
  });

  it("reports a hold clip that loops", () => {
    // Brace is a plant and a hold (§9.2) because `protect` lasts until your next
    // turn. Looped, it replays its own wind-up forever.
    const rig = goodRig("hero");
    const guard = rig.clips.find((c) => c.name === "guard");
    if (!guard) throw new Error("bad fixture");
    guard.loop = true;
    expect(labels(rig)).toEqual(['clip "guard"  loop']);
  });

  it("reports a loop clip that plays once", () => {
    const rig = goodRig("hero");
    const idle = rig.clips.find((c) => c.name === "idle");
    if (!idle) throw new Error("bad fixture");
    idle.loop = false;
    expect(labels(rig)).toEqual(['clip "idle"  loop']);
  });

  it("says nothing about the loop flag of a clip the contract does not pin", () => {
    // `down` is a one-shot that hands off to a loop, which Rive expresses as two
    // clips. Asserting either way would be inventing a rule.
    const rig = goodRig("hero");
    const down = rig.clips.find((c) => c.name === "down");
    if (!down) throw new Error("bad fixture");
    down.loop = !down.loop;
    expect(compareRigToContract(rig, contract, "hero")).toEqual([]);
  });

  it("reports a clip the contract has never heard of", () => {
    const rig = goodRig("hero");
    rig.clips.push({ name: "backflip", ticks: 12, loop: false });
    expect(labels(rig)).toEqual(['clip "backflip"  unknown']);
  });

  it("reports a typo as both a missing clip and an unknown one", () => {
    /*
     * The pair is the point. "celebrate is missing" alone reads as unfinished
     * work; "celebrait is unknown" alone reads as a stray extra. Together they
     * are unmistakably one renamed clip, which is a one-character fix.
     */
    const rig = goodRig("hero");
    const clip = rig.clips.find((c) => c.name === "celebrate");
    if (!clip) throw new Error("bad fixture");
    clip.name = "celebrait";
    expect(labels(rig)).toEqual(['clip "celebrate"', 'clip "celebrait"  unknown']);
  });

  it("reports a hero clip on an enemy rig as the wrong set, not as unknown", () => {
    // A different message on purpose: `cast` is a real clip with a documented
    // reason for not being an enemy's (§9.5.2), so the fix is to argue with the
    // contract rather than to rename anything.
    const rig = goodRig("enemy");
    rig.clips.push({ name: "cast", ticks: 10, loop: false });
    const [problem] = compareRigToContract(rig, contract, "enemy");
    expect(problem?.label).toBe('clip "cast"  not in the enemy set');
    expect(problem?.actual).toContain("the other kind");
  });
});

describe("state machine inputs", () => {
  it("reports one that is missing", () => {
    const rig = goodRig("hero");
    rig.inputs = rig.inputs.filter((i) => i.name !== "helpUp");
    expect(labels(rig)).toEqual(['input "helpUp"']);
  });

  it("reports one declared as the wrong kind", () => {
    // The client fires a trigger and reads a boolean. Swap them and the tap
    // compiles, runs, and does nothing.
    const rig = goodRig("hero");
    const attack = rig.inputs.find((i) => i.name === "attack");
    if (!attack) throw new Error("bad fixture");
    attack.kind = "boolean";
    const [problem] = compareRigToContract(rig, contract, "hero");
    expect(problem?.label).toBe('input "attack"  kind');
    expect(problem?.expected).toBe("trigger");
    expect(problem?.actual).toBe("boolean");
  });

  it("requires the full input set on an enemy rig too", () => {
    /*
     * Deliberate, and the one place this could reasonably go the other way. An
     * enemy has five clips but the same inputs, because art-pipeline §6.1's rule
     * is that game code never special-cases a rig — a client that has to know
     * which inputs exist before firing one is that special case. Firing `cast`
     * at a wolf is a no-op transition, which is cheap; a missing input is a
     * runtime lookup failure, which is not.
     */
    const rig = goodRig("enemy");
    rig.inputs = rig.inputs.filter((i) => i.name !== "celebrate");
    expect(labels(rig, "enemy")).toEqual(['input "celebrate"']);
  });

  it("ignores an extra input the contract does not name", () => {
    // Unlike an extra clip. An input costs nothing unfired, and a rigger's own
    // scratch input is not a defect — where an unasked-for *clip* is animation
    // work nobody costed.
    const rig = goodRig("hero");
    rig.inputs.push({ name: "blinkNow", kind: "trigger" });
    expect(compareRigToContract(rig, contract, "hero")).toEqual([]);
  });
});

describe("an unknown kind", () => {
  it("fails once, rather than reporting every clip as unexpected", () => {
    const problems = compareRigToContract(goodRig("hero"), contract, "boss");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.expected).toContain("hero");
  });
});

describe("an empty rig", () => {
  it("reports every required clip and input rather than throwing", () => {
    // The shape a failed introspection would produce if it ever returned instead
    // of erroring. It must be a legible list, not a crash.
    const problems = compareRigToContract({ clips: [], inputs: [] }, contract, "hero");
    const required = contract.sets.hero ?? [];
    const deferred = required.filter((c) => contract.clips[c]?.deferred).length;
    const inputs =
      contract.inputs.triggers.length +
      contract.inputs.booleans.length +
      contract.inputs.numbers.length;
    expect(problems).toHaveLength(required.length - deferred + inputs);
  });
});
