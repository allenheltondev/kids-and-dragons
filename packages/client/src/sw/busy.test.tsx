// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { isBusy, resetBusy, setBusy, useBusy, useIsBusy } from "./busy";

afterEach(resetBusy);

describe("busy", () => {
  it("is busy while any reason is held, and idle once all are released", () => {
    expect(isBusy()).toBe(false);
    setBusy("creation", true);
    setBusy("home-form", true);
    expect(isBusy()).toBe(true);
    setBusy("creation", false);
    expect(isBusy()).toBe(true);
    setBusy("home-form", false);
    expect(isBusy()).toBe(false);
  });

  it("useBusy holds its reason while active and mounted, and useIsBusy follows", () => {
    const watcher = renderHook(() => useIsBusy());
    expect(watcher.result.current).toBe(false);
    const holder = renderHook(({ active }: { active: boolean }) => useBusy("creation", active), {
      initialProps: { active: true },
    });
    expect(watcher.result.current).toBe(true);
    act(() => holder.rerender({ active: false }));
    expect(watcher.result.current).toBe(false);
    act(() => holder.rerender({ active: true }));
    expect(watcher.result.current).toBe(true);
    holder.unmount();
    expect(watcher.result.current).toBe(false);
  });
});
