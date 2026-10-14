// @vitest-environment jsdom
/**
 * The dice card's beats: the d20 lands, a friend's die lands after it, and the
 * sum stays up long enough to read.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiceRoll } from "@kad/shared";
import { useGameStore } from "../store";
import { ROLL_HELP_TUMBLE_MS, ROLL_READ_MS, ROLL_TUMBLE_MS } from "../world/presentation";
import { DiceOverlay, spokenRoll } from "./DiceOverlay";

const HELPED: DiceRoll = {
  die: 9,
  mod: 2,
  total: 14,
  tn: 12,
  result: "success",
  characterId: "c_1",
  stat: "quick",
  help: { characterId: "c_2", sides: 6, value: 3 },
};

function throwRoll(roll: DiceRoll): void {
  act(() => {
    useGameStore.setState({
      presentation: { seq: 7, presentation: { kind: "ROLL", roll } },
    } as never);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useGameStore.setState({ presentation: null } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the dice card", () => {
  it("lands the d20, then the helper's die, then shows the sum for a proper read", () => {
    render(<DiceOverlay />);
    throwRoll(HELPED);
    expect(screen.getByText(/helps: d6/)).toBeTruthy();

    act(() => vi.advanceTimersByTime(ROLL_TUMBLE_MS));
    expect(document.querySelector(".dice__card--settled")).toBeNull();

    act(() => vi.advanceTimersByTime(ROLL_HELP_TUMBLE_MS));
    expect(document.querySelector(".dice__card--settled")).not.toBeNull();
    expect(screen.getByText("+3")).toBeTruthy();

    act(() => vi.advanceTimersByTime(ROLL_READ_MS - 100));
    expect(document.querySelector(".dice")).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(document.querySelector(".dice")).toBeNull();
  });

  it("says the helper's share out loud", () => {
    expect(spokenRoll(HELPED, "Sparklehoof", "Windstep")).toBe(
      "Sparklehoof rolled 9 plus 2 plus 3 from Windstep, 14. Success!",
    );
  });
});
