// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reconnect = vi.hoisted(() => vi.fn());
vi.mock("../store", () => ({ useGameStore: { getState: () => ({ reconnect }) } }));

import { useReconnectOnWake } from "./wake-reconnect";
import { WAKE_COALESCE_MS } from "./wake";

function Phone(): null {
  useReconnectOnWake();
  return null;
}

let visibility: DocumentVisibilityState = "visible";
let minutes = 0;

beforeEach(() => {
  vi.useFakeTimers();
  // Each case a minute after the last, clear of its page-wide wake.
  minutes += 1;
  vi.setSystemTime(Date.now() + minutes * 60_000);
  visibility = "visible";
  reconnect.mockClear();
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a phone coming back to the game (#413)", () => {
  it("opens a fresh stream and catches up when it is back on screen, not while it is away", () => {
    render(<Phone />);
    expect(reconnect).not.toHaveBeenCalled();
    visibility = "hidden";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(reconnect).not.toHaveBeenCalled();
    visibility = "visible";
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("catches up when a frozen app thaws, and the moment the signal is back", () => {
    render(<Phone />);
    act(() => { document.dispatchEvent(new Event("resume")); });
    expect(reconnect).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(WAKE_COALESCE_MS); });
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(reconnect).toHaveBeenCalledTimes(2);
  });

  it("opens one fresh stream for the page, however many screens on it listen", () => {
    render(<><Phone /><Phone /></>);
    act(() => { document.dispatchEvent(new Event("resume")); });
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("stops listening when the phone leaves the room", () => {
    const { unmount } = render(<Phone />);
    unmount();
    act(() => { document.dispatchEvent(new Event("resume")); });
    expect(reconnect).not.toHaveBeenCalled();
  });
});
