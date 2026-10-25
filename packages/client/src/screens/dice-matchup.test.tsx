// @vitest-environment jsdom
/**
 * The dice card and its spoken sentence print every term of the roll,
 * the matchup included, so the sum a child reads is the sum that was made.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiceRoll } from "@kad/shared";
import { useGameStore } from "../store";
import { ROLL_HELP_TUMBLE_MS, ROLL_TUMBLE_MS } from "../world/presentation";
import { DiceOverlay, spokenRoll } from "./DiceOverlay";

const note = { id: "n", roll: 0, damage: 0 } as never;

function roll(over: Partial<DiceRoll>): DiceRoll {
  return { die: 14, mod: 2, total: 16, tn: 12, result: "success", characterId: "c_1", stat: "quick", ...over };
}

function withMatchup(amount: number, over: Partial<DiceRoll> = {}): DiceRoll {
  const base = roll(over);
  return { ...base, total: base.total + amount, matchup: { amount, notes: [note] } };
}

/** Sum the printed terms of "14+2+1=17" and return [sum, printed total]. */
function printed(maths: string): [number, number] {
  const [lhs, rhs] = maths.replace(/−/g, "-").split("=");
  const sum = (lhs!.match(/[+-]?\d+/g) ?? []).reduce((a, t) => a + Number(t), 0);
  return [sum, Number(rhs)];
}

/** Sum the spoken terms ("rolled 14 plus 2 plus 1 from the matchup, 17.") */
function spokenSum(text: string): [number, number] {
  const m = /rolled (.*?), (\d+)\./.exec(text)!;
  const body = m[1]!.replace(/ from [^+]*?(?= (plus|minus)|$)/g, "");
  const parts = body.split(/ (plus|minus) /);
  let sum = Number(parts[0]);
  for (let i = 1; i < parts.length; i += 2) {
    const n = Number(parts[i + 1]);
    sum += parts[i] === "minus" ? -n : n;
  }
  return [sum, Number(m[2])];
}

function mathsOf(r: DiceRoll): string {
  render(<DiceOverlay />);
  act(() => {
    useGameStore.setState({ presentation: { seq: 7, presentation: { kind: "ROLL", roll: r } } } as never);
  });
  act(() => vi.advanceTimersByTime(ROLL_TUMBLE_MS + ROLL_HELP_TUMBLE_MS));
  return document.querySelector(".dice__maths")!.textContent!;
}

beforeEach(() => {
  vi.useFakeTimers();
  useGameStore.setState({ presentation: null } as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a roll with a matchup", () => {
  it("prints and says a positive matchup", () => {
    const r = withMatchup(1);
    const maths = mathsOf(r);
    expect(maths).toBe("14+2+1=17");
    expect(printed(maths)).toEqual([17, r.total]);
    const said = spokenRoll(r, "Sparklehoof", null);
    expect(said).toBe("Sparklehoof rolled 14 plus 2 plus 1 from the matchup, 17. Success!");
    expect(spokenSum(said)).toEqual([17, r.total]);
  });

  it("prints and says a negative matchup", () => {
    const r = withMatchup(-1);
    const maths = mathsOf(r);
    expect(maths).toBe("14+2−1=15");
    expect(printed(maths)).toEqual([15, r.total]);
    const said = spokenRoll(r, "Sparklehoof", null);
    expect(said).toBe("Sparklehoof rolled 14 plus 2 minus 1 from the matchup, 15. Success!");
    expect(spokenSum(said)).toEqual([15, r.total]);
  });

  it.each([3, -3])("shows the capped amount %i, not the sum of the notes", (amount) => {
    const r = withMatchup(amount);
    const maths = mathsOf(r);
    expect(printed(maths)).toEqual([r.total, r.total]);
    expect(maths).toContain(`${amount < 0 ? "−" : "+"}3=`);
    const said = spokenRoll(r, "Sparklehoof", null);
    expect(said).toContain(`${amount < 0 ? "minus" : "plus"} 3 from the matchup`);
    expect(spokenSum(said)).toEqual([r.total, r.total]);
  });

  it("adds help, buff and matchup so every term sums to the total", () => {
    const r = withMatchup(-2, {
      die: 9,
      mod: 2,
      total: 16,
      help: { characterId: "c_2", sides: 6, value: 3 },
      buff: { id: "riftspark", label: "Riftspark", amount: 2 },
    });
    expect(r.total).toBe(14);
    const maths = mathsOf(r);
    expect(maths).toBe("9+2+3+2−2=14");
    expect(printed(maths)).toEqual([14, r.total]);
    const said = spokenRoll(r, "Sparklehoof", "Windstep");
    expect(said).toBe(
      "Sparklehoof rolled 9 plus 2 plus 3 from Windstep plus 2 from Riftspark minus 2 from the matchup, 14. Success!",
    );
    expect(spokenSum(said)).toEqual([14, r.total]);
  });

  it("is unchanged without a matchup, or with a zero one", () => {
    const r = roll({});
    const maths = mathsOf(r);
    expect(maths).toBe("14+2=16");
    expect(printed(maths)).toEqual([16, r.total]);
    expect(spokenRoll(r, "Sparklehoof", null)).toBe("Sparklehoof rolled 14 plus 2, 16. Success!");
    const zero: DiceRoll = { ...r, matchup: { amount: 0, notes: [] } };
    expect(spokenRoll(zero, "Sparklehoof", null)).toBe(spokenRoll(r, "Sparklehoof", null));
  });
});
