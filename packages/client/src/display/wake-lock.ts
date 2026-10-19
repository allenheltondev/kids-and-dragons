/**
 * Keep the shared screen awake (#264). A television that dims or sleeps in the
 * middle of a chapter takes the story with it, so the display asks the browser
 * for a Screen Wake Lock for as long as it is open.
 *
 * Browsers release the lock whenever the tab is hidden, so it is asked for
 * again each time the page comes back. Where there is no Wake Lock API (most
 * smart-TV browsers) nothing happens: no throw, no warning, and the report
 * (CapabilityReport) says "not available". A refusal is the same quiet kind
 * of answer, tried again on the next gesture or visibility change.
 */

export type WakeLockState = "unsupported" | "held" | "released" | "denied";

export interface KeepAwake {
  state(): WakeLockState;
  onChange(listener: () => void): () => void;
  stop(): void;
}

export interface KeepAwakeEnv {
  nav?: Pick<Navigator, "wakeLock"> | undefined;
  doc?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> | undefined;
}

export function keepAwake(env: KeepAwakeEnv = {}): KeepAwake {
  const nav = "nav" in env ? env.nav : typeof navigator === "undefined" ? undefined : navigator;
  const doc = "doc" in env ? env.doc : typeof document === "undefined" ? undefined : document;
  const api = nav?.wakeLock;

  let state: WakeLockState = api ? "released" : "unsupported";
  let sentinel: WakeLockSentinel | null = null;
  let asking = false;
  let stopped = false;
  const listeners = new Set<() => void>();

  function set(next: WakeLockState): void {
    if (state === next) return;
    state = next;
    for (const listener of listeners) listener();
  }

  async function acquire(): Promise<void> {
    if (stopped || !api || sentinel || asking) return;
    // The request rejects for a hidden page; the visibility handler asks again.
    if (doc && doc.visibilityState !== "visible") return;
    asking = true;
    try {
      const lock = await api.request("screen");
      if (stopped) {
        void lock.release().catch(() => undefined);
        return;
      }
      sentinel = lock;
      set("held");
      lock.addEventListener("release", () => {
        if (sentinel !== lock) return;
        sentinel = null;
        set("released");
      });
    } catch {
      set("denied");
    } finally {
      asking = false;
    }
  }

  const retry = (): void => { void acquire(); };
  const onVisible = (): void => {
    if (!doc || doc.visibilityState === "visible") retry();
  };
  if (api) {
    doc?.addEventListener("visibilitychange", onVisible);
    // A browser that wants a gesture first gets one more chance on the first tap.
    (doc as Document | undefined)?.addEventListener("pointerdown", retry);
    (doc as Document | undefined)?.addEventListener("keydown", retry);
    retry();
  }

  return {
    state: () => state,
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    stop() {
      stopped = true;
      doc?.removeEventListener("visibilitychange", onVisible);
      (doc as Document | undefined)?.removeEventListener("pointerdown", retry);
      (doc as Document | undefined)?.removeEventListener("keydown", retry);
      const held = sentinel;
      sentinel = null;
      void held?.release().catch(() => undefined);
      listeners.clear();
    },
  };
}
