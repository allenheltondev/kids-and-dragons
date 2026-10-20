// @vitest-environment jsdom
/**
 * "Tap for sound" on the shared screen (#264): one plain button while the
 * browser is holding sound back, gone once it is playing, never for a browser
 * with no audio, and never in the way of silent play.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../store", () => ({ useGameStore: { getState: () => ({ reconnect: () => undefined }) } }));

import { AudioControl } from "../audio";
import { DisplayExtras } from "./DisplayExtras";

class BlockedContext {
  static allowed = false;
  currentTime = 0;
  state: "suspended" | "running" = "suspended";
  destination = {};
  listeners = new Set<() => void>();
  addEventListener(_: string, fn: () => void): void { this.listeners.add(fn); }
  removeEventListener(_: string, fn: () => void): void { this.listeners.delete(fn); }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
  createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
  resume(): Promise<void> {
    // The TV browser lets sound start only once it is really allowed.
    if (BlockedContext.allowed) {
      this.state = "running";
      for (const fn of this.listeners) fn();
    }
    return Promise.resolve();
  }
  close(): Promise<void> { return Promise.resolve(); }
}

function screenWithSound(): void {
  render(<><AudioControl /><DisplayExtras /></>);
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  BlockedContext.allowed = false;
});

it("shows one button while sound is blocked, keeps it through a refused tap, and drops it once sound plays", async () => {
  vi.stubGlobal("AudioContext", BlockedContext);
  screenWithSound();
  expect(await screen.findAllByRole("button", { name: "Tap for sound" })).toHaveLength(1);

  // A first tap the browser still refuses leaves the ask on screen.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Tap for sound" })); });
  expect(screen.getByRole("button", { name: "Tap for sound" })).toBeTruthy();

  BlockedContext.allowed = true;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Tap for sound" }));
    await Promise.resolve();
  });
  expect(screen.queryByRole("button", { name: "Tap for sound" })).toBeNull();
});

it("stays out of the way when sound is turned off, and comes back when it is turned on", async () => {
  vi.stubGlobal("AudioContext", BlockedContext);
  screenWithSound();
  await screen.findByRole("button", { name: "Tap for sound" });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Turn sound off" })); });
  expect(screen.queryByRole("button", { name: "Tap for sound" })).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Turn sound on" })); });
  expect(screen.getByRole("button", { name: "Tap for sound" })).toBeTruthy();
});

it("does not ask a browser with no audio at all for a tap that cannot help", async () => {
  // jsdom: no AudioContext. Silent play is the whole story there.
  screenWithSound();
  await screen.findByRole("button", { name: "About this screen" });
  expect(screen.queryByRole("button", { name: "Tap for sound" })).toBeNull();
  expect(screen.getByRole("button", { name: "Turn sound off" })).toBeTruthy();
});
