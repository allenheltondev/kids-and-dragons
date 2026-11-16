import { describe, expect, it } from "vitest";
import { applyIntent, carryState, crossingOpenings, crossingSafe, crossingWindow, interactionActor, skillCompletions, skillSteps, throwFlight, throwSituation,
  type Chapter, type InteractionAction, type InteractionScene, type RunState } from "@kad/shared";
import { chapters, context } from "./riftlight-test-support.ts";
import { act, landed, open, promptOf, solve } from "./interaction-play.ts";

const scenes = [...chapters.values()].flatMap(chapter => Object.entries(chapter.scenes)
  .filter((entry): entry is [string, InteractionScene] => entry[1].type === "interaction")
  .map(([id, scene]) => ({ chapter, id, scene })));
const ids = (state: RunState) => state.party.filter(m => m.connected).map(m => m.playerId);
const actor = (state: RunState) => interactionActor(promptOf(state), ids(state))!;
function commit(chapter: Chapter, state: RunState, extra: { position?: number; angle?: number; answer?: string[]; testOnly?: boolean } = {}) {
  return act(chapter, state, { action: "commit", round: promptOf(state).challenge!.round, ...extra }, actor(state), 60000);
}
function start(chapter: Chapter, id: string, size = 2, relaxed = false) {
  const state = open(chapter, id, size);
  return act(chapter, state, { action: "start", rulesVersion: 3, relaxed }, actor(state));
}
function shot(state: RunState) {
  const p = promptOf(state), target = throwSituation(p);
  for (let a = 0; a <= 100; a += 5) for (let s = 0; s <= 100; s++) {
    const flight = throwFlight(p, s / 100, a / 100);
    if (Math.abs(flight.landing - target.target) < target.width / 2 && flight.clearance >= target.clearance) return { position: s / 100, angle: a / 100 };
  }
  throw Error(`Unreachable throw ${state.chapterId}/${state.sceneId} stage ${p.challenge!.progress}`);
}
function solveRound(chapter: Chapter, state: RunState): RunState {
  const p = promptOf(state), spec = p.spec;
  if (spec.kind === "precision") return commit(chapter, state, shot(state));
  if (spec.kind === "timing") return commit(chapter, state, { position: crossingWindow(p).start + .01 });
  if (spec.kind === "balance") {
    const carry = carryState(p, ids(state));
    for (const id of ids(state)) {
      const target = carry.left.includes(id) ? .5 + carry.shift : .5;
      const delta = Math.round((target - (promptOf(state).levels?.[id] ?? 0)) * 4);
      if (delta) state = act(chapter, state, { action: "adjust", round: p.challenge!.round, direction: delta > 0 ? "up" : "down", steps: Math.abs(delta) }, id);
    }
    return commit(chapter, state);
  }
  if (spec.kind === "memory" || spec.kind === "sequence") return commit(chapter, state, { answer: spec.answer });
  if (spec.kind === "tracking") {
    const cover = spec.swaps.reduce((at, [a,b]) => at === a ? b : at === b ? a : at, spec.start);
    return commit(chapter, state, { answer: [String(cover)] });
  }
  throw Error("Use the relay or free-play rules.");
}

