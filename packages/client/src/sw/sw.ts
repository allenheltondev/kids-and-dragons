/**
 * The service worker (`/sw.js`) — see `policy.ts` for what it is for and what
 * it decides. This file is only the wiring: install, activate, fetch, message.
 *
 * Built by `sw-build.ts` into one classic script with this build's lists
 * prepended, so a deploy is a new `sw.js` and the browser installs it on its
 * own. Registered only in a production build (`register.ts`); the dev server
 * never sees it.
 *
 * Typed against the DOM program the rest of the client lives in, with the few
 * worker-only shapes declared here, rather than a second program with the
 * WebWorker lib (which cannot share a compilation with DOM).
 */

import {
  SW_CACHES,
  SW_FILES_BUDGET_BYTES,
  SW_FILES_META_KEY,
  SW_IMAGE_LIMIT,
  SW_PRECACHE_CONTENT,
  SW_SHELL_KEY,
  swCacheable,
  swEvictions,
  swIsImage,
  swOverLimit,
  swStaleBundles,
  swStaleVersions,
  swStrategyFor,
  swVersionedKey,
  type FileIndex,
  type FileMeta,
} from "./policy";

/** Prepended by `sw-build.ts`: every `/bundle/*` file of this build. */
declare const __KAD_BUNDLE__: readonly string[];
/** Prepended by `sw-build.ts`: the ones saved at install. */
declare const __KAD_PRECACHE__: readonly string[];
/** Prepended by `sw-build.ts`: every `/content/campaigns/*.json`. */
declare const __KAD_PRECACHE_CAMPAIGNS__: readonly string[];
/** Prepended by `sw-build.ts`: the URL of this build's `FileIndex` (a hashed `/bundle/` file). */
declare const __KAD_FILE_INDEX__: string;

interface SwExtendableEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  /** Navigation preload's response, when it is enabled (activate, below). */
  readonly preloadResponse?: Promise<Response | undefined>;
  respondWith(response: Response | Promise<Response>): void;
}
interface SwMessageEvent extends SwExtendableEvent {
  readonly data: unknown;
}
interface SwScope {
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  readonly registration: { navigationPreload?: { enable(): Promise<void> } };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: SwFetchEvent) => void): void;
  addEventListener(type: "message", listener: (event: SwMessageEvent) => void): void;
}

const worker = self as unknown as SwScope;

/**
 * Every lookup ignores `Vary`. Servers mark responses `Vary: Origin`, and a
 * module script sends an `Origin` header the saved request never had — so a
 * plain `match` misses every saved script and quietly sends the page back to
 * the network. Everything this worker saves is the same bytes for any origin
 * header (hashed code, fingerprinted files), so `Vary` says nothing here.
 */
const SAME: CacheQueryOptions = { ignoreVary: true };

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // The page itself, fresh past the HTTP cache: it is `no-cache` anyway.
      const shell = await caches.open(SW_CACHES.shell);
      const page = await fetch(SW_SHELL_KEY, { cache: "reload" });
      if (swCacheable(page)) await shell.put(SW_SHELL_KEY, page);

      // Hashed code: what is already saved from an earlier build is the same
      // bytes, so only what is new is fetched. The file index is one of them.
      const bundle = await caches.open(SW_CACHES.bundle);
      await addMissing(bundle, __KAD_PRECACHE__);

      // The content the offline book reads, by fingerprint: a deploy that
      // changed none of it fetches none of it.
      const fingerprints = await fileIndex();
      const files = await caches.open(SW_CACHES.files);
      const loose: string[] = [];
      for (const path of [...SW_PRECACHE_CONTENT, ...__KAD_PRECACHE_CAMPAIGNS__]) {
        const fingerprint = fingerprints[path];
        if (fingerprint === undefined) {
          loose.push(path);
          continue;
        }
        if (await files.match(swVersionedKey(path, fingerprint), SAME)) continue;
        const response = await fetch(path, { cache: "no-cache" });
        if (swCacheable(response)) await keepVersioned(files, path, fingerprint, response);
      }
      if (loose.length > 0) await (await caches.open(SW_CACHES.content)).addAll(loose);

      // Take over at once. Every build's worker answers the same way, so an
      // open page loses nothing by being served by the new one.
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const known = new Set<string>(Object.values(SW_CACHES));
      for (const name of await caches.keys()) {
        if (!known.has(name)) await caches.delete(name);
      }

      // Code a deploy replaced.
      const bundle = await caches.open(SW_CACHES.bundle);
      const cachedCode = (await bundle.keys()).map((request) => new URL(request.url).pathname);
      for (const path of swStaleBundles(cachedCode, __KAD_BUNDLE__)) await bundle.delete(path);

      // Art, rigs, audio and content a deploy replaced or removed.
      const fingerprints = await fileIndex();
      const files = await caches.open(SW_CACHES.files);
      const current = await filesMeta();
      const keys = (await files.keys()).map(keyOf).filter((key) => key !== SW_FILES_META_KEY);
      for (const key of swStaleVersions(keys, fingerprints)) {
        await files.delete(key);
        delete current[key];
      }
      await saveMeta();

      // Start the page's request while the worker is still waking up.
      await worker.registration.navigationPreload?.enable().catch(() => undefined);
      await worker.clients.claim();
    })(),
  );
});

