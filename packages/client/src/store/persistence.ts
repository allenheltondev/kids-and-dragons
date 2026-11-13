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

import type { JournalResponse, RoomMode } from "@kad/shared";
import type { ClientSession } from "./contract";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const SESSION_PREFIX = "kad.session.";
const DEVICE_KEY = "kad.device";

/** A no-op store so SSR, tests, and Safari private mode never throw. */
const memoryStorage = (): KeyValueStorage & Pick<Storage, "key" | "length"> => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
};

const fallback = memoryStorage();
const tabFallback = memoryStorage();

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

let resolvedTab: KeyValueStorage | null = null;

/**
 * Storage that lives as long as this tab: `sessionStorage`. Where a shared
 * tablet keeps its room session (#250), so the next kid to pick up the tablet
 * (or scan the room's QR, which opens a fresh tab) is asked who they are
 * instead of landing in the last kid's seat. A refresh keeps it.
 */
export function tabStorage(): KeyValueStorage {
  if (resolvedTab) return resolvedTab;
  try {
    if (typeof sessionStorage === "undefined") {
      resolvedTab = tabFallback;
      return resolvedTab;
    }
    sessionStorage.setItem("kad.probe", "1");
    sessionStorage.removeItem("kad.probe");
    resolvedTab = sessionStorage;
  } catch {
    resolvedTab = tabFallback;
  }
  return resolvedTab;
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
  /**
   * The binding came from opening a Party Mode room on this screen, and this
   * browser has never been seated as a player. A TV keeps its binding so the
   * next room lands in the same household, but it is nobody (spec §2.1) and
   * has no hero, so it is never offered the journal. Cleared the moment the
   * device is seated or adopted as a player.
   */
  screenOnly?: boolean;
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
          ...(parsed.screenOnly === true ? { screenOnly: true } : {}),
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

/**
 * The device binding of a browser that has been a *player* — read without
 * minting an identity, unlike `loadIdentity`. `null` for a phone that has never
 * played (nothing to study between games, and asking should not make it
 * somebody) and for a screen that only ever hosted (`screenOnly`).
 */
export function loadPlayerDeviceToken(storage: KeyValueStorage = defaultStorage()): string | null {
  const raw = storage.getItem(DEVICE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalIdentity>;
    if (parsed.screenOnly === true) return null;
    return typeof parsed.deviceToken === "string" && parsed.deviceToken !== "" ? parsed.deviceToken : null;
  } catch {
    return null;
  }
}

/**
 * Whether this storage has been anybody at all: a player, or a TV that hosted.
 * Read without minting. An installed app's first launch (#412) asks about an
 * old hero only while this is false, before anything here makes a new one.
 */
export function hasDeviceIdentity(storage: KeyValueStorage = defaultStorage()): boolean {
  try {
    return storage.getItem(DEVICE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Seated or adopted as a player: keep the binding, and stop being a screen. */
export function asPlayerIdentity(identity: LocalIdentity, deviceToken?: string): LocalIdentity {
  const { screenOnly: _screen, ...rest } = identity;
  return { ...rest, ...(deviceToken ? { deviceToken } : {}) };
}

export function saveIdentity(identity: LocalIdentity, storage: KeyValueStorage = defaultStorage()): void {
  try {
    storage.setItem(DEVICE_KEY, JSON.stringify(identity));
  } catch {
    /* non-fatal; the player just names themselves again next time */
  }
}

/**
 * What a personal device token says about itself: the binding (`sub`) and the
 * household (`hh`) it was signed for. Read, never verified: the server is the
 * only judge of a token, and this is only used to tell two of this browser's
 * own tokens apart. `null` for anything that is not a signed device token (the
 * local dev server's tokens among them), so callers fall back to doing nothing.
 */
export function deviceTokenClaims(token: string): { deviceId: string; householdId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { sub?: unknown; hh?: unknown; aud?: unknown };
    if (claims.aud !== "device" || typeof claims.sub !== "string" || typeof claims.hh !== "string") return null;
    return { deviceId: claims.sub, householdId: claims.hh };
  } catch {
    return null;
  }
}

/**
 * The server renewed this device's token (`x-kad-device-token` on a response,
 * architecture §4.5 "The device token"): keep it in place of the old one.
 *
 * A device token lives 30 days and is re-issued once past halfway, but only a
 * device that keeps the re-issue lives on. Before this was kept, every phone's
 * token died 30 days after it was first issued however often it played, and
 * the next join quietly made the phone a new player in a new household: its
 * heroes still on the server, under a player the phone no longer was.
 *
 * Kept only when it renews the binding this browser already holds (the same
 * `sub`), so a response that raced a pairing, a sign-in or a leave can never
 * put back a binding the device has since moved off.
 */
export function keepRenewedDeviceToken(renewed: string, storage: KeyValueStorage = defaultStorage()): boolean {
  try {
    const raw = storage.getItem(DEVICE_KEY);
    if (!raw) return false;
    const stored = JSON.parse(raw) as Partial<LocalIdentity>;
    if (typeof stored.deviceToken !== "string" || stored.deviceToken === renewed) return false;
    const was = deviceTokenClaims(stored.deviceToken);
    const now = deviceTokenClaims(renewed);
    if (!was || !now || was.deviceId !== now.deviceId) return false;
    storage.setItem(DEVICE_KEY, JSON.stringify({ ...stored, deviceToken: renewed }));
    return true;
  } catch {
    // Not kept this time; the server renews again on the next request.
    return false;
  }
}

/**
 * This browser is its household's **shared device** (#250): a family tablet
 * the kids take turns on. It holds the tablet's own token, which names the
 * household and nobody in it, and never a kid's device token: each kid picks
 * themselves on it and plays on a room session alone.
 */
export interface SharedDeviceRecord {
  token: string;
  householdId: string;
}

const LOCATION_KEY = "kad.location";

/** What the family named its table ("Kitchen table"); "" when it never was. */
export function loadLocationName(storage: KeyValueStorage = defaultStorage()): string {
  try {
    return storage.getItem(LOCATION_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Remember the table's name for next time; an empty name forgets it. */
export function saveLocationName(name: string, storage: KeyValueStorage = defaultStorage()): void {
  try {
    if (name === "") storage.removeItem(LOCATION_KEY);
    else storage.setItem(LOCATION_KEY, name);
  } catch {
    /* the name is a convenience; the game opens without it */
  }
}

const SHARED_KEY = "kad.shared";

export function loadSharedDevice(storage: KeyValueStorage = defaultStorage()): SharedDeviceRecord | null {
  const raw = storage.getItem(SHARED_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SharedDeviceRecord>;
    if (typeof parsed.token !== "string" || parsed.token === "" || typeof parsed.householdId !== "string") {
      return null;
    }
    return { token: parsed.token, householdId: parsed.householdId };
  } catch {
    return null;
  }
}

/** The tablet's token was renewed (a sliding expiry, like a phone's). */
export function saveSharedDevice(record: SharedDeviceRecord, storage: KeyValueStorage = defaultStorage()): void {
  try {
    storage.setItem(SHARED_KEY, JSON.stringify(record));
  } catch {
    /* the old token keeps working until its 30 days are up */
  }
}

/**
 * Make this browser the shared tablet. Whatever made it *somebody* goes: the
 * device identity and the journal read with it (the server has already revoked
 * that binding), the record of who signed in here, and every room session
 * saved here, each of which is some kid's seat.
 */
export function becomeSharedDevice(
  record: SharedDeviceRecord,
  storage: KeyValueStorage = defaultStorage(),
  tab: KeyValueStorage = tabStorage(),
): void {
  /*
   * The tablet's token is written first, and a failure to write it throws
   * before anything is forgotten. The other order could leave a browser that
   * is neither: no shared token, no identity, and the next join would make it
   * a brand-new player without anybody noticing.
   */
  try {
    storage.setItem(SHARED_KEY, JSON.stringify(record));
  } catch {
    throw new Error("This device couldn\u2019t save its new setup. Free up some space and try again.");
  }
  storage.removeItem(DEVICE_KEY);
  storage.removeItem(JOURNAL_KEY);
  storage.removeItem(ACCOUNT_KEY);
  clearAllSessions(storage);
  clearAllSessions(tab);
}

/** Forgotten (or never real): back to an ordinary device, nobody yet. */
export function clearSharedDevice(
  storage: KeyValueStorage = defaultStorage(),
  tab: KeyValueStorage = tabStorage(),
): void {
  storage.removeItem(SHARED_KEY);
  clearAllSessions(tab);
}

/**
 * This device stops being a player (`store/leave-device.ts`): its binding, the
 * book it kept for offline reading, the grown-up's sign-in record and every
 * room it was seated in. What is left is a device nobody has used. Nothing of
 * the kid's is lost by this; all of it is on the server.
 */
export function forgetPlayerDevice(
  storage: KeyValueStorage = defaultStorage(),
  tab: KeyValueStorage = tabStorage(),
): void {
  storage.removeItem(DEVICE_KEY);
  storage.removeItem(JOURNAL_KEY);
  storage.removeItem(ACCOUNT_KEY);
  clearAllSessions(storage);
  clearAllSessions(tab);
}

function clearAllSessions(storage: KeyValueStorage): void {
  const keys = (storage as Partial<Storage>).key;
  const length = (storage as Partial<Storage>).length;
  if (typeof keys !== "function" || typeof length !== "number") return;
  const stale: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const key = keys.call(storage, i);
    if (key?.startsWith(SESSION_PREFIX)) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
}

/**
 * That this browser's household has been claimed by an account (§4.5).
 *
 * Stored so the keepsake offer does not come back every chapter once somebody
 * has already said yes. Deliberately *not* a source of truth: the server owns
 * whether a household is a guest, and this is only ever used to decide whether
 * to make an offer. The worst a stale value can do is skip an offer, or make
 * one that turns out to be a no-op — both of which are quiet.
 *
 * Except one, which was not quiet: a record for a household this device no
 * longer plays in. A phone whose binding was replaced (a token that ran out,
 * then a join that made it somebody new) kept saying "Signed in" and hid the
 * sign-in that would have found its heroes again. So `loadAccount` answers
 * only for the household the device's own token names; a record for another
 * reads as no record, and the home screen offers to sign in, which goes back
 * to the account's household and asks who this phone is.
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
    const token = loadPlayerDeviceToken(storage);
    const bound = token === null ? null : deviceTokenClaims(token);
    if (bound !== null && bound.householdId !== parsed.householdId) return null;
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

/**
 * The last journal this browser read (`GET /api/journal`), so the adventure
 * book still opens where the signal does not — in the car, which is where it
 * gets read. Keyed by the device token it was read with: a different binding
 * (another household, a re-adopted phone) never sees somebody else's book.
 */
export interface SavedJournal {
  deviceToken: string;
  /** ISO, for "from last time". */
  savedAt: string;
  journal: JournalResponse;
  /**
   * ISO, when the book's camp was last read, when that is older than the rest
   * of it: a read whose camp failed (`JournalResponse.campError`) kept the
   * camp from the copy before (#656). Absent: read with the rest, `savedAt`.
   */
  campSavedAt?: string;
}

const JOURNAL_KEY = "kad.journal";

/** The saved copy if `parsed` is a well-formed one read with `deviceToken`, else null. */
export function validSavedJournal(parsed: unknown, deviceToken: string): SavedJournal | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Partial<SavedJournal>;
  if (p.deviceToken !== deviceToken || typeof p.savedAt !== "string") return null;
  const journal = p.journal;
  if (typeof journal !== "object" || journal === null || !Array.isArray(journal.heroes)) return null;
  return { deviceToken, savedAt: p.savedAt, journal, ...(typeof p.campSavedAt === "string" ? { campSavedAt: p.campSavedAt } : {}) };
}

/** The pre-IndexedDB path (#458), kept for the fallback and the migration. */
export function loadSavedJournal(
  deviceToken: string,
  storage: KeyValueStorage = defaultStorage(),
): SavedJournal | null {
  const raw = storage.getItem(JOURNAL_KEY);
  if (!raw) return null;
  try {
    return validSavedJournal(JSON.parse(raw), deviceToken);
  } catch {
    return null;
  }
}

export function saveJournal(saved: SavedJournal, storage: KeyValueStorage = defaultStorage()): void {
  try {
    storage.setItem(JOURNAL_KEY, JSON.stringify(saved));
  } catch {
    /* out of quota: the book just needs the network next time */
  }
}

export function clearSavedJournal(storage: KeyValueStorage = defaultStorage()): void {
  storage.removeItem(JOURNAL_KEY);
}

export const SESSION_KEY_PREFIX = SESSION_PREFIX;
export const DEVICE_IDENTITY_KEY = DEVICE_KEY;
export const ACCOUNT_RECORD_KEY = ACCOUNT_KEY;
export const SAVED_JOURNAL_KEY = JOURNAL_KEY;
export const SHARED_DEVICE_KEY = SHARED_KEY;