describe("Riftlight's revised mini-games", () => {
  it.each([1, 2, 4])("finishes every authored game with %i heroes and takes its success branch", size => {
    for (const { chapter, id, scene } of scenes) {
      let state: RunState;
      if (scene.interaction.kind === "relay" || scene.interaction.kind === "play") state = solve(chapter, open(chapter, id, size));
      else {
        state = start(chapter, id, size);
        expect(promptOf(state).challenge!.version).toBe(3);
        for (let round = 0; promptOf(state).phase === "active" && round < 8; round++) state = solveRound(chapter, state);
      }
      expect(promptOf(state).outcome, `${chapter.id}/${id}`).toBe("success");
      expect(landed(chapter, state, actor(state)).sceneId).toBe(scene.onSuccess.goto);
    }
  });
  it("requires enough opening for the entire move, slows recovery, and rejects stale and out-of-turn moves", () => {
    const chapter = chapters.get("riftlight-stuttering-flats")!;
    const state = start(chapter, "cross_rhythm");
    const p = promptOf(state), w = crossingWindow(p);
    expect(crossingSafe(p, w.start + .01)).toBe(true);
    expect(crossingSafe(p, w.end - .01)).toBe(false);
    const short = crossingOpenings(p)[0]!;
    expect(short.end - short.start).toBeLessThan(w.travel);
    expect(crossingSafe(p, short.start)).toBe(false);
    const near = commit(chapter, state, { position: w.end - w.travel + .02 });
    const poor = commit(chapter, state, { position: 0 });
    expect(promptOf(near).challenge!.strain).toBeLessThan(promptOf(poor).challenge!.strain);
    expect(crossingWindow(promptOf(near)).periodMs).toBeGreaterThan(w.periodMs);
    const result = applyIntent(near, { playerId: actor(near), intent: { type: "INTERACT", openedSeq: p.openedSeq, attempt: p.attempt, action: "commit", round: 0, position: w.start } }, context(chapter));
    expect(result.error).toBeDefined();
    let recovered = solveRound(chapter, near);
    expect(actor(recovered)).not.toBe(actor(near));
    recovered = solveRound(chapter, recovered);
    expect(promptOf(recovered).outcome).toBe("success");
  });
  it("takes every revised game's authored failure branch after recoverable mistakes are exhausted", () => {
    for (const { chapter, id, scene } of scenes) {
      if (["relay", "play"].includes(scene.interaction.kind)) continue;
      let state = start(chapter, id);
      if (scene.interaction.kind === "balance") for (const playerId of ids(state)) state = act(chapter, state, { action: "adjust", round: 0, direction: "up", steps: 4 }, playerId);
      for (let round = 0; round < 10 && promptOf(state).phase === "active"; round++) {
        const p = promptOf(state), spec = p.spec;
        if (spec.kind === "precision") state = commit(chapter, state, { position: 0, angle: 0 });
        else if (spec.kind === "timing") state = commit(chapter, state, { position: 0 });
        else if (spec.kind === "balance") state = commit(chapter, state);
        else if (spec.kind === "tracking") {
          const target = spec.swaps.reduce((at, [a,b]) => at === a ? b : at === b ? a : at, spec.start);
          const wrong = spec.covers.findIndex((_, i) => i !== target && !p.challenge!.excluded.includes(String(i)));
          state = commit(chapter, state, { answer: [String(wrong)] });
        } else if (spec.kind === "sequence" || spec.kind === "memory") {
          const answer = [...spec.answer];
          answer[0] = spec.options.find(o => o.id !== answer[0])!.id;
          state = commit(chapter, state, { answer });
        }
      }
      expect(promptOf(state).outcome, `${chapter.id}/${id}`).toBe("failure");
      expect(landed(chapter, state, actor(state)).sceneId).toBe(scene.onFailure.goto);
    }
  });
  it("makes height, strength, wind and clearance matter, and preserves the situation across a miss and reload", () => {
    const chapter = chapters.get("riftlight-exchange-rift")!;
    const state = start(chapter, "barge_toss");
    const p = promptOf(state);
    expect(throwFlight(p, .5, .1).peak).toBeLessThan(throwFlight(p, .5, .9).peak);
    expect(throwFlight(p, .2, .5).landing).toBeLessThan(throwFlight(p, .7, .5).landing);
    const missed = commit(chapter, state, { position: 0, angle: 0 });
    expect(promptOf(missed).challenge!.feedback).toContain("Too low");
    const restored = JSON.parse(JSON.stringify(missed)) as RunState;
    expect(throwSituation(promptOf(restored)).wind).toBe(throwSituation(p).wind);
    const recovered = solveRound(chapter, restored);
    expect(promptOf(recovered).challenge!.progress).toBe(1);
    expect(throwSituation(promptOf(recovered)).wind).not.toBe(throwSituation(p).wind);
    for (const value of [NaN, Infinity, -1, 2]) {
      const current = promptOf(restored);
      const invalid: InteractionAction = { action: "commit", rulesVersion: 3, round: current.challenge!.round, position: .5, angle: value };
      expect(applyIntent(restored, { playerId: actor(restored), intent: { type: "INTERACT", openedSeq: current.openedSeq, attempt: current.attempt, ...invalid } }, context(chapter)).error).toBeDefined();
    }
  });
  it("keeps stages bounded when a hero disconnects and hands the next move to a connected phone", () => {
    const chapter = chapters.get("riftlight-exchange-rift")!;
    let state = start(chapter, "barge_toss", 4);
    state = solveRound(chapter, state);
    state.party.find(m => m.playerId === actor(state))!.connected = false;
    for (let round = 0; promptOf(state).phase === "active" && round < 5; round++) state = solveRound(chapter, state);
    expect(promptOf(state)).toMatchObject({ outcome: "success", challenge: { progress: 4 } });
  });
  it("makes opposite supports change tilt in opposite directions and lets a solo prop finish", () => {
    const chapter = chapters.get("riftlight-ashspan-bridge")!;
    let state = start(chapter, "carry_beam");
    const team = ids(state);
    const lift = (s: RunState, id: string) => act(chapter, s, { action: "adjust", round: 0, direction: "up", steps: 2 }, id);
    state = lift(state, team[0]!);
    expect(carryState(promptOf(state), team).tilt).toBeGreaterThan(0);
    state = lift(state, team[1]!);
    expect(carryState(promptOf(state), team).safe).toBe(true);
    state = commit(chapter, state);
    expect(carryState(promptOf(state), team).safe).toBe(false);
    const slipped = commit(chapter, state);
    expect(promptOf(slipped).challenge!.progress).toBe(1);
    expect(promptOf(slipped).challenge!.strain).toBeGreaterThan(0);
    expect(promptOf(solveRound(chapter, slipped)).challenge!.progress).toBe(2);
  });
  it("tests a complete plan without revealing which prefix is correct", () => {
    const { chapter, id, scene } = scenes.find(s => s.scene.interaction.kind === "sequence")!;
    if (scene.interaction.kind !== "sequence") throw Error();
    const answer = [...scene.interaction.answer];
    [answer[0], answer[1]] = [answer[1]!, answer[0]!];
    const tested = commit(chapter, start(chapter, id), { answer, testOnly: true });
    expect(promptOf(tested).challenge!.matched).toBe(0);
    expect(promptOf(tested).challenge!.feedback).toContain("parts respond");
    expect(promptOf(commit(chapter, tested, { answer: scene.interaction.answer })).outcome).toBe("success");
  });
  it("keeps older started saves on their original rules", () => {
    const chapter = chapters.get("riftlight-exchange-rift")!;
    const state = open(chapter, "barge_toss", 2);
    const legacy = act(chapter, state, { action: "start", relaxed: false, rulesVersion: 2 }, actor(state));
    expect(promptOf(legacy).challenge!.version).toBeUndefined();
  });
  it("negotiates shared v2 controls when a cached phone joins a revised game", () => {
    const chapter = chapters.get("riftlight-exchange-rift")!;
    const state = start(chapter, "barge_toss");
    const p = promptOf(state);
    if (p.spec.kind !== "precision") throw Error();
    const result = applyIntent(state, { playerId: actor(state), intent: { type: "INTERACT", openedSeq: p.openedSeq, attempt: p.attempt, action: "commit", round: 0, position: p.spec.target } }, context(chapter));
    expect(result.error).toBeUndefined();
    expect(promptOf(result.state)).toMatchObject({ compatibility: "legacy-controls", challenge: { progress: 1 } });
    expect(promptOf(result.state).challenge!.version).toBeUndefined();
  });
  it.each(["precision", "timing"] as const)("preserves actual %s stage credits and handoff through disconnect, v2 fallback, and return", kind => {
    const chapter = chapters.get("riftlight-exchange-rift")!;
    let state = start(chapter, kind === "precision" ? "barge_toss" : "ridge_walk", 4);
    const [a, b, c, d] = ids(state) as [string, string, string, string];
    state = solveRound(chapter, state);
    state.party.find(member => member.playerId === b)!.connected = false;
    expect(actor(state)).toBe(c);
    state = solveRound(chapter, state);
    expect(skillCompletions(promptOf(state))).toEqual({ [a]: 1, [c]: 1 });
    expect(actor(state)).toBe(d);
    state = JSON.parse(JSON.stringify(state)) as RunState;
    const p = promptOf(state);
    if (p.spec.kind !== kind) throw Error();
    // A cached v2 phone submits its original marker position, without a rules version.
    const result = applyIntent(state, { playerId: d, intent: { type: "INTERACT", openedSeq: p.openedSeq,
      attempt: p.attempt, action: "commit", round: p.challenge!.round, position: p.spec.target } }, context(chapter));
    expect(result.error).toBeUndefined();
    state = result.state;
    expect(promptOf(state).challenge!.version).toBeUndefined();
    expect(skillCompletions(promptOf(state))).toEqual({ [a]: 1, [c]: 1, [d]: 1 });
    expect(skillSteps(promptOf(state), ids(state))).toBe(9);
    expect(actor(state)).toBe(a);
    state.party.find(member => member.playerId === b)!.connected = true;
    expect(skillSteps(promptOf(state), ids(state))).toBe(12);
    expect(skillCompletions(promptOf(state))[b] ?? 0).toBe(0);
  });
});
