import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JournalResponse } from "@kad/shared";
import {
  clearSavedJournal,
  JOURNAL_DB_NAME,
  loadSavedJournal,
  resetJournalMemory,
  saveJournal,
  type SavedJournal,
} from "./journal-db";
import type { KeyValueStorage } from "./persistence";

function memStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const journal = { heroes: [], fieldGuide: {}, finders: {}, whereabouts: null } as unknown as JournalResponse;
const saved = (deviceToken = "dev_1"): SavedJournal => ({ deviceToken, savedAt: "2026-01-01T00:00:00.000Z", journal });

async function idbHas(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.open(JOURNAL_DB_NAME, 1);
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction("journal").objectStore("journal").get("current");
      get.onsuccess = () => {
        db.close();
        resolve(get.result !== undefined);
      };
    };
  });
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetJournalMemory();
});
afterEach(() => vi.restoreAllMocks());

describe("journal in IndexedDB", () => {
  it("saves and loads the same shape", async () => {
    const ls = memStorage();
    await saveJournal(saved(), ls);
    expect(await loadSavedJournal("dev_1", ls)).toEqual(saved());
    expect(ls.map.size).toBe(0);
  });

  it("never shows one binding's copy to another", async () => {
    const ls = memStorage();
    await saveJournal(saved(), ls);
    expect(await loadSavedJournal("dev_other", ls)).toBeNull();
  });

  it("returns null when nothing is saved", async () => {
    expect(await loadSavedJournal("dev_1", memStorage())).toBeNull();
  });

  it("clears the IndexedDB copy and any localStorage one", async () => {
    const ls = memStorage();
    await saveJournal(saved(), ls);
    ls.setItem("kad.journal", JSON.stringify(saved()));
    await clearSavedJournal(ls);
    expect(await idbHas()).toBe(false);
    expect(ls.map.size).toBe(0);
    expect(await loadSavedJournal("dev_1", ls)).toBeNull();
  });

  it("migrates a localStorage copy on first read, then deletes it", async () => {
    const ls = memStorage();
    ls.setItem("kad.journal", JSON.stringify(saved()));
    expect(await loadSavedJournal("dev_1", ls)).toEqual(saved());
    expect(ls.getItem("kad.journal")).toBeNull();
    expect(await idbHas()).toBe(true);
    expect(await loadSavedJournal("dev_1", ls)).toEqual(saved());
  });

  it("a save supersedes a stale localStorage copy", async () => {
    const ls = memStorage();
    ls.setItem("kad.journal", JSON.stringify(saved("dev_old")));
    await saveJournal(saved(), ls);
    expect(ls.getItem("kad.journal")).toBeNull();
    expect(await loadSavedJournal("dev_1", ls)).toEqual(saved());
  });
});

describe("patching the saved book (updateSavedJournal)", () => {
  it("keeps both patches when two tabs patch at once: each its own lane, one IndexedDB", async () => {
    await saveJournal(saved());
    // Two tabs: two copies of the module, so two lanes that know nothing of each other.
    vi.resetModules();
    const tabA = await import("./journal-db");
    vi.resetModules();
    const tabB = await import("./journal-db");
    await Promise.all([
      tabA.updateSavedJournal("dev_1", (j) => ({ ...j, trivia: { v: 1, mastered: { q_1: { at: "2026-11-17T10:00:00.000Z", firstTry: true } }, missed: {}, rungs: [] } })),
      tabB.updateSavedJournal("dev_1", (j) => ({ ...j, finders: { p_1: "Ada" } })),
    ]);
    const now = await loadSavedJournal("dev_1");
    expect(now?.journal.trivia?.mastered).toHaveProperty("q_1");
    expect(now?.journal.finders).toEqual({ p_1: "Ada" });
  });

  it("writes nothing for another binding's book, or when the patch declines", async () => {
    await saveJournal(saved());
    const { updateSavedJournal } = await import("./journal-db");
    await updateSavedJournal("dev_2", (j) => ({ ...j, finders: { p_9: "Nope" } }));
    await updateSavedJournal("dev_1", () => null);
    expect((await loadSavedJournal("dev_1"))?.journal.finders).toEqual({});
  });
});

describe("when IndexedDB is missing or throws", () => {
  it("falls back to localStorage when it is missing", async () => {
    // @ts-expect-error simulating a browser without IndexedDB
    globalThis.indexedDB = undefined;
    const ls = memStorage();
    await saveJournal(saved(), ls);
    expect(ls.getItem("kad.journal")).not.toBeNull();
    expect(await loadSavedJournal("dev_1", ls)).toEqual(saved());
    await clearSavedJournal(ls);
    expect(ls.getItem("kad.journal")).toBeNull();
  });

  it("a failed request falls back without an unhandled rejection", async () => {
    // The request fails and the transaction aborts with it: two rejections for
    // one failure. Only the request's may surface, as the fallback it triggers.
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore) {
      const req = { onsuccess: null, onerror: null, error: new DOMException("full", "QuotaExceededError") } as unknown as IDBRequest;
      this.transaction.abort();
      setTimeout(() => (req as { onerror: ((e: Event) => void) | null }).onerror?.(new Event("error")), 0);
      return req;
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const ls = memStorage();
      await saveJournal(saved(), ls);
      expect(ls.getItem("kad.journal")).not.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("falls back to localStorage when open throws, and keeps a legacy copy", async () => {
    vi.spyOn(globalThis.indexedDB, "open").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const ls = memStorage();
    ls.setItem("kad.journal", JSON.stringify(saved()));
    expect(await loadSavedJournal("dev_1", ls)).toEqual(saved());
    expect(ls.getItem("kad.journal")).not.toBeNull();
    await saveJournal(saved("dev_2"), ls);
    expect(await loadSavedJournal("dev_2", ls)).toEqual(saved("dev_2"));
    await expect(clearSavedJournal(ls)).resolves.toBeUndefined();
  });

  it("falls back to memory when nothing can hold it", async () => {
    // @ts-expect-error simulating a browser without IndexedDB
    globalThis.indexedDB = undefined;
    const ls = memStorage();
    ls.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    await saveJournal(saved(), ls);
    expect(await loadSavedJournal("dev_1", ls)).toEqual(saved());
    await clearSavedJournal(ls);
    expect(await loadSavedJournal("dev_1", ls)).toBeNull();
  });
});
