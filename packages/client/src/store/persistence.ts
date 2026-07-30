/**
 * Session persistence (architecture §4.3).
 *
 * "The TV can be hard-refreshed mid-encounter and recover in under a second"
 * only holds if the refreshed page still knows who it is. The room code lives
 * in the URL; the session token and playerId live here, keyed by code so a
 * laptop with two rooms open in two tabs doesn't clobber itself.
 *
 * Chapter 1 replaces the local identity below with a real device-bound token
 * (architecture §4.5). Everything else in this file survives that change.
 */

import type { RoomMode } from "@kad/shared";
import type { ClientSession } from "./contract";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SESSION_PREFIX = "kad.session.";
const DEVICE_KEY = "kad.device";

/** A no-op store so SSR, tests, and Safari private mode never throw. */
const memoryStorage = (): KeyValueStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};

const fallback = memoryStorage();

/**
 * Sessions are useless once the room they name has long expired, but they used
 * to live in localStorage forever — one abandoned entry per room ever joined.
 * Anything older than this is swept on the first storage access of a page load.
 * A week comfortably outlives any room (they expire in hours) while still being
 * "cleans itself up" rather than "grows forever".
 */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Resolved once per page load: the probe writes to disk, and every default-
    argument call of the functions below was repeating it. */
let resolvedDefault: KeyValueStorage | null = null;

export function defaultStorage(): KeyValueStorage {
  if (resolvedDefault) return resolvedDefault;
  try {
    if (typeof localStorage === "undefined") {
      resolvedDefault = fallback;
      return resolvedDefault;
    }
    // Touch it: iOS private mode has the object but throws on write.
    localStorage.setItem("kad.probe", "1");
    localStorage.removeItem("kad.probe");
    pruneSessions(localStorage);
    resolvedDefault = localStorage;
  } catch {
    resolvedDefault = fallback;
  }
  return resolvedDefault;
}

/** Sweep expired `kad.session.*` entries. Only ever called on real Storage —
    the in-memory fallback dies with the page anyway. */
function pruneSessions(storage: Storage): void {
  try {
    const stale: string[] = [];
    const now = Date.now();
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key === null || !key.startsWith(SESSION_PREFIX)) continue;
      const savedAt = readSavedAt(storage.getItem(key));
      if (savedAt === null) {
        // Written before entries carried a timestamp: stamp it now so the
        // clock starts, rather than deleting a session that may be live.
        stampSavedAt(storage, key, now);
        continue;
      }
      if (now - savedAt > SESSION_MAX_AGE_MS) stale.push(key);
    }
    // Removal after the scan — deleting while iterating shifts `key(i)`.
    for (const key of stale) storage.removeItem(key);
  } catch {
    /* housekeeping only; never worth failing a page load over */
  }
}

function readSavedAt(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const savedAt = (parsed as Record<string, unknown>)["savedAt"];
    return typeof savedAt === "number" ? savedAt : null;
  } catch {
    return null;
  }
}

function stampSavedAt(storage: KeyValueStorage, key: string, now: number): void {
  const raw = storage.getItem(key);
  if (!raw) return;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return;
    storage.setItem(key, JSON.stringify({ ...parsed, savedAt: now }));
  } catch {
    /* not JSON — leave it; loadSession already treats it as absent */
  }
}

function sessionKey(code: string): string {
  return SESSION_PREFIX + code.toUpperCase();
}

function isSession(value: unknown): value is ClientSession {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["runId"] === "string" &&
    typeof candidate["roomCode"] === "string" &&
    typeof candidate["playerId"] === "string" &&
    typeof candidate["sessionToken"] === "string" &&
    (candidate["mode"] === "party" || candidate["mode"] === "travel")
  );
}

