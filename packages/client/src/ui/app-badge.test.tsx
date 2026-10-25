// @vitest-environment jsdom
/**
 * The app icon badge (#466): set while a question waits and the page is hidden,
 * cleared otherwise, and never for the TV or a shared tablet.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { RunState } from "@kad/shared";
import { useGameStore } from "../store";
import { saveSharedDevice } from "../store/persistence";
import { badgeFor, useAppBadge, type BadgeInput } from "./app-badge";

const ready = { kind: "ready" as const, forPlayerIds: ["p1"] };

function run(prompt: RunState["prompt"] = ready): RunState {
  return {
    chapterId: "ch1",
    visited: ["a"],
    prompt,
    party: [{ playerId: "p1", character: { id: "c1" } }],
  } as unknown as RunState;
}

function setRun(state: RunState | null, playerId = "p1"): void {
  act(() => {
    useGameStore.setState({
      state,
      session: state ? ({ playerId, runId: "r1", roomCode: "ABCD" } as never) : null,
    });
  });
}

function setVisibility(value: "visible" | "hidden"): void {
  act(() => {
    Object.defineProperty(document, "visibilityState", { value, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

function Probe(): null {
  useAppBadge();
  return null;
}

const base: BadgeInput = { waiting: true, playerId: "p1", sharedDevice: false, hidden: true };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(navigator, "setAppBadge", { value: undefined, configurable: true, writable: true });
  Object.defineProperty(navigator, "clearAppBadge", { value: undefined, configurable: true, writable: true });
  setRun(null);
});

describe("badgeFor", () => {
  it("sets the badge for a waiting question while hidden", () => {
    expect(badgeFor(base)).toBe("set");
  });

  it.each([
    ["the page is visible", { hidden: false }],
    ["no question is open", { waiting: false }],
    ["the TV or a display client", { playerId: "" }],
    ["a shared tablet", { sharedDevice: true }],
  ])("clears when %s", (_, override) => {
    expect(badgeFor({ ...base, ...override })).toBe("clear");
  });
});

describe("useAppBadge", () => {
  function stubBadge(): { set: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } {
    const set = vi.fn(() => Promise.resolve());
    const clear = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "setAppBadge", { value: set, configurable: true, writable: true });
    Object.defineProperty(navigator, "clearAppBadge", { value: clear, configurable: true, writable: true });
    return { set, clear };
  }

  it("clears once on mount", () => {
    const { set, clear } = stubBadge();
    render(<Probe />);
    expect(clear).toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("sets the badge when a prompt arrives while hidden, and clears when visible", () => {
    const { set, clear } = stubBadge();
    setVisibility("hidden");
    render(<Probe />);
    setRun(run());
    expect(set).toHaveBeenCalledWith(1);

    clear.mockClear();
    setVisibility("visible");
    expect(clear).toHaveBeenCalled();
  });

  it("sets the badge when the page hides with a question open", () => {
    const { set } = stubBadge();
    render(<Probe />);
    setRun(run());
    expect(set).not.toHaveBeenCalled();
    setVisibility("hidden");
    expect(set).toHaveBeenCalledWith(1);
  });

  it("clears when the question is answered", () => {
    const { set, clear } = stubBadge();
    setVisibility("hidden");
    render(<Probe />);
    setRun(run());
    expect(set).toHaveBeenCalledTimes(1);
    clear.mockClear();
    setRun(run(null));
    expect(clear).toHaveBeenCalled();
  });

  it("clears on unmount", () => {
    const { clear } = stubBadge();
    const view = render(<Probe />);
    clear.mockClear();
    view.unmount();
    expect(clear).toHaveBeenCalled();
  });

  it("never sets the badge on a watching shared tablet", () => {
    const { set } = stubBadge();
    saveSharedDevice({ token: "t", householdId: "h" });
    setVisibility("hidden");
    render(<Probe />);
    setRun(run());
    expect(set).not.toHaveBeenCalled();
  });

  it("never sets the badge on the TV (no player)", () => {
    const { set } = stubBadge();
    setVisibility("hidden");
    render(<Probe />);
    setRun(run(), "");
    expect(set).not.toHaveBeenCalled();
  });

  it("is silent where the API is absent or throws", () => {
    setVisibility("hidden");
    render(<Probe />);
    expect(() => setRun(run())).not.toThrow();

    const refusing = vi.fn(() => { throw new Error("blocked"); });
    Object.defineProperty(navigator, "setAppBadge", { value: refusing, configurable: true, writable: true });
    expect(() => setRun(run(null))).not.toThrow();
    expect(() => setRun(run())).not.toThrow();
    expect(refusing).toHaveBeenCalledTimes(1);
  });
});
