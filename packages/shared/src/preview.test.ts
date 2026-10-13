import { describe, expect, it } from "vitest";
import { readIntentPreview } from "./preview.js";

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
