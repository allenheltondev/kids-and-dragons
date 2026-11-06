/**
 * The camp's finds in the engine (#618, docs/camp.md §5.1, §5.4, §12.2): the
 * engine records a find on the run and does nothing else, so a replay is
 * exact. Claiming it from storage is the server's (handlers/camp-finds.ts).
 */

import { describe, expect, it } from "vitest";
import { applyEffects, applyIntent, createRunState } from "./engine.js";
import type { EngineContext } from "./engine.js";
import { makeRng } from "./dice.js";
import type { ClientIntent } from "./types/protocol.js";
import type { RunState } from "./types/state.js";
import type { Chapter, Effect, StoryScene } from "./types/chapter.js";
import { APPEARANCE, makeChapter, makeItems, makeMap, makeRules } from "./test-fixtures.js";

const AWNING: Effect = { type: "findForCamp", pieceId: "find_noodle_awning", rewardId: "bramblewood-01.awning" };
const FEATHER: Effect = { type: "findForKit", pieceId: "deco_gull_feather", rewardId: "bramblewood-01.feather" };

/** The fixture chapter with a crew find and a kit find on the shrine, and the crew find again on the scratched road to it. */
function findingChapter(): Chapter {
  const chapter = makeChapter();
  const shrine = chapter.scenes["scene_shrine"] as StoryScene;
  shrine.onEnter = [...(shrine.onEnter ?? []), AWNING, FEATHER];
  const scratched = chapter.scenes["scene_scratched"] as StoryScene;
  scratched.onEnter = [AWNING];
  return chapter;
}

const MAP = makeMap();
function ctx(seed = "test"): EngineContext {
  return {
    rules: makeRules(),
    items: makeItems(),
    chapter: findingChapter(),
    map: (id) => (id === MAP.id ? MAP : null),
    abilities: {},
    rng: makeRng(seed),
    now: "2026-07-28T12:00:00.000Z",
    householdId: "h_1",
  };
}

const hero = (name: string, species: "unicorn" | "griffin"): ClientIntent => ({
  type: "CREATE_CHARACTER",
  name,
  species,
  class: species === "unicorn" ? "songkeeper" : "duskrunner",
  stats: { might: 0, quick: 3, clever: 0, heart: 0 },
  appearance: APPEARANCE,
});

/** The intents of an evening: two heroes sit, start, and go through the scratched road to the shrine. */
const LOG: { playerId: string; intent: ClientIntent }[] = [
  { playerId: "p_1", intent: hero("Sparklehoof", "unicorn") },
  { playerId: "p_2", intent: hero("Windstep", "griffin") },
  { playerId: "p_1", intent: { type: "READY", ready: true } },
  { playerId: "p_2", intent: { type: "READY", ready: true } },
  { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
];

function newRun(): RunState {
  return createRunState({ runId: "r_1", roomCode: "ABCD", mode: "party", now: "2026-07-28T11:00:00.000Z" });
}

/** Play `LOG`, then roll and walk on until the shrine, failing the squeeze (die 1) so the scratched road is taken. */
function play(): RunState[] {
  const states: RunState[] = [];
  const context = { ...ctx(), rng: { next: () => 0.001 } };
  let state = newRun();
  const step = (playerId: string, intent: ClientIntent) => {
    const result = applyIntent(state, { playerId, intent }, context);
    if (result.error) throw new Error(`${intent.type}: ${result.error.message}`);
    state = result.state;
    states.push(state);
  };
  for (const { playerId, intent } of LOG) step(playerId, intent);
  for (let guard = 0; guard < 10 && state.sceneId !== "scene_shrine"; guard++) {
    const prompt = state.prompt;
    if (prompt?.kind === "roll") {
      step(state.party.find((m) => m.character.id === prompt.characterId)!.playerId, { type: "ROLL" });
    } else if (prompt?.kind === "choice") {
      for (const playerId of prompt.forPlayerIds) if (state.prompt?.kind === "choice") step(playerId, { type: "CHOOSE", choiceId: prompt.options[0]!.id });
    } else step("p_1", { type: "ADVANCE" });
  }
  return states;
}

describe("finds in the engine", () => {
  it("records a crew find and a kit find, once per reward id, with every seated hero on the kit find", () => {
    const states = play();
    const final = states.at(-1)!;
    expect(final.sceneId).toBe("scene_shrine");
    expect(final.visited).toContain("scene_scratched");
    // The scratched road and the shrine both offer the awning: one reward id, one find.
    expect(final.campFinds).toEqual([
      { kind: "camp", pieceId: "find_noodle_awning", rewardId: "bramblewood-01.awning", sceneId: "scene_scratched" },
      {
        kind: "kit",
        pieceId: "deco_gull_feather",
        rewardId: "bramblewood-01.feather",
        sceneId: "scene_shrine",
        heroes: final.party.map((m) => m.character.id),
      },
    ]);
    // Nothing else moves: no bag item, no coins.
    for (const member of final.party) expect(member.character.inventory.map((e) => e.itemId)).not.toContain("find_noodle_awning");
  });

  it("is pure: the same log replayed gives the same states, and never touches its input", () => {
    const first = play();
    const again = play();
    expect(again).toEqual(first);
    const before = structuredClone(first.at(-1)!);
    const after = applyEffects(before, [AWNING, { ...FEATHER, rewardId: "other.feather" }], ctx());
    expect(before).toEqual(first.at(-1));
    expect(after.campFinds?.map((f) => f.rewardId)).toEqual(["bramblewood-01.awning", "bramblewood-01.feather", "other.feather"]);
  });

  it("records a befriend as a friend find, once per reward id, and nothing else (#624)", () => {
    const at = play().at(-1)!;
    const BUN: Effect = { type: "befriend", friendId: "bun", rewardId: "bramblewood-01.bun" };
    const once = applyEffects(at, [BUN], ctx());
    const twice = applyEffects(once, [BUN], ctx());
    expect(twice.campFinds?.at(-1)).toEqual({ kind: "friend", pieceId: "bun", rewardId: "bramblewood-01.bun", sceneId: "scene_shrine" });
    expect(twice.campFinds?.filter((f) => f.kind === "friend")).toHaveLength(1);
    // A friend is never a bag item, a flag or coins.
    expect(twice.flags).toEqual(at.flags);
    expect(twice.coins).toEqual(at.coins);
    for (const member of twice.party) expect(member.character.inventory.map((e) => e.itemId)).not.toContain("bun");
  });

  it("starts each chapter with no finds, and records none where nothing is found", () => {
    const states = play();
    const started = states.find((s) => s.chapterId === "bramblewood-01")!;
    expect(started).not.toHaveProperty("campFinds");
    const lobby = { ...states.at(-1)!, phase: "lobby" as const, prompt: null, party: states.at(-1)!.party.map((m) => ({ ...m, ready: true })) };
    const restarted = applyIntent(lobby, { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }, ctx()).state;
    expect(restarted).not.toHaveProperty("campFinds");
  });
});
