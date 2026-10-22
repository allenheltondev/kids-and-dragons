/**
 * Notice that the screen woke up, however the browser reports it (#264, #413).
 *
 * A TV that sleeps, or a phone whose installed app went to the background,
 * comes back in one of several ways, and each browser picks its own:
 *
 *   - the page is shown again (`visibilitychange`);
 *   - it is restored from the back/forward cache (`pageshow`, `persisted`);
 *   - it was frozen and is thawed (`resume`, the Page Lifecycle API that
 *     Chrome on Android uses for a backgrounded app);
 *   - the signal came back (`online`), while the stream sat in a long backoff;
 *   - or nothing at all is said, and the only sign is that a timer which should
 *     have fired every few seconds did not fire for a long time.
 *
 * All of them mean the same thing: the stream may be dead and events may have
 * been missed, so the caller reconnects and catches up from its last seq
 * (architecture §4.3). Several usually arrive together (a thaw is also a
 * show), so a burst is answered once.
 */

/** How often the clock is checked for a gap. */
export const TICK_MS = 5_000;
/** A gap this much longer than the tick is a sleep, not a slow frame. */
export const SLEEP_GAP_MS = 20_000;
/** Wakes this close together are one wake: one fresh stream, not three. */
export const WAKE_COALESCE_MS = 1_000;

export interface WakeEnv {
  doc?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> | undefined;
  win?: Pick<Window, "addEventListener" | "removeEventListener"> | undefined;
  now?: (() => number) | undefined;
}

export function onWake(wake: () => void, env: WakeEnv = {}): () => void {
  const doc = "doc" in env ? env.doc : typeof document === "undefined" ? undefined : document;
  const win = "win" in env ? env.win : typeof window === "undefined" ? undefined : window;
  const now = env.now ?? Date.now;

  const hidden = (): boolean => doc?.visibilityState === "hidden";
  let last = now();
  let woke = -Infinity;
  const fire = (): void => {
    const at = now();
    last = at;
    // Off screen there is nobody to catch up for, and a phone's background
    // tab would otherwise open a stream every throttled minute. Coming back
    // on screen is its own wake.
    if (hidden() || at - woke < WAKE_COALESCE_MS) return;
    woke = at;
    wake();
  };
  const onVisibility = (): void => { fire(); };
  // A first load fires `pageshow` too, and is no wake: only a page the
  // back/forward cache kept and gave back is.
  const onPageShow = (event: Event): void => {
    if ((event as PageTransitionEvent).persisted) fire();
  };
  const timer = setInterval(() => {
    const gap = now() - last;
    if (gap > SLEEP_GAP_MS) fire();
    else last = now();
  }, TICK_MS);

  doc?.addEventListener("visibilitychange", onVisibility);
  doc?.addEventListener("resume", fire);
  win?.addEventListener("pageshow", onPageShow);
  win?.addEventListener("online", fire);
  return () => {
    clearInterval(timer);
    doc?.removeEventListener("visibilitychange", onVisibility);
    doc?.removeEventListener("resume", fire);
    win?.removeEventListener("pageshow", onPageShow);
    win?.removeEventListener("online", fire);
  };
}