export function loadSession(code: string, storage: KeyValueStorage = defaultStorage()): ClientSession | null {
  const raw = storage.getItem(sessionKey(code));
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveSession(session: ClientSession, storage: KeyValueStorage = defaultStorage()): void {
  try {
    // `savedAt` is what pruneSessions() ages entries by. isSession() ignores
    // it, so a loaded session round-trips cleanly.
    storage.setItem(
      sessionKey(session.roomCode),
      JSON.stringify({ ...session, savedAt: Date.now() }),
    );
  } catch {
    /* out of quota: the session is recoverable by rejoining, so never fatal */
  }
}

export function clearSession(code: string, storage: KeyValueStorage = defaultStorage()): void {
  storage.removeItem(sessionKey(code));
}

/**
 * The stand-in for Chapter 1's household + device binding.
 *
 * A real `DEVICE#<deviceId>` item and a signed token replace this; keeping
 * the ids stable per browser now means the join call already looks like the one
 * that ships, and a refresh already rejoins as the same player.
 */
export interface LocalIdentity {
  householdId: string;
  playerId: string;
  displayName: string;
  /**
   * The device binding the server issued (architecture §4.5). Presenting it on
   * a later join is what makes this device *the same player* rather than a new
   * one — without it every room mints a fresh profile and the character that
   * belongs to this phone is orphaned.
   */
  deviceToken?: string;
}

function randomId(prefix: string): string {
  const bytes =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${bytes}`;
}

export function loadIdentity(storage: KeyValueStorage = defaultStorage()): LocalIdentity {
  const raw = storage.getItem(DEVICE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<LocalIdentity>;
      if (typeof parsed.householdId === "string" && typeof parsed.playerId === "string") {
        return {
          householdId: parsed.householdId,
          playerId: parsed.playerId,
          displayName: typeof parsed.displayName === "string" ? parsed.displayName : "",
          ...(typeof parsed.deviceToken === "string" ? { deviceToken: parsed.deviceToken } : {}),
        };
      }
    } catch {
      /* fall through and mint a new one */
    }
  }
  const identity: LocalIdentity = {
    householdId: randomId("hh"),
    playerId: randomId("p"),
    displayName: "",
  };
  saveIdentity(identity, storage);
  return identity;
}

export function saveIdentity(identity: LocalIdentity, storage: KeyValueStorage = defaultStorage()): void {
  try {
    storage.setItem(DEVICE_KEY, JSON.stringify(identity));
  } catch {
    /* non-fatal; the player just names themselves again next time */
  }
}

/**
 * That this browser's household has been claimed by an account (§4.5).
 *
 * Stored so the keepsake offer does not come back every chapter once somebody
 * has already said yes. Deliberately *not* a source of truth: the server owns
 * whether a household is a guest, and this is only ever used to decide whether
 * to make an offer. The worst a stale value can do is skip an offer, or make
 * one that turns out to be a no-op — both of which are quiet.
 */
export interface AccountRecord {
  householdId: string;
  email: string;
  /** ISO, for "kept since March". */
  claimedAt: string;
}

const ACCOUNT_KEY = "kad.account";

export function loadAccount(storage: KeyValueStorage = defaultStorage()): AccountRecord | null {
  const raw = storage.getItem(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AccountRecord>;
    if (typeof parsed.householdId !== "string" || typeof parsed.email !== "string") return null;
    return {
      householdId: parsed.householdId,
      email: parsed.email,
      claimedAt: typeof parsed.claimedAt === "string" ? parsed.claimedAt : "",
    };
  } catch {
    return null;
  }
}

export function saveAccount(
  account: AccountRecord,
  storage: KeyValueStorage = defaultStorage(),
): void {
  try {
    storage.setItem(ACCOUNT_KEY, JSON.stringify(account));
  } catch {
    /* non-fatal: the household is claimed server-side either way */
  }
}

export const SESSION_KEY_PREFIX = SESSION_PREFIX;
export const DEVICE_IDENTITY_KEY = DEVICE_KEY;
export const ACCOUNT_RECORD_KEY = ACCOUNT_KEY;
