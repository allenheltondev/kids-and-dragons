// @vitest-environment jsdom
/**
 * The reconnecting banner: shown only for a drop that lasts, gone the moment
 * the channel is back. The grace period is the behaviour under test — the
 * banner exists to explain a stall, and a banner that flashed on every
 * sub-second blip would manufacture the very anxiety it is meant to absorb.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useGameStore } from "../store";
import { ConnectionBanner, RECONNECT_GRACE_MS } from "./ConnectionBanner";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  act(() => {
    useGameStore.setState({ connection: "idle" });
  });
});

function setConnection(status: "idle" | "connecting" | "open" | "reconnecting" | "error"): void {
  act(() => {
    useGameStore.setState({ connection: status });
  });
}

describe("the reconnecting banner", () => {
  it("says nothing for a blip shorter than the grace period", () => {
    vi.useFakeTimers();
    render(<ConnectionBanner />);

    setConnection("reconnecting");
    act(() => {
      vi.advanceTimersByTime(RECONNECT_GRACE_MS - 100);
    });
    expect(screen.queryByText("Reconnecting…")).toBeNull();

    // The channel came back before the grace elapsed: never shown at all.
    setConnection("open");
    act(() => {
      vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
    });
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });

  it("appears once a drop has lasted, and leaves the moment the channel is back", () => {
    vi.useFakeTimers();
    render(<ConnectionBanner />);

    setConnection("reconnecting");
    act(() => {
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 50);
    });
    expect(screen.getByText("Reconnecting…")).toBeTruthy();

    setConnection("open");
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });

  it("stays quiet for every state that is not a drop", () => {
    // "connecting" is the initial attach — the screens own their spinners
    // there — and "error" already has the toast. This banner is only for the
    // mid-session stall nothing else explains.
    vi.useFakeTimers();
    render(<ConnectionBanner />);
    for (const status of ["idle", "connecting", "open", "error"] as const) {
      setConnection(status);
      act(() => {
        vi.advanceTimersByTime(RECONNECT_GRACE_MS * 2);
      });
      expect(screen.queryByText("Reconnecting…")).toBeNull();
    }
  });
});
