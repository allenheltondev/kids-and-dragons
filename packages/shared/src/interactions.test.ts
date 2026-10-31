import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, enterScene, type EngineContext } from "./engine.js";
import { resolveCharacter } from "./character.js";
import { makeRng } from "./dice.js";
import { makeChapter, makeCharacter, makeItems, makeRules } from "./test-fixtures.js";
import { balanceReady, interactionClues, supportsReady, type InteractionAction, type InteractionPrompt, type InteractionSpec } from "./interactions.js";
import { cooperationProgress, TEAM_HOLD_MS } from "./teamwork.js";
import { sceneEdges, validateChapter } from "./chapter-graph.js";
import { edgesOf } from "./chapter-map.js";
import type { InteractionScene, RunState } from "./index.js";

const now = "2026-10-25T19:00:00.000Z";
const precision: InteractionSpec = { kind: "precision", cue: "Ring the bell", actionLabel: "Throw", target: 0.5, width: 0.3, periodMs: 4000 };
const sequence: InteractionSpec = { kind: "sequence", cue: "Share clues", actionLabel: "Try", options: [{ id: "a", label: "A", icon: "star" }, { id: "b", label: "B", icon: "leaf" }], answer: ["a", "b"], clues: ["A first", "B last", "Use both"] };
const tracking: InteractionSpec = { kind: "tracking", cue: "Watch", actionLabel: "Choose", covers: ["Left", "Middle", "Right"], start: 0, swaps: [[0, 1], [1, 2]], stepMs: 1000 };
const memory: InteractionSpec = { kind: "memory", cue: "Echo", actionLabel: "Echo", options: [{ id: "a", label: "A", icon: "star" }, { id: "b", label: "B", icon: "leaf" }], answer: ["a", "b", "a"], stepMs: 1000 };
function setup(spec = precision, players = 2) {
  const chapter = makeChapter();
  const scene: InteractionScene = { type: "interaction", narration: "A bell hangs from a branch.", interaction: spec,
    onSuccess: { goto: "scene_clearing", effects: [{ type: "setFlag", flag: "interaction_won" }] },
    onFailure: { goto: "scene_clearing", effects: [{ type: "setFlag", flag: "interaction_missed" }] },
    onAssisted: { goto: "scene_clearing", effects: [{ type: "setFlag", flag: "interaction_helped" }] } };
  chapter.scenes["interaction_test"] = scene;
  const ctx: EngineContext = { chapter, rules: makeRules(), items: makeItems(), rng: makeRng("interactions"), now, householdId: "h_1" };
  let state = createRunState({ runId: "interaction", roomCode: "TEST", mode: "party", now });
  state.party = Array.from({ length: players }, (_, index) => ({ playerId: `p${index}`, character: resolveCharacter(makeCharacter({ id: `c${index}`, ownerPlayerId: `p${index}` }), ctx.rules, ctx.items), connected: true, ready: true, hp: 10, down: false }));
  state.chapterId = chapter.id;
  state = enterScene(state, "interaction_test", ctx).state;
  return { state, ctx, scene };
}
function prompt(state: RunState): InteractionPrompt {
  if (state.prompt?.kind !== "interaction") throw Error("Expected interaction");
  return state.prompt;
}
function act(state: RunState, ctx: EngineContext, action: InteractionAction, playerId = "p0") {
  const current = prompt(state);
  return applyIntent(state, { playerId, intent: { type: "INTERACT", openedSeq: current.openedSeq, attempt: current.attempt, ...action } }, ctx);
}
function step(state: RunState, ctx: EngineContext, action: InteractionAction, playerId = "p0") {
  const result = act(state, ctx, action, playerId);
  expect(result.error).toBeUndefined();
  return result.state;
}

