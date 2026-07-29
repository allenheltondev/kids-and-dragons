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

export function defaultStorage(): KeyValueStorage {
  try {
    if (typeof localStorage === "undefined") return fallback;
    // Touch it: iOS private mode has the object but throws on write.
    localStorage.setItem("kad.probe", "1");
    localStorage.removeItem("kad.probe");
    return localStorage;
  } catch {
    return fallback;
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
    storage.setItem(sessionKey(session.roomCode), JSON.stringify(session));
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
 * A real `DEVICE#<deviceId>` item and a KMS-signed token replace this; keeping
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

export const SESSION_KEY_PREFIX = SESSION_PREFIX;
export const DEVICE_IDENTITY_KEY = DEVICE_KEY;
