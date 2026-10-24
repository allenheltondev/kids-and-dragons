/**
 * The overnight refresh (#467): when the installed app registers it
 * (periodic.ts), and what the worker's run refreshes and warms (policy.ts).
 * The run's wiring is checked against the built `sw.js` in sw.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import {
  SW_FILES_BUDGET_BYTES,
  SW_PERIODIC_MIN_INTERVAL_MS,
  SW_PERIODIC_TAG,
  swContentToRefresh,
  swPeriodicByteCap,
  swPeriodicRecordOf,
  swPeriodicWork,
  swVersionedKey,
  swWarmList,
} from "./policy";
import {
  periodicSyncDecision,
  registerPeriodicSync,
  type PeriodicSyncEnv,
  type PeriodicSyncFacts,
  type PeriodicSyncManagerLike,
} from "./periodic";

const yes: PeriodicSyncFacts = { supported: true, standalone: true, controlled: true, permission: "granted", registered: false };

describe("when the installed app asks for an overnight refresh", () => {
  it("asks only in the installed app, once a worker is in charge, where the browser grants it", () => {
    expect(periodicSyncDecision(yes)).toBe("register");
    expect(periodicSyncDecision({ ...yes, supported: false })).toBe("unsupported");
    expect(periodicSyncDecision({ ...yes, standalone: false })).toBe("not-installed");
    expect(periodicSyncDecision({ ...yes, controlled: false })).toBe("not-controlled");
    expect(periodicSyncDecision({ ...yes, permission: "denied" })).toBe("not-granted");
    expect(periodicSyncDecision({ ...yes, permission: "prompt" })).toBe("not-granted");
    expect(periodicSyncDecision({ ...yes, permission: null })).toBe("not-granted");
    expect(periodicSyncDecision({ ...yes, registered: true })).toBe("already-registered");
  });

  it("is about once a day", () => {
    expect(SW_PERIODIC_TAG).toBe("kad-refresh");
    expect(SW_PERIODIC_MIN_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("registering it", () => {
  function setup(tags: string[] = [], env: Partial<PeriodicSyncEnv> = {}) {
    const manager: PeriodicSyncManagerLike = {
      getTags: vi.fn(async () => tags),
      register: vi.fn(async () => undefined),
    };
    const permission = vi.fn(async (): Promise<PermissionState | null> => "granted");
    const full: PeriodicSyncEnv = { standalone: () => true, controlled: () => true, permission, ...env };
    const registration = { periodicSync: manager } as unknown as ServiceWorkerRegistration;
    return { manager, permission, env: full, registration };
  }

  it("registers the tag with a day's interval", async () => {
    const { manager, env, registration } = setup();
    await expect(registerPeriodicSync(registration, env)).resolves.toBe("register");
    expect(manager.register).toHaveBeenCalledWith("kad-refresh", { minInterval: SW_PERIODIC_MIN_INTERVAL_MS });
  });

  it("leaves an existing registration alone", async () => {
    const { manager, env, registration } = setup(["kad-refresh"]);
    await expect(registerPeriodicSync(registration, env)).resolves.toBe("already-registered");
    expect(manager.register).not.toHaveBeenCalled();
  });

  it("does nothing in a browser tab, and does not even ask for the permission", async () => {
    const { manager, permission, env, registration } = setup([], { standalone: () => false });
    await expect(registerPeriodicSync(registration, env)).resolves.toBe("not-installed");
    expect(permission).not.toHaveBeenCalled();
    expect(manager.register).not.toHaveBeenCalled();
  });

  it("does nothing on a first launch, before a worker controls the page", async () => {
    const { manager, env, registration } = setup([], { controlled: () => false });
    await expect(registerPeriodicSync(registration, env)).resolves.toBe("not-controlled");
    expect(manager.register).not.toHaveBeenCalled();
  });

  it("does nothing where the permission is not granted, or cannot be asked", async () => {
    const denied = setup([], { permission: async () => "denied" });
    await expect(registerPeriodicSync(denied.registration, denied.env)).resolves.toBe("not-granted");
    const throws = setup([], { permission: async () => { throw new TypeError("unknown permission name"); } });
    await expect(registerPeriodicSync(throws.registration, throws.env)).resolves.toBe("not-granted");
    expect(denied.manager.register).not.toHaveBeenCalled();
    expect(throws.manager.register).not.toHaveBeenCalled();
  });

  it("does nothing where the API is missing, and never throws", async () => {
    const { env } = setup();
    await expect(registerPeriodicSync(undefined, env)).resolves.toBe("unsupported");
    await expect(registerPeriodicSync({} as ServiceWorkerRegistration, env)).resolves.toBe("unsupported");
    const broken = setup();
    broken.manager.register = vi.fn(async () => { throw new DOMException("no", "NotAllowedError"); });
    await expect(registerPeriodicSync(broken.registration, broken.env)).resolves.toBe("unsupported");
  });
});

describe("what a run refreshes", () => {
  const index = {
    "/content/rules.json": "r2",
    "/content/items.json": "i1",
    "/content/chapters/gemfall-03a.json": "c2",
    "/content/chapters/gemfall-01.json": "o1",
    "/assets/biomes/x/bg.webp": "b1",
  };

  it("fetches content a deploy changed, read off the fingerprint each copy was saved under", () => {
    const saved = [
      swVersionedKey("/content/rules.json", "r1"),
      swVersionedKey("/content/items.json", "i1"),
      swVersionedKey("/content/chapters/gemfall-03a.json", "c1"),
      "/__kad/files-meta",
      "/__kad/periodic-sync",
    ];
    expect(swContentToRefresh(index, saved, [])).toEqual(["/content/rules.json", "/content/chapters/gemfall-03a.json"]);
  });

  it("fetches content it wants and has not saved, wanted first; never art, never what is unindexed", () => {
    const saved = [swVersionedKey("/content/rules.json", "r2"), swVersionedKey("/content/items.json", "i1")];
    const wanted = ["/content/chapters/gemfall-01.json", "/content/rules.json", "/content/new.json", "/assets/biomes/x/bg.webp"];
    expect(swContentToRefresh(index, saved, wanted)).toEqual(["/content/chapters/gemfall-01.json"]);
  });

  it("fetches nothing when every copy is this build's", () => {
    const saved = Object.entries(index).map(([path, fingerprint]) => swVersionedKey(path, fingerprint));
    expect(swContentToRefresh(index, saved, Object.keys(index))).toEqual([]);
  });
});

describe("what a run warms", () => {
  it("downloads indexed art not already saved, once each, in the order asked", () => {
    const index = { "/a.png": "1", "/b.png": "2", "/c.png": "3" };
    expect(swWarmList(["/c.png", "/a.png", "/c.png", "/b.png", "/unindexed.png"], index, [swVersionedKey("/a.png", "1")])).toEqual([
      { path: "/c.png", fingerprint: "3" },
      { path: "/b.png", fingerprint: "2" },
    ]);
  });

  it("warms nothing when the phone asks to save data, but still refreshes content", () => {
    expect(swPeriodicWork(true)).toEqual({ refreshContent: true, warmNext: false });
    expect(swPeriodicWork(false)).toEqual({ refreshContent: true, warmNext: true });
  });

  it("downloads at most a quarter of the files budget a night", () => {
    expect(swPeriodicByteCap(SW_FILES_BUDGET_BYTES)).toBe(50 * 1024 * 1024);
    expect(swPeriodicByteCap(100)).toBe(25);
  });
});

describe("the record of the last run", () => {
  it("reads back what the worker wrote", () => {
    const record = { at: 10, outcome: "done", build: "b", refreshed: 1, warmed: 2, chapters: ["x"] };
    expect(swPeriodicRecordOf(record)).toEqual(record);
    expect(swPeriodicRecordOf({ at: 10, outcome: "partial" })).toEqual({ at: 10, outcome: "partial", build: "", refreshed: 0, warmed: 0, chapters: [] });
  });

  it("is nothing when it is not one", () => {
    expect(swPeriodicRecordOf(undefined)).toBeNull();
    expect(swPeriodicRecordOf([])).toBeNull();
    expect(swPeriodicRecordOf({ at: "yesterday", outcome: "done" })).toBeNull();
    expect(swPeriodicRecordOf({ at: 1, outcome: "exploded" })).toBeNull();
  });
});
