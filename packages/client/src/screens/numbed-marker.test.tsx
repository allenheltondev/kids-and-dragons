// @vitest-environment jsdom
/**
 * The Numbed marker (#227): a hero stung by a numbing enemy sees it in words
 * and an icon — never colour alone — and the words say it wears off. A fight
 * without a sting draws exactly the rows it did before.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { beginEncounter, makeRng, parseBoard } from "@kad/shared";
import type { CombatBuff, EncounterState, RulesContent } from "@kad/shared";
import { BuffList, combatBuffRows } from "./BuffList";
import { PUFFED_WORDS, numbedLine, numbedTurnsText, puffedLine } from "./buff-copy";
import { gridCells, isNumbedHero } from "./combat-grid";
import { makeCharacter, makeMember } from "../testing/fixtures";

afterEach(cleanup);

const NUMBED: CombatBuff = { id: "numbed", label: "Numbed", kind: "move", heroId: "c_a", amount: -2, turnsLeft: 2 };
const SHIELD: CombatBuff = { id: "rift-shield", label: "Rift Shield", kind: "guard", heroId: "c_a", amount: 1 };

describe("the words", () => {
  it("call it a numbing sting that wears off", () => {
    expect(numbedLine("You", 2, 2)).toBe("You are numbed by a sting: 2 fewer steps for 2 turns. It wears off.");
    expect(numbedLine("Pip", 1, 1)).toBe("Pip is numbed by a sting: 1 fewer step for 1 turn. It wears off.");
    expect(numbedTurnsText(2)).toBe("wears off after 2 more turns");
    expect(numbedTurnsText(1)).toBe("wears off after 1 more turn");
    expect(numbedTurnsText(undefined)).toBe("wears off when the fight ends");
  });
});

describe("BuffList in a fight", () => {
  it("shows Numbed with its own icon, a signed number in words and a 'Wears off' chip instead of 'Cost'", () => {
    const { container } = render(<BuffList rows={combatBuffRows([NUMBED, SHIELD], "c_a")} title="Buffs" />);
    const items = within(screen.getByRole("list", { name: "Buffs" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Numbed: −2 Steps · wears off after 2 more turnsWears off",
      "Rift Shield: +1 Guard · this fight",
    ]);
    expect(within(items[0]!).queryByText("Cost")).toBeNull();
    expect(within(items[0]!).getByText("Wears off")).toBeTruthy();
    expect(container.querySelector("li")?.querySelector("svg")).toBeTruthy();
  });

  it("is only on the hero it stung, and a fight with no sting draws the rows it always did", () => {
    expect(combatBuffRows([NUMBED], "c_b")).toEqual([]);
    expect(combatBuffRows([SHIELD], "c_a").map((row) => row.numbed)).toEqual([undefined]);
  });
});

const FIGHT = (() => {
  const character = makeCharacter({ id: "c_a", stats: { might: 2, quick: 25, clever: 3, heart: 5 } });
  return beginEncounter(
    {
      board: parseBoard(["....", "....", "....", "...."]),
      party: [{ character, at: { x: 0, y: 0 } }],
      enemies: [
        {
          spec: { id: "skupper", name: "Skupper", count: 1, hp: 6, guard: 11, quick: 0, steps: 4, attack: 3, retaliation: { slow: { steps: 2, turns: 2 } } },
          at: { x: 3, y: 3 },
        },
      ],
    },
    { rules: { version: 1 } as unknown as RulesContent, abilities: {}, rng: makeRng("numbed-marker") },
  );
})();

describe("the lasting Numbed marker", () => {
  const stung: EncounterState = { ...FIGHT, buffs: [NUMBED] };

  it("is asked for only by the stung player's own phone", () => {
    expect(isNumbedHero(stung, "c_a", "c_a")).toBe(true);
    // Another player's phone, looking at the same figure: no marker.
    expect(isNumbedHero(stung, "c_b", "c_a")).toBe(false);
    // Their own figure, but not Numbed; or no hero at all.
    expect(isNumbedHero(FIGHT, "c_a", "c_a")).toBe(false);
    expect(isNumbedHero(stung, null, "c_a")).toBe(false);
    // A rift buff on the hero is not a sting.
    expect(isNumbedHero({ ...FIGHT, buffs: [SHIELD] }, "c_a", "c_a")).toBe(false);
  });
});

describe("a puffed enemy", () => {
  const puffed: EncounterState = {
    ...FIGHT,
    combatants: FIGHT.combatants.map((c) => (c.id === "skupper#1" ? { ...c, puffed: 2 } : c)),
  };
  const occupantOf = (encounter: EncounterState, id: string) =>
    gridCells(encounter, [makeMember({ character: makeCharacter({ id: "c_a" }) })], [], []).find((cell) => cell.occupant?.id === id)!
      .occupant!;

  it("is marked on the grid for everyone, and only while it is puffed", () => {
    expect(occupantOf(puffed, "skupper#1").puffed).toBe(true);
    expect(occupantOf(FIGHT, "skupper#1")).not.toHaveProperty("puffed");
    expect(occupantOf(puffed, "c_a")).not.toHaveProperty("puffed");
  });

  it("says so in words, with what hitting it does", () => {
    expect(puffedLine("Skupper 1")).toBe("Skupper 1 puffs up! Hitting it now means a numbing sting.");
    expect(PUFFED_WORDS).toBe("Puffed");
  });
});
