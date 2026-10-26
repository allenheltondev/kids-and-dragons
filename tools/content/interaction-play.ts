/**
 * Plays an `interaction` scene the way phones play it: real INTERACT intents
 * (start, stop, answer, support, adjust, catch and pass, play, complete,
 * assist, continue) through the engine, at a table of one, two and four.
 * Shared by riftlight-interactions.test.ts and gemfall-interactions.test.ts.
 */

import { expect } from "vitest";
import { applyIntent, enterScene, playbackMs } from "@kad/shared";
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
  const others = first.playerIds.filter((id) => id !== actor);
  let state = act(chapter, opened, { action: "start", relaxed: true }, actor);
  const wait = playbackMs(spec, true) + 1000;
  switch (spec.kind) {
    case "precision":
    case "timing":
      return act(chapter, state, { action: "stop", position: spec.target }, actor);
    case "cooperate":
      // Friends hold; a lone hero props the way. Props are always allowed.
      for (const id of others.length > 0 ? others : [actor]) state = act(chapter, state, { action: "support", mode: "prop" }, id);
      return act(chapter, state, { action: "complete" }, actor);
    case "sequence":
    case "memory":
      return act(chapter, state, { action: "answer", answer: [...spec.answer] }, actor, wait);
    case "tracking":
      return act(chapter, state, { action: "answer", answer: [String(finalCover(spec))] }, actor, wait);
    case "balance":
      for (const id of first.playerIds) {
        state = act(chapter, state, { action: "adjust", direction: "up" }, id);
        state = act(chapter, state, { action: "adjust", direction: "up" }, id);
      }
      return act(chapter, state, { action: "complete" }, actor);
    case "relay":
      // Each connected hero catches and passes in turn; a lone hero does both.
      for (const id of first.playerIds) {
        state = act(chapter, state, { action: "catch" }, id);
        state = act(chapter, state, { action: "pass" }, id);
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
export function miss(chapter: Chapter, opened: RunState): RunState | null {
  const first = promptOf(opened);
  const { spec } = first;
  const actor = first.actorId;
  const wait = playbackMs(spec, false) + 1000;
  // Not relaxed: the target is as narrow as authored.
  const started = (): RunState => act(chapter, opened, { action: "start", relaxed: false }, actor);
  switch (spec.kind) {
    case "precision":
    case "timing": {
      const position = spec.target < 0.5 ? 1 : 0;
      if (Math.abs(position - spec.target) <= spec.width / 2) return null;
      return act(chapter, started(), { action: "stop", position }, actor);
    }
    case "sequence": {
      const wrong = [...spec.answer].reverse();
      if (wrong.join() === spec.answer.join()) return null;
      return act(chapter, started(), { action: "answer", answer: wrong }, actor);
    }
    case "memory": {
      const wrong = [...spec.answer].reverse();
      if (wrong.join() === spec.answer.join()) return null;
      return act(chapter, started(), { action: "answer", answer: wrong }, actor, wait);
    }
    case "tracking": {
      const right = finalCover(spec);
      const wrong = spec.covers.findIndex((_, index) => index !== right);
      return act(chapter, started(), { action: "answer", answer: [String(wrong)] }, actor, wait);
    }
    default:
      return null;
  }
}

export const landed = (chapter: Chapter, state: RunState, actor: string): RunState => act(chapter, state, { action: "continue" }, actor);

