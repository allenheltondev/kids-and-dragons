import { BOOT_GLOBAL } from "./policy";

/** Tells the watchdog in index.html that the app drew. Safe to call twice, or without a watchdog. */
export function markBooted(host: object = window): void {
  const watchdog = (host as Record<string, unknown>)[BOOT_GLOBAL] as { booted?: () => void } | undefined;
  try {
    watchdog?.booted?.();
  } catch {
    // The watchdog must never be the thing that breaks a working app.
  }
}
