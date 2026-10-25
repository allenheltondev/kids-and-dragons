/**
 * Fill the television (#264).
 *
 * A smart TV's browser keeps its own furniture on screen: an address bar, a title bar, and on
 * some sets a hint strip along the bottom. The display is a story read from the sofa, so that
 * furniture is a stripe of browser across the top of a painted scene, and it costs real height
 * at the size the chapter title and goal are drawn.
 *
 * The Fullscreen API fixes it, but only from a user gesture, which the shared screen is
 * deliberately short of: the TV is read, not driven (docs/tv-read-only-audit.md). So there are
 * two ways in, and the device remembers:
 *
 *   - A **Fill the screen** button in the "About this screen" panel, on the row that reports
 *     full screen, shown only while the browser says it can and the screen is not. A remote
 *     reaches the panel from the corner row's (i) and the button with the arrows. It is not in
 *     the corner row itself: that row is proven at six controls and holds still by the metre
 *     (layout-fit.spec.ts), and a seventh that came and went moved the rest.
 *   - Once a screen has been full, the next load asks again on the *first* gesture of any kind
 *     (a remote key, a tap), so a host who sets it up on Saturday does not press it again on
 *     Sunday. A browser that refuses outside a gesture is why this waits for one at all.
 *
 * Leaving full screen deliberately (Back on the remote, Escape) is remembered too: the asking
 * stops until the button is pressed again. Nothing here ever throws, on any browser: an older
 * TV has the `webkit` spelling and the oldest have neither, and then the button never appears.
 */

import { defaultStorage, type KeyValueStorage } from "../store/persistence";

/** Whether this screen asked to be full, as this device remembers it. */
export const FULLSCREEN_KEY = "kad.display.fullscreen";

export type FullscreenState = "unsupported" | "off" | "on" | "denied";

/** The document parts used here, each possibly missing on a TV browser. */
export interface FullscreenDoc {
  documentElement: {
    requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
    webkitRequestFullscreen?: () => void;
  };
  fullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  addEventListener: Document["addEventListener"];
  removeEventListener: Document["removeEventListener"];
}

function theDocument(): FullscreenDoc | undefined {
  return typeof document === "undefined" ? undefined : (document as unknown as FullscreenDoc);
}

/** Whether this browser offers full screen at all. `fullscreenEnabled` is false inside a frame. */
export function canFullscreen(doc: FullscreenDoc | undefined = theDocument()): boolean {
  if (!doc) return false;
  const root = doc.documentElement;
  const has = typeof root.requestFullscreen === "function" || typeof root.webkitRequestFullscreen === "function";
  return has && doc.fullscreenEnabled !== false;
}

export function isFullscreen(doc: FullscreenDoc | undefined = theDocument()): boolean {
  if (!doc) return false;
  return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null;
}

/** Ask, by whichever spelling this browser has. False if it refused or has none. */
export async function askFullscreen(doc: FullscreenDoc | undefined = theDocument()): Promise<boolean> {
  if (!doc || !canFullscreen(doc)) return false;
  const root = doc.documentElement;
  try {
    if (typeof root.requestFullscreen === "function") {
      await root.requestFullscreen();
      return true;
    }
    root.webkitRequestFullscreen?.();
    return true;
  } catch {
    // A browser outside a gesture, or one that simply will not. The button stays.
    return false;
  }
}

export function rememberFullscreen(on: boolean, store: KeyValueStorage = defaultStorage()): void {
  try {
    if (on) store.setItem(FULLSCREEN_KEY, "1");
    else store.removeItem(FULLSCREEN_KEY);
  } catch {
    // Private mode. The button still works, this load only.
  }
}

export function rememberedFullscreen(store: KeyValueStorage = defaultStorage()): boolean {
  try {
    return store.getItem(FULLSCREEN_KEY) === "1";
  } catch {
    return false;
  }
}

export interface FullscreenWatch {
  state(): FullscreenState;
  onChange(listener: () => void): () => void;
  /** Press the button: ask, and remember the answer. */
  enter(): void;
  stop(): void;
}

export interface FullscreenEnv {
  doc?: FullscreenDoc | undefined;
  store?: KeyValueStorage;
}

/**
 * Watch and drive this screen's full-screen state. On a browser that has it and a device that
 * remembered it, the first gesture of the load asks once; after that the button is the only way.
 */
export function watchFullscreen(env: FullscreenEnv = {}): FullscreenWatch {
  const doc = "doc" in env ? env.doc : theDocument();
  const store = env.store ?? defaultStorage();
  const listeners = new Set<() => void>();
  let state: FullscreenState = !doc || !canFullscreen(doc) ? "unsupported" : isFullscreen(doc) ? "on" : "off";
  let asking = false;
  let stopped = false;
  /** One automatic ask per load, and only for a device that has been full before. */
  let mayAskOnGesture = state === "off" && rememberedFullscreen(store);

  function set(next: FullscreenState): void {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener();
  }

  async function ask(remember: boolean): Promise<void> {
    if (stopped || asking || !doc || state === "unsupported" || isFullscreen(doc)) return;
    asking = true;
    // Recorded before the asking, not after: the browser may report the change while the
    // request is still in flight, and the host's intent is what is being remembered.
    if (remember) rememberFullscreen(true, store);
    try {
      const won = await askFullscreen(doc);
      if (stopped) return;
      if (won) set("on");
      else if (remember) {
        // The button was pressed and refused anyway: say so rather than sit there.
        rememberFullscreen(false, store);
        set("denied");
      }
    } finally {
      asking = false;
    }
  }

  const onGesture = (): void => {
    if (!mayAskOnGesture) return;
    mayAskOnGesture = false;
    // Remembered already, so a refusal here is not news: it keeps waiting for the button.
    void ask(false);
  };
  const onChange = (): void => {
    if (!doc) return;
    const now = isFullscreen(doc);
    // Left on purpose (Back, Escape): stop asking on later loads until asked again.
    if (!now && state === "on") rememberFullscreen(false, store);
    set(now ? "on" : "off");
  };

  if (doc && state !== "unsupported") {
    doc.addEventListener("fullscreenchange", onChange);
    doc.addEventListener("webkitfullscreenchange", onChange as EventListener);
    doc.addEventListener("keydown", onGesture);
    doc.addEventListener("pointerdown", onGesture);
    doc.addEventListener("click", onGesture);
  }

  return {
    state: () => state,
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    enter() {
      mayAskOnGesture = false;
      void ask(true);
    },
    stop() {
      stopped = true;
      if (!doc || state === "unsupported") { listeners.clear(); return; }
      doc.removeEventListener("fullscreenchange", onChange);
      doc.removeEventListener("webkitfullscreenchange", onChange as EventListener);
      doc.removeEventListener("keydown", onGesture);
      doc.removeEventListener("pointerdown", onGesture);
      doc.removeEventListener("click", onGesture);
      listeners.clear();
    },
  };
}

export function describeFullscreen(state: FullscreenState): { ok: boolean; detail: string } {
  switch (state) {
    case "on": return { ok: true, detail: "Filling the screen" };
    case "off": return { ok: true, detail: "Available" };
    case "denied": return { ok: false, detail: "The browser refused it" };
    case "unsupported": return { ok: false, detail: "Not available on this browser" };
  }
}
