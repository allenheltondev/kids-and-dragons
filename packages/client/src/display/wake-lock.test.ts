import { describe, expect, it, vi } from "vitest";
import { keepAwake } from "./wake-lock";

function fakeDoc() {
  const handlers = new Map<string, Set<() => void>>();
  const doc = {
    visibilityState: "visible" as DocumentVisibilityState,
    addEventListener: (type: string, fn: () => void) => { (handlers.get(type) ?? handlers.set(type, new Set()).get(type)!).add(fn); },
    removeEventListener: (type: string, fn: () => void) => { handlers.get(type)?.delete(fn); },
  };
  return { doc, fire: (type: string) => handlers.get(type)?.forEach((fn) => { fn(); }), handlers };
}

function fakeLock() {
  const sentinels: { release: ReturnType<typeof vi.fn>; fireRelease: () => void }[] = [];
  const request = vi.fn(async () => {
    let onRelease: () => void = () => undefined;
    const sentinel = {
      release: vi.fn(async () => undefined),
      addEventListener: (_: string, fn: () => void) => { onRelease = fn; },
      fireRelease: () => { onRelease(); },
    };
    sentinels.push(sentinel);
    return sentinel as unknown as WakeLockSentinel;
  });
  return { nav: { wakeLock: { request } } as unknown as Navigator, request, sentinels };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("keepAwake", () => {
  it("does nothing, and does not throw, where there is no Wake Lock API", () => {
    const { doc, handlers } = fakeDoc();
    const awake = keepAwake({ nav: {} as Navigator, doc: doc as unknown as Document });
    expect(awake.state()).toBe("unsupported");
    expect([...handlers.values()].every((set) => set.size === 0)).toBe(true);
    expect(() => { awake.stop(); }).not.toThrow();
  });

  it("holds the lock and asks again when the browser lets it go on hiding the tab", async () => {
    const { doc, fire } = fakeDoc();
    const { nav, request, sentinels } = fakeLock();
    const awake = keepAwake({ nav, doc: doc as unknown as Document });
    await settle();
    expect(awake.state()).toBe("held");
    expect(request).toHaveBeenCalledTimes(1);

    // The tab hides: the browser releases the lock on its own.
    doc.visibilityState = "hidden";
    sentinels[0]!.fireRelease();
    expect(awake.state()).toBe("released");
    fire("visibilitychange");
    await settle();
    expect(request).toHaveBeenCalledTimes(1); // not while hidden

    doc.visibilityState = "visible";
    fire("visibilitychange");
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(awake.state()).toBe("held");
  });

  it("reads a refusal as an answer, and tries again on the next tap", async () => {
    const { doc, fire } = fakeDoc();
    const request = vi.fn().mockRejectedValueOnce(new Error("NotAllowedError")).mockResolvedValue({
      release: async () => undefined,
      addEventListener: () => undefined,
    });
    const awake = keepAwake({ nav: { wakeLock: { request } } as unknown as Navigator, doc: doc as unknown as Document });
    await settle();
    expect(awake.state()).toBe("denied");
    fire("pointerdown");
    await settle();
    expect(awake.state()).toBe("held");
  });

  it("lets go when stopped, and a lock that arrives after stopping is released at once", async () => {
    const { doc } = fakeDoc();
    const { nav, sentinels } = fakeLock();
    const awake = keepAwake({ nav, doc: doc as unknown as Document });
    await settle();
    awake.stop();
    expect(sentinels[0]!.release).toHaveBeenCalled();
  });
});
