// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useGameStore } from "../store";
import { HEARTBEAT_MS, usePresenceBeat } from "./presence-beat";

function Beating(): null {
  usePresenceBeat();
  return null;
}

let visibility: DocumentVisibilityState = "visible";
const beat = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  beat.mockClear();
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  useGameStore.setState({
    session: { runId: "r_1", roomCode: "ABCD", playerId: "p_1", mode: "party", sessionToken: "t" },
    beat,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the phone's heartbeat (#258)", () => {
  it("beats at once, then every interval while on screen", () => {
    render(<Beating />);
    expect(beat).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS * 3));
    expect(beat).toHaveBeenCalledTimes(4);
    expect(beat).toHaveBeenLastCalledWith();
  });

  it("goes quiet while hidden, and beats the moment it is back on screen", () => {
    render(<Beating />);
    visibility = "hidden";
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS * 5));
    expect(beat).toHaveBeenCalledTimes(1);
    visibility = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(beat).toHaveBeenCalledTimes(2);
  });

  it("says goodbye as the page closes, but not when it is only stashed", () => {
    render(<Beating />);
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true }));
    });
    expect(beat).not.toHaveBeenCalledWith(true);
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: false }));
    });
    expect(beat).toHaveBeenLastCalledWith(true);
  });

  it("is silent on a screen with no player, like the TV", () => {
    useGameStore.setState({
      session: { runId: "r_1", roomCode: "ABCD", playerId: "", mode: "party", sessionToken: "" },
    });
    render(<Beating />);
    act(() => vi.advanceTimersByTime(HEARTBEAT_MS * 2));
    expect(beat).not.toHaveBeenCalled();
  });
});