/**
 * The page says it is idle (`register.ts`): fetch what install left for
 * later — the Rive runtime — without anyone waiting on it.
 */
worker.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown } | null;
  if (data?.type !== "kad:idle") return;
  event.waitUntil(
    (async () => {
      const bundle = await caches.open(SW_CACHES.bundle);
      await addMissing(bundle, __KAD_BUNDLE__);
    })().catch(() => undefined),
  );
});

worker.addEventListener("fetch", (event) => {
  const { request } = event;
  const strategy = swStrategyFor(
    { method: request.method, url: request.url, mode: request.mode, hasRange: request.headers.has("range") },
    worker.location.origin,
  );
  switch (strategy) {
    case "passthrough":
      return; // the browser's own fetch, untouched
    case "shell":
      event.respondWith(shell(event));
      return;
    case "bundle":
      event.respondWith(cacheFirst(request, SW_CACHES.bundle));
      return;
    case "content":
    case "asset":
      event.respondWith(fingerprinted(event, request, strategy));
      return;
    case "image":
      // Brand art from `public/` is fingerprinted too; anything else is not.
      event.respondWith(fingerprinted(event, request, "asset"));
      return;
  }
});

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** A page load: the network (preloaded when it can be), else the saved app. */
async function shell(event: SwFetchEvent): Promise<Response> {
  const cache = await caches.open(SW_CACHES.shell);
  try {
    const response = (await event.preloadResponse) ?? (await fetch(event.request));
    if (swCacheable(response)) event.waitUntil(cache.put(SW_SHELL_KEY, response.clone()));
    return response;
  } catch (error) {
    const saved = await cache.match(SW_SHELL_KEY, SAME);
    if (saved) return saved;
    throw error;
  }
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(request, SAME);
  if (saved) return saved;
  const response = await fetch(request);
  if (swCacheable(response)) await cache.put(request, response.clone());
  return response;
}

/**
 * Art, rigs, audio and content. With a fingerprint, the saved copy of exactly
 * these bytes is served without asking anyone; without one (a file newer than
 * this build's index), content falls back to network-first and pictures to
 * stale-while-revalidate, and anything else goes to the network untouched.
 */
async function fingerprinted(event: SwFetchEvent, request: Request, kind: "content" | "asset"): Promise<Response> {
  const path = new URL(request.url).pathname;
  const fingerprint = (await fileIndex())[path];
  if (fingerprint !== undefined) return versioned(event, request, path, fingerprint);
  if (kind === "content") return networkFirst(request, SW_CACHES.content);
  if (swIsImage(path)) return staleWhileRevalidate(event, request);
  return fetch(request);
}

async function versioned(event: SwFetchEvent, request: Request, path: string, fingerprint: string): Promise<Response> {
  const cache = await caches.open(SW_CACHES.files);
  const key = swVersionedKey(path, fingerprint);
  const saved = await cache.match(key, SAME);
  if (saved) {
    event.waitUntil(touch(key));
    return saved;
  }
  // Past the HTTP cache, which may hold the bytes a deploy just replaced.
  const response = await fetch(new Request(request, { cache: "no-cache" }));
  if (swCacheable(response)) {
    event.waitUntil(keepVersioned(cache, path, fingerprint, response.clone()).catch(() => undefined));
  }
  return response;
}

async function networkFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (swCacheable(response)) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const saved = await cache.match(request, SAME);
    if (saved) return saved;
    throw error;
  }
}

/**
 * Unindexed pictures: the saved copy straight away, a fresh one fetched behind
 * it for next time. Saving and trimming happen after the page has its picture.
 */
