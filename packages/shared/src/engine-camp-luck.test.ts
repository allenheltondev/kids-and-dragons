/**
 * Lucky drops in the engine (#619, docs/camp.md §5.2): after a mini-game the
 * party succeeds at or a fight it wins, a 1 in 8 chance of 1 Dash Cash, drawn
 * from the step's seeded rng and only recorded on the run. Whether it pays is
 * the server's (handlers/camp-pay.ts).
 */

import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, enterScene, type EngineContext } from "./engine.js";
import { resolveCharacter } from "./character.js";
import { makeRng, type Rng } from "./dice.js";
import { LUCKY_DROP_ODDS, LUCKY_DROPS_PER_CHAPTER, luckyRoll } from "./camp-luck.js";
import { makeChapter, makeCharacter, makeItems, makeMap, makeRules } from "./test-fixtures.js";
import type { InteractionAction, InteractionSpec } from "./interactions.js";
import type { InteractionScene, RunState } from "./index.js";

const now = "2026-11-05T19:00:00.000Z";
const precision: InteractionSpec = { kind: "precision", cue: "Ring the bell", actionLabel: "Throw", target: 0.5, width: 0.3, periodMs: 4000 };
const play: InteractionSpec = {
  kind: "play",
  cue: "Camp",
  actionLabel: "Rest",
  participation: "any",
  options: [{ id: "lamp", label: "Hang a lamp", icon: "star", reaction: "A warm glow appears." }],
};

function setup(spec: InteractionSpec, seed = "luck") {
  const chapter = makeChapter();
  const scene: InteractionScene = {
    type: "interaction",
    narration: "A bell hangs from a branch.",
    interaction: spec,
    onSuccess: { goto: "scene_clearing" },
    onFailure: { goto: "scene_clearing" },
  };
  chapter.scenes["game"] = scene;
  const ctx: EngineContext = { chapter, rules: makeRules(), items: makeItems(), rng: makeRng(seed), now, householdId: "h_1" };
  let state = createRunState({ runId: "luck", roomCode: "TEST", mode: "party", now });
  state.party = [0, 1].map((index) => ({
    playerId: `p${index}`,
    character: resolveCharacter(makeCharacter({ id: `c${index}`, ownerPlayerId: `p${index}` }), ctx.rules, ctx.items),
    connected: true,
    ready: true,
    hp: 10,
    down: false,
  }));
  state.chapterId = chapter.id;
  state = enterScene(state, "game", ctx).state;
  return { state, ctx };
}

function act(state: RunState, ctx: EngineContext, action: InteractionAction, playerId = "p0"): RunState {
  const prompt = state.prompt;
  if (prompt?.kind !== "interaction") throw new Error("expected a game");
  const result = applyIntent(state, { playerId, intent: { type: "INTERACT", openedSeq: prompt.openedSeq, attempt: prompt.attempt, ...action } }, ctx);
  expect(result.error).toBeUndefined();
  return result.state;
}

/** An rng whose every draw is `value`. */
const fixed = (value: number): Rng => ({ next: () => value });

/** Start the bell and ring it, the stop on `position` (0.5 hits, 0.0 misses). */
function ring(state: RunState, ctx: EngineContext, position: number, rng: Rng): RunState {
  const started = act(state, ctx, { action: "start", relaxed: false });
  return act(started, { ...ctx, rng }, { action: "stop", position });
}

