import { describe, expect, it } from "vitest";
import { previewContext, readIntentPreview } from "./preview.js";
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
