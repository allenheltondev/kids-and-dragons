import { describe, expect, it } from "vitest";
import { PLAYER_COLORS, assignPlayerColors } from "./player-colors.js";

describe("assignPlayerColors", () => {
  it("never hands out a color someone at the table already wears", () => {
    const taken: { accent: string }[] = [];
    for (let i = 0; i < PLAYER_COLORS.length; i++) {
      const colors = assignPlayerColors(`run:p_${String(i)}:colors`, taken);
      expect(taken.map((t) => t.accent)).not.toContain(colors.accent);
      taken.push(colors);
    }
    expect(new Set(taken.map((t) => t.accent)).size).toBe(PLAYER_COLORS.length);
  });

  it("is the same pick for the same seed, so a replay rebuilds it", () => {
    expect(assignPlayerColors("r_1:p_1:colors", [])).toEqual(assignPlayerColors("r_1:p_1:colors", []));
  });

  it("varies with the seed — a first player is not always the same color", () => {
    const picks = new Set(
      Array.from({ length: 40 }, (_, i) => assignPlayerColors(`r_${String(i)}:p_1:colors`, []).accent),
    );
    expect(picks.size).toBeGreaterThan(3);
  });

  it("still gives a color when every one is taken", () => {
    const colors = assignPlayerColors("r:p:colors", PLAYER_COLORS);
    expect(PLAYER_COLORS).toContainEqual(colors);
  });
});
