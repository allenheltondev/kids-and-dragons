/**
 * Notice that the screen woke up, however the browser reports it (#264).
 *
 * A TV that sleeps either hides the page (`visibilitychange`), restores it from
 * the back/forward cache (`pageshow`), or just freezes everything and carries
 * on, in which case the only sign is that a timer which should have fired every
 * few seconds did not fire for a long time. All three mean the same thing: the
 * stream may be dead and events may have been missed, so the caller reconnects
 * and catches up from its last seq (architecture §4.3).
 */

/** How often the clock is checked for a gap. */
export const TICK_MS = 5_000;
/** A gap this much longer than the tick is a sleep, not a slow frame. */
export const SLEEP_GAP_MS = 20_000;

export interface WakeEnv {
  doc?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> | undefined;
  win?: Pick<Window, "addEventListener" | "removeEventListener"> | undefined;
  now?: (() => number) | undefined;
}

export function onWake(wake: () => void, env: WakeEnv = {}): () => void {
  const doc = "doc" in env ? env.doc : typeof document === "undefined" ? undefined : document;
  const win = "win" in env ? env.win : typeof window === "undefined" ? undefined : window;
  const now = env.now ?? Date.now;

  let last = now();
  const fire = (): void => {
    last = now();
    wake();
  };
  const onVisibility = (): void => {
    if (!doc || doc.visibilityState === "visible") fire();
  };
  const onPageShow = (): void => { fire(); };
  const timer = setInterval(() => {
    const at = now();
    const gap = at - last;
    last = at;
    if (gap > SLEEP_GAP_MS) wake();
  }, TICK_MS);

  doc?.addEventListener("visibilitychange", onVisibility);
  win?.addEventListener("pageshow", onPageShow);
  return () => {
    clearInterval(timer);
    doc?.removeEventListener("visibilitychange", onVisibility);
    win?.removeEventListener("pageshow", onPageShow);
  };
}
