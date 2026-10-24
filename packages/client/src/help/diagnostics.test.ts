/** The Diagnostics report's words (#459): pure formatting, and what a browser without an API gives. */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectDiagnostics,
  diagnosticRows,
  diagnosticsText,
  formatBytes,
  formatWhen,
  periodicWords,
  savedFilesOf,
  workerStateOf,
  type Diagnostics,
} from "./diagnostics";

const full: Diagnostics = {
  build: "abc123def456",
  worker: { state: "active", script: "/sw.js" },
  controlled: true,
  standalone: true,
  storage: { usage: 5 * 1024 * 1024, quota: 2 * 1024 ** 3 },
  persisted: true,
  saved: { count: 42, bytes: 31_457_280 },
  periodic: {
    registered: true,
    lastRun: { at: Date.UTC(2026, 9, 24, 6, 12), outcome: "done", build: "abc123def456", refreshed: 1, warmed: 30, chapters: ["gemfall-03a"] },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("formatBytes", () => {
  it("picks a unit a person can read", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(31_457_280)).toBe("30 MB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2.0 GB");
  });
  it("says unknown for what is not a size", () => {
    expect(formatBytes(NaN)).toBe("unknown");
    expect(formatBytes(-1)).toBe("unknown");
  });
});

describe("workerStateOf", () => {
  it("is the furthest along of the registration's workers", () => {
    const w = {} as ServiceWorker;
    expect(workerStateOf(undefined)).toBe("none");
    expect(workerStateOf({ active: null, waiting: null, installing: null })).toBe("none");
    expect(workerStateOf({ active: null, waiting: null, installing: w })).toBe("installing");
    expect(workerStateOf({ active: null, waiting: w, installing: w })).toBe("waiting");
    expect(workerStateOf({ active: w, waiting: w, installing: null })).toBe("active");
  });
});

describe("savedFilesOf", () => {
  it("counts the files and adds their bytes", () => {
    expect(savedFilesOf({ "/a?v=1": { bytes: 10, used: 1 }, "/b?v=2": { bytes: 32, used: 2 } })).toEqual({ count: 2, bytes: 42 });
    expect(savedFilesOf({})).toEqual({ count: 0, bytes: 0 });
  });
  it("is unknown when there is no bookkeeping", () => {
    expect(savedFilesOf(undefined)).toBeNull();
    expect(savedFilesOf([])).toBeNull();
    expect(savedFilesOf("x")).toBeNull();
  });
  it("skips entries that are not sizes", () => {
    expect(savedFilesOf({ a: null, b: { used: 1 }, c: { bytes: 5, used: 1 } })).toEqual({ count: 1, bytes: 5 });
  });
});

describe("diagnosticsText", () => {
  it("is plain text, one line per row", () => {
    expect(diagnosticsText(full).split("\n")).toEqual([
      "Kids & Dragons diagnostics",
      "Build: abc123def456",
      "Helper: Ready (/sw.js)",
      "Helper in charge of this page: Yes",
      "Opened as: An installed app",
      "Space used: 5.0 MB of 2.0 GB",
      "Space kept safe: Yes",
      "Saved for offline: 42 files, 30 MB",
      "Overnight refresh: On, last ran 2026-10-24 06:12 UTC",
    ]);
  });

  it("says unknown, not nothing, for what the browser would not tell", () => {
    const rows = diagnosticRows({
      ...full,
      worker: { state: "none", script: null },
      controlled: false,
      standalone: false,
      storage: null,
      persisted: null,
      saved: null,
      periodic: { registered: null, lastRun: null },
    });
    expect(rows.map((row) => row.value)).toEqual(["abc123def456", "None", "No", "A browser tab", "Unknown", "Unknown", "Unknown", "Not on this device"]);
  });

  it("uses no dashes in its words", () => {
    expect(diagnosticsText(full)).not.toMatch(/[–—]/);
  });
});

describe("the overnight refresh (#467)", () => {
  const run = full.periodic.lastRun!;
  it("says whether it is on and when it last ran", () => {
    expect(periodicWords({ registered: true, lastRun: null })).toBe("On, not run yet");
    expect(periodicWords({ registered: true, lastRun: run })).toBe("On, last ran 2026-10-24 06:12 UTC");
    expect(periodicWords({ registered: true, lastRun: { ...run, outcome: "failed" } })).toBe("On, last ran 2026-10-24 06:12 UTC, and it went wrong");
    expect(periodicWords({ registered: false, lastRun: null })).toBe("Off");
    expect(periodicWords({ registered: false, lastRun: run })).toBe("Off (last ran 2026-10-24 06:12 UTC)");
    expect(periodicWords({ registered: null, lastRun: null })).toBe("Not on this device");
  });
  it("writes times the same on every device", () => {
    expect(formatWhen(Date.UTC(2026, 0, 2, 3, 4))).toBe("2026-01-02 03:04 UTC");
    expect(formatWhen(NaN)).toBe("unknown");
  });
});

describe("collectDiagnostics", () => {
  it("does not throw where the browser has none of these APIs", async () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0" });
    vi.stubGlobal("caches", undefined);
    const found = await collectDiagnostics();
    expect(found).toMatchObject({
      worker: { state: "none", script: null },
      controlled: false,
      storage: null,
      persisted: null,
      saved: null,
      periodic: { registered: null, lastRun: null },
    });
  });

  it("reads the worker, the space and the files cache's bookkeeping", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0",
      serviceWorker: {
        controller: {},
        getRegistration: async () => ({
          active: { scriptURL: "https://kad.test/sw.js" },
          waiting: null,
          installing: null,
          periodicSync: { getTags: async () => ["kad-refresh"] },
        }),
      },
      storage: { estimate: async () => ({ usage: 100, quota: 1000 }), persisted: async () => false },
    });
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async (key: string) =>
          key === "/__kad/files-meta"
            ? new Response(JSON.stringify({ "/a?v=1": { bytes: 7, used: 1 } }))
            : key === "/__kad/periodic-sync"
              ? new Response(JSON.stringify({ at: 5, outcome: "partial", build: "b", refreshed: 0, warmed: 2, chapters: ["x"] }))
              : undefined,
      }),
    });
    const found = await collectDiagnostics();
    expect(found).toMatchObject({
      worker: { state: "active", script: "/sw.js" },
      controlled: true,
      storage: { usage: 100, quota: 1000 },
      persisted: false,
      saved: { count: 1, bytes: 7 },
      periodic: { registered: true, lastRun: { at: 5, outcome: "partial", build: "b", refreshed: 0, warmed: 2, chapters: ["x"] } },
    });
  });
});
