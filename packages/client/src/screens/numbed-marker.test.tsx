// @vitest-environment jsdom
/**
 * The Numbed marker (#227): a hero stung by a numbing enemy sees it in words
 * and an icon — never colour alone — and the words say it wears off. A fight
 * without a sting draws exactly the rows it did before.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CombatBuff } from "@kad/shared";
import { BuffList, combatBuffRows } from "./BuffList";
import { numbedLine, numbedTurnsText } from "./buff-copy";

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
    const { container } = render(<BuffList rows={combatBuffRows([NUMBED, SHIELD], "c_a")} title="On you right now" />);
    const items = within(screen.getByRole("list", { name: "On you right now" })).getAllByRole("listitem");
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
