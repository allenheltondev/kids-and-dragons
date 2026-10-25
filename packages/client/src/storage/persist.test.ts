import { beforeEach, describe, expect, it } from "vitest";
import type { KeyValueStorage } from "../store/persistence";
import {
  PERSIST_KEY,
  askPersistOnce,
  estimate,
  isTvPath,
  persisted,
  recordedPersist,
  resetPersistAsk,
  shouldAskPersist,
  type PersistApi,
} from "./persist";

function memory(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

function api(answer: boolean, already = false): PersistApi & { asks: number } {
  const fake = {
    asks: 0,
    persist: async () => {
      fake.asks += 1;
      return answer;
    },
    persisted: async () => already,
    estimate: async () => ({ usage: 1_000, quota: 10_000 }),
  };
  return fake;
}

beforeEach(() => resetPersistAsk());

describe("when to ask the browser to keep this phone's storage", () => {
  it("asks once, where the API exists, never on the TV", () => {
    expect(shouldAskPersist({ recorded: null, path: "/p/ABCD", available: true })).toBe(true);
    expect(shouldAskPersist({ recorded: null, path: "/journal", available: true })).toBe(true);
    expect(shouldAskPersist({ recorded: null, path: "/tv/ABCD", available: true })).toBe(false);
    expect(shouldAskPersist({ recorded: "denied", path: "/p/ABCD", available: true })).toBe(false);
    expect(shouldAskPersist({ recorded: "granted", path: "/p/ABCD", available: true })).toBe(false);
    expect(shouldAskPersist({ recorded: null, path: "/p/ABCD", available: false })).toBe(false);
  });

  it("knows the TV's route", () => {
    expect(isTvPath("/tv/ABCD")).toBe(true);
    expect(isTvPath("/tv/ABCD/")).toBe(true);
    expect(isTvPath("/p/ABCD")).toBe(false);
    expect(isTvPath("/")).toBe(false);
  });
});

describe("asking", () => {
  it("records the answer, so the next load does not ask", async () => {
    const storage = memory();
    const browser = api(true);
    expect(await askPersistOnce({ api: browser, storage, path: "/p/ABCD" })).toBe("granted");
    expect(storage.data[PERSIST_KEY]).toBe("granted");
    resetPersistAsk(); // a new page load
    expect(await askPersistOnce({ api: browser, storage, path: "/p/ABCD" })).toBeNull();
    expect(browser.asks).toBe(1);
  });

  it("records a refusal too", async () => {
    const storage = memory();
    expect(await askPersistOnce({ api: api(false), storage, path: "/journal" })).toBe("denied");
    expect(recordedPersist(storage)).toBe("denied");
  });

  it("asks once per page life, however many screens want it", async () => {
    const storage = memory();
    const browser = api(true);
    await Promise.all([
      askPersistOnce({ api: browser, storage, path: "/p/ABCD" }),
      askPersistOnce({ api: browser, storage, path: "/journal" }),
    ]);
    expect(browser.asks).toBe(1);
  });

  it("does not prompt when the storage is already kept", async () => {
    const storage = memory();
    const browser = api(false, true);
    expect(await askPersistOnce({ api: browser, storage, path: "/p/ABCD" })).toBe("granted");
    expect(browser.asks).toBe(0);
  });

  it("never asks on the TV, nor where there is no API, and asks later on a phone route", async () => {
    const storage = memory();
    const browser = api(true);
    expect(await askPersistOnce({ api: browser, storage, path: "/tv/ABCD" })).toBeNull();
    expect(await askPersistOnce({ api: {}, storage, path: "/p/ABCD" })).toBeNull();
    expect(browser.asks).toBe(0);
    expect(storage.data[PERSIST_KEY]).toBeUndefined();
    expect(await askPersistOnce({ api: browser, storage, path: "/p/ABCD" })).toBe("granted");
  });

  it("survives a browser that throws, recording nothing", async () => {
    const storage = memory();
    const broken: PersistApi = { persist: () => Promise.reject(new Error("no")) };
    expect(await askPersistOnce({ api: broken, storage, path: "/p/ABCD" })).toBeNull();
    expect(recordedPersist(storage)).toBeNull();
  });
});

describe("for a diagnostics panel", () => {
  it("says whether storage is kept and how much is used, or null where it cannot", async () => {
    expect(await persisted(api(false, true))).toBe(true);
    expect(await persisted({})).toBeNull();
    expect(await persisted(undefined)).toBeNull();
    expect(await estimate(api(true))).toEqual({ usage: 1_000, quota: 10_000 });
    expect(await estimate({ estimate: async () => ({}) })).toBeNull();
    expect(await estimate({ estimate: () => Promise.reject(new Error("no")) })).toBeNull();
  });
});
