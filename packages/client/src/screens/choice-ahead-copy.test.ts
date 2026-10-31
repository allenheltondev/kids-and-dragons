import { describe, expect, it } from "vitest";
import { aheadBadge } from "./choice-ahead-copy";

describe("aheadBadge", () => {
  it("says what a choice leads to, in an icon and words", () => {
    expect(aheadBadge({ kind: "roll", stat: "quick" })).toEqual({ icon: "quick", text: "Quick roll" });
    expect(aheadBadge({ kind: "roll", stat: "might", party: true })).toEqual({ icon: "might", text: "Everyone rolls Might" });
    expect(aheadBadge({ kind: "game" })).toEqual({ icon: "play", text: "Game" });
    expect(aheadBadge({ kind: "fight" })).toEqual({ icon: "swords", text: "Fight" });
  });

  it("draws nothing for a choice that leads to more story", () => {
    expect(aheadBadge(undefined)).toBeNull();
  });
});
