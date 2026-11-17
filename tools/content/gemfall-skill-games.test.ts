import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIntent, carryState, crossingWindow, haulNeeded, interactionActor, skillSteps, steadySituation, type Chapter, type InteractionPrompt, type InteractionScene, type RunState } from "@kad/shared";
import { context } from "./riftlight-test-support.ts";
import { act, landed, open, promptOf, solve } from "./interaction-play.ts";

const chapters = fs.readdirSync("content/chapters").filter(f => f.startsWith("gemfall-")).map(f => JSON.parse(fs.readFileSync(`content/chapters/${f}`, "utf8")) as Chapter);
const scenes = chapters.flatMap(chapter => Object.entries(chapter.scenes).filter((e): e is [string, InteractionScene] => e[1].type === "interaction").map(([id, scene]) => ({ chapter, id, scene })));
const ids = (s: RunState) => s.party.filter(m => m.connected).map(m => m.playerId);
const actor = (s: RunState) => interactionActor(promptOf(s), ids(s))!;
const start = (c: Chapter, id: string, size = 2, relaxed = false) => { const s = open(c, id, size); return act(c, s, { action: "start", rulesVersion: 4, relaxed }, actor(s)); };
const commit = (c: Chapter, s: RunState, extra: { position?: number; angle?: number; answer?: string[]; testOnly?: boolean } = {}, player = actor(s)) => act(c, s, { action: "commit", round: promptOf(s).challenge!.round, ...extra }, player, 60000);
function round(c: Chapter, s: RunState): RunState {
  const p = promptOf(s), spec = p.spec;
  if (spec.kind === "precision") { const t = steadySituation(p); return commit(c, s, { angle: t.support, position: t.load }); }
  if (spec.kind === "timing") return commit(c, s, { position: crossingWindow(p).start + .01 });
  if (spec.kind === "balance") {
    const carry = carryState(p, ids(s));
    for (const id of ids(s)) {
      const target = carry.left.includes(id) ? .5 + carry.shift : .5;
      const delta = Math.round((target - (promptOf(s).levels?.[id] ?? 0)) * 4);
      if (delta) s = act(c, s, { action: "adjust", round: p.challenge!.round, direction: delta > 0 ? "up" : "down", steps: Math.abs(delta) }, id);
    }
    return commit(c, s);
  }
  if (spec.kind === "cooperate") {
    for (const id of ids(s)) s = commit(c, s, { position: haulNeeded(promptOf(s), ids(s), id) }, id);
    return s;
  }
  if (spec.kind === "memory" || spec.kind === "sequence") return commit(c, s, { answer: spec.answer });
  if (spec.kind === "tracking") return commit(c, s, { answer: [String(spec.swaps.reduce((at, [a, b]) => at === a ? b : at === b ? a : at, spec.start))] });
  throw Error("Use the relay/free play rules.");
}

