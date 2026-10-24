/**
 * Registers the service worker (`/sw.js`, src/sw/sw.ts) — in a production
 * build only. The dev server neither builds one nor should be served by one:
 * a worker caching Vite's modules is how a laptop ends up debugging yesterday.
 *
 * After `load`, so installing it (and the code and content it saves) never
 * competes with the first paint for the network.
 *
 * The registration is kept (#456) so a screen that wakes can ask for a newer
 * build (`checkForUpdate`); a browser only does that on its own at navigation,
 * and an installed app or a TV can go days without one.
 *
 * Once a worker is ready and already answers for the page (never on the very
 * first launch), the installed app on Chromium also asks for an overnight
 * refresh (#467, periodic.ts), loaded only where the browser has the API.
 */

import { updateDue } from "./calm";

type Registration = ServiceWorkerRegistration | undefined;

let resolveRegistration: (registration: Registration) => void = () => undefined;
let registration: Promise<Registration> = new Promise((resolve) => { resolveRegistration = resolve; });
let lastCheck: number | null = null;

/** The registration, once made; `undefined` where there is none (dev, a refusing browser). */
export function serviceWorkerRegistration(): Promise<Registration> {
  return registration;
}

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    // A browser that refuses (private mode, a policy) just has no offline book.
    navigator.serviceWorker
      .register("/sw.js")
      .then((made) => {
        resolveRegistration(made);
        askForOvernightRefresh();
      }, () => resolveRegistration(undefined));
  });
}

function askForOvernightRefresh(): void {
  void navigator.serviceWorker.ready
    .then(async (ready) => {
      if (!navigator.serviceWorker.controller || !("periodicSync" in ready)) return;
      await (await import("./periodic")).registerPeriodicSync(ready);
    })
    .catch(() => undefined);
}

/**
 * Ask the worker for a newer build, at most once per few minutes. A failure
 * (offline, a server blip) is swallowed: the next wake asks again.
 */
export async function checkForUpdate(now: number = Date.now()): Promise<void> {
  if (!import.meta.env.PROD) return;
  if (!updateDue(lastCheck, now)) return;
  lastCheck = now;
  try {
    await (await registration)?.update();
  } catch {
    // Nothing to do; this is only a nudge.
  }
}
