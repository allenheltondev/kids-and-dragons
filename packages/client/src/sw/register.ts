/**
 * Registers the service worker (`/sw.js`, src/sw/sw.ts) — in a production
 * build only. The dev server neither builds one nor should be served by one:
 * a worker caching Vite's modules is how a laptop ends up debugging yesterday.
 *
 * After `load`, so installing it (and the code and content it saves) never
 * competes with the first paint for the network. Then, once the browser is
 * idle, the page tells the worker so (`kad:idle`) and it fetches what install
 * left for later: the ~2MB Rive runtime the game's rigs need, downloaded while
 * nobody is waiting rather than when the first character steps on stage.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    // A browser that refuses (private mode, a policy) just has no offline book.
    navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => whenIdle(() => registration.active?.postMessage({ type: "kad:idle" })))
      .catch(() => undefined);
  });
}

/** `requestIdleCallback` where there is one (not Safari), a few seconds' grace where not. */
function whenIdle(work: () => void): void {
  if ("requestIdleCallback" in window) window.requestIdleCallback(work, { timeout: 10_000 });
  else setTimeout(work, 5_000);
}
