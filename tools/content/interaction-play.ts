/**
 * Plays an `interaction` scene the way phones play it: real INTERACT intents
 * (start, stop, answer, support, adjust, catch and pass, play, complete,
 * assist, continue) through the engine, at a table of one, two and four.
 * Shared by riftlight-interactions.test.ts and gemfall-interactions.test.ts.
 */

import { expect } from "vitest";
import { TEAM_HOLD_MS, balanceTarget, pullTarget, skillAim, relayTarget, relayHolder, applyIntent, enterScene, playbackMs } from "@kad/shared";
import type { Chapter, InteractionAction, InteractionPrompt, InteractionScene, RunState } from "@kad/shared";
import { context, start } from "./riftlight-test-support.ts";

export const SIZES = [1, 2, 4] as const;

export function promptOf(state: RunState): InteractionPrompt {
  if (state.prompt?.kind !== "interaction") throw new Error(`expected an interaction, got ${JSON.stringify(state.prompt)}`);
  return state.prompt;
}

/** Opens `sceneId` with `size` connected heroes seated. */
export function open(chapter: Chapter, sceneId: string, size: number): RunState {
  const seated = start(chapter, "manticore", "duskrunner", {}, size);
  const opened = enterScene(seated, sceneId, context(chapter));
  expect(opened.error, `${chapter.id}/${sceneId}`).toBeUndefined();
  return opened.state;
}

/** One real intent from `playerId`, `afterMs` after the scene opened (playback is measured in server time). */
export function act(chapter: Chapter, state: RunState, action: InteractionAction, playerId: string, afterMs = 0): RunState {
  const prompt = promptOf(state);
  const base = context(chapter);
  const now = new Date(Date.parse(base.now) + afterMs).toISOString();
  const result = applyIntent(
    state,
    { playerId, intent: { type: "INTERACT", openedSeq: prompt.openedSeq, attempt: prompt.attempt, ...action } },
    { ...base, now },
  );
  expect(result.error, `${chapter.id}/${state.sceneId}: ${JSON.stringify(action)} by ${playerId}`).toBeUndefined();
  return result.state;
}

/** Where the hidden thing ends up after a tracking scene's swaps. */
function finalCover(spec: { start: number; swaps: readonly (readonly [number, number])[] }): number {
  return spec.swaps.reduce((at, [a, b]) => (at === a ? b : at === b ? a : at), spec.start);
}

/** Plays the scene to its success result with real actions, in relaxed play so no timing is needed. */
export function solve(chapter: Chapter, opened: RunState): RunState {
  const first = promptOf(opened);
  const { spec } = first;
  const actor = first.actorId;
  let state = act(chapter, opened, { action: "start", relaxed: true, rulesVersion: 2 }, actor);
  const wait = playbackMs(spec, true) + 1000;
  if (promptOf(state).challenge) {
    while (promptOf(state).phase === "active") {
      const p = promptOf(state);
      const round = p.challenge!.round;
      if (spec.kind === "balance") {
        const target = balanceTarget(p);
        for (const id of first.playerIds) {
          const delta = Math.round((target - (promptOf(state).levels?.[id] ?? 0)) * 4);
          if (delta) state = act(chapter, state, { action: "adjust", round, direction: delta > 0 ? "up" : "down", steps: Math.abs(delta) }, id);
        }
        state = act(chapter, state, { action: "commit", round }, actor);
      } else if (spec.kind === "cooperate") {
        for (const id of first.playerIds) state = act(chapter, state, { action: "commit", round, position: pullTarget(p) }, id);
      } else if (spec.kind === "precision" || spec.kind === "timing") {
        state = act(chapter, state, { action: "commit", round, position: skillAim(p).target }, actor);
      } else if (spec.kind === "memory" || spec.kind === "sequence") {
        state = act(chapter, state, { action: "commit", round, answer: [...spec.answer] }, actor, wait);
      } else if (spec.kind === "tracking") {
        state = act(chapter, state, { action: "commit", round, answer: [String(finalCover(spec))] }, actor, wait);
      }
    }
    return state;
  }
  switch (spec.kind) {
    case "precision":
    case "timing":
      return act(chapter, state, { action: "stop", position: spec.target }, actor);
    case "cooperate":
      // Every hero joins the lift; props remove the need for simultaneous touch.
      for (const id of first.playerIds) state = act(chapter, state, { action: "support", mode: "prop" }, id);
      return act(chapter, state, { action: "complete" }, actor, TEAM_HOLD_MS);
    case "sequence":
    case "memory":
      return act(chapter, state, { action: "answer", answer: [...spec.answer] }, actor, wait);
    case "tracking":
      return act(chapter, state, { action: "answer", answer: [String(finalCover(spec))] }, actor, wait);
    case "balance":
      for (const id of first.playerIds) {
        state = act(chapter, state, { action: "adjust", direction: "up", steps: 2 }, id);
      }
      return state;
    case "relay":
      // Each connected hero catches and passes in turn; a lone hero does both.
      for (const id of first.playerIds) {
        state = act(chapter, state, { action: "catch", flightId: promptOf(state).relay!.flight.id, position: 0.82, reach: promptOf(state).relay!.flight.landing }, id);
        state = act(chapter, state, { action: "pass", flightId: promptOf(state).relay!.flight.id, ...relayTarget(promptOf(state).passed?.length ?? 0) }, id);
      }
      return state;
    case "play": {
      const taps = spec.stages?.length ?? 1;
      const players = spec.participation === "everyone" ? first.playerIds : [actor];
      for (const id of players) {
        for (let tap = 0; tap < (spec.participation === "everyone" ? Math.max(1, taps) : taps); tap++) {
          state = act(chapter, state, { action: "play", optionId: spec.options[0]!.id }, id);
        }
      }
      return promptOf(state).outcome ? state : act(chapter, state, { action: "complete" }, actor);
    }
  }
}