describe("authoritative story interactions", () => {
  it("nominates from the full-party turn marker when an earlier seat is disconnected", () => {
    const { state, ctx } = setup(precision, 3);
    state.party[0]!.connected = false;
    state.storyTurn = 1;
    const reopened = enterScene(state, "interaction_test", ctx);
    expect(reopened.error).toBeUndefined();
    expect(prompt(reopened.state).actorId).toBe("p1");
    expect(prompt(reopened.state).playerIds).toEqual(["p1", "p2"]);
  });

  it("counts a game as one moment of the owner's beat, even when another friend continues", () => {
    const { state, ctx } = setup(precision, 3);
    state.party[0]!.connected = false;
    const reopened = enterScene(state, "interaction_test", ctx).state;
    const result = step(reopened, ctx, { action: "assist" }, "p1");
    const next = step(result, ctx, { action: "continue" }, "p2");
    // The beat is still p1's (standing in for p0's dropped phone): one moment spent, no pass.
    expect(next.storyTurn ?? 0).toBe(0);
    expect(next.spotlightMoments).toBe(1);
    expect(next.prompt).toMatchObject({ kind: "choice", forPlayerIds: ["p1"] });
  });

  it("counts the game for the beat after the nominee disconnects, and the stand-in keeps it", () => {
    const { state, ctx } = setup(precision, 3);
    expect(prompt(state).actorId).toBe("p0");
    state.party[0]!.connected = false;
    const result = step(state, ctx, { action: "assist" }, "p1");
    const next = step(result, ctx, { action: "continue" }, "p2");
    expect(next.storyTurn ?? 0).toBe(0);
    expect(next.spotlightMoments).toBe(1);
    expect(next.prompt).toMatchObject({ kind: "choice", forPlayerIds: ["p1"] });
  });

  it("keeps the beat on its owner from a choice, through a game, to the next choice", () => {
    const { state, ctx } = setup(precision, 3);
    ctx.chapter!.scenes["fork_test"] = {
      type: "story",
      narration: "Two ways to the bell.",
      choices: [
        { id: "left", label: "Left", icon: "forward", goto: "interaction_test" },
        { id: "right", label: "Right", icon: "forward", goto: "interaction_test" },
      ],
    };
    let next = enterScene(state, "fork_test", ctx).state;
    next = applyIntent(next, { playerId: "p0", intent: { type: "CHOOSE", choiceId: "left" } }, ctx).state;
    expect(next.spotlightMoments).toBe(1);
    expect(prompt(next).actorId).toBe("p0");
    next = step(next, ctx, { action: "start", relaxed: false });
    next = step(next, ctx, { action: "stop", position: 0.5 });
    next = step(next, ctx, { action: "continue" });
    // Two moments, not three: the next decision is still p0's.
    expect(next.spotlightMoments).toBe(2);
    expect(next.prompt).toMatchObject({ kind: "choice", forPlayerIds: ["p0"] });

    // A game that is the beat's third moment passes the spotlight on.
    const third = enterScene({ ...next, spotlightMoments: 2 }, "interaction_test", ctx).state;
    let done = step(third, ctx, { action: "start", relaxed: false });
    done = step(done, ctx, { action: "stop", position: 0.5 });
    done = step(done, ctx, { action: "continue" });
    expect(done.storyTurn).toBe(1);
    expect(done.spotlightMoments).toBe(0);
    expect(done.prompt).toMatchObject({ kind: "choice", forPlayerIds: ["p1"] });
  });

  it("tracks the hidden object through swaps and rejects guesses during playback", () => {
    const { state, ctx } = setup(tracking);
    const active = step(state, ctx, { action: "start", relaxed: false });
    expect(act(active, ctx, { action: "answer", answer: ["2"] }).error).toBeDefined();
    const later = { ...ctx, now: "2026-10-25T19:00:04.000Z" };
    expect(prompt(step(active, later, { action: "answer", answer: ["2"] })).outcome).toBe("success");
    expect(prompt(step(active, later, { action: "answer", answer: ["0"] })).outcome).toBe("failure");
    expect(act(active, later, { action: "answer", answer: ["9"] }).error).toBeDefined();
  });
  it("checks a memory pattern including repeats, with an untimed relaxed route", () => {
    const { state, ctx } = setup(memory);
    const active = step(state, ctx, { action: "start", relaxed: false });
    expect(act(active, ctx, { action: "answer", answer: ["a", "b", "a"] }).error).toBeDefined();
    const later = { ...ctx, now: "2026-10-25T19:00:04.000Z" };
    expect(prompt(step(active, later, { action: "answer", answer: ["a", "b", "a"] })).outcome).toBe("success");
    const relaxed = step(state, ctx, { action: "start", relaxed: true });
    expect(prompt(step(relaxed, ctx, { action: "answer", answer: ["a", "b", "a"] })).outcome).toBe("success");
  });
  it.each([
    ["tracking", tracking, ["2"], 3000],
    ["memory", memory, ["a", "b", "a"], 3000],
  ] as const)("accepts a %s answer from a phone whose clock is a little fast, never one given mid-playback (#566)", (_, spec, answer, playback) => {
    const { state, ctx } = setup(spec);
    const active = step(state, ctx, { action: "start", relaxed: false });
    const at = (ms: number) => ({ ...ctx, now: new Date(Date.parse(now) + ms).toISOString() });
    // The phone unlocked the answer up to CLOCK_TRUSTED_MS (400 ms) early on its own clock.
    expect(prompt(step(active, at(playback - 150), { action: "answer", answer: [...answer] })).outcome).toBe("success");
    expect(prompt(step(active, at(playback - 400), { action: "answer", answer: [...answer] })).outcome).toBe("success");
    // Any earlier is an answer given while the pattern was still playing.
    expect(act(active, at(playback - 401), { action: "answer", answer: [...answer] }).error).toBeDefined();
    expect(act(active, at(playback / 2), { action: "answer", answer: [...answer] }).error).toBeDefined();
  });
  it("resolves wait-now timing using the displayed phase", () => {
    const { state, ctx } = setup({ ...precision, kind: "timing" });
    const active = step(state, ctx, { action: "start", relaxed: false });
    expect(prompt(step(active, ctx, { action: "stop", position: 0.5 })).outcome).toBe("success");
    expect(prompt(step(active, ctx, { action: "stop", position: 0 })).outcome).toBe("failure");
  });
  it.each([1, 2, 4])("requires every connected side to balance at a table of %i", (players) => {
    const { state, ctx } = setup({ kind: "balance", cue: "Steady", actionLabel: "Carry", objectLabel: "Basket" }, players);
    let next = step(state, ctx, { action: "start", relaxed: false });
    expect(act(next, ctx, { action: "complete" }).error).toBeDefined();
    for (let seat = 0; seat < players; seat++) {
      next = step(next, ctx, { action: "adjust", direction: "up" }, `p${seat}`);
      next = step(next, ctx, { action: "adjust", direction: "up" }, `p${seat}`);
    }
    expect(prompt(next).outcome).toBe("success");
    next = step(next, ctx, { action: "retry" });
    expect(prompt(next).levels).toBeUndefined();
  });
  it("makes relay turns authoritative and skips disconnected receivers", () => {
    const { state, ctx } = setup({ kind: "relay", cue: "Pass", actionLabel: "Pass", objectLabel: "spark" }, 3);
    let next = step(state, ctx, { action: "start", relaxed: false });
    expect(act(next, ctx, { action: "catch" }, "p1").error).toBeDefined();
    expect(act(next, ctx, { action: "pass" }).error).toBeDefined();
    next = step(next, ctx, { action: "catch" });
    expect(act(next, ctx, { action: "catch" }).error).toBeDefined();
    next = step(next, ctx, { action: "pass" });
    next.party[1]!.connected = false;
    next = step(next, ctx, { action: "catch" }, "p2");
    next = step(next, ctx, { action: "pass" }, "p2");
    expect(prompt(next).outcome).toBe("success");
  });
  it("does not transfer a disconnected player’s catch to the next receiver", () => {
    const { state, ctx } = setup({ kind: "relay", cue: "Pass", actionLabel: "Pass", objectLabel: "spark" });
    let next = step(state, ctx, { action: "start", relaxed: false });
    next = step(next, ctx, { action: "catch" });
    next.party[0]!.connected = false;
    expect(act(next, ctx, { action: "pass" }, "p1").error).toBeDefined();
    next = step(next, ctx, { action: "catch" }, "p1");
    expect(prompt(step(next, ctx, { action: "pass" }, "p1")).outcome).toBe("success");
  });
  it("records each camp contribution and bounds repeated feedback", () => {
    const { state, ctx } = setup({ kind: "play", cue: "Camp", actionLabel: "Rest", participation: "everyone", options: [{ id: "lamp", label: "Hang a lamp", icon: "star", reaction: "A warm glow appears." }] });
    let next = step(state, ctx, { action: "start", relaxed: false });
    expect(act(next, ctx, { action: "play", optionId: "invented" }).error).toBeDefined();
    for (let count = 0; count < 20; count++) next = step(next, ctx, { action: "play", optionId: "lamp" });
    expect(prompt(next).reactions).toHaveLength(12);
    expect(act(next, ctx, { action: "complete" }).error).toBeDefined();
    next = step(next, ctx, { action: "play", optionId: "lamp" }, "p1");
    expect(prompt(step(next, ctx, { action: "complete" })).outcome).toBe("success");
  });
  it("advances authored wake-up reactions without a failure or deadline", () => {
    const { state, ctx } = setup({ kind: "play", cue: "Hello", actionLabel: "Welcome", participation: "any", options: [{ id: "tap", label: "Hello", icon: "hand", reaction: "Rustle" }], stages: ["A twig twitches.", "An eye opens."] }, 1);
    let next = step(state, ctx, { action: "start", relaxed: false });
    next = step(next, ctx, { action: "play", optionId: "tap" });
    expect(act(next, ctx, { action: "complete" }).error).toBeDefined();
    expect(prompt(next).reactions?.at(-1)?.text).toBe("A twig twitches.");
    next = step(next, ctx, { action: "play", optionId: "tap" });
    expect(prompt(next).reactions?.at(-1)?.text).toBe("An eye opens.");
    expect(prompt(step(next, ctx, { action: "complete" })).outcome).toBe("success");
  });
  it("persists a result without applying its branch until the party continues", () => {
    const { state, ctx } = setup();
    let next = step(state, ctx, { action: "start", relaxed: false });
    next = step(next, ctx, { action: "stop", position: 0.5 });
    expect(prompt(next).outcome).toBe("success");
    expect(next.flags["interaction_won"]).toBeUndefined();
    expect(act(next, ctx, { action: "stop", position: 0.5 }).error).toBeDefined();
    next = step(JSON.parse(JSON.stringify(next)) as RunState, ctx, { action: "continue" }, "p1");
    expect(next.flags["interaction_won"]).toBe(true);
  });
  it("keeps the resolved actor when their phone drops between the outcome and continue", () => {
    const { state, ctx } = setup(precision, 3);
    let next = step(state, ctx, { action: "start", relaxed: false });
    next = step(next, ctx, { action: "stop", position: 0.5 });
    expect(prompt(next).resolvedActorId).toBe("p0");
    next.party[0]!.connected = false;
    next = step(next, ctx, { action: "continue" }, "p1");
    // The owner's moment is spent; their beat is not over, and p1 stands in while they are away.
    expect(next.storyTurn ?? 0).toBe(0);
    expect(next.spotlightMoments).toBe(1);
    expect(next.flags["interaction_won"]).toBe(true);
  });
  it("uses the authored failure and assisted branches", () => {
    const { state, ctx } = setup();
    let next = step(state, ctx, { action: "start", relaxed: false });
    next = step(next, ctx, { action: "stop", position: 0 });
    expect(step(next, ctx, { action: "continue" }).flags["interaction_missed"]).toBe(true);
    const helped = step(state, ctx, { action: "assist" }, "p1");
    expect(step(helped, ctx, { action: "continue" }).flags["interaction_helped"]).toBe(true);
  });
  it("widens the target in relaxed play", () => {
    const { state, ctx } = setup();
    const normal = step(step(state, ctx, { action: "start", relaxed: false }), ctx, { action: "stop", position: 0.25 });
    const relaxed = step(step(state, ctx, { action: "start", relaxed: true }), ctx, { action: "stop", position: 0.25 });
    expect(prompt(normal).outcome).toBe("failure");
    expect(prompt(relaxed).outcome).toBe("success");
  });
  it("rejects outsiders, wrong actors, stale attempts, and malformed input", () => {
    const { state, ctx } = setup();
    expect(act(state, ctx, { action: "assist" }, "outsider").error).toBeDefined();
    expect(act(state, ctx, { action: "start", relaxed: false }, "p1").error).toBeDefined();
    const active = step(state, ctx, { action: "start", relaxed: false });
    for (const position of [NaN, Infinity, -1, 2]) expect(act(active, ctx, { action: "stop", position }).error).toBeDefined();
    const retry = step(active, ctx, { action: "retry" });
    expect(applyIntent(retry, { playerId: "p0", intent: { type: "INTERACT", openedSeq: prompt(active).openedSeq, attempt: 0, action: "stop", position: 0.5 } }, ctx).error).toBeDefined();
    expect(act(active, ctx, { action: "answer", answer: [] }).error).toBeDefined();
    expect(act(state, ctx, { action: "start", relaxed: "yes" } as unknown as InteractionAction).error).toBeDefined();
  });
  it("requires live support, expires abandoned holds, and allows a prop", () => {
    const { state, ctx } = setup({ kind: "cooperate", cue: "Hold", supportLabel: "Hold", actionLabel: "Rescue" });
    let next = step(state, ctx, { action: "start", relaxed: false });
    expect(act(next, ctx, { action: "complete" }).error).toBeDefined();
    next = step(next, ctx, { action: "support", mode: "hold" }, "p1");
    expect(supportsReady(prompt(next), ["p0", "p1"], now)).toBe(false);
    next = step(next, ctx, { action: "support", mode: "hold" }, "p0");
    expect(supportsReady(prompt(next), ["p0", "p1"], now)).toBe(true);
    expect(act(next, { ...ctx, now: "2026-10-25T19:00:07.000Z" }, { action: "complete" }).error).toBeDefined();
    next = step(next, ctx, { action: "support", mode: "release" }, "p1");
    expect(act(next, ctx, { action: "complete" }).error).toBeDefined();
    next = step(next, ctx, { action: "support", mode: "prop" }, "p1");
    expect(act(next, ctx, { action: "complete" }).error).toBeDefined();
    expect(prompt(step(next, { ...ctx, now: new Date(Date.parse(now) + TEAM_HOLD_MS).toISOString() }, { action: "complete" })).outcome).toBe("success");
  });
  it("supports a solo prop and reassignment when the acting phone disconnects", () => {
    const { state, ctx } = setup({ kind: "cooperate", cue: "Hold", supportLabel: "Hold", actionLabel: "Rescue" });
    state.party[0]!.connected = false;
    let next = step(state, ctx, { action: "start", relaxed: true }, "p1");
    next = step(next, ctx, { action: "support", mode: "prop" }, "p1");
    expect(prompt(step(next, { ...ctx, now: new Date(Date.parse(now) + TEAM_HOLD_MS).toISOString() }, { action: "complete" }, "p1")).outcome).toBe("success");
  });
  it.each([1, 2, 3, 4])("keeps all clues available at a table of %i", (players) => {
    const { state } = setup(sequence, players);
    const ids = state.party.map((member) => member.playerId);
    expect(ids.flatMap((id) => interactionClues(prompt(state), id, ids)).sort()).toEqual([...sequence.clues].sort());
  });
  it("checks complete ordered answers and permits a fresh attempt", () => {
    const { state, ctx } = setup(sequence);
    let next = step(state, ctx, { action: "start", relaxed: false });
    expect(act(next, ctx, { action: "answer", answer: ["unknown", "a"] }).error).toBeDefined();
    expect(act(next, ctx, { action: "answer", answer: ["a"] }).error).toBeDefined();
    next = step(next, ctx, { action: "answer", answer: ["b", "a"] });
    expect(prompt(next).outcome).toBe("failure");
    next = step(next, ctx, { action: "retry" });
    next = step(next, ctx, { action: "start", relaxed: false });
    expect(prompt(step(next, ctx, { action: "answer", answer: ["a", "b"] })).outcome).toBe("success");
  });
  it("includes every outcome in graph tools and validates sequence references", () => {
    const { scene, ctx } = setup(sequence);
    expect(sceneEdges(scene).map((edge) => edge.to)).toEqual(edgesOf("test", scene).map((edge) => edge.to));
    scene.interaction = { ...sequence, answer: ["missing"] };
    expect(validateChapter(ctx.chapter!).some((issue) => issue.code === "BAD_INTERACTION")).toBe(true);
  });
});


