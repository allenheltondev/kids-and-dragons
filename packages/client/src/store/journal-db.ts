/**
 * The saved journal in IndexedDB (#458). The book can run to hundreds of
 * kilobytes with a few heroes and a full Field Guide, which is a poor fit for
 * localStorage's synchronous, small quota. Identity, sessions, the shared-device
 * record and the install flags stay in localStorage; only the journal lives here.
 *
 * Every call tolerates IndexedDB being missing or throwing (private mode,
 * blocked storage): it falls back to the old localStorage path
 * (`persistence.ts`), then to memory, so the book still opens offline wherever
 * anything can hold it.
 *
 * Migration is on read: a `kad.journal` still in localStorage is moved into
 * IndexedDB and the localStorage copy deleted.
 */

import {
  clearSavedJournal as clearLocalJournal,
  defaultStorage,
  loadSavedJournal as loadLocalJournal,
  SAVED_JOURNAL_KEY,
  validSavedJournal,
  type KeyValueStorage,
  type SavedJournal,
} from "./persistence";

export type { SavedJournal } from "./persistence";

export const JOURNAL_DB_NAME = "kad";
const STORE = "journal";
const RECORD_KEY = "current";

/** Last resort when neither IndexedDB nor localStorage will hold the book. */
let memory: SavedJournal | null = null;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined" || !indexedDB) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(JOURNAL_DB_NAME, 1);
    } catch (error) {
      reject(error);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

/** One short-lived connection per call: nothing to leak, nothing to hold an upgrade up. */
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await open();
  try {
    const tx = db.transaction(STORE, mode);
    const finished = done(tx);
    // A request that fails aborts the transaction too, so `finished` rejects
    // while `run` is already throwing. Observed from the start, so that second
    // rejection is never an unhandled one; the failure is reported once, by
    // `run`, and the success path still waits for the commit below.
    void finished.catch(() => undefined);
    const result = await run(tx.objectStore(STORE));
    await finished;
    return result;
  } finally {
    db.close();
  }
}

function safeStorage(storage?: KeyValueStorage): KeyValueStorage {
  try {
    return storage ?? defaultStorage();
  } catch {
    return { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
  }
}

/** The legacy localStorage copy, raw and parsed, whatever token it was read with. */
function legacyCopy(storage: KeyValueStorage): SavedJournal | null {
  try {
    const raw = storage.getItem(SAVED_JOURNAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { deviceToken?: unknown };
    return typeof parsed.deviceToken === "string" ? validSavedJournal(parsed, parsed.deviceToken) : null;
  } catch {
    return null;
  }
}

function dropLegacy(storage: KeyValueStorage): void {
  try {
    clearLocalJournal(storage);
  } catch {
    /* nothing to drop */
  }
}

export async function saveJournal(saved: SavedJournal, storage?: KeyValueStorage): Promise<void> {
  const ls = safeStorage(storage);
  try {
    await withStore("readwrite", async (store) => {
      await request(store.put(saved, RECORD_KEY));
    });
    memory = null;
    dropLegacy(ls);
    return;
  } catch {
    /* fall through to localStorage */
  }
  memory = saved;
  try {
    ls.setItem(SAVED_JOURNAL_KEY, JSON.stringify(saved));
    memory = null;
  } catch {
    /* quota or blocked: the copy in memory serves this page load */
  }
}

export async function loadSavedJournal(deviceToken: string, storage?: KeyValueStorage): Promise<SavedJournal | null> {
  const ls = safeStorage(storage);
  let idbWorks = true;
  try {
    const stored = await withStore("readonly", (store) => request(store.get(RECORD_KEY)));
    if (stored !== undefined) return validSavedJournal(stored, deviceToken);
  } catch {
    idbWorks = false;
  }

  // Nothing in IndexedDB: a pre-#458 copy in localStorage moves over, once.
  const legacy = legacyCopy(ls);
  if (legacy) {
    if (idbWorks) {
      try {
        await withStore("readwrite", async (store) => {
          await request(store.put(legacy, RECORD_KEY));
        });
        dropLegacy(ls);
      } catch {
        /* keep the localStorage copy; it is still the one we have */
      }
    }
    return validSavedJournal(legacy, deviceToken);
  }
  if (!idbWorks) {
    const local = loadLocalJournal(deviceToken, ls);
    if (local) return local;
  }
  return memory ? validSavedJournal(memory, deviceToken) : null;
}

export async function clearSavedJournal(storage?: KeyValueStorage): Promise<void> {
  memory = null;
  dropLegacy(safeStorage(storage));
  try {
    await withStore("readwrite", async (store) => {
      await request(store.delete(RECORD_KEY));
    });
  } catch {
    /* no IndexedDB, so no copy there to clear */
  }
}

/** Test seam: forget the in-memory copy. */
export function resetJournalMemory(): void {
  memory = null;
}
