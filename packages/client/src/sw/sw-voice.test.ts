/**
 * Recorded narration through the built `sw.js` (#547): the real script from
 * `sw-build.ts`, in a sandbox with an in-memory Cache Storage and a stub
 * network serving clips. What is decided (which paths are clips, how big the
 * cache may be) is in sw.test.ts; this is the wiring: a clip is kept once it
 * has been had, is served with no network, a missing clip is passed on and not
 * kept, and the least recently used clips go when the cache is over budget.
 */

import { createContext, Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { buildServiceWorker } from "../../sw-build";
import { SW_VOICE_BUDGET_FLOOR_BYTES } from "./policy";

const ORIGIN = "https://kad.test";
const INDEX_URL = "/bundle/files-x1.json";
const source = buildServiceWorker({
  bundleFiles: ["/bundle/index-a1.js", INDEX_URL],
  campaignFiles: [],
  fileIndexUrl: INDEX_URL,
  build: "abc123def456",
  // Pinned, never read from this repo's lock: whether the art copies exist is the build's
  // business (small-art-build.ts), and these tests are about the worker.
  smallArt: false,
});

const key = (n: number): string => n.toString(16).padStart(64, "0");
const pathOf = (n: number): string => `/voice/${key(n).slice(0, 2)}/${key(n)}.webm`;

/** A Cache keyed by absolute URL, matching the way the worker asks (paths). */
class MemoryCache {
  readonly entries = new Map<string, { body: ArrayBuffer; headers: [string, string][] }>();
  private url(input: RequestInfo | URL): string {
    return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN).href;
  }
  async match(input: RequestInfo | URL): Promise<Response | undefined> {
    const hit = this.entries.get(this.url(input));
    return hit ? basic(new Response(hit.body.slice(0), { headers: hit.headers })) : undefined;
  }
  async put(input: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(this.url(input), { body: await response.arrayBuffer(), headers: [...response.headers] });
  }
  async delete(input: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(this.url(input));
  }
  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async addAll(): Promise<void> {}
}

function basic(response: Response): Response {
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

interface Harness {
  listeners: Map<string, (event: unknown) => void>;
  voice: MemoryCache;
  fetched: string[];
  /** Cut the network: every fetch rejects. */
  setOffline(offline: boolean): void;
}

/** `bytes` is what each clip weighs; `have` the clips the site has. */
function harness({ bytes = 1000, have = new Set<number>(), quota }: { bytes?: number; have?: Set<number>; quota?: number } = {}): Harness {
  const fetched: string[] = [];
  let offline = false;
  const caches = new Map<string, MemoryCache>();
  const open = async (name: string): Promise<MemoryCache> => {
    if (!caches.has(name)) caches.set(name, new MemoryCache());
    return caches.get(name)!;
  };
  const fetchStub = async (input: RequestInfo | URL): Promise<Response> => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, ORIGIN).pathname;
    fetched.push(path);
    if (offline) throw new TypeError("Failed to fetch");
    if (path === INDEX_URL) return basic(new Response("{}"));
    const id = [...have].find((n) => pathOf(n) === path);
    if (id === undefined) return basic(new Response("<Error>AccessDenied</Error>", { status: 403 }));
    return basic(new Response(new Uint8Array(bytes), { headers: { "content-type": "audio/webm", "cache-control": "public,max-age=31536000,immutable" } }));
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    location: new URL(ORIGIN),
    clients: { claim: async () => undefined, matchAll: async () => [] },
    registration: { update: async () => undefined, active: {} },
    skipWaiting: async () => undefined,
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  };
  const context = createContext({
    self,
    caches: { open, has: async (name: string) => caches.has(name), keys: async () => [...caches.keys()], delete: async (name: string) => caches.delete(name) },
    fetch: fetchStub,
    indexedDB: undefined,
    navigator: { connection: {}, storage: { estimate: async () => ({ quota: quota ?? 10 * 1024 ** 3 }) } },
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
  const voice = new MemoryCache();
  caches.set("kad-voice-v1", voice);
  return { listeners, voice, fetched, setOffline: (value) => { offline = value; } };
}

/** The page asks for `path`; resolves with what it was answered, after everything the worker kept behind it. */
async function ask(h: Harness, path: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Response | undefined> {
  const work: Promise<unknown>[] = [];
  let answer: Promise<Response> | undefined;
  h.listeners.get("fetch")!({
    request: new Request(ORIGIN + path, init),
    respondWith: (response: Promise<Response>) => { answer = response; },
    waitUntil: (p: Promise<unknown>) => work.push(p),
  });
  const response = await answer;
  await Promise.all(work);
  return response;
}

const metaOf = async (h: Harness): Promise<Record<string, { bytes: number; used: number }>> => {
  const saved = await h.voice.match("/__kad/voice-meta");
  return saved ? ((await saved.json()) as Record<string, { bytes: number; used: number }>) : {};
};

const kept = (h: Harness): string[] => [...h.voice.entries.keys()].map((url) => new URL(url).pathname).filter((path) => path.startsWith("/voice/"));

describe("the built worker's recorded narration", () => {
  it("serves a clip from the network the first time, and keeps it", async () => {
    const h = harness({ have: new Set([1]) });
    const response = await ask(h, pathOf(1));
    expect(response?.status).toBe(200);
    expect((await response!.arrayBuffer()).byteLength).toBe(1000);
    expect(kept(h)).toEqual([pathOf(1)]);
    expect((await metaOf(h))[pathOf(1)]?.bytes).toBe(1000);
  });

  it("serves a kept clip without asking the network, and plays it with no signal", async () => {
    const h = harness({ have: new Set([1]) });
    await ask(h, pathOf(1));
    h.setOffline(true);
    h.fetched.length = 0;
    const response = await ask(h, pathOf(1));
    expect(response?.status).toBe(200);
    expect((await response!.arrayBuffer()).byteLength).toBe(1000);
    expect(h.fetched).toEqual([]);
  });

  it("passes on a clip the site lacks and keeps nothing for it, so the line is read by the device voice", async () => {
    const h = harness({ have: new Set() });
    const response = await ask(h, pathOf(7));
    expect(response?.status).toBe(403);
    expect(kept(h)).toEqual([]);
  });

  it("answers an offline clip nobody kept with the network's own failure", async () => {
    const h = harness({ have: new Set([1]) });
    h.setOffline(true);
    await expect(ask(h, pathOf(1))).rejects.toThrow("Failed to fetch");
  });

  it("leaves partial audio and other methods to the browser", async () => {
    const h = harness({ have: new Set([1]) });
    expect(await ask(h, pathOf(1), { headers: { range: "bytes=0-99" } })).toBeUndefined();
    expect(await ask(h, pathOf(1), { method: "HEAD" })).toBeUndefined();
    expect(kept(h)).toEqual([]);
  });

  it("drops the least recently used clips when the cache is over budget, and keeps the one just heard", async () => {
    const MB = 1024 * 1024;
    // The floor is the budget on a phone with a small quota: 30 MB, trimmed to 27 MB when it is passed.
    const h = harness({ bytes: 12 * MB, have: new Set([1, 2, 3]), quota: SW_VOICE_BUDGET_FLOOR_BYTES });
    await ask(h, pathOf(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await ask(h, pathOf(2));
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Heard again: clip 1 is now more recent than clip 2.
    await ask(h, pathOf(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    await ask(h, pathOf(3));
    expect(kept(h).sort()).toEqual([pathOf(1), pathOf(3)].sort());
    expect(Object.keys(await metaOf(h)).sort()).toEqual([pathOf(1), pathOf(3)].sort());
  }, 15_000);
});
