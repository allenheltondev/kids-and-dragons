/**
 * Asking the browser to keep this phone's storage (#457).
 *
 * Without it, storage is "best effort": a browser short on space may clear
 * the saved app, its art and the adventure book's copy whenever it likes, and
 * Safari does so after a week without a visit. `navigator.storage.persist()`
 * asks for it to be kept. Browsers decide on their own (Chrome by how much
 * the site is used or whether it is installed, Firefox by asking), so it is
 * asked once a household has actually played, or opened the book, never at
 * first paint and never on the TV (`/tv/:code`), which keeps nothing a family
 * would miss. The answer is recorded on the device, so it is not asked again
 * on every load.
 *
 * `persisted()` and `estimate()` are for a diagnostics panel: whether the
 * storage is kept, and how much of the quota is used.
 */

import { useEffect } from "react";
import { defaultStorage, type KeyValueStorage } from "../store/persistence";

export const PERSIST_KEY = "kad.storage.persist";

/** What the browser said, as recorded. */
export type PersistAnswer = "granted" | "denied";

/** The parts of `StorageManager` used here, each possibly missing. */
export interface PersistApi {
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<StorageEstimate>;
}

export interface StorageUse {
  /** Bytes this origin uses, as the browser reports it. */
  usage: number;
  /** Bytes it may use. */
  quota: number;
}

/** Whether `path` is the TV's display route, which never asks. */
export function isTvPath(path: string): boolean {
  return /^\/tv\/[^/]+\/?$/i.test(path);
}

/**
 * Pure: whether to ask now. Not where the API is missing, not on the TV, and
 * not once an answer is recorded.
 */
export function shouldAskPersist(facts: { recorded: PersistAnswer | null; path: string; available: boolean }): boolean {
  return facts.available && facts.recorded === null && !isTvPath(facts.path);
}

/** The answer recorded on this device, if any. */
export function recordedPersist(storage: KeyValueStorage = defaultStorage()): PersistAnswer | null {
  try {
    const value = storage.getItem(PERSIST_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

function browserApi(): PersistApi | undefined {
  return typeof navigator === "undefined" ? undefined : (navigator as Partial<Navigator>).storage;
}

function browserPath(): string {
  return typeof location === "undefined" ? "/" : location.pathname;
}

export interface PersistEnv {
  api?: PersistApi;
  storage?: KeyValueStorage;
  path?: string;
}

/** One ask per page life, however many screens want it. */
let asking: Promise<PersistAnswer | null> | null = null;

/** Test seam: forget this page life's ask. */
export function resetPersistAsk(): void {
  asking = null;
}

/**
 * Ask once, and record the answer. Resolves to what was recorded, or null
 * when nothing was asked (no API, the TV, already recorded) or asking failed.
 */
export function askPersistOnce(env: PersistEnv = {}): Promise<PersistAnswer | null> {
  if (asking) return asking;
  const api = env.api ?? browserApi();
  const storage = env.storage ?? defaultStorage();
  const ask = api?.persist;
  const recorded = recordedPersist(storage);
  if (!shouldAskPersist({ recorded, path: env.path ?? browserPath(), available: ask !== undefined }) || !ask) {
    return Promise.resolve(null);
  }
  asking = (async (): Promise<PersistAnswer | null> => {
    try {
      // Already kept (an installed app, often) needs no prompt.
      const kept = (await api.persisted?.call(api)) === true || (await ask.call(api)) === true;
      const answer: PersistAnswer = kept ? "granted" : "denied";
      try {
        storage.setItem(PERSIST_KEY, answer);
      } catch {
        /* private mode or full: asked again next time, which is harmless */
      }
      return answer;
    } catch {
      return null;
    }
  })();
  return asking;
}

/** Whether the browser has agreed to keep this storage; null where it cannot say. */
export async function persisted(api: PersistApi | undefined = browserApi()): Promise<boolean | null> {
  try {
    return api?.persisted ? await api.persisted.call(api) : null;
  } catch {
    return null;
  }
}

/** How much storage is used and allowed; null where the browser does not say. */
export async function estimate(api: PersistApi | undefined = browserApi()): Promise<StorageUse | null> {
  try {
    const found = api?.estimate ? await api.estimate.call(api) : undefined;
    if (found?.quota === undefined) return null;
    return { usage: found.usage ?? 0, quota: found.quota };
  } catch {
    return null;
  }
}

/** Ask once `ready` is true (a scene has been played, or the book is open). */
export function usePersistStorage(ready: boolean): void {
  useEffect(() => {
    if (ready) void askPersistOnce();
  }, [ready]);
}