async function staleWhileRevalidate(event: SwExtendableEvent, request: Request): Promise<Response> {
  const cache = await caches.open(SW_CACHES.image);
  const saved = await cache.match(request, SAME);
  const refresh = fetch(request).then((response) => {
    if (swCacheable(response)) event.waitUntil(keepImage(cache, request, response.clone()));
    return response;
  });
  if (saved) {
    event.waitUntil(refresh.catch(() => undefined));
    return saved;
  }
  return refresh;
}

async function keepImage(cache: Cache, request: Request, response: Response): Promise<void> {
  await cache.put(request, response);
  for (const old of swOverLimit(await cache.keys(), SW_IMAGE_LIMIT)) await cache.delete(old);
}

// ---------------------------------------------------------------------------
// Fingerprinted files: the index, saving, bookkeeping
// ---------------------------------------------------------------------------

let indexLoad: Promise<FileIndex> | null = null;

/** This build's fingerprints. Empty — every file then falls back — if it cannot be read. */
function fileIndex(): Promise<FileIndex> {
  indexLoad ??= (async () => {
    const bundle = await caches.open(SW_CACHES.bundle);
    const response = (await bundle.match(__KAD_FILE_INDEX__, SAME)) ?? (await fetch(__KAD_FILE_INDEX__));
    if (!response.ok) throw new Error(`file index: ${String(response.status)}`);
    return (await response.json()) as FileIndex;
  })().catch((): FileIndex => {
    indexLoad = null; // try again next time
    return {};
  });
  return indexLoad;
}

/**
 * Save a fingerprinted file — but only if its bytes are the ones the
 * fingerprint names. A CDN edge still serving the previous deploy's copy
 * would otherwise be saved under the new name and kept for good.
 */
async function keepVersioned(cache: Cache, path: string, fingerprint: string, response: Response): Promise<void> {
  const bytes = await response.arrayBuffer();
  if ((await fingerprintOf(bytes)) !== fingerprint) return;
  // Re-wrapped, so the saved copy carries no transfer framing from this fetch.
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  const current = await filesMeta();
  for (const older of await cache.keys(path, { ignoreSearch: true, ignoreVary: true })) {
    await cache.delete(older);
    delete current[keyOf(older)];
  }
  const key = swVersionedKey(path, fingerprint);
  await cache.put(key, new Response(bytes, { status: 200, headers }));
  current[key] = { bytes: bytes.byteLength, used: Date.now() };
  await saveMeta();
}

/** `sw-build.ts` fingerprints with the first 16 hex digits of SHA-256. */
async function fingerprintOf(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 8), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let metaLoad: Promise<Record<string, FileMeta>> | null = null;

function filesMeta(): Promise<Record<string, FileMeta>> {
  metaLoad ??= (async () => {
    const files = await caches.open(SW_CACHES.files);
    const saved = await files.match(SW_FILES_META_KEY, SAME);
    return saved ? ((await saved.json()) as Record<string, FileMeta>) : {};
  })().catch((): Record<string, FileMeta> => ({}));
  return metaLoad;
}

let saving: Promise<void> | null = null;

/**
 * Write the bookkeeping, dropping least-recently-used files over budget first.
 * Coalesced: a burst of saves (a scene's worth of art) writes once.
 */
function saveMeta(): Promise<void> {
  saving ??= (async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    saving = null;
    const files = await caches.open(SW_CACHES.files);
    const current = await filesMeta();
    for (const key of swEvictions(current, SW_FILES_BUDGET_BYTES)) {
      await files.delete(key);
      delete current[key];
    }
    await files.put(
      SW_FILES_META_KEY,
      new Response(JSON.stringify(current), { headers: { "content-type": "application/json" } }),
    );
  })();
  return saving;
}

async function touch(key: string): Promise<void> {
  const current = await filesMeta();
  const entry = current[key];
  if (!entry) return;
  entry.used = Date.now();
  await saveMeta();
}

/** A request's cache key as `path?search`, the shape `swVersionedKey` writes. */
function keyOf(request: Request): string {
  const url = new URL(request.url);
  return url.pathname + url.search;
}

async function addMissing(cache: Cache, urls: readonly string[]): Promise<void> {
  const missing: string[] = [];
  for (const url of urls) if (!(await cache.match(url, SAME))) missing.push(url);
  await cache.addAll(missing);
}
