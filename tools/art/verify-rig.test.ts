/**
 * `compareRigToContract` — the judgement half of the rig verifier.
 *
 * These tests exist because of the shape of the problem. `introspectRiv` turns a
 * `.riv` into a `RigIntrospection` through the real Rive runtime — which *does*
 * run headlessly (an earlier version of both files claimed otherwise; see its
 * note for what actually happened) — but it can only ever be exercised against
 * a real `.riv`, and none has been delivered yet. If the comparison logic lived
 * inside it, the first exercise it ever got would be the first rig somebody
 * delivered — at which point a false pass is indistinguishable from a real one,
 * and a false failure sends an artist back to re-export art that was fine.
 *
 * So the introspection is a thin adapter and everything with an opinion is here,
 * fed fabricated rigs — plus the adapter's two pure helpers (`riveInputKinds`,
 * `riveClipTicks`), which are the parts of it that can be wrong without wasm in
 * the room, and the two manifest-driven checks (`checkEffectSync`,
 * `checkTurnBudget`), judged through a `Report` whose writer is injected so the
 * run stays quiet. The contract and effects are the real ones out of
 * `assets/manifest.json` on purpose: a test against a fixture contract would
 * keep passing after somebody renamed a clip or repointed a sheet.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkEffectSync,
  checkTurnBudget,
  compareRigToContract,
  Report,
  riveClipTicks,
  riveInputKinds,
  type EffectEntry,
  type RigContract,
  type RigIntrospection,
} from "./verify-rig.ts";

const MANIFEST = fileURLToPath(new URL("../../assets/manifest.json", import.meta.url));
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
  rigContract: RigContract;
  effects: EffectEntry[];
};
const contract = manifest.rigContract;

/** A rig that satisfies the contract for `kind`, built from the contract itself. */
// The return type narrows `inputs` to non-null: a good rig by definition has a
// state machine, and the tests below poke at its inputs without null checks.
function goodRig(
  kind: "hero" | "enemy",
): RigIntrospection & { inputs: NonNullable<RigIntrospection["inputs"]> } {
  const clips = (contract.sets[kind] ?? []).map((name) => {
    const spec = contract.clips[name];
    return { name, ticks: spec?.ticks ?? 0, loop: spec?.loop === true };
  });
  // A set clip that names a hand-off loop (`down` → `down_loop`) requires it
  // delivered too — a second Rive animation, looping, at `loopTicks` long.
  for (const name of contract.sets[kind] ?? []) {
    const spec = contract.clips[name];
    if (spec?.loopClip) clips.push({ name: spec.loopClip, ticks: spec.loopTicks ?? 0, loop: true });
  }
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

  it("passes clean for an enemy, with six animations and not the hero's set", () => {
    // §9.5.2: an enemy gets idle, walk, attack, hurt, down — five set clips,
    // and `down`'s hand-off loop rides along as the sixth animation. If this
    // ever needs the hero set, the contract changes first — the excluded six
    // each have a reason there and every reason is an engine fact.
    const rig = goodRig("enemy");
    expect(rig.clips).toHaveLength(6);
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

  it("reports a clip defined twice, even when the surviving copy looks right", () => {
    /*
     * Rive will happily export two animations with one name, and the comparison
     * keys clips by name — so before this check, the last duplicate silently won
     * and the rig passed on whichever copy export order happened to favour. Both
     * copies here match the contract exactly; the duplication itself is the bug,
     * because nothing guarantees the *played* copy is the *checked* copy.
     */
    const rig = goodRig("hero");
    const attack = rig.clips.find((c) => c.name === "attack");
    if (!attack) throw new Error("bad fixture");
    rig.clips.push({ ...attack });
    expect(labels(rig)).toEqual(['clip "attack"  duplicated']);
  });

  it("reports a duplicate and still judges the copy that would win", () => {
    // The last copy is the one the Map keeps, so its wrong length is reported
    // alongside the duplication — one export, both facts.
    const rig = goodRig("hero");
    const attack = rig.clips.find((c) => c.name === "attack");
    if (!attack) throw new Error("bad fixture");
    rig.clips.push({ ...attack, ticks: attack.ticks + 1 });
    expect(labels(rig)).toEqual(['clip "attack"  duplicated', 'clip "attack"  length']);
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

describe("the down/down_loop hand-off", () => {
  /*
   * `down` is a one-shot into a named loop — two Rive animations for one
   * contract row. The name comes from `down.loopClip`, so these tests read it
   * from the manifest rather than repeating the string: rename the loop there
   * and they follow.
   */
  const loopName = contract.clips.down?.loopClip ?? "";

  it("names the loop in the contract, so the pairing is checkable at all", () => {
    expect(loopName).toBe("down_loop");
    expect(contract.clips.down?.loopTicks).toBe(24);
  });

  it("fails a rig that delivers down without its loop", () => {
    // The exact false comfort §9.3 forbids: the figure falls, then freezes —
    // and a frozen pose reads as a corpse.
    const rig = goodRig("hero");
    rig.clips = rig.clips.filter((c) => c.name !== loopName);
    const [problem] = compareRigToContract(rig, contract, "hero");
    expect(problem?.label).toBe(`clip "${loopName}"`);
    expect(problem?.expected).toContain("24 ticks");
  });

  it("does not report the loop as unknown when only its host is missing", () => {
    // The loop is contract, not surplus: a rig missing `down` is missing
    // `down`, and shipping `down_loop` was right, not extra.
    const rig = goodRig("hero");
    rig.clips = rig.clips.filter((c) => c.name !== "down");
    expect(labels(rig)).toEqual(['clip "down"']);
  });

  it("checks the loop's length against loopTicks", () => {
    const rig = goodRig("hero");
    const loop = rig.clips.find((c) => c.name === loopName);
    if (!loop) throw new Error("bad fixture");
    loop.ticks = 12;
    const [problem] = compareRigToContract(rig, contract, "hero");
    expect(problem?.label).toBe(`clip "${loopName}"  length`);
    expect(problem?.expected).toContain("24 ticks");
  });

  it("requires the loop to actually loop", () => {
    // A breathing loop that plays once is a figure that stops breathing —
    // §9.3's frozen pose, arriving one loop later.
    const rig = goodRig("hero");
    const loop = rig.clips.find((c) => c.name === loopName);
    if (!loop) throw new Error("bad fixture");
    loop.loop = false;
    expect(labels(rig)).toEqual([`clip "${loopName}"  loop`]);
  });

  it("requires the loop on enemy rigs too, since their set has down", () => {
    const rig = goodRig("enemy");
    rig.clips = rig.clips.filter((c) => c.name !== loopName);
    expect(labels(rig, "enemy")).toEqual([`clip "${loopName}"`]);
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

  it("reports a rig with no state machine as one failure, not one per input", () => {
    /*
     * `inputs: null` is `introspectRiv`'s way of saying "the default artboard
     * has no state machine at all" — a different fact from a machine with zero
     * inputs, which is the empty array. The fix for a missing machine is one
     * machine; a message listing eleven missing inputs points the rigger at
     * eleven fixes that are not the fix.
     */
    const rig = goodRig("hero");
    const problems = compareRigToContract({ clips: rig.clips, inputs: null }, contract, "hero");
    expect(problems).toHaveLength(1);
    expect(problems[0]?.label).toBe("state machine");
    expect(problems[0]?.actual).toContain("no state machine");
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
    // of erroring. It must be a legible list, not a crash. `inputs: []` is a
    // state machine with nothing on it — a machine that is missing outright is
    // `inputs: null` and one failure, tested above.
    const problems = compareRigToContract({ clips: [], inputs: [] }, contract, "hero");
    const required = contract.sets.hero ?? [];
    const deferred = required.filter((c) => contract.clips[c]?.deferred).length;
    // A non-deferred set clip that names a hand-off loop is two missing
    // animations, not one. (A deferred host's loop may be absent with it.)
    const companions = required.filter(
      (c) => contract.clips[c]?.loopClip && !contract.clips[c]?.deferred,
    ).length;
    const inputs =
      contract.inputs.triggers.length +
      contract.inputs.booleans.length +
      contract.inputs.numbers.length;
    expect(problems).toHaveLength(required.length - deferred + companions + inputs);
  });
});

/*
 * The two data-driven checks below are judged through a quiet Report — the
 * writer is injected, so the test run stays legible — and, like everything
 * else in this file, against fixtures built *from* the real manifest, so drift
 * between the manifest and these expectations breaks tests rather than hiding.
 */

/** Run a check quietly, keeping the printed lines for the assertions that need them. */
function quietly(
  run: (rep: Report) => void,
): { failures: string[]; warnings: string[]; passed: number; lines: string[] } {
  const lines: string[] = [];
  const rep = new Report((line) => lines.push(line));
  run(rep);
  return { failures: rep.failures, warnings: rep.warnings, passed: rep.passed, lines };
}

describe("checkEffectSync, derived from the manifest's startsOn", () => {
  it("passes the real manifest: every declared pairing hits a real event", () => {
    const { failures } = quietly((rep) => checkEffectSync(rep, contract, manifest.effects));
    expect(failures).toEqual([]);
  });

  it("fails an effect whose startsOn names a clip the contract lacks", () => {
    const effects = structuredClone(manifest.effects);
    const strike = effects.find((e) => e.id === "impact_strike");
    if (!strike) throw new Error("bad fixture");
    strike.startsOn = { clip: "atack", event: "impact" };
    const { failures } = quietly((rep) => checkEffectSync(rep, contract, effects));
    expect(failures).toEqual(["effect sync  impact_strike"]);
  });

  it("fails an effect whose startsOn names an event its clip does not expose", () => {
    const effects = structuredClone(manifest.effects);
    const bloom = effects.find((e) => e.id === "heal_bloom");
    if (!bloom) throw new Error("bad fixture");
    bloom.startsOn = { clip: "cast", event: "bloom" };
    const { failures } = quietly((rep) => checkEffectSync(rep, contract, effects));
    expect(failures).toEqual(["effect sync  heal_bloom"]);
  });

  it("fails an effect that declares no startsOn at all", () => {
    // `startsOn: null` is an answer (ambient); no field is dodging the
    // question, which is the pre-manifest silence this check replaced.
    const effects = structuredClone(manifest.effects);
    const star = effects.find((e) => e.id === "burst_star");
    if (!star) throw new Error("bad fixture");
    delete star.startsOn;
    const { failures } = quietly((rep) => checkEffectSync(rep, contract, effects));
    expect(failures).toEqual(["effect sync  burst_star"]);
  });

  it("fails a sheet on a different clock from the contract's tick", () => {
    const effects = structuredClone(manifest.effects);
    const strike = effects.find((e) => e.id === "impact_strike");
    if (!strike) throw new Error("bad fixture");
    strike.fps = 24;
    const { failures } = quietly((rep) => checkEffectSync(rep, contract, effects));
    expect(failures).toEqual(["effect sync  impact_strike"]);
  });

  it("skips an ambient loop (startsOn: null) instead of failing or passing it", () => {
    const aura = manifest.effects.filter((e) => e.startsOn === null);
    expect(aura.length).toBeGreaterThan(0);
    const { failures, passed, lines } = quietly((rep) => checkEffectSync(rep, contract, aura));
    expect(failures).toEqual([]);
    // Nothing checked is not a pass — but the skip is said out loud.
    expect(passed).toBe(0);
    expect(lines.join("\n")).toContain("ambient");
  });

  it("warns, and does not fail, on an event no effect consumes", () => {
    // leap's `dust` — dust_scuff is specified (§9.7 item 1) but not
    // commissioned, and undelivered work is tolerated, not silently dropped.
    const { failures, warnings } = quietly((rep) =>
      checkEffectSync(rep, contract, manifest.effects),
    );
    expect(failures).toEqual([]);
    expect(warnings.some((w) => w.includes("leap.dust"))).toBe(true);
  });

  it("does not warn about an event a concurrent clip consumes", () => {
    // lift's `contact` is consumed twice over (revive_lift and revive); it
    // must not be reported idle even if the sheet went away.
    const effects = manifest.effects.filter((e) => e.id !== "revive_lift");
    const { warnings } = quietly((rep) => checkEffectSync(rep, contract, effects));
    expect(warnings.some((w) => w.includes("lift.contact"))).toBe(false);
  });
});

describe("checkTurnBudget, including concurrent overhangs", () => {
  it("passes the real contract at exactly 45/45 — zero headroom, by design", () => {
    // §9.2: the ceiling is the cast turn, and the budget is spent at 100%.
    // If this number moves in either direction, the contract changed and the
    // brief's arithmetic has to be redone before anything ships.
    const { failures, lines } = quietly((rep) =>
      checkTurnBudget(rep, contract, manifest.effects),
    );
    expect(failures).toEqual([]);
    expect(lines.join("\n")).toContain("45/45");
  });

  it("charges a concurrent clip's overhang to the turn of the clip that hosts it", () => {
    /*
     * The synthetic retiming the brief warns about: stretch `revive` and the
     * Help Up turn must grow, even though `revive` is concurrent and the old
     * check excluded it unconditionally. 40 ticks from the lift's contact at
     * 6 ends at 45; the lift ends at 10; move 12 + lift 10 + overhang 35 = 57.
     */
    const ctr = structuredClone(contract);
    if (!ctr.clips.revive || !ctr.clips.lift) throw new Error("bad fixture");
    ctr.clips.revive.ticks = 40;
    const { failures, lines } = quietly((rep) => checkTurnBudget(rep, ctr, manifest.effects));
    expect(failures).toEqual(["turn budget"]);
    const out = lines.join("\n");
    expect(out).toContain("57 ticks");
    expect(out).toContain("revive overhang");
  });

  it("is indifferent to an overhang the host clip already covers", () => {
    // `hurt` starts at the attack's impact (tick 3) and ends at 7, inside the
    // attack's 8 — concurrency that really is free stays free.
    const ctr = structuredClone(contract);
    if (!ctr.clips.hurt) throw new Error("bad fixture");
    ctr.clips.hurt.ticks = 6; // ends exactly with the attack
    const { failures } = quietly((rep) => checkTurnBudget(rep, ctr, manifest.effects));
    expect(failures).toEqual([]);
  });

  it("fails a concurrent clip that declares no startsOn", () => {
    // Without a start tick the overhang is unmeasurable, and the budget would
    // be back to taking `concurrent` on faith — the bug this field closed.
    const ctr = structuredClone(contract);
    if (!ctr.clips.revive) throw new Error("bad fixture");
    delete ctr.clips.revive.startsOn;
    const { failures } = quietly((rep) => checkTurnBudget(rep, ctr, manifest.effects));
    expect(failures).toEqual(['turn budget  concurrent clip "revive"']);
  });

  it("fails a concurrent clip whose startsOn names an event that is not there", () => {
    const ctr = structuredClone(contract);
    if (!ctr.clips.revive) throw new Error("bad fixture");
    ctr.clips.revive.startsOn = { clip: "lift", event: "grab" };
    const { failures } = quietly((rep) => checkTurnBudget(rep, ctr, manifest.effects));
    expect(failures).toEqual(['turn budget  concurrent clip "revive"']);
  });

  it("reads effect tails from the manifest's startsOn, not from a table", () => {
    // Point burst_star at the attack instead and the worst turn moves with the
    // data: attack picks up a 12-frame tail from its tick-3 impact (ticks 3–14,
    // 6 past its 8), so the worst turn becomes 18 + 12 + 8 + 6 = 44 — the
    // attack turn, because the cast turn lost its sheets and fell to 40.
    const effects = structuredClone(manifest.effects).filter((e) => e.id !== "heal_bloom");
    const star = effects.find((e) => e.id === "burst_star");
    if (!star) throw new Error("bad fixture");
    star.startsOn = { clip: "attack", event: "impact" };
    const { failures, lines } = quietly((rep) => checkTurnBudget(rep, contract, effects));
    expect(failures).toEqual([]);
    expect(lines.join("\n")).toContain("attack 8 + 6 tick(s) of effect tail");
  });
});

describe("riveInputKinds", () => {
  it("builds the code table from the runtime's statics, not from memory", () => {
    /*
     * These literals are what @rive-app/canvas-advanced 2.39.1 actually reports
     * for SMIInput.bool/.number/.trigger, verified by running the runtime. The
     * hardcoded table this replaced said 59=trigger and 122=boolean — wrong on
     * both counts for the installed build, and unnoticeable until a rig
     * shipped. The point of the helper is that the codes come in as data.
     */
    expect(riveInputKinds({ bool: 59, number: 56, trigger: 58 })).toEqual({
      59: "boolean",
      56: "number",
      58: "trigger",
    });
  });

  it("follows the statics wherever a future build moves them", () => {
    expect(riveInputKinds({ bool: 1, number: 2, trigger: 3 })).toEqual({
      1: "boolean",
      2: "number",
      3: "trigger",
    });
  });
});

describe("riveClipTicks", () => {
  it("restates a duration on the contract's clock", () => {
    // 24 frames at 24fps is one second; one second on a 12-tick clock is 12.
    const anim = { duration: 24, fps: 24, workStart: 0, workEnd: 0, enableWorkArea: false };
    expect(riveClipTicks(anim, 12)).toBe(12);
  });

  it("uses the work area, not the raw duration, when one is enabled", () => {
    /*
     * An animator's scratch frames outside the work area are not part of the
     * clip. Measuring `duration` here would call a to-spec clip "too long" and
     * send someone hunting a length problem that does not exist.
     */
    const anim = { duration: 60, fps: 60, workStart: 12, workEnd: 52, enableWorkArea: true };
    expect(riveClipTicks(anim, 12)).toBe(8); // (52-12) frames at 60fps = 8 ticks
  });

  it("ignores a work area the animation carries but has not enabled", () => {
    const anim = { duration: 24, fps: 12, workStart: 2, workEnd: 20, enableWorkArea: false };
    expect(riveClipTicks(anim, 12)).toBe(24);
  });

  it("falls back to workEnd > 0 when the build has no enableWorkArea flag", () => {
    // The published .d.ts omits the flag; on such a surface an unset work area
    // reads workEnd 0, and a set one reads its end frame.
    expect(riveClipTicks({ duration: 100, fps: 12, workStart: 2, workEnd: 14 }, 12)).toBe(12);
    expect(riveClipTicks({ duration: 100, fps: 12, workStart: 0, workEnd: 0 }, 12)).toBe(100);
  });

  it("rounds to the nearest whole tick", () => {
    // 20 frames at 30fps is 0.667s = 8 ticks exactly; 21 frames is 8.4 → 8.
    expect(riveClipTicks({ duration: 20, fps: 30, workStart: 0, workEnd: 0 }, 12)).toBe(8);
    expect(riveClipTicks({ duration: 21, fps: 30, workStart: 0, workEnd: 0 }, 12)).toBe(8);
  });

  it("answers 0 rather than Infinity for a zero-fps animation", () => {
    expect(riveClipTicks({ duration: 24, fps: 0, workStart: 0, workEnd: 0 }, 12)).toBe(0);
  });
});
