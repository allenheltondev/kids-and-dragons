// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DETAIL_STEP, pushBackStep, runBackStep, useBackStep, useHasBackStep } from "./back-steps";

describe("steps back inside a page", () => {
  it("has nothing to do when nothing is open", () => {
    expect(runBackStep()).toBe(false);
  });

  it("runs the most specific step first, and the newest among equals", () => {
    const calls: string[] = [];
    const drops = [
      pushBackStep(() => { calls.push("pane"); return true; }),
      pushBackStep(() => { calls.push("entry"); return true; }, DETAIL_STEP),
      pushBackStep(() => { calls.push("newer pane"); return true; }),
    ];
    expect(runBackStep()).toBe(true);
    expect(calls).toEqual(["entry"]);
    drops[1]!();
    runBackStep();
    expect(calls).toEqual(["entry", "newer pane"]);
    drops.forEach((drop) => drop());
    expect(runBackStep()).toBe(false);
  });

  it("lets the next step try when one finds nothing to undo", () => {
    const first = vi.fn(() => true);
    const idle = vi.fn(() => false);
    const drops = [pushBackStep(first), pushBackStep(idle)];
    expect(runBackStep()).toBe(true);
    expect(idle).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    drops.forEach((drop) => drop());
  });

  it("is offered by a screen only while it has somewhere to go back to", () => {
    const seen = renderHook(() => useHasBackStep());
    expect(seen.result.current).toBe(false);

    const step = vi.fn(() => true);
    const screen = renderHook(({ open }) => useBackStep(open ? step : null), { initialProps: { open: false } });
    expect(seen.result.current).toBe(false);
    screen.rerender({ open: true });
    expect(seen.result.current).toBe(true);

    act(() => { runBackStep(); });
    expect(step).toHaveBeenCalledTimes(1);

    screen.rerender({ open: false });
    expect(seen.result.current).toBe(false);
    screen.unmount();
    seen.unmount();
  });
});
