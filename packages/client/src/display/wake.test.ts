import { afterEach, describe, expect, it, vi } from "vitest";
import { onWake, SLEEP_GAP_MS, TICK_MS } from "./wake";

afterEach(() => { vi.useRealTimers(); });

function env() {
  const doc = new EventTarget() as EventTarget & { visibilityState: string };
  doc.visibilityState = "visible";
  const win = new EventTarget();
  let clock = 0;
  return {
    doc, win,
    advance: (ms: number) => { clock += ms; },
    deps: { doc: doc as unknown as Document, win: win as unknown as Window, now: () => clock },
  };
}

describe("onWake", () => {
  it("fires when the page becomes visible again, not when it hides", () => {
    const e = env();
    const wake = vi.fn();
    const stop = onWake(wake, e.deps);
    e.doc.visibilityState = "hidden";
    e.doc.dispatchEvent(new Event("visibilitychange"));
    expect(wake).not.toHaveBeenCalled();
    e.doc.visibilityState = "visible";
    e.doc.dispatchEvent(new Event("visibilitychange"));
    expect(wake).toHaveBeenCalledTimes(1);
    stop();
  });

  it("fires when restored from the back/forward cache", () => {
    const e = env();
    const wake = vi.fn();
    const stop = onWake(wake, e.deps);
    e.win.dispatchEvent(new Event("pageshow"));
    expect(wake).toHaveBeenCalledTimes(1);
    stop();
  });

  it("fires when the whole page was frozen and no event said so", () => {
    vi.useFakeTimers();
    const e = env();
    const wake = vi.fn();
    const stop = onWake(wake, e.deps);
    e.advance(TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    expect(wake).not.toHaveBeenCalled(); // an ordinary tick
    e.advance(SLEEP_GAP_MS + TICK_MS);
    vi.advanceTimersByTime(TICK_MS);
    expect(wake).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stops listening", () => {
    const e = env();
    const wake = vi.fn();
    onWake(wake, e.deps)();
    e.doc.dispatchEvent(new Event("visibilitychange"));
    expect(wake).not.toHaveBeenCalled();
  });
});