describe("teamwork that plays through to its own finish", () => {
  const cooperation: InteractionSpec = { kind: "cooperate", cue: "Lift", supportLabel: "Hold", actionLabel: "Lift it" };
  const at = (ctx: EngineContext, ms: number) => ({ ...ctx, now: new Date(Date.parse(now) + ms).toISOString() });
  it("lets friends share the balance unequally and finishes on the final lift", () => {
    const { state, ctx } = setup({ kind: "balance", cue: "Lift", actionLabel: "Go", objectLabel: "Sling" });
    let next = step(state, ctx, { action: "start", relaxed: false });
    for (let i = 0; i < 3; i++) next = step(next, ctx, { action: "adjust", direction: "up" });
    expect(prompt(next).phase).toBe("active");
    next = step(next, ctx, { action: "adjust", direction: "up" }, "p1");
    expect(prompt(next)).toMatchObject({ phase: "result", outcome: "success", levels: { p0: 0.75, p1: 0.25 } });
    expect(next.flags["interaction_won"]).toBeUndefined();
    expect(step(next, ctx, { action: "continue" }, "p1").flags["interaction_won"]).toBe(true);
  });
  it("never lets a strong hero leave a connected friend out", () => {
    const { state, ctx } = setup({ kind: "balance", cue: "Lift", actionLabel: "Go", objectLabel: "Sling" });
    state.prompt = { ...prompt(state), levels: { p0: 1, p1: 0 } };
    expect(balanceReady(prompt(state), ["p0", "p1"])).toBe(false);
  });
  it.each([1, 2, 3, 4])("requires the whole team to hold at a table of %i", (players) => {
    const { state, ctx } = setup(cooperation, players);
    let next = step(state, ctx, { action: "start", relaxed: true });
    for (let seat = 0; seat < players; seat++) next = step(next, ctx, { action: "support", mode: "prop" }, `p${seat}`);
    expect(act(next, ctx, { action: "complete" }).error).toBeDefined();
    expect(cooperationProgress(prompt(next), next.party.map((m) => m.playerId), at(ctx, 900).now)).toBe(0.5);
    next = step(next, at(ctx, TEAM_HOLD_MS), { action: "complete" });
    expect(prompt(next).outcome).toBe("success");
    next = step(next, ctx, { action: "retry" });
    expect(prompt(next).steadySince).toBeUndefined();
  });
  it("resets progress on release and does not bank an abandoned hold", () => {
    const { state, ctx } = setup(cooperation);
    let next = step(state, ctx, { action: "start", relaxed: false });
    next = step(next, ctx, { action: "support", mode: "hold" });
    next = step(next, ctx, { action: "support", mode: "hold" }, "p1");
    next = step(next, at(ctx, 900), { action: "support", mode: "release" }, "p1");
    expect(prompt(next).steadySince).toBeUndefined();
    next = step(next, at(ctx, 1000), { action: "support", mode: "hold" }, "p1");
    expect(act(next, at(ctx, 2000), { action: "complete" }).error).toBeDefined();
    next = step(next, at(ctx, 7000), { action: "support", mode: "hold" });
    expect(prompt(next).steadySince).toBeUndefined();
    next = step(next, at(ctx, 7000), { action: "support", mode: "hold" }, "p1");
    expect(cooperationProgress(prompt(next), ["p0", "p1"], at(ctx, 7500).now)).toBeCloseTo(500 / TEAM_HOLD_MS);
  });
  it("restarts the shared hold when a phone disconnects, then accepts the new lead", () => {
    const { state, ctx } = setup(cooperation);
    let next = step(state, ctx, { action: "start", relaxed: true });
    next = step(next, ctx, { action: "support", mode: "prop" });
    next = step(next, ctx, { action: "support", mode: "prop" }, "p1");
    next.party[0]!.connected = false;
    expect(act(next, at(ctx, 2000), { action: "complete" }, "p1").error).toBeDefined();
    next = step(next, at(ctx, 2000), { action: "support", mode: "prop" }, "p1");
    next = JSON.parse(JSON.stringify(next)) as RunState;
    expect(prompt(step(next, at(ctx, 2000 + TEAM_HOLD_MS), { action: "complete" }, "p1")).outcome).toBe("success");
  });
  it("can finish from a support renewal without the lead phone sending a finish", () => {
    const { state, ctx } = setup(cooperation);
    let next = step(state, ctx, { action: "start", relaxed: false });
    next = step(next, ctx, { action: "support", mode: "hold" });
    next = step(next, ctx, { action: "support", mode: "hold" }, "p1");
    expect(prompt(step(next, at(ctx, TEAM_HOLD_MS), { action: "support", mode: "hold" }, "p1")).outcome).toBe("success");
  });
});