/** A real way to get it wrong, or null where the mechanic has no wrong answer. */
export function miss(chapter: Chapter, opened: RunState, includeTeamwork = false): RunState | null {
  const first = promptOf(opened);
  const { spec } = first;
  const actor = first.actorId;
  // Full-route scripts deliberately preserve teamwork prerequisites. The per-scene suite
  // opts in to team failures too, so every newly reachable authored branch is exercised.
  if (!includeTeamwork && (spec.kind === "balance" || spec.kind === "cooperate")) return null;
  const wait = playbackMs(spec, false) + 1000;
  // Not relaxed: the target is as narrow as authored.
  const started = (): RunState => act(chapter, opened, { action: "start", relaxed: false, rulesVersion: 2 }, actor);
  if (spec.kind !== "relay" && spec.kind !== "play") {
    let state = started();
    if (spec.kind === "balance") for (const id of first.playerIds) state = act(chapter, state, { action: "adjust", round: 0, direction: "up", steps: 4 }, id);
    if ((spec.kind === "memory" || spec.kind === "sequence") && [...spec.answer].reverse().join() === spec.answer.join()) return null;
    while (promptOf(state).phase === "active") {
      const p = promptOf(state);
      const round = p.challenge!.round;
      if (spec.kind === "cooperate") for (const id of first.playerIds) state = act(chapter, state, { action: "commit", round, position: 1 }, id);
      else if (spec.kind === "balance") state = act(chapter, state, { action: "commit", round }, actor);
      else if (spec.kind === "precision" || spec.kind === "timing") {
        const position = spec.target < 0.5 ? 1 : 0;
        if (Math.abs(position - spec.target) <= spec.width / 2) return null;
        state = act(chapter, state, { action: "commit", round, position }, actor);
      } else if (spec.kind === "tracking") {
        const wrong = spec.covers.findIndex((_, index) => index !== finalCover(spec) && !p.challenge!.excluded.includes(String(index)));
        state = act(chapter, state, { action: "commit", round, answer: [String(wrong)] }, actor, wait);
      } else state = act(chapter, state, { action: "commit", round, answer: [...spec.answer].reverse() }, actor, wait);
    }
    return state;
  }
  switch (spec.kind) {
    case "relay": {
      let state = started();
      while (promptOf(state).phase === "active") {
        const p = promptOf(state);
        const holder = relayHolder(p, state.party.filter(m => m.connected).map(m => m.playerId))!;
        state = p.caughtBy === holder
          ? act(chapter, state, { action: "pass", flightId: p.relay!.flight.id, aim: 1, power: 0 }, holder)
          : act(chapter, state, { action: "catch", flightId: p.relay!.flight.id, position: 0, reach: p.relay!.flight.landing }, holder);
      }
      return state;
    }
    default:
      return null;
  }
}

export const landed = (chapter: Chapter, state: RunState, actor: string): RunState => act(chapter, state, { action: "continue" }, actor);

