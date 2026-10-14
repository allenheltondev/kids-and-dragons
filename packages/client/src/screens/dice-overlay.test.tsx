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
import { DiceOverlay, celebrationFor, groupLine, marginLine, spokenRoll } from "./DiceOverlay";
import { burst } from "./DiceCelebration";

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

  it("tallies a whole-party check on its last roll", () => {
    expect(groupLine({ made: 2, of: 3, result: "success" })).toBe("2 of 3 made it. The party makes it!");
    expect(groupLine({ made: 1, of: 3, result: "failure" })).toBe("1 of 3 made it. Not this time for the party.");
  });

  it("picks the celebration from the die and the result", () => {
    expect(celebrationFor({ die: 20, result: "success" })).toBe("crit");
    expect(celebrationFor({ die: 1, result: "failure" })).toBe("fumble");
    expect(celebrationFor({ die: 12, result: "success" })).toBe("success");
    expect(celebrationFor({ die: 5, result: "failure" })).toBe("miss");
  });

  it("says by how much, in numbers a kid can check", () => {
    expect(marginLine({ die: 11, total: 16, tn: 12, result: "success" })).toBe("Beat 12 by 4!");
    expect(marginLine({ die: 9, total: 12, tn: 12, result: "success" })).toBe("Exactly 12. Just made it!");
    expect(marginLine({ die: 5, total: 9, tn: 12, result: "failure" })).toBe("3 short of 12.");
    expect(marginLine({ die: 20, total: 22, tn: 25, result: "success" })).toBe("A natural 20 always makes it!");
    expect(marginLine({ die: 1, total: 15, tn: 8, result: "failure" })).toBe("Bonk! A natural 1 never makes it. Next time!");
  });

  it("throws the same confetti for the same roll, more of it on a 20, and fans it upward", () => {
    expect(burst("success", 7)).toEqual(burst("success", 7));
    expect(burst("crit", 7).length).toBeGreaterThan(burst("success", 7).length);
    for (const piece of burst("success", 3)) expect(piece.y).toBeLessThanOrEqual(0);
    expect(burst("success", 3).some((p) => p.shape === "star")).toBe(false);
  });

  it("drops the confetti and stamps the headline once every die is down", () => {
    render(<DiceOverlay />);
    throwRoll(HELPED);
    expect(document.querySelector(".celebration")).toBeNull();
    act(() => vi.advanceTimersByTime(ROLL_TUMBLE_MS + ROLL_HELP_TUMBLE_MS));
    expect(document.querySelector(".celebration--success")).not.toBeNull();
    expect(screen.getByText("Beat 12 by 2!")).toBeTruthy();
  });

  it("bonks a natural 1: the starburst, the dizzy stars and the sound", async () => {
    const audio = await import("../audio/cue");
    const played: string[] = [];
    audio.setAudioSink({ cue: (id) => played.push(id), music: () => undefined });
    render(<DiceOverlay />);
    throwRoll({ die: 1, mod: 4, total: 5, tn: 8, result: "failure", characterId: "c_1", stat: "quick" });
    act(() => vi.advanceTimersByTime(ROLL_TUMBLE_MS));
    expect(screen.getByText("BONK!")).toBeTruthy();
    expect(document.querySelectorAll(".celebration__dizzy-star")).toHaveLength(3);
    expect(played).toContain("bonk");
    audio.setAudioSink(null);
  });
});
