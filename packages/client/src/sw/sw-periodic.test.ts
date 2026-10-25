/**
 * The overnight refresh as the built `sw.js` runs it (#467): the real script
 * from `sw-build.ts`, in a sandbox with an in-memory Cache Storage, a stub
 * network serving the real Gemfall content, and a saved journal. What is
 * decided is tested in next-chapter.test.ts and periodic.test.ts; this is the
 * wiring: what lands in the files cache, what is recorded, and that nothing
 * escapes the event.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import type { Chapter } from "@kad/shared";
import { buildServiceWorker } from "../../sw-build";
import { swNextChapterArt, swHeroesOf } from "./next-chapter";
import { swVersionedKey } from "./policy";

const ORIGIN = "https://kad.test";
const INDEX_URL = "/bundle/files-x1.json";
const source = buildServiceWorker({
  bundleFiles: ["/bundle/index-a1.js", INDEX_URL],
  campaignFiles: ["/content/campaigns/gemfall.json"],
  fileIndexUrl: INDEX_URL,
  build: "abc123def456",
});

const repo = (path: string): Uint8Array => readFileSync(new URL(`../../../..${path}`, import.meta.url));
const fp = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, 16);
const HERO = { species: "unicorn", tier: "fledgling", class: "songkeeper" };
const JOURNAL = {
  heroes: [HERO],
  story: [{ campaignId: "gemfall", title: "Gemfall", status: "active", chapters: [{ chapterId: "gemfall-01", title: "x", revealed: [], lastTime: [] }] }],
};

/** A Cache keyed by absolute URL, matching the way the worker asks (paths, `ignoreSearch`). */
class MemoryCache {
  readonly entries = new Map<string, { body: ArrayBuffer; headers: [string, string][] }>();
  private url(key: RequestInfo | URL): string {
    return new URL(typeof key === "string" ? key : key instanceof URL ? key.href : key.url, ORIGIN).href;
  }
  async match(key: RequestInfo | URL): Promise<Response | undefined> {
    const hit = this.entries.get(this.url(key));
    return hit ? basic(new Response(hit.body.slice(0), { headers: hit.headers })) : undefined;
  }
  async put(key: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(this.url(key), { body: await response.arrayBuffer(), headers: [...response.headers] });
  }
  async delete(key: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.url(key));
  }
  async keys(path?: string, options?: { ignoreSearch?: boolean }): Promise<Request[]> {
    return [...this.entries.keys()]
      .filter((url) => path === undefined || (options?.ignoreSearch ? new URL(url).pathname === path : url === this.url(path)))
      .map((url) => new Request(url));
  }
  async addAll(): Promise<void> {}
}