describe("lucky drops (§5.2)", () => {
  it("rolls once a won game lands, and records a drop that comes up", () => {
    const { state, ctx } = setup(precision);
    const won = ring(state, ctx, 0.5, fixed(0));
    expect(won.campLuck).toEqual({ rolled: ["game"], drops: [{ sceneId: "game", kind: "game" }] });
    const missed = ring(state, ctx, 0.5, fixed(0.99));
    // Rolled, and nothing came up: nothing to show anywhere.
    expect(missed.campLuck).toEqual({ rolled: ["game"], drops: [] });
  });

  it("never rolls for a lost game", () => {
    const { state, ctx } = setup(precision);
    expect(ring(state, ctx, 0, fixed(0)).campLuck).toBeUndefined();
  });

  it("never rolls for a play interaction, which always succeeds", () => {
    const { state, ctx } = setup(play);
    let next = act(state, ctx, { action: "start", relaxed: false });
    next = act(next, ctx, { action: "play", optionId: "lamp" });
    const done = act(next, { ...ctx, rng: fixed(0) }, { action: "complete" });
    expect(done.prompt).toMatchObject({ kind: "interaction", outcome: "success" });
    expect(done.campLuck).toBeUndefined();
  });

  it("counts relaxed play: easier, not automatic", () => {
    const { state, ctx } = setup(precision);
    const started = act(state, ctx, { action: "start", relaxed: true });
    expect(act(started, { ...ctx, rng: fixed(0) }, { action: "stop", position: 0.5 }).campLuck?.drops).toHaveLength(1);
  });

  it("rolls a scene once a chapter, so retrying a won game cannot roll again", () => {
    const { state, ctx } = setup(precision);
    const missed = ring(state, ctx, 0.5, fixed(0.99));
    const again = act(missed, ctx, { action: "retry" });
    expect(ring(again, ctx, 0.5, fixed(0)).campLuck).toEqual({ rolled: ["game"], drops: [] });
  });

  it("stops rolling once the chapter's cap has come up", () => {
    const { state, ctx } = setup(precision);
    const capped: RunState = {
      ...state,
      campLuck: {
        rolled: ["a", "b"],
        drops: Array.from({ length: LUCKY_DROPS_PER_CHAPTER }, (_, i) => ({ sceneId: `s${i}`, kind: "fight" as const })),
      },
    };
    expect(ring(capped, ctx, 0.5, fixed(0)).campLuck?.rolled).toEqual(["a", "b"]);
  });

  it("comes up about 1 in 8 over many seeded steps", () => {
    const trials = 4000;
    let drops = 0;
    for (let i = 0; i < trials; i++) {
      const { state, ctx } = setup(precision, `trial-${i}`);
      const started = act(state, ctx, { action: "start", relaxed: false });
      drops += act(started, { ...ctx, rng: makeRng(`roll-${i}`) }, { action: "stop", position: 0.5 }).campLuck?.drops.length ?? 0;
    }
    const rate = drops / trials;
    expect(rate).toBeGreaterThan(1 / LUCKY_DROP_ODDS - 0.02);
    expect(rate).toBeLessThan(1 / LUCKY_DROP_ODDS + 0.02);
    expect(luckyRoll(0.124)).toBe(true);
    expect(luckyRoll(0.125)).toBe(false);
  });

  it("rolls the same on a replay of the same step and seed", () => {
    const { state, ctx } = setup(precision);
    const started = act(state, ctx, { action: "start", relaxed: false });
    const results = Array.from({ length: 50 }, (_, i) => {
      const a = act(started, { ...ctx, rng: makeRng(`seed-${i}`) }, { action: "stop", position: 0.5 });
      const b = act(structuredClone(started), { ...ctx, rng: makeRng(`seed-${i}`) }, { action: "stop", position: 0.5 });
      expect(b).toEqual(a);
      return a.campLuck?.drops.length ?? 0;
    });
    // Some of each, so the replay check above held for both.
    expect(results).toContain(0);
    expect(results).toContain(1);
  });

  it("draws after every other roll the step made, so nothing else it rolled moves", () => {
    const { state, ctx } = setup(precision);
    const started = act(state, ctx, { action: "start", relaxed: false });
    const draws: number[] = [];
    const spy: Rng = { next: () => { draws.push(draws.length); return 0.5; } };
    act(started, { ...ctx, rng: spy }, { action: "stop", position: 0.5 });
    // The one draw this step made is the drop's.
    expect(draws).toHaveLength(1);
  });

  it("rolls for a fight won, and never for one lost", () => {
    const map = makeMap();
    const base = setup(precision);
    const ctx: EngineContext = { ...base.ctx, map: (id) => (id === map.id ? map : null) };
    const atFight = enterScene(base.state, "encounter_wisps", ctx).state;
    let fighting = atFight;
    for (const member of fighting.party) {
      fighting = applyIntent(fighting, { playerId: member.playerId, intent: { type: "READY", ready: true } }, ctx).state;
    }
    expect(fighting.encounter).toBeTruthy();
    const ending = (side: "enemy" | "party"): RunState => {
      const s = structuredClone(fighting);
      const e = s.encounter!;
      (e as { combatants: typeof e.combatants }).combatants = e.combatants.map((c) => (c.side === side ? { ...c, hp: 0, down: true } : c));
      if (side === "party") for (const m of s.party) { m.hp = 0; m.down = true; }
      return s;
    };
    const won = applyIntent(ending("enemy"), { playerId: "p0", intent: { type: "ADVANCE" } }, { ...ctx, rng: fixed(0) });
    expect(won.error).toBeUndefined();
    expect(won.state.lastEncounter?.outcome).toBe("victory");
    expect(won.state.campLuck).toEqual({ rolled: ["encounter_wisps"], drops: [{ sceneId: "encounter_wisps", kind: "fight" }] });
    const lost = applyIntent(ending("party"), { playerId: "p0", intent: { type: "ADVANCE" } }, { ...ctx, rng: fixed(0) });
    expect(lost.error).toBeUndefined();
    expect(lost.state.lastEncounter?.outcome).toBe("defeat");
    expect(lost.state.campLuck).toBeUndefined();
  });

  it("is cleared when a chapter starts", () => {
    const { state, ctx } = setup(precision);
    const won = ring(state, ctx, 0.5, fixed(0));
    const lobby: RunState = { ...won, phase: "lobby", chapterId: null, sceneId: null, prompt: null };
    const started = applyIntent(lobby, { playerId: "p0", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }, ctx);
    expect(started.error).toBeUndefined();
    expect(started.state.campLuck).toBeUndefined();
  });
});
