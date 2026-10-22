import { afterEach, describe, expect, it, vi } from "vitest";
import { onWake, SLEEP_GAP_MS, TICK_MS, WAKE_COALESCE_MS } from "./wake";

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

  it("fires when restored from the back/forward cache, not on a first load", () => {
    const e = env();
    const wake = vi.fn();
    const stop = onWake(wake, e.deps);
    e.win.dispatchEvent(new Event("pageshow"));
    expect(wake).not.toHaveBeenCalled();
    e.win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(wake).toHaveBeenCalledTimes(1);
    stop();
  });

  it("fires when a frozen app is thawed, and when the signal comes back (#413)", () => {
    const e = env();
    const wake = vi.fn();
    const stop = onWake(wake, e.deps);
    e.doc.dispatchEvent(new Event("resume"));
    expect(wake).toHaveBeenCalledTimes(1);
    e.advance(WAKE_COALESCE_MS);
    e.win.dispatchEvent(new Event("online"));
    expect(wake).toHaveBeenCalledTimes(2);
    stop();
  });

  it("answers a burst of wake signals once", () => {
    const e = env();
    const wake = vi.fn();
    const stop = onWake(wake, e.deps);
    // A thawed, bfcache-restored page says so three ways at once.
    e.doc.dispatchEvent(new Event("resume"));
    e.doc.dispatchEvent(new Event("visibilitychange"));
    e.win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(wake).toHaveBeenCalledTimes(1);
    stop();
  });

  it("never wakes a page that is off screen, whatever its throttled clock says", () => {
    vi.useFakeTimers();
    const e = env();
    const wake = vi.fn();
    const stop = onWake(wake, e.deps);
    e.doc.visibilityState = "hidden";
    // A background tab's timers run once a minute: every tick looks like a sleep.
    for (let i = 0; i < 3; i += 1) {
      e.advance(60_000);
      vi.advanceTimersByTime(TICK_MS);
    }
    e.win.dispatchEvent(new Event("online"));
    expect(wake).not.toHaveBeenCalled();
    // Coming back on screen is the wake.
    e.doc.visibilityState = "visible";
    e.doc.dispatchEvent(new Event("visibilitychange"));
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
    e.doc.dispatchEvent(new Event("resume"));
    e.win.dispatchEvent(new Event("online"));
    expect(wake).not.toHaveBeenCalled();
  });
});
