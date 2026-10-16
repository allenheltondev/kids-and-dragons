// @vitest-environment jsdom
/**
 * Temporary buffs on the phone (#200): the journey panel lists what the party
 * carries between fights, the combat panel what is on this hero now. Each is
 * a word and a signed number, a burden says "Cost" in words as well as
 * colour, and a view without buffs draws nothing at all.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { CombatBuff, JourneyBuffView, JourneyView } from "@kad/shared";
import { BuffList, combatBuffRows, journeyBuffRows } from "./BuffList";
import { buffAmountText, buffRemainingText, buffTurnsText, checkBuffLine } from "./buff-copy";
import { JourneyPanel } from "./JourneyPanel";

afterEach(cleanup);

const HELD: JourneyBuffView[] = [
  { id: "rift-shield", label: "Rift Shield", kind: "guard", amount: 1, stacks: 1, target: "party", remaining: { encounters: 2 }, expiresOn: ["defeat"] },
  { id: "rift-surge", label: "Rift Surge", kind: "damage", amount: 2, stacks: 2, target: "one", remaining: { encounters: 1, turns: 2 } },
  { id: "rift-fray", label: "Frayed Nerves", kind: "guard", amount: -1, stacks: 1, target: "party", remaining: { encounters: 1 } },
];

describe("the words", () => {
  it("say what a buff does with a sign, and how long it lasts", () => {
    expect(buffAmountText("guard", 1)).toBe("+1 Guard");
    expect(buffAmountText("move", -2)).toBe("−2 Steps");
    expect(buffAmountText("roll", 2)).toBe("+2 To hit");
    expect(buffRemainingText({ encounters: 1 })).toBe("the next fight");
    expect(buffRemainingText({ encounters: 3 })).toBe("the next 3 fights");
    expect(buffRemainingText({ encounters: 1, turns: 1 })).toBe("your first turn of the next fight");
    expect(buffTurnsText(undefined)).toBe("this fight");
    expect(buffTurnsText(2)).toBe("2 more turns");
  });

  it("say a story-check buff (#222) changes a check, lasts a number of checks, and ask before spending it", () => {
    expect(buffAmountText("roll", 2, "check")).toBe("+2 on a check");
    expect(buffRemainingText({ encounters: 1, uses: 1 })).toBe("one check");
    expect(buffRemainingText({ encounters: 1, uses: 2 })).toBe("2 checks");
    expect(checkBuffLine({ id: "riftspark", label: "Riftspark", amount: 2, spend: "choose" })).toBe("Use Riftspark (+2)?");
    expect(checkBuffLine({ id: "riftspark", label: "Riftspark", amount: 2, spend: "auto" })).toBe("Riftspark: +2 on this roll");
  });
});

describe("BuffList", () => {
  it("lists each buff in words, and marks a burden as a cost without relying on colour", () => {
    render(<BuffList rows={journeyBuffRows(HELD)} title="Rift powers you carry" />);
    const list = screen.getByRole("list", { name: "Rift powers you carry" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Rift Shield: +1 Guard · everyone, the next 2 fights",
      "Rift Surge ×2: +2 Hit power · one hero, your first 2 turns of the next fight",
      "Frayed Nerves: −1 Guard · everyone, the next fightCost",
    ]);
    expect(within(items[2]!).getByText("Cost")).toBeTruthy();
  });

  it("lists a story-check buff as the party's, for one check", () => {
    const spark: JourneyBuffView = {
      id: "riftspark",
      label: "Riftspark",
      kind: "roll",
      amount: 2,
      stacks: 1,
      target: "party",
      remaining: { encounters: 1, uses: 1 },
      expiresOn: ["chapter"],
      appliesTo: "check",
      spend: "choose",
    };
    render(<BuffList rows={journeyBuffRows([spark])} title="Rift powers you carry" />);
    expect(screen.getByRole("listitem").textContent).toBe("Riftspark: +2 on a check · whoever rolls, one check");
  });

  it("draws nothing when there is nothing to draw", () => {
    const { container } = render(<BuffList rows={journeyBuffRows(undefined)} title="x" />);
    expect(container.innerHTML).toBe("");
  });

  it("in a fight, shows only this hero's buffs and their turns left", () => {
    const fight: CombatBuff[] = [
      { id: "rift-surge", label: "Rift Surge", kind: "damage", heroId: "c_a", amount: 1, turnsLeft: 1 },
      { id: "rift-shield", label: "Rift Shield", kind: "guard", heroId: "c_a", amount: 1 },
      { id: "rift-shield", label: "Rift Shield", kind: "guard", heroId: "c_b", amount: 1 },
    ];
    expect(combatBuffRows(fight, "c_a").map((row) => [row.label, row.detail])).toEqual([
      ["Rift Surge", "1 more turn"],
      ["Rift Shield", "this fight"],
    ]);
    expect(combatBuffRows(undefined, "c_a")).toEqual([]);
  });
});

describe("JourneyPanel", () => {
  const view = (buffs?: JourneyBuffView[]): JourneyView => ({
    node: "den",
    title: "The Den",
    visit: 1,
    status: "playing",
    chapter: "rb-den",
    exits: [],
    ...(buffs ? { buffs } : {}),
  });

  it("shows the rift powers the party carries", () => {
    render(<JourneyPanel journey={view(HELD)} onChoose={() => {}} onContinue={() => {}} />);
    expect(within(screen.getByRole("list", { name: "Rift powers you carry" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("shows no list when the party carries none", () => {
    render(<JourneyPanel journey={view()} onChoose={() => {}} onContinue={() => {}} />);
    expect(screen.queryByRole("list", { name: "Rift powers you carry" })).toBeNull();
  });
});