it("judges a whole lever gesture at its destination and rejects malformed notch counts", () => {
  const { state, ctx } = setup({ kind: "balance", cue: "Lift", actionLabel: "Go", objectLabel: "Sling" });
  let next = step(state, ctx, { action: "start", relaxed: false });
  next = step(next, ctx, { action: "adjust", direction: "up", steps: 2 }, "p1");
  for (const steps of [0, -1, 5, 1.5, NaN, null]) {
    expect(act(next, ctx, { action: "adjust", direction: "up", steps } as InteractionAction).error).toBeDefined();
  }
  next = step(next, ctx, { action: "adjust", direction: "up", steps: 4 });
  expect(prompt(next)).toMatchObject({ phase: "active", levels: { p0: 1, p1: 0.5 } });
  next = step(next, ctx, { action: "adjust", direction: "down", steps: 2 });
  expect(prompt(next)).toMatchObject({ phase: "result", outcome: "success" });
});


describe("shared visual receipts", () => {
  it.each([precision, { ...precision, kind: "timing" } as InteractionSpec])("retains the actual $kind tap across persistence and clears it on retry", (spec) => {
    const { state, ctx } = setup(spec);
    const active = step(state, ctx, { action: "start", relaxed: false });
    const done = step(active, ctx, { action: "stop", position: 0.63 });
    expect(prompt(JSON.parse(JSON.stringify(done)) as RunState).stopPosition).toBe(0.63);
    expect(prompt(step(done, ctx, { action: "retry" })).stopPosition).toBeUndefined();
  });
  it.each([tracking, memory, sequence])("retains the $kind guess without borrowing the input array", (spec) => {
    const { state, ctx } = setup(spec);
    const active = step(state, ctx, { action: "start", relaxed: true });
    const answer = spec.kind === "tracking" ? ["2"] : spec.kind === "memory" || spec.kind === "sequence" ? [...spec.answer] : [];
    const done = step(active, ctx, { action: "answer", answer });
    const saved = JSON.parse(JSON.stringify(done)) as RunState;
    expect(prompt(saved).submittedAnswer).toEqual(answer);
    answer.length = 0;
    expect(prompt(done).submittedAnswer!.length).toBeGreaterThan(0);
    expect(prompt(step(done, ctx, { action: "retry" })).submittedAnswer).toBeUndefined();
  });
});
