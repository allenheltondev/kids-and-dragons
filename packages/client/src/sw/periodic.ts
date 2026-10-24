/**
 * The installed app asks for an overnight refresh (#467): a Periodic
 * Background Sync (`SW_PERIODIC_TAG`, at most once a day) that wakes the
 * worker to refresh content and warm the next chapter's art (sw.ts
 * `periodicsync`). Chromium on Android only, and only for an installed app
 * the browser has seen used: the browser grants the permission, and stretches
 * the interval for an app that is seldom opened.
 *
 * Loaded lazily by register.ts, and only where the registration has a
 * `periodicSync` at all, so no other browser fetches it. Never throws.
 */

import { browserEnv, isStandalone } from "../install/detect";
import { SW_PERIODIC_MIN_INTERVAL_MS, SW_PERIODIC_TAG } from "./policy";

/** What the decision reads. */
export interface PeriodicSyncFacts {
  /** The registration has `periodicSync`. */
  supported: boolean;
  /** Opened as the installed app. */
  standalone: boolean;
  /** A worker already answers for this page (not a first launch). */
  controlled: boolean;
  /** `navigator.permissions.query({ name: "periodic-background-sync" })`, or null where it cannot be asked. */
  permission: PermissionState | null;
  /** The tag is already registered. */
  registered: boolean;
}

export type PeriodicSyncDecision =
  | "register"
  | "unsupported"
  | "not-installed"
  | "not-controlled"
  | "not-granted"
  | "already-registered";

/** Whether to register, decided in the order the facts are cheapest to read. */
export function periodicSyncDecision(facts: PeriodicSyncFacts): PeriodicSyncDecision {
  if (!facts.supported) return "unsupported";
  if (!facts.standalone) return "not-installed";
  if (!facts.controlled) return "not-controlled";
  if (facts.permission !== "granted") return "not-granted";
  if (facts.registered) return "already-registered";
  return "register";
}

/** The Periodic Background Sync manager, which DOM's types do not have yet. */
export interface PeriodicSyncManagerLike {
  register(tag: string, options?: { minInterval?: number }): Promise<void>;
  getTags(): Promise<string[]>;
}

/** The parts of the browser this reads, so a test can stand them in. */
export interface PeriodicSyncEnv {
  standalone(): boolean;
  controlled(): boolean;
  permission(): Promise<PermissionState | null>;
}

const live: PeriodicSyncEnv = {
  standalone: () => isStandalone(browserEnv()),
  controlled: () => typeof navigator !== "undefined" && navigator.serviceWorker?.controller != null,
  permission: async () => {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return null;
    const status = await navigator.permissions.query({ name: "periodic-background-sync" as PermissionName });
    return status.state;
  },
};

/** The registration's periodic sync manager, or null where there is none. */
export function periodicSyncOf(registration: ServiceWorkerRegistration | null | undefined): PeriodicSyncManagerLike | null {
  const manager = (registration as (ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManagerLike }) | null | undefined)?.periodicSync;
  return manager && typeof manager.register === "function" && typeof manager.getTags === "function" ? manager : null;
}

/**
 * Register the overnight refresh where the decision says to. Idempotent (an
 * existing registration is left as it is) and never throws: anything that
 * fails answers "unsupported" or "not-granted", and the next launch asks again.
 */
export async function registerPeriodicSync(
  registration: ServiceWorkerRegistration | null | undefined,
  env: PeriodicSyncEnv = live,
): Promise<PeriodicSyncDecision> {
  try {
    const manager = periodicSyncOf(registration);
    const early = periodicSyncDecision({
      supported: manager !== null,
      standalone: env.standalone(),
      controlled: env.controlled(),
      permission: "granted",
      registered: false,
    });
    if (early !== "register" || !manager) return early;
    const permission = await env.permission().catch(() => null);
    if (permission !== "granted") return "not-granted";
    const tags = await manager.getTags();
    const decision = periodicSyncDecision({ supported: true, standalone: true, controlled: true, permission, registered: tags.includes(SW_PERIODIC_TAG) });
    if (decision === "register") await manager.register(SW_PERIODIC_TAG, { minInterval: SW_PERIODIC_MIN_INTERVAL_MS });
    return decision;
  } catch {
    return "unsupported";
  }
}
