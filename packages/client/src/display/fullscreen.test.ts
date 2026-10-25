import { describe, expect, it, vi } from "vitest";
import {
  FULLSCREEN_KEY,
  canFullscreen,
  describeFullscreen,
  isFullscreen,
  watchFullscreen,
  type FullscreenDoc,
} from "./fullscreen";

/** A document that can go full screen, or one of the TV browsers that cannot. */
function fakeDoc(options: { standard?: boolean; webkit?: boolean; enabled?: boolean; refuse?: boolean } = {}) {
  const { standard = true, webkit = false, enabled = true, refuse = false } = options;
  const listeners = new Map<string, Set<EventListener>>();
  let element: Element | null = null;
  const asked = vi.fn();
  const root: FullscreenDoc["documentElement"] = {};
  if (standard) {
    root.requestFullscreen = async (): Promise<void> => {
      asked();
      if (refuse) throw new Error("gesture required");
      element = {} as Element;
      fire("fullscreenchange");
    };
  }
  if (webkit) {
    root.webkitRequestFullscreen = (): void => {
      asked();
      element = {} as Element;
      fire("webkitfullscreenchange");
    };
  }
  function fire(type: string): void {
    for (const listener of listeners.get(type) ?? []) listener(new Event(type));
  }
  const doc = {
    documentElement: root,
    fullscreenEnabled: enabled,
    get fullscreenElement() { return element; },
    addEventListener: ((type: string, listener: EventListener) => {
      const set = listeners.get(type) ?? new Set<EventListener>();
      set.add(listener);
      listeners.set(type, set);
    }) as Document["addEventListener"],
    removeEventListener: ((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }) as Document["removeEventListener"],
  } as unknown as FullscreenDoc;
  return {
    doc,
    asked,
    fire,
    leave(): void {
      element = null;
      fire("fullscreenchange");
    },
  };
}

function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    has: (key: string) => map.has(key),
  };
}

describe("full screen on the shared screen", () => {
  it("is unsupported where the browser has neither spelling, and says so without throwing", () => {
    const { doc } = fakeDoc({ standard: false });
    expect(canFullscreen(doc)).toBe(false);
    const watch = watchFullscreen({ doc, store: fakeStore() });
    expect(watch.state()).toBe("unsupported");
    // Pressing it anyway is a no-op, not a crash.
    watch.enter();
    expect(watch.state()).toBe("unsupported");
    watch.stop();
  });

  it("is unsupported inside a frame, where fullscreenEnabled is false", () => {
    const { doc } = fakeDoc({ enabled: false });
    expect(canFullscreen(doc)).toBe(false);
  });

  it("takes the older webkit spelling", async () => {
    const { doc, asked } = fakeDoc({ standard: false, webkit: true });
    const watch = watchFullscreen({ doc, store: fakeStore() });
    expect(watch.state()).toBe("off");
    watch.enter();
    await vi.waitFor(() => { expect(watch.state()).toBe("on"); });
    expect(asked).toHaveBeenCalledOnce();
    watch.stop();
  });

  it("remembers a screen that went full, and asks again on the next load's first key", async () => {
    const store = fakeStore();
    const first = fakeDoc();
    const one = watchFullscreen({ doc: first.doc, store });
    one.enter();
    await vi.waitFor(() => { expect(one.state()).toBe("on"); });
    expect(store.has(FULLSCREEN_KEY)).toBe(true);
    one.stop();

    // A fresh load: nothing is asked until a gesture, since a browser refuses outside one.
    const next = fakeDoc();
    const two = watchFullscreen({ doc: next.doc, store });
    expect(two.state()).toBe("off");
    expect(next.asked).not.toHaveBeenCalled();
    next.fire("keydown");
    await vi.waitFor(() => { expect(two.state()).toBe("on"); });
    two.stop();
  });

  it("asks once per load, not on every key", async () => {
    const store = fakeStore({ [FULLSCREEN_KEY]: "1" });
    const { doc, asked, fire } = fakeDoc({ refuse: true });
    const watch = watchFullscreen({ doc, store });
    fire("keydown");
    fire("keydown");
    fire("pointerdown");
    await vi.waitFor(() => { expect(asked).toHaveBeenCalledOnce(); });
    // Refused outside the button, so it keeps waiting rather than calling itself denied.
    expect(watch.state()).toBe("off");
    watch.stop();
  });

  it("says denied when the button itself is refused", async () => {
    const { doc } = fakeDoc({ refuse: true });
    const watch = watchFullscreen({ doc, store: fakeStore() });
    watch.enter();
    await vi.waitFor(() => { expect(watch.state()).toBe("denied"); });
    watch.stop();
  });

  it("stops asking on later loads once somebody leaves full screen on purpose", async () => {
    const store = fakeStore();
    const screen = fakeDoc();
    const watch = watchFullscreen({ doc: screen.doc, store });
    watch.enter();
    await vi.waitFor(() => { expect(watch.state()).toBe("on"); });
    screen.leave();
    expect(watch.state()).toBe("off");
    expect(store.has(FULLSCREEN_KEY)).toBe(false);
    watch.stop();
  });

  it("lets go of every listener when the display closes", () => {
    const { doc, asked, fire } = fakeDoc();
    const watch = watchFullscreen({ doc, store: fakeStore({ [FULLSCREEN_KEY]: "1" }) });
    watch.stop();
    fire("keydown");
    expect(asked).not.toHaveBeenCalled();
  });

  it("reads the state back in plain words for the report", () => {
    expect(describeFullscreen("on").ok).toBe(true);
    expect(describeFullscreen("off").ok).toBe(true);
    expect(describeFullscreen("denied").ok).toBe(false);
    expect(describeFullscreen("unsupported").detail).toMatch(/Not available/);
  });

  it("reads the element by either spelling", () => {
    expect(isFullscreen({ fullscreenElement: null, webkitFullscreenElement: {} as Element } as FullscreenDoc)).toBe(true);
    expect(isFullscreen({ fullscreenElement: null } as FullscreenDoc)).toBe(false);
  });
});
