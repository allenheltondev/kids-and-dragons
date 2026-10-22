import { describe, expect, it } from "vitest";
import { DECISION_INTENTS, decisionContext, previewContext, readIntentPreview } from "./preview.js";
import type { RunState } from "./types/state.js";

describe("readIntentPreview", () => {
  it("reads every kind", () => {
    expect(readIntentPreview({ kind: "choice", choiceId: "east" })).toEqual({ kind: "choice", choiceId: "east" });
    expect(readIntentPreview({ kind: "move", to: { x: 2, y: 3 } })).toEqual({ kind: "move", to: { x: 2, y: 3 } });
    expect(readIntentPreview({ kind: "action", abilityId: "attack", targetIds: ["wisp#1"] })).toEqual({
      kind: "action",
      abilityId: "attack",
      targetIds: ["wisp#1"],
    });
    expect(readIntentPreview({ kind: "item", itemId: "acorn", targetId: "wisp#1" })).toEqual({
      kind: "item",
      itemId: "acorn",
      targetId: "wisp#1",
    });
    expect(readIntentPreview({ kind: "end_turn" })).toEqual({ kind: "end_turn" });
  });

  it("reads null as backing out", () => {
    expect(readIntentPreview(null)).toBeNull();
  });

  it("drops keys it does not know rather than relaying them", () => {
    expect(readIntentPreview({ kind: "end_turn", extra: "x".repeat(10_000) })).toEqual({ kind: "end_turn" });
  });

  it("refuses anything malformed or oversized", () => {
    for (const bad of [
      undefined,
      "choice",
      { kind: "roll" },
      { kind: "choice" },
      { kind: "choice", choiceId: "x".repeat(65) },
      { kind: "move", to: { x: 1.5, y: 0 } },
      { kind: "move", to: { x: -1, y: 0 } },
      { kind: "action", abilityId: "attack", targetIds: "wisp" },
      { kind: "action", abilityId: "attack", targetIds: Array.from({ length: 9 }, (_, i) => `t${i}`) },
      { kind: "item", itemId: "acorn", targetId: 7 },
    ]) {
      expect(readIntentPreview(bad)).toBeUndefined();
    }
  });
});

describe("previewContext", () => {
  const base = {
    chapterId: "ch1",
    visited: ["start", "fork"],
    storyTurn: 0,
    encounter: null,
    prompt: { kind: "choice", sceneId: "fork", options: [], forPlayerIds: [], vote: false },
  } as unknown as RunState;

  it("names a story question by chapter, trail, scene and turn marker", () => {
    expect(previewContext(base)).toBe("choice:ch1:2:fork:0");
  });

  it("moves on when the same question comes round again", () => {
    expect(previewContext({ ...base, visited: ["start", "fork", "brook", "fork"] })).not.toBe(previewContext(base));
    expect(previewContext({ ...base, storyTurn: 1 })).not.toBe(previewContext(base));
  });

  it("is null when there is nothing to preview", () => {
    expect(previewContext(null)).toBeNull();
    expect(previewContext({ ...base, prompt: null })).toBeNull();
    expect(previewContext({ ...base, prompt: { kind: "roll" } } as unknown as RunState)).toBeNull();
  });
});

describe("previewContext in a fight", () => {
  const fight = (startedAt: number | undefined) =>
    ({
      encounter: {
        startedAt,
        round: 1,
        turnIndex: 0,
        stepsLeft: 4,
        actionTaken: false,
        order: ["c_pip"],
        openingOrder: ["c_pip"],
        encoreActor: null,
        combatants: [{ id: "c_pip", side: "party", down: false }],
      },
    }) as unknown as RunState;

  it("tells two fights apart even when every turn field repeats", () => {
    // The same hero opening round 1 of two different fights: identical turn
    // fields, different fights. A pick left over from the first must not be
    // the second's.
    expect(previewContext(fight(5))).not.toBe(previewContext(fight(9)));
    expect(previewContext(fight(5))).toBe(previewContext(fight(5)));
  });
});

describe("decisionContext (#413)", () => {
  const base = {
    phase: "scene",
    chapterId: "ch1",
    sceneId: "fork",
    visited: ["start", "fork"],
    storyTurn: 0,
    encounter: null,
    prompt: { kind: "choice", sceneId: "fork", options: [], forPlayerIds: [], vote: true },
  } as unknown as RunState;

  it("stays put while a friend votes, so the ordinary retry still goes through", () => {
    const voted = { ...base, prompt: { ...base.prompt, votes: { p_friend: "left" } } } as unknown as RunState;
    expect(decisionContext(voted)).toBe(decisionContext(base));
  });

  it("moves on with the scene, a revisit, the turn marker and the kind of question", () => {
    const next = { ...base, sceneId: "brook", visited: ["start", "fork", "brook"] } as unknown as RunState;
    expect(decisionContext(next)).not.toBe(decisionContext(base));
    expect(decisionContext({ ...base, visited: ["start", "fork", "brook", "fork"] })).not.toBe(decisionContext(base));
    expect(decisionContext({ ...base, storyTurn: 1 })).not.toBe(decisionContext(base));
    const roll = { ...base, prompt: { kind: "roll", sceneId: "fork" } } as unknown as RunState;
    expect(decisionContext(roll)).not.toBe(decisionContext(base));
  });

  it("names a fight's turn, not the steps taken in it", () => {
    const fight = (patch: Record<string, unknown>) =>
      ({
        encounter: {
          startedAt: 5,
          round: 1,
          turnIndex: 0,
          stepsLeft: 4,
          actionTaken: false,
          order: ["c_pip", "c_wolf"],
          openingOrder: ["c_pip", "c_wolf"],
          encoreActor: null,
          combatants: [
            { id: "c_pip", side: "party", down: false },
            { id: "c_wolf", side: "enemy", down: false },
          ],
          ...patch,
        },
      }) as unknown as RunState;
    expect(decisionContext(fight({ stepsLeft: 1, actionTaken: true }))).toBe(decisionContext(fight({})));
    expect(decisionContext(fight({ turnIndex: 1 }))).not.toBe(decisionContext(fight({})));
    expect(decisionContext(fight({ startedAt: 9 }))).not.toBe(decisionContext(fight({})));
  });

  it("binds the answers to a question, and not the lobby or the journey", () => {
    expect(DECISION_INTENTS.has("CHOOSE")).toBe(true);
    expect(DECISION_INTENTS.has("ROLL")).toBe(true);
    expect(DECISION_INTENTS.has("MOVE")).toBe(true);
    expect(DECISION_INTENTS.has("READY")).toBe(false);
    expect(DECISION_INTENTS.has("CHOOSE_EXIT")).toBe(false);
  });
});
