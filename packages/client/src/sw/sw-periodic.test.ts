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
import { describe, expect, it, vi } from "vitest";
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
  posted: unknown[];
}

function harness({ saveData = false, waiting = false, broken = false } = {}): Harness {
  const next = { state: "installed", postMessage: vi.fn(), addEventListener() {}, removeEventListener() {} };
  const posted: unknown[] = [];
  next.postMessage.mockImplementation((message: unknown) => posted.push(message));
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

  const caches = new Map<string, MemoryCache>();
  const files = new MemoryCache();
  caches.set("kad-files-v1", files);
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
    clients: { claim: async () => undefined, matchAll: async () => [] },
    registration: { update: async () => undefined, installing: null, waiting: waiting ? next : null, active: { state: "activated" } },
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
  return { listeners, files, fetched, posted };
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

  it("hands the run to a newer build the update found", async () => {
    const h = harness({ waiting: true });
    await fire(h, "periodicsync", { tag: "kad-refresh" });
    expect(h.posted).toEqual([{ type: "kad:periodic-refresh" }]);
    expect(h.fetched.some((path) => path.startsWith("/assets/"))).toBe(false);
    expect(await record(h)).toMatchObject({ outcome: "handed-over" });
  }, 15_000);

  it("takes a handed-over run only from another worker, never from a page", async () => {
    const h = harness();
    expect(await fire(h, "message", { data: { type: "kad:periodic-refresh" }, source: { url: `${ORIGIN}/` } })).toBe(0);
    expect(await fire(h, "message", { data: { type: "kad:periodic-refresh" }, source: { scriptURL: `${ORIGIN}/sw.js` } })).toBe(1);
    expect(await record(h)).toMatchObject({ outcome: "done" });
  }, 15_000);

  it("lets nothing escape when storage itself is broken", async () => {
    const h = harness({ broken: true });
    await expect(fire(h, "periodicsync", { tag: "kad-refresh" })).resolves.toBe(1);
  }, 15_000);
});