function basic(response: Response): Response {
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

interface Harness {
  listeners: Map<string, (event: unknown) => void>;
  files: MemoryCache;
  fetched: string[];
  /** The Cache Storage, to hand a second worker the same origin. */
  caches: Map<string, MemoryCache>;
}

interface HarnessOptions {
  saveData?: boolean;
  /** A newer build the update finds, and where it stands. */
  newer?: "installing" | "waiting";
  broken?: boolean;
  /** Pages open on the origin. */
  pages?: number;
  /** Another worker's Cache Storage: the same origin, a new build's worker. */
  caches?: Map<string, MemoryCache>;
}

function harness({ saveData = false, newer, broken = false, pages = 0, caches: shared }: HarnessOptions = {}): Harness {
  // A plain object, as a scope sees another `ServiceWorker`: nothing on it is called.
  const next = {};
  const chapters = ["gemfall-01", "gemfall-02", "gemfall-03a", "gemfall-03b", "gemfall-03c", "gemfall-04a"];
  const served = new Map<string, Uint8Array>();
  served.set("/content/campaigns/gemfall.json", repo("/content/campaigns/gemfall.json"));
  for (const id of chapters) served.set(`/content/chapters/${id}.json`, repo(`/content/chapters/${id}.json`));
  const second = JSON.parse(new TextDecoder().decode(served.get("/content/chapters/gemfall-02.json"))) as Chapter;
  for (const url of swNextChapterArt([second], swHeroesOf({ heroes: [HERO] as never }))) served.set(url, new TextEncoder().encode(`art ${url}`));
  const index = Object.fromEntries([...served].map(([path, bytes]) => [path, fp(bytes)]));

  const fetched: string[] = [];
  const fetchStub = async (input: RequestInfo | URL): Promise<Response> => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN).pathname;
    fetched.push(path);
    if (path === INDEX_URL) return basic(new Response(JSON.stringify(index)));
    if (path === "/api/journal") return basic(new Response(JSON.stringify(JOURNAL)));
    const bytes = served.get(path);
    return basic(bytes ? new Response(bytes.slice()) : new Response("missing", { status: 404 }));
  };

  const caches = shared ?? new Map<string, MemoryCache>([["kad-files-v1", new MemoryCache()]]);
  const files = caches.get("kad-files-v1")!;
  const storage = {
    open: async (name: string) => {
      if (broken) throw new Error("storage is gone");
      if (!caches.has(name)) caches.set(name, new MemoryCache());
      return caches.get(name)!;
    },
    has: async (name: string) => caches.has(name),
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
  };

  const indexedDB = {
    open() {
      const request: Record<string, unknown> & { onsuccess?: () => void } = {};
      setTimeout(() => {
        const get: Record<string, unknown> & { onsuccess?: () => void } = {};
        request.result = {
          objectStoreNames: { contains: () => true },
          transaction: () => ({ objectStore: () => ({ get: () => (setTimeout(() => { get.result = { deviceToken: "dev-1", savedAt: "", journal: {} }; get.onsuccess?.(); }), get) }) }),
          close() {},
        };
        request.onsuccess?.();
      });
      return request;
    },
  };

  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: new URL(ORIGIN),
    clients: { claim: async () => undefined, matchAll: async () => Array.from({ length: pages }, () => ({ postMessage() {} })) },
    registration: {
      update: async () => undefined,
      installing: newer === "installing" ? next : null,
      waiting: newer === "waiting" ? next : null,
      active: {},
    },
    skipWaiting: async () => undefined,
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  };
  const context = createContext({
    self,
    caches: storage,
    fetch: fetchStub,
    indexedDB,
    navigator: { connection: { saveData }, storage: { estimate: async () => ({ quota: 10 * 1024 ** 3 }) } },
    Response,
    Request,
    Headers,
    URL,
    AbortSignal,
    TextEncoder,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    console,
  });
  new Script(source).runInContext(context);
  return { listeners, files, fetched, caches };
}

/** Fire an event and wait for everything it handed `waitUntil`. */
async function fire(h: Harness, type: string, event: Record<string, unknown>): Promise<number> {
  const work: Promise<unknown>[] = [];
  h.listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => work.push(p) });
  await Promise.all(work);
  return work.length;
}

async function record(h: Harness): Promise<Record<string, unknown> | undefined> {
  const saved = await h.files.match("/__kad/periodic-sync");
  return saved ? ((await saved.json()) as Record<string, unknown>) : undefined;
}

