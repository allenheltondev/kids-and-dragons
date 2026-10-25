import { describe, expect, it } from "vitest";
import { bridgeSolved, clues, cluesForSeat, gateReady, landsShot, markerAt } from "./rules";

describe("story interaction experiments", () => {
  it("aims back and forth without an expiring attempt", () => {
    expect([0, 800, 1600, 2400, 3200].map(markerAt)).toEqual([0, 0.5, 1, 0.5, 0]);
    expect(markerAt(3200 * 100 + 800)).toBe(0.5);
    expect(landsShot(0.5, false)).toBe(true);
    expect(landsShot(0.25, false)).toBe(false);
    expect(landsShot(0.25, true)).toBe(true);
    expect(landsShot(NaN, true)).toBe(false);
  });

  it("requires every support role, and releases the gate when a holder leaves", () => {
    expect(gateReady(4, [0, 1])).toBe(false);
    expect(gateReady(4, [0, 1, 2])).toBe(true);
    expect(gateReady(4, [0, 2])).toBe(false);
    expect(gateReady(2, [1])).toBe(false);
    expect(gateReady(1, [])).toBe(false);
    expect(gateReady(1, [0])).toBe(true);
  });

  it.each([1, 2, 3, 4])("keeps every clue available with %i players", (players) => {
    const distributed = Array.from({ length: players }, (_, seat) => cluesForSeat(seat, players)).flat();
    expect(distributed).toHaveLength(clues.length);
    expect(new Set(distributed)).toEqual(new Set(clues));
  });

  it("requires the complete ordered path", () => {
    expect(bridgeSolved(["Frog", "Owl", "Fox"])).toBe(true);
    expect(bridgeSolved(["Frog", "Fox", "Owl"])).toBe(false);
    expect(bridgeSolved(["Frog", "Owl"])).toBe(false);
    expect(bridgeSolved(["Frog", "Owl", "Fox", "Fox"])).toBe(false);
  });
});