describe("Gemfall's deliberate skill games", () => {
  it.each([1, 2, 4])("completes every authored scene with %i heroes, ordinary and relaxed", size => {
    for (const { chapter, id, scene } of scenes) for (const relaxed of [false, true]) {
      let s = ["relay", "play"].includes(scene.interaction.kind) ? solve(chapter, open(chapter, id, size)) : start(chapter, id, size, relaxed);
      for (let n = 0; promptOf(s).phase === "active" && n < 12; n++) s = round(chapter, s);
      expect(promptOf(s).outcome, `${chapter.id}/${id}`).toBe("success");
      expect(landed(chapter, s, actor(s)).sceneId).toBe(scene.onSuccess.goto);
    }
  });
  it("separates support errors, under-effort and excessive pressure, and preserves recovery after reload", () => {
    const c = chapters.find(c => c.id === "gemfall-04b")!, s = start(c, "interaction_calf_load");
    const t = steadySituation(promptOf(s));
    const off = commit(c, s, { angle: 0, position: t.load });
    const low = commit(c, s, { angle: t.support, position: 0 });
    const high = commit(c, s, { angle: t.support, position: 1 });
    expect(promptOf(off).challenge!.feedback).toMatch(/support point/);
    expect(promptOf(low).challenge!.feedback).toMatch(/Add a little/);
    expect(promptOf(high).challenge!.feedback).toMatch(/Too much/);
    const near = commit(c, s, { angle: t.support, position: t.load + t.tolerance + .02 });
    expect(promptOf(near).challenge!.strain).toBeLessThan(promptOf(high).challenge!.strain);
    expect(steadySituation(promptOf(near)).tolerance).toBeGreaterThan(t.tolerance);
    let recovered = JSON.parse(JSON.stringify(near)) as RunState;
    while (promptOf(recovered).phase === "active") recovered = round(c, recovered);
    expect(promptOf(recovered).outcome).toBe("success");
  });
  it("rejects stale, invalid and out-of-turn actions without changing the attempt", () => {
    const c = chapters.find(c => c.id === "gemfall-04b")!, s = start(c, "interaction_calf_load");
    const p = promptOf(s), before = JSON.stringify(s);
    for (const [playerId, extra] of [[ids(s)[1]!, { position: .5, angle: .5, round: 0 }], [actor(s), { position: NaN, angle: .5, round: 0 }], [actor(s), { position: .5, angle: 2, round: 0 }], [actor(s), { position: .5, angle: .5, round: 99 }]] as const) {
      const result = applyIntent(s, { playerId, intent: { type: "INTERACT", action: "commit", openedSeq: p.openedSeq, attempt: p.attempt, rulesVersion: 4, ...extra } }, context(c));
      expect(result.error).toBeDefined(); expect(JSON.stringify(s)).toBe(before);
    }
  });
  it("makes the near rope's leverage matter and lets a friend compensate", () => {
    const c = chapters.find(c => c.id === "gemfall-07r")!, s = start(c, "interaction_haul_team");
    const [near, far] = ids(s) as [string, string];
    const set = commit(c, s, { position: .2 }, near);
    expect(haulNeeded(promptOf(set), ids(set), far)).toBeCloseTo(.7);
    const moved = commit(c, set, { position: .7 }, far);
    expect(promptOf(moved).challenge!.progress).toBe(1);
    const weak = commit(c, commit(c, s, { position: .1 }, near), { position: .1 }, far);
    expect(promptOf(weak).challenge).toMatchObject({ progress: 0, strain: 0 });
    const rough = commit(c, commit(c, s, { position: 1 }, near), { position: 1 }, far);
    expect(promptOf(rough).challenge!.strain).toBeGreaterThan(0);
    const revised = commit(c, commit(c, s, { position: 1 }, near), { position: .2 }, near);
    expect(promptOf(revised).challenge!.pulls[near]).toBe(.2);
    expect(promptOf(commit(c, revised, { position: .7 }, far)).challenge!.progress).toBe(1);
  });
  it("keeps active v2 saves and negotiates a cached phone back to v2 with actual stage credits", () => {
    const c = chapters.find(c => c.id === "gemfall-04b")!;
    let s = start(c, "interaction_calf_load", 4);
    s = round(c, s); s.party[1]!.connected = false; s = round(c, s);
    const p = promptOf(s), who = actor(s);
    const result = applyIntent(s, { playerId: who, intent: { type: "INTERACT", openedSeq: p.openedSeq, attempt: p.attempt, action: "commit", round: p.challenge!.round, position: .5 } }, context(c));
    expect(result.error).toBeUndefined();
    expect(promptOf(result.state).challenge!.version).toBeUndefined();
    expect(promptOf(result.state).challenge!.completed?.[s.party[2]!.playerId]).toBe(1);
    const opened = open(c, "interaction_calf_load", 2);
    const old = act(c, opened, { action: "start", rulesVersion: 2, relaxed: false }, actor(opened));
    expect(promptOf(old).challenge!.version).toBeUndefined();
    expect(skillSteps(promptOf(old), ids(old))).toBe(6);
  });
  it("requires a whole sequence before testing and reveals no correct prefix", () => {
    const c = chapters.find(c => c.id === "gemfall-01")!, s = start(c, "interaction_post_routes");
    const p = promptOf(s); if (p.spec.kind !== "sequence") throw Error();
    const tested = commit(c, s, { answer: [...p.spec.answer].reverse(), testOnly: true });
    expect(promptOf(tested).challenge!.matched).toBe(0);
    expect(promptOf(tested).phase).toBe("active");
  });
  it("keeps authored failure and helping-hand branches reachable", () => {
    for (const { chapter, id, scene } of scenes) {
      const opened = open(chapter, id, 2);
      const helped = act(chapter, opened, { action: "assist" }, actor(opened));
      expect(landed(chapter, helped, actor(helped)).sceneId).toBe((scene.onAssisted ?? scene.onSuccess).goto);
      if (!["precision", "timing", "balance", "cooperate"].includes(scene.interaction.kind)) continue;
      let s = start(chapter, id);
      if (scene.interaction.kind === "balance") for (const id of ids(s)) s = act(chapter, s, { action: "adjust", round: 0, direction: "up", steps: 4 }, id);
      for (let n = 0; n < 8 && promptOf(s).phase === "active"; n++) {
        if (scene.interaction.kind === "cooperate") for (const id of ids(s)) s = commit(chapter, s, { position: 1 }, id);
        else s = commit(chapter, s, { position: 0, angle: 0 });
      }
      expect(promptOf(s).outcome, `${chapter.id}/${id}`).toBe("failure");
      expect(landed(chapter, s, actor(s)).sceneId).toBe(scene.onFailure.goto);
    }
  });
  it("can finish a shared haul when the last unset phone disconnects", () => {
    const c = chapters.find(c => c.id === "gemfall-07r")!;
    let s = start(c, "interaction_haul_team");
    const [one, two] = ids(s) as [string, string];
    s = commit(c, s, { position: .4 }, one);
    s.party.find(m => m.playerId === two)!.connected = false;
    s = commit(c, s, { position: .4 }, one);
    expect(promptOf(s).challenge!.progress).toBe(1);
    while (promptOf(s).phase === "active") s = round(c, s);
    expect(promptOf(s).outcome).toBe("success");
  });
});
