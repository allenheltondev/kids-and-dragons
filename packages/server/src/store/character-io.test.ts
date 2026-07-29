import { describe, expect, it, vi } from "vitest";
import type { Character } from "@kad/shared";
import { readAll } from "./character-io.ts";

/** A valid stored row, in the same literal style as contract.test.ts. */
function character(id: string): Character {
  return {
    id,
    householdId: "h_1",
    ownerPlayerId: "p_1",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    appearance: { palette: "meadow", accent: "#7FD4C1" },
    committed: {
      level: 1,
      xp: 0,
      stats: { might: 1, quick: 2, clever: 2, heart: 4 },
      tier: "fledgling",
      unlockedActions: [],
      inventory: [],
    },
    provisional: null,
    questItems: [],
    souvenirs: [],
    createdAt: "2026-07-04T18:00:00.000Z",
  };
}

describe("readAll", () => {
  it("migrates every row it can read", () => {
    const items = [{ data: character("c_1") }, { data: character("c_2") }];
    expect(readAll(items, "h_1").map((c) => c.id)).toEqual(["c_1", "c_2"]);
  });

  it("drops an unreadable row and keeps the rest", () => {
    /*
     * The difference between "Pip's sheet is missing" and "the game will not
     * start". Listing a household is not the same question as asking for one
     * character by id — there, a broken row is a dead end and `getCharacter`
     * rightly throws. Here, two working characters must survive the third.
     */
    const warn = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const items = [
      { data: character("c_1") },
      { data: { id: "c_broken" } },
      { data: character("c_2") },
    ];

    expect(readAll(items, "h_1").map((c) => c.id)).toEqual(["c_1", "c_2"]);
    // Silent at the table, loud in the logs — this is the only warning anybody
    // will ever get that a corrupt character exists.
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("h_1");
    warn.mockRestore();
  });

  it("returns nothing for a household with no characters", () => {
    expect(readAll([], "h_1")).toEqual([]);
  });
});