describe("the built worker's overnight refresh", () => {
  it("listens for its own tag only", async () => {
    const h = harness();
    expect(await fire(h, "periodicsync", { tag: "someone-else" })).toBe(0);
    expect(h.fetched).toEqual([]);
  });

  it("warms the household's next chapter and refreshes its content, then says so", async () => {
    const h = harness();
    await fire(h, "periodicsync", { tag: "kad-refresh" });
    const keys = [...h.files.entries.keys()].map((url) => new URL(url).pathname + new URL(url).search);
    const second = JSON.parse(readFileSync(new URL("../../../../content/chapters/gemfall-02.json", import.meta.url), "utf8")) as Chapter;
    const art = swNextChapterArt([second], swHeroesOf({ heroes: [HERO] as never }));
    for (const url of art) expect(keys).toContain(swVersionedKey(url, fp(new TextEncoder().encode(`art ${url}`))));
    expect(keys).toContain(swVersionedKey("/content/chapters/gemfall-02.json", fp(repo("/content/chapters/gemfall-02.json"))));
    expect(keys).toContain(swVersionedKey("/content/campaigns/gemfall.json", fp(repo("/content/campaigns/gemfall.json"))));
    // Read to find the next beat, but not kept: only the chapter ahead is.
    expect(keys.some((key) => key.startsWith("/content/chapters/gemfall-03a.json"))).toBe(false);
    expect(h.fetched).toContain("/api/journal");
    expect(await record(h)).toMatchObject({ outcome: "done", build: "abc123def456", chapters: ["gemfall-02"], warmed: art.length, refreshed: 2 });
    expect(await h.files.match("/__kad/files-meta")).toBeDefined();
  }, 15_000);

  it("guesses at no art when the phone asks to save data", async () => {
    const h = harness({ saveData: true });
    await fire(h, "periodicsync", { tag: "kad-refresh" });
    expect(h.fetched.some((path) => path.startsWith("/assets/"))).toBe(false);
    expect(h.fetched).not.toContain("/api/journal");
    expect(await record(h)).toMatchObject({ outcome: "saved-data", warmed: 0 });
  }, 15_000);

  it("hands the run to a newer build through a marker its activate takes", async () => {
    // Worker A: the update finds B installing. A posts nothing; it leaves a marker.
    const a = harness({ newer: "installing" });
    await fire(a, "periodicsync", { tag: "kad-refresh" });
    expect(a.fetched.some((path) => path.startsWith("/assets/"))).toBe(false);
    expect(await record(a)).toMatchObject({ outcome: "handed-over", build: "abc123def456" });
    const marker = (await (await a.files.match("/__kad/periodic-pending"))?.json()) as { at: number; tag: string };
    expect(marker.tag).toBe("kad-refresh");
    expect(Date.now() - marker.at).toBeLessThan(60_000);

    // Worker B: a fresh scope on the same caches, with no `self.serviceWorker`, activates.
    const b = harness({ caches: a.caches });
    await fire(b, "activate", {});
    expect(await a.files.match("/__kad/periodic-pending")).toBeUndefined();
    expect(b.fetched.some((path) => path.startsWith("/assets/"))).toBe(true);
    expect(await record(b)).toMatchObject({ outcome: "done", chapters: ["gemfall-02"] });
  }, 15_000);

  it("leaves the hand-off for the next run while a page is open, which takes it once", async () => {
    const a = harness({ newer: "waiting" });
    await fire(a, "periodicsync", { tag: "kad-refresh" });
    const b = harness({ caches: a.caches, pages: 1 });
    await fire(b, "activate", {});
    expect(b.fetched.some((path) => path.startsWith("/assets/"))).toBe(false);
    expect(await a.files.match("/__kad/periodic-pending")).toBeDefined();
    await fire(b, "periodicsync", { tag: "kad-refresh" });
    expect(await a.files.match("/__kad/periodic-pending")).toBeUndefined();
    expect(await record(b)).toMatchObject({ outcome: "done" });
  }, 15_000);

  it("ignores a stale hand-off, and drops it", async () => {
    const a = harness();
    const old = { at: Date.now() - 25 * 60 * 60 * 1000, tag: "kad-refresh" };
    await a.files.put("/__kad/periodic-pending", new Response(JSON.stringify(old)));
    await fire(a, "activate", {});
    expect(a.fetched.some((path) => path.startsWith("/assets/") || path === "/api/journal")).toBe(false);
    expect(await record(a)).toBeUndefined();
    expect(await a.files.match("/__kad/periodic-pending")).toBeUndefined();
  }, 15_000);

  it("leaves no marker when there is no newer build", async () => {
    const h = harness();
    await fire(h, "periodicsync", { tag: "kad-refresh" });
    expect(await h.files.match("/__kad/periodic-pending")).toBeUndefined();
    expect(await record(h)).toMatchObject({ outcome: "done" });
  }, 15_000);

  it("lets nothing escape when storage itself is broken", async () => {
    const h = harness({ broken: true });
    await expect(fire(h, "periodicsync", { tag: "kad-refresh" })).resolves.toBe(1);
  }, 15_000);
});
