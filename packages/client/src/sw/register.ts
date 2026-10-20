/**
 * Registers the service worker (`/sw.js`, src/sw/sw.ts) — in a production
 * build only. The dev server neither builds one nor should be served by one:
 * a worker caching Vite's modules is how a laptop ends up debugging yesterday.
 *
 * After `load`, so installing it (and the code and content it saves) never
 * competes with the first paint for the network.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    // A browser that refuses (private mode, a policy) just has no offline book.
    navigator.serviceWorker
      .register("/sw.js")
      .catch(() => undefined);
  });
}
