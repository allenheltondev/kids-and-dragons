import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, enterScene, type EngineContext } from "./engine.js";
import { resolveCharacter } from "./character.js";
import { makeRng } from "./dice.js";
import { makeChapter, makeCharacter, makeItems, makeRules } from "./test-fixtures.js";
import { relayTarget } from "./relay.js";
import { balanceTarget, pullNeeded, pullTarget, skillAim } from "./skill-games.js";
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
  if (action.action === "adjust" && prompt(state).challenge && action.round === undefined) action = { ...action, round: prompt(state).challenge!.round };
  const result = act(state, ctx, action, playerId);
  expect(result.error).toBeUndefined();
  return result.state;
}

function flightCatch(state: RunState): InteractionAction {
  return { action: "catch", flightId: prompt(state).relay!.flight.id, position: 0.82, reach: prompt(state).relay!.flight.landing };
}
function flightPass(state: RunState): InteractionAction {
  return { action: "pass", flightId: prompt(state).relay!.flight.id, ...relayTarget(prompt(state).passed?.length ?? 0) };
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
    expect(act(next, ctx, flightCatch(next), "p1").error).toBeDefined();
    expect(act(next, ctx, flightPass(next)).error).toBeDefined();
    next = step(next, ctx, flightCatch(next));
    expect(act(next, ctx, flightCatch(next)).error).toBeDefined();
    next = step(next, ctx, flightPass(next));
    next.party[1]!.connected = false;
    next = step(next, ctx, flightCatch(next), "p2");
    next = step(next, ctx, flightPass(next), "p2");
    expect(prompt(next).outcome).toBe("success");
  });
  it("does not transfer a disconnected player’s catch to the next receiver", () => {
    const { state, ctx } = setup({ kind: "relay", cue: "Pass", actionLabel: "Pass", objectLabel: "spark" });
    let next = step(state, ctx, { action: "start", relaxed: false });
    next = step(next, ctx, flightCatch(next));
    next.party[0]!.connected = false;
    expect(act(next, ctx, flightPass(next), "p1").error).toBeDefined();
    next = step(next, ctx, flightCatch(next), "p1");
    expect(prompt(step(next, ctx, flightPass(next), "p1")).outcome).toBe("success");
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


describe("relay flight gameplay", () => {
  const spec: InteractionSpec = { kind: "relay", cue: "Deliver it", actionLabel: "Throw", objectLabel: "the spark" };
  it("turns an early grab into a recoverable drop, rejects stale actions, and preserves the flight on refresh", () => {
    const { state, ctx } = setup(spec);
    let next = step(state, ctx, { action: "start", relaxed: false });
    const early = { ...flightCatch(next), position: 0.1 } as InteractionAction;
    next = step(next, ctx, early);
    expect(prompt(next)).toMatchObject({ phase: "active", relay: { chances: 2, last: "too-early", flight: { id: 1, dropped: true } } });
    expect(prompt(next).caughtBy).toBeUndefined();
    expect(act(next, ctx, early).error).toBeDefined();
    next = JSON.parse(JSON.stringify(next)) as RunState;
    next = step(next, ctx, flightCatch(next));
    expect(prompt(next)).toMatchObject({ caughtBy: "p0", relay: { chances: 2, saves: 1, last: "save" } });
  });
  it("makes a wild throw drift, rewards the next player's save, and makes a final miss rebound before failure", () => {
    const { state, ctx } = setup(spec);
    let next = step(state, ctx, { action: "start", relaxed: false });
    next = step(next, ctx, flightCatch(next));
    next = step(next, ctx, { action: "pass", flightId: prompt(next).relay!.flight.id, aim: -1, power: 0.1 });
    expect(prompt(next).relay).toMatchObject({ chances: 3, cleanPasses: 0, last: "wild-pass", flight: { quality: "wild", landing: 0.16 } });
    next = step(next, ctx, flightCatch(next), "p1");
    expect(prompt(next).relay).toMatchObject({ saves: 1, last: "save", bestStreak: 2 });
    for (let chances = 2; chances >= 0; chances--) {
      next = step(next, ctx, { action: "pass", flightId: prompt(next).relay!.flight.id, aim: 1, power: 0 }, "p1");
      expect(prompt(next).relay!.chances).toBe(chances);
      expect(prompt(next).passed).toEqual(["p0"]);
      if (chances) {
        expect(prompt(next).phase).toBe("active");
        next = step(next, ctx, flightCatch(next), "p1");
      }
    }
    expect(prompt(next).outcome).toBe("failure");
    expect(next.flags.interaction_missed).toBeUndefined();
    expect(step(next, ctx, { action: "continue" }, "p1").flags.interaction_missed).toBe(true);
  });
  it("charges a late pickup once, whereas relaxed play leaves the object catchable without a deadline", () => {
    const { state, ctx } = setup(spec);
    const active = step(state, ctx, { action: "start", relaxed: false });
    const pickup = step(active, ctx, { ...flightCatch(active), position: 1 } as InteractionAction);
    expect(prompt(pickup)).toMatchObject({ caughtBy: "p0", relay: { chances: 2, saves: 1 } });
    expect(act(pickup, ctx, flightCatch(pickup)).error).toBeDefined();
    const relaxed = step(state, ctx, { action: "start", relaxed: true });
    expect(prompt(step(relaxed, ctx, { ...flightCatch(relaxed), position: 1 } as InteractionAction)).relay).toMatchObject({ chances: 3, saves: 0 });
  });
  it.each([false, true])("requires reaching a dropped object without charging the same drop again, relaxed=%s", (relaxed) => {
    const { state, ctx } = setup(spec);
    let next = step(state, ctx, { action: "start", relaxed });
    next = step(next, ctx, { ...flightCatch(next), position: 0 } as InteractionAction);
    const dropped = structuredClone(prompt(next).relay!.flight);
    next = step(next, ctx, { ...flightCatch(next), reach: 0.99 } as InteractionAction);
    expect(prompt(next).caughtBy).toBeUndefined();
    expect(prompt(next).relay).toMatchObject({ chances: 2, saves: 0, flight: dropped });
    // Pickups have a generous but finite radius, wider in relaxed mode.
    next = step(next, ctx, { ...flightCatch(next), reach: dropped.landing + (relaxed ? 0.31 : 0.24) } as InteractionAction);
    expect(prompt(next)).toMatchObject({ caughtBy: "p0", relay: { chances: 2, saves: 1, last: "save" } });
  });
  it("does not allow bare catch/pass inputs or nonfinite measurements to bypass the skill loop", () => {
    const { state, ctx } = setup(spec);
    const active = step(state, ctx, { action: "start", relaxed: false });
    expect(act(active, ctx, { action: "catch" }).error).toBeDefined();
    for (const value of [NaN, Infinity, -1, 2]) {
      expect(act(active, ctx, { ...flightCatch(active), position: value } as InteractionAction).error).toBeDefined();
      expect(act(active, ctx, { ...flightCatch(active), reach: value } as InteractionAction).error).toBeDefined();
    }
    const caught = step(active, ctx, flightCatch(active));
    expect(act(caught, ctx, { action: "pass" }).error).toBeDefined();
    for (const value of [NaN, Infinity, -2, 2]) expect(act(caught, ctx, { ...flightPass(caught), aim: value } as InteractionAction).error).toBeDefined();
    for (const value of [NaN, Infinity, -1, 2]) expect(act(caught, ctx, { ...flightPass(caught), power: value } as InteractionAction).error).toBeDefined();
  });
  it.each([1, 2, 4])("allows a clean route with %s players and restores chances on retry", (size) => {
    const { state, ctx } = setup(spec, size);
    let next = step(state, ctx, { action: "start", relaxed: false });
    for (let seat = 0; seat < size; seat++) {
      next = step(next, ctx, flightCatch(next), `p${seat}`);
      next = step(next, ctx, flightPass(next), `p${seat}`);
    }
    expect(prompt(next)).toMatchObject({ outcome: "success", relay: { chances: 3, cleanPasses: size, bestStreak: size } });
    next = step(next, ctx, { action: "retry" });
    expect(prompt(next).relay).toBeUndefined();
    next = step(next, ctx, { action: "start", relaxed: false });
    expect(prompt(next).relay).toMatchObject({ chances: 3, saves: 0, cleanPasses: 0, flight: { id: 0 } });
  });
  it("finishes an older saved relay with its original controls until the family retries", () => {
    const { state, ctx } = setup(spec, 1);
    let next = step(state, ctx, { action: "start", relaxed: false });
    delete prompt(next).relay;
    next = step(next, ctx, { action: "catch" });
    next = step(next, ctx, { action: "pass" });
    expect(prompt(next).outcome).toBe("success");
    next = step(next, ctx, { action: "retry" });
    next = step(next, ctx, { action: "start", relaxed: false });
    expect(prompt(next).relay).toBeDefined();
  });
});

describe("skill-game rules used by the current phones", () => {
  const start = (spec: InteractionSpec, players = 2, relaxed = false) => {
    const { state, ctx } = setup(spec, players);
    return { state: step(state, ctx, { action: "start", relaxed, rulesVersion: 2 }), ctx };
  };
  const commit = (state: RunState, ctx: EngineContext, extra: { position?: number; answer?: string[]; testOnly?: boolean } = {}, id = "p0") =>
    step(state, ctx, { action: "commit", round: prompt(state).challenge!.round, ...extra }, id);

  it.each([1, 2, 4])("carries a changing load through three distinct settings with %i heroes", players => {
    let { state, ctx } = start({ kind: "balance", cue: "Carry", actionLabel: "Carry", objectLabel: "Basket" }, players);
    for (const target of [0.5, 0.75, 0.25]) {
      expect(balanceTarget(prompt(state))).toBe(target);
      for (let seat = 0; seat < players; seat++) {
        const current = prompt(state).levels?.[`p${seat}`] ?? 0;
        state = step(state, ctx, { action: "adjust", direction: target > current ? "up" : "down", steps: Math.abs(target - current) * 4 }, `p${seat}`);
      }
      expect(prompt(state).phase).toBe("active"); // finding a setting alone no longer wins
      state = commit(state, ctx);
    }
    expect(prompt(state).outcome).toBe("success");
    expect(prompt(state).challenge!.progress).toBe(3);
    const next = step(state, ctx, { action: "continue" });
    expect(next.flags.interaction_won).toBe(true);
  });
  it("makes a bad step slip, preserves safe footing, and permits a deliberate recovery", () => {
    let { state, ctx } = start({ kind: "balance", cue: "Carry", actionLabel: "Carry", objectLabel: "Basket" }, 1);
    state = step(state, ctx, { action: "adjust", direction: "up", steps: 2 });
    state = commit(state, ctx);
    state = commit(state, ctx); // .5 is too little for the second step's .75 load
    expect(prompt(state).challenge).toMatchObject({ progress: 1, strain: 0.3 });
    expect(prompt(state).outcome).toBeUndefined();
    state = step(state, ctx, { action: "adjust", direction: "up" });
    state = commit(state, ctx);
    expect(prompt(state).challenge!.progress).toBe(2);
    expect(prompt(state).challenge!.strain).toBeCloseTo(0.2);
    state = commit(state, ctx); // .75 vs .25
    state = commit(state, ctx);
    expect(prompt(state).outcome).toBe("failure");
    expect(step(state, ctx, { action: "continue" }).flags.interaction_missed).toBe(true);
  });
  it("distinguishes slack from a damaging jerk, keeps ledges, and rejects duplicate or stale pulls", () => {
    let { state, ctx } = start({ kind: "cooperate", cue: "Haul", actionLabel: "Lift", supportLabel: "Grip" });
    state = commit(state, ctx, { position: 0 });
    expect(act(state, ctx, { action: "commit", round: 0, position: 0.4 }).error).toBeDefined();
    state = commit(state, ctx, { position: 0 }, "p1");
    expect(prompt(state).challenge).toMatchObject({ progress: 0, strain: 0, round: 1 });
    state = commit(state, ctx, { position: 1 });
    state = commit(state, ctx, { position: 0 }, "p1");
    expect(prompt(state).challenge!.strain).toBeCloseTo(0.6); // a weak pull cannot cancel a jerk
    expect(act(state, ctx, { action: "commit", round: 0, position: 0.4 }).error).toBeDefined();
    for (let ledge = 0; ledge < 3; ledge++) {
      const target = pullTarget(prompt(state));
      state = commit(state, ctx, { position: target });
      state = commit(state, ctx, { position: target }, "p1");
    }
    expect(prompt(state).outcome).toBe("success");
  });
  it("reconciles a disconnected hauling partner without replaying an old pull", () => {
    let { state, ctx } = start({ kind: "cooperate", cue: "Haul", actionLabel: "Lift", supportLabel: "Grip" });
    state = commit(state, ctx, { position: 0.4 }, "p1");
    state.party[1]!.connected = false;
    state = commit(state, ctx, { position: 0.4 });
    expect(prompt(state).challenge).toMatchObject({ progress: 1, pulls: {} });
    state.party[1]!.connected = true;
    state = commit(state, ctx, { position: 0.7 });
    expect(prompt(state).challenge!.progress).toBe(1);
    state = commit(state, ctx, { position: 0.7 }, "p1");
    expect(prompt(state).challenge!.progress).toBe(2);
  });
  it("lets a friend make up a gentle under-pull while rejecting stale balance corrections", () => {
    let { state, ctx } = start({ kind: "cooperate", cue: "Haul", actionLabel: "Lift", supportLabel: "Grip" });
    state = commit(state, ctx, { position: 0.2 });
    expect(pullNeeded(prompt(state), ["p0", "p1"])).toBeCloseTo(0.6);
    state = commit(state, ctx, { position: 0.6 }, "p1");
    expect(prompt(state).challenge!.progress).toBe(1);
    const balance = start({ kind: "balance", cue: "Carry", actionLabel: "Carry", objectLabel: "Basket" }, 1);
    let next = step(balance.state, balance.ctx, { action: "adjust", direction: "up", steps: 2 });
    next = commit(next, balance.ctx);
    expect(act(next, balance.ctx, { action: "adjust", round: 0, direction: "down" }).error).toBeDefined();
    expect(prompt(next).levels?.p0).toBe(0.5);
  });
  it.each(["precision", "timing"] as const)("grades %s recovery and shares three stages around the party", kind => {
    const spec = { ...precision, kind };
    let { state, ctx } = start(spec);
    const near = commit(state, ctx, { position: 0.68 }); // .03 outside the gold
    const rough = commit(state, ctx, { position: 0 });
    expect(prompt(near).challenge!.strain).toBeLessThan(prompt(rough).challenge!.strain);
    state = commit(near, ctx, { position: skillAim(prompt(near)).target });
    expect(prompt(state).phase).toBe("active");
    expect(act(state, ctx, { action: "commit", round: prompt(state).challenge!.round, position: spec.target }).error).toBeDefined();
    for (let progress = 1; progress < 6; progress++) {
      state = commit(state, ctx, { position: spec.target }, `p${progress % 2}`);
    }
    expect(prompt(state).outcome).toBe("success");
    state = commit(rough, ctx, { position: 0 });
    expect(prompt(state).outcome).toBe("failure");
  });
  it.each([1, 4])("gives every one of %i heroes three successful timing stages", players => {
    let { state, ctx } = start({ ...precision, kind: "timing" }, players);
    for (let stage = 0; stage < players * 3; stage++) {
      expect(prompt(state).phase).toBe("active");
      state = commit(state, ctx, { position: precision.target }, `p${stage % players}`);
      expect(prompt(state).challenge!.progress).toBe(stage + 1);
    }
    expect(prompt(state).outcome).toBe("success");
  });
  it("skips a disconnected timing player and rejects the previous round after handoff", () => {
    let { state, ctx } = start(precision, 4);
    state = commit(state, ctx, { position: precision.target });
    state.party[1]!.connected = false;
    expect(act(state, ctx, { action: "commit", round: 0, position: precision.target }, "p2").error).toBeDefined();
    state = commit(state, ctx, { position: precision.target }, "p2");
    expect(prompt(state).challenge!.progress).toBe(2);
    expect(prompt(state).phase).toBe("active");
  });
  it("runs partial sequence arrangements through a visible test without committing the branch", () => {
    let { state, ctx } = start(sequence);
    state = step(state, ctx, { action: "arrange", round: 0, answer: ["a", "a"] });
    expect(prompt(state).challenge!.arrangement).toEqual(["a", "a"]);
    state = commit(state, ctx, { answer: ["a", "a"], testOnly: true });
    expect(prompt(state).challenge!.matched).toBe(1);
    expect(prompt(state).phase).toBe("active");
    const edited = step(state, ctx, { action: "arrange", round: prompt(state).challenge!.round, answer: ["b", "a"] });
    expect(prompt(edited).challenge!.matched).toBe(0);
    const tested = commit(state, ctx, { answer: ["a", "b"], testOnly: true });
    expect(prompt(tested).phase).toBe("active");
    expect(prompt(tested).challenge!.feedback).toContain("whole path holds");
    const failure = commit(state, ctx, { answer: ["b", "a"] });
    expect(prompt(failure).outcome).toBe("failure");
    state = commit(state, ctx, { answer: ["a", "b"] });
    expect(prompt(state).outcome).toBe("success");
  });
  it("retains the remembered opening after one broken tune, then branches on a repeated mistake", () => {
    let { state, ctx } = start(memory, 1, true);
    state = commit(state, ctx, { answer: ["a", "a", "b"] });
    expect(prompt(state).challenge).toMatchObject({ arrangement: ["a"], matched: 1, strain: 0.5 });
    const recovered = commit(state, ctx, { answer: ["a", "b", "a"] });
    expect(prompt(recovered).outcome).toBe("success");
    state = commit(state, ctx, { answer: ["a", "a", "b"] });
    expect(prompt(state).outcome).toBe("failure");
  });
  it("leaves an empty tracking cover open while the remaining choice can still be recovered", () => {
    let { state, ctx } = start(tracking, 1, true);
    state = commit(state, ctx, { answer: ["0"] });
    expect(prompt(state).challenge!.excluded).toEqual(["0"]);
    expect(act(state, ctx, { action: "commit", round: 1, answer: ["0"] }).error).toBeDefined();
    expect(prompt(commit(state, ctx, { answer: ["2"] })).outcome).toBe("success");
    expect(prompt(commit(state, ctx, { answer: ["1"] })).outcome).toBe("failure");
  });
  it("rejects forged positions, bypass actions, premature answers, and out-of-turn arrangements", () => {
    const aim = start(precision);
    for (const position of [NaN, Infinity, -0.1, 1.1]) expect(act(aim.state, aim.ctx, { action: "commit", round: 0, position }).error).toBeDefined();
    expect(act(aim.state, aim.ctx, { action: "complete" }).error).toBeDefined();
    expect(act(aim.state, aim.ctx, { action: "stop", position: 0.5 }, "p1").error).toBeDefined();
    const puzzle = start(memory);
    expect(act(puzzle.state, puzzle.ctx, { action: "commit", round: 0, answer: ["a", "b", "a"] }).error).toBeDefined();
    const path = start(sequence);
    expect(act(path.state, path.ctx, { action: "arrange", round: 0, answer: ["a"] }, "p1").error).toBeDefined();
    expect(act(path.state, path.ctx, { action: "arrange", round: 0, answer: ["unknown"] }).error).toBeDefined();
  });
  it("preserves in-progress saves and upgrades after retry, clearing all round state", () => {
    const { state: original, ctx } = setup(precision);
    let state = step(original, ctx, { action: "start", relaxed: false });
    expect(prompt(state).challenge).toBeUndefined();
    state = step(state, ctx, { action: "retry" });
    state = step(state, ctx, { action: "start", relaxed: false, rulesVersion: 2 });
    state = commit(state, ctx, { position: 0 });
    const restored = JSON.parse(JSON.stringify(state)) as RunState;
    expect(prompt(restored).challenge!.strain).toBeGreaterThan(0);
    state = step(restored, ctx, { action: "retry" });
    expect(prompt(state).challenge).toBeUndefined();
    state = step(state, ctx, { action: "start", relaxed: true, rulesVersion: 2 });
    expect(prompt(state).challenge).toMatchObject({ round: 0, progress: 0, strain: 0 });
  });
  it("lets a v1 phone join a v2 balance by switching the whole attempt to shared legacy controls", () => {
    let { state, ctx } = start({ kind: "balance", cue: "Carry", actionLabel: "Carry", objectLabel: "Basket" });
    state = step(state, ctx, { action: "adjust", direction: "up", steps: 2 }); // v2 lead
    const joined = act(state, ctx, { action: "adjust", direction: "up" }, "p1"); // cached v1 phone has no round
    expect(joined.error).toBeUndefined(); state = joined.state;
    expect(prompt(state).challenge).toBeUndefined();
    expect(prompt(state).compatibility).toBe("legacy-controls");
    expect(prompt(state).levels).toEqual({ p0: 0.5, p1: 0.25 });
    state = step(state, ctx, { action: "adjust", direction: "up" }, "p1");
    expect(prompt(state).outcome).toBe("success");
    state = step(state, ctx, { action: "retry" });
    expect(prompt(state).compatibility).toBeUndefined();
  });
  it("lets a v1 support join v2 cooperation without awarding unearned completion", () => {
    let { state, ctx } = start({ kind: "cooperate", cue: "Lift", actionLabel: "Lift", supportLabel: "Grip" });
    state = commit(state, ctx, { position: 0.4 }); // current phone has pulled
    state = step(state, ctx, { action: "support", mode: "prop" }, "p1"); // older phone
    expect(prompt(state).challenge).toBeUndefined();
    expect(prompt(state).compatibility).toBe("legacy-controls");
    expect(prompt(state).outcome).toBeUndefined();
    expect(act(state, ctx, { action: "complete" }).error).toBeDefined();
    state = step(state, ctx, { action: "support", mode: "prop" }); // current phone now renders v1
    expect(prompt(state).phase).toBe("active");
    const later = { ...ctx, now: new Date(Date.parse(ctx.now) + TEAM_HOLD_MS).toISOString() };
    expect(prompt(step(state, later, { action: "complete" })).outcome).toBe("success");
  });
  it("persists a legacy complete fallback, but rejects invalid legacy input and explicit stale rounds", () => {
    const lift = start({ kind: "cooperate", cue: "Lift", actionLabel: "Lift", supportLabel: "Grip" });
    const fallback = step(lift.state, lift.ctx, { action: "complete" });
    expect(prompt(fallback).challenge).toBeUndefined();
    expect(prompt(fallback).outcome).toBeUndefined();
    expect(act(lift.state, lift.ctx, { action: "complete" }, "p1").error).toBeDefined();
    const balance = start({ kind: "balance", cue: "Carry", actionLabel: "Carry", objectLabel: "Basket" });
    expect(act(balance.state, balance.ctx, { action: "adjust", direction: "up", steps: 99 }, "p1").error).toBeDefined();
    expect(act(balance.state, balance.ctx, { action: "adjust", direction: "up", round: 99 }, "p1").error).toBeDefined();
    expect(prompt(balance.state).challenge).toBeDefined();
  });
  it("supports a legacy actor taking over an aiming game after the v2 lead disconnects", () => {
    const { state, ctx } = start(precision);
    state.party[0]!.connected = false;
    const next = step(state, ctx, { action: "stop", position: 0.5 }, "p1");
    expect(prompt(next).compatibility).toBe("legacy-controls");
    expect(prompt(next).outcome).toBe("success");
  });
});
