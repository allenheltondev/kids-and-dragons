// @vitest-environment jsdom
/** One speaker control enables blocked audio, then mutes and unmutes it. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../store", () => ({ useGameStore: { getState: () => ({ reconnect: () => undefined }) } }));

import { AudioControl } from "../audio";
import { DisplayExtras } from "./DisplayExtras";

class BlockedContext {
  static allowed = false;
  static latest: BlockedContext | null = null;
  constructor() { BlockedContext.latest = this; }
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

it("keeps one button through blocked, enabled, and muted states", async () => {
  vi.stubGlobal("AudioContext", BlockedContext);
  screenWithSound();
  expect(await screen.findAllByRole("button", { name: /^(Enable sound|Turn sound)/ })).toHaveLength(1);
  const speaker = screen.getByRole("button", { name: "Enable sound" });

  expect(screen.getByRole("button", { name: "Enable sound" }).textContent).toBe("");
  expect(screen.getByRole("button", { name: "Enable sound" }).querySelector(".kad-icon")).not.toBeNull();

  // A first tap the browser still refuses leaves the ask on screen.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Enable sound" })); });
  expect(screen.getByRole("button", { name: "Enable sound" })).toBeTruthy();

  BlockedContext.allowed = true;
  await act(async () => {
    fireEvent.pointerDown(speaker);
    fireEvent.click(speaker);
    await Promise.resolve();
  });
  expect(screen.queryByRole("button", { name: "Enable sound" })).toBeNull();
  expect(screen.getByRole("button", { name: "Turn sound off" })).toBe(speaker);
  expect(speaker.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(speaker);
  expect(screen.getByRole("button", { name: "Turn sound on" })).toBe(speaker);
});

it("honors saved mute and enables sound from that same control", async () => {
  vi.stubGlobal("AudioContext", BlockedContext);
  localStorage.setItem("kad-audio", JSON.stringify({ muted: true, volume: .8 }));
  screenWithSound();
  const speaker = await screen.findByRole("button", { name: "Turn sound on" });
  expect(screen.getAllByRole("button", { name: /^(Enable sound|Turn sound)/ })).toHaveLength(1);
  await act(async () => { fireEvent.click(speaker); });
  expect(screen.getByRole("button", { name: "Enable sound" })).toBe(speaker);
});

it("updates the same control when a running browser suspends audio", async () => {
  vi.stubGlobal("AudioContext", BlockedContext);
  BlockedContext.allowed = true;
  screenWithSound();
  const speaker = await screen.findByRole("button", { name: "Enable sound" });
  await act(async () => { fireEvent.keyDown(speaker, { key: "Enter" }); fireEvent.click(speaker); });
  expect(screen.getByRole("button", { name: "Turn sound off" })).toBe(speaker);
  act(() => {
    BlockedContext.latest!.state = "suspended";
    for (const notify of BlockedContext.latest!.listeners) notify();
  });
  expect(screen.getByRole("button", { name: "Enable sound" })).toBe(speaker);
  await act(async () => { fireEvent.pointerDown(speaker); fireEvent.click(speaker); });
  expect(screen.getByRole("button", { name: "Turn sound off" })).toBe(speaker);
});

it("does not ask a browser with no audio at all for a tap that cannot help", async () => {
  // jsdom: no AudioContext. Silent play is the whole story there.
  screenWithSound();
  await screen.findByRole("button", { name: "About this screen" });
  expect(screen.queryByRole("button", { name: "Enable sound" })).toBeNull();
  expect(screen.getByRole("button", { name: "Turn sound off" })).toBeTruthy();
});
