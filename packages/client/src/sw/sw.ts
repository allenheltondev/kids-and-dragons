/**
 * The service worker (`/sw.js`) — see `policy.ts` for what it is for and what
 * it decides. This file is only the wiring: install, activate, fetch.
 *
 * Built by `sw-build.ts` into one classic script with this build's list of
 * hashed code prepended (`__KAD_PRECACHE__`), so a deploy is a new `sw.js`
 * and the browser installs it on its own. Registered only in a production
 * build (`register.ts`); the dev server never sees it.
 *
 * Typed against the DOM program the rest of the client lives in, with the few
 * worker-only shapes declared here, rather than a second program with the
 * WebWorker lib (which cannot share a compilation with DOM).
 */

import {
  SW_CACHES,
  SW_IMAGE_LIMIT,
  SW_PRECACHE_CONTENT,
  SW_SHELL_KEY,
  swCacheable,
  swOverLimit,
  swStaleBundles,
  swStrategyFor,
} from "./policy";

/** Prepended by `sw-build.ts`: every `/bundle/*` file of this build. */
declare const __KAD_BUNDLE__: readonly string[];
/** Prepended by `sw-build.ts`: the ones saved at install. */
declare const __KAD_PRECACHE__: readonly string[];
/** Prepended by `sw-build.ts`: every `/content/campaigns/*.json`. */
declare const __KAD_PRECACHE_CAMPAIGNS__: readonly string[];

interface SwExtendableEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}
interface SwScope {
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: SwFetchEvent) => void): void;
}

const worker = self as unknown as SwScope;

worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // The page itself, fresh past the HTTP cache: it is `no-cache` anyway.
      const shell = await caches.open(SW_CACHES.shell);
      const page = await fetch(SW_SHELL_KEY, { cache: "reload" });
      if (swCacheable(page)) await shell.put(SW_SHELL_KEY, page);

      // Hashed code: what is already saved from an earlier build is the same
      // bytes, so only what is new is fetched.
      const bundle = await caches.open(SW_CACHES.bundle);
      await addMissing(bundle, __KAD_PRECACHE__);

      // Content changes without its URL changing, so it is fetched fresh.
      const content = await caches.open(SW_CACHES.content);
      await content.addAll(
        [...SW_PRECACHE_CONTENT, ...__KAD_PRECACHE_CAMPAIGNS__].map((url) => new Request(url, { cache: "reload" })),
      );

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
      const bundle = await caches.open(SW_CACHES.bundle);
      const cached = (await bundle.keys()).map((request) => new URL(request.url).pathname);
      for (const path of swStaleBundles(cached, __KAD_BUNDLE__)) await bundle.delete(path);
      await worker.clients.claim();
    })(),
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
      event.respondWith(networkFirst(request, SW_CACHES.shell, SW_SHELL_KEY));
      return;
    case "content":
      event.respondWith(networkFirst(request, SW_CACHES.content));
      return;
    case "bundle":
      event.respondWith(cacheFirst(request, SW_CACHES.bundle));
      return;
    case "image":
      event.respondWith(staleWhileRevalidate(event, request));
      return;
  }
});

async function addMissing(cache: Cache, urls: readonly string[]): Promise<void> {
  const missing: string[] = [];
  for (const url of urls) if (!(await cache.match(url))) missing.push(url);
  await cache.addAll(missing);
}

/** The network when it answers, kept for later; the saved copy when it does not. */
async function networkFirst(request: Request, cacheName: string, key: string | Request = request): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (swCacheable(response)) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const saved = await cache.match(key);
    if (saved) return saved;
    throw error;
  }
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (swCacheable(response)) await cache.put(request, response.clone());
  return response;
}

/**
 * Art: the saved copy straight away, and a fresh one fetched behind it for
 * next time — art URLs are not hashed, so a repainted picture still arrives,
 * one view late. The first sight of anything is the network's. Saving and
 * trimming happen after the page has its picture, never before.
 */
async function staleWhileRevalidate(event: SwExtendableEvent, request: Request): Promise<Response> {
  const cache = await caches.open(SW_CACHES.image);
  const saved = await cache.match(request);
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
