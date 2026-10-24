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
  SW_BUNDLE_LIST_KEY,
  SW_CACHES,
  SW_FILES_META_KEY,
  SW_IMAGE_LIMIT,
  SW_LEGACY_IMAGE_CACHES,
  SW_PRECACHE_CONTENT,
  SW_SHELL_KEY,
  SW_SHELL_STAGED_KEY,
  SW_SHELL_TIMEOUT_MS,
  swAfterInstallError,
  swBudgetFor,
  swCacheable,
  swEvictions,
  swIsImage,
  swOverLimit,
  swQuotaTrim,
  swShellAnswer,
  swShellEntry,
  swStaleBundles,
  swStaleVersions,
  swStrategyFor,
  swVersionedKey,
  type FileIndex,
  type FileMeta,
  type SwShellNetwork,
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
 * the network (where, after a deploy, the old build's chunks no longer are).
 * Everything this worker saves is the same bytes whatever the origin header
 * (hashed code, fingerprinted files), so `Vary` says nothing here.
 */
const SAME: CacheQueryOptions = { ignoreVary: true };

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // A full disk gets one trim of the saved art and one more try
      // (`swAfterInstallError`); anything else fails the install as it is.
      for (let attempt = 0; ; attempt += 1) {
        try {
          await installCopies();
          break;
        } catch (error) {
          if (swAfterInstallError(error, attempt) === "fail") throw error;
          await trimForQuota();
        }
      }

      // Take over at once. Every build's worker answers the same way, so an
      // open page loses nothing by being served by the new one.
      await worker.skipWaiting();
    })(),
  );
});

/**
 * Everything an install saves. Safe to run twice: what is already saved is
 * skipped, so a retry after a trim fetches only what did not fit.
 */
async function installCopies(): Promise<void> {
  // The page itself, fresh past the HTTP cache (it is `no-cache` anyway),
  // staged rather than saved: the worker in charge still serves its own
  // build's page offline, and must keep doing so if this install fails.
  // Activate makes it the saved page.
  const shell = await caches.open(SW_CACHES.shell);
  const page = await fetch(SW_SHELL_KEY, { cache: "reload" });
  if (swCacheable(page)) await shell.put(SW_SHELL_STAGED_KEY, page);

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
    // The book needs every one of these offline. If one cannot be had as
    // this build's bytes — a CDN edge still serving the previous deploy —
    // install fails, so this worker never takes over and the old one (and
    // its copies) stays in charge; the browser tries the update again later.
    const response = await fetch(path, { cache: "no-cache" });
    const kept =
      swCacheable(response) &&
      (await keepVersioned(files, path, fingerprint, response, { replaceOlder: false, persist: false }));
    if (!kept) throw new Error(`install: ${path} is not the bytes this build fingerprinted`);
  }
  await saveMeta();
  if (loose.length > 0) await (await caches.open(SW_CACHES.content)).addAll(loose);
}

/**
 * The disk filled mid-install: drop the least recently used art and audio, to
 * about half of what is saved (`swQuotaTrim`; content never goes), so the
 * retry has room. That art is downloaded again when a screen next draws it.
 */
async function trimForQuota(): Promise<void> {
  const files = await caches.open(SW_CACHES.files);
  const current = await filesMeta();
  for (const key of swQuotaTrim(current)) {
    await files.delete(key);
    delete current[key];
  }
  await saveMeta().catch(() => undefined);
}

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // This build's page, staged at install, becomes the offline app.
      const shellCache = await caches.open(SW_CACHES.shell);
      const staged = await shellCache.match(SW_SHELL_STAGED_KEY, SAME);
      if (staged) {
        await shellCache.put(SW_SHELL_KEY, staged);
        await shellCache.delete(SW_SHELL_STAGED_KEY);
      }

      // Pictures an earlier worker kept (#224's offline book: the map and the
      // finds) move into the fingerprinted cache — verified, like anything
      // kept — before the cache they were in is dropped below.
      const fingerprints = await fileIndex();
      const files = await caches.open(SW_CACHES.files);
      await adoptLegacyImages(fingerprints, files);

      const known = new Set<string>(Object.values(SW_CACHES));
      for (const name of await caches.keys()) {
        if (!known.has(name)) await caches.delete(name);
      }

      // Code no build in use needs: this build's and the previous one's stay,
      // because the pages this worker is about to take over were built
      // against the previous one (policy.ts `swStaleBundles`).
      const bundle = await caches.open(SW_CACHES.bundle);
      const recorded = await bundle.match(SW_BUNDLE_LIST_KEY, SAME);
      const previous = recorded ? ((await recorded.json()) as string[]) : [];
      const cachedCode = (await bundle.keys()).map((request) => new URL(request.url).pathname);
      for (const path of swStaleBundles(cachedCode, __KAD_BUNDLE__, previous)) await bundle.delete(path);
      await bundle.put(SW_BUNDLE_LIST_KEY, new Response(JSON.stringify(__KAD_BUNDLE__)));

      // Art, rigs, audio and content a deploy replaced or removed.
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

/**
 * A page load: the network (preloaded when it can be), raced against a short
 * timer. The saved app answers when the network fails, or is still out when
 * the timer fires (a captive portal, one bar of signal); with no saved app the
 * network is waited for as long as it takes (`swShellAnswer`). Whenever the
 * network's page arrives, early or late, it is kept for the next load.
 */
function shell(event: SwFetchEvent): Promise<Response> {
  const network = (async () => (await event.preloadResponse) ?? (await fetch(event.request)))();
  const cache = caches.open(SW_CACHES.shell);
  // Registered before the page is handed the response, so the clone is taken
  // while the body is still unread; the worker stays up for a late answer.
  event.waitUntil(
    network
      .then(async (response) => {
        if (!swCacheable(response)) return;
        const copy = response.clone();
        await keepShell(await cache, copy);
      })
      .catch(() => undefined),
  );
  return (async () => {
    const saved = await (await cache).match(SW_SHELL_KEY, SAME);
    type Settled = { state: Exclude<SwShellNetwork, "pending">; response?: Response; error?: unknown };
    const settled: Promise<Settled> = network.then(
      (response) => ({ state: "ok", response }),
      (error: unknown) => ({ state: "failed", error }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ state: "pending" }>((resolve) => {
      timer = setTimeout(() => resolve({ state: "pending" }), SW_SHELL_TIMEOUT_MS);
    });
    let outcome: Settled | { state: "pending" } = await Promise.race([settled, timeout]);
    clearTimeout(timer);
    let answer = swShellAnswer(outcome.state, saved !== undefined);
    if (answer === "wait") {
      outcome = await settled;
      answer = swShellAnswer(outcome.state, saved !== undefined);
    }
    if (answer === "network" && "response" in outcome && outcome.response) return outcome.response;
    if (answer === "saved" && saved) return saved;
    throw "error" in outcome ? outcome.error : new Error("page load failed");
  })();
}

/**
 * Save a page fetched online as the offline app — only if it is this build's
 * page. After a deploy the network serves the next build's page while this
 * worker is still in charge; saving it would pair the next build's code with
 * this worker's content offline. The next worker saves its own page.
 */
async function keepShell(cache: Cache, response: Response): Promise<void> {
  const entry = swShellEntry(await response.clone().text());
  if (entry !== null && __KAD_BUNDLE__.includes(entry)) await cache.put(SW_SHELL_KEY, response);
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
async function keepVersioned(
  cache: Cache,
  path: string,
  fingerprint: string,
  response: Response,
  { replaceOlder = true, persist = true }: { replaceOlder?: boolean; persist?: boolean } = {},
): Promise<boolean> {
  const bytes = await response.arrayBuffer();
  if ((await fingerprintOf(bytes)) !== fingerprint) return false;
  // Re-wrapped, so the saved copy carries no transfer framing from this fetch.
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  const current = await filesMeta();
  // Not during install: the worker in charge is still serving those copies,
  // and an install that fails must leave them where they were. Activate
  // drops whatever the new build replaced (`swStaleVersions`).
  if (replaceOlder) {
    for (const older of await cache.keys(path, { ignoreSearch: true, ignoreVary: true })) {
      await cache.delete(older);
      delete current[keyOf(older)];
    }
  }
  const key = swVersionedKey(path, fingerprint);
  await cache.put(key, new Response(bytes, { status: 200, headers }));
  current[key] = { bytes: bytes.byteLength, used: Date.now() };
  // A batch (install, adoption) saves the bookkeeping once at the end, rather
  // than waiting out `saveMeta`'s coalescing pause for every file.
  if (persist) await saveMeta();
  return true;
}

/** Move an earlier worker's saved pictures into the fingerprinted cache, keeping only verified ones. */
async function adoptLegacyImages(fingerprints: FileIndex, files: Cache): Promise<void> {
  for (const name of SW_LEGACY_IMAGE_CACHES) {
    if (!(await caches.has(name))) continue;
    const legacy = await caches.open(name);
    for (const request of await legacy.keys()) {
      const path = new URL(request.url).pathname;
      const fingerprint = fingerprints[path];
      if (fingerprint === undefined || (await files.match(swVersionedKey(path, fingerprint), SAME))) continue;
      const saved = await legacy.match(request, SAME);
      if (saved) await keepVersioned(files, path, fingerprint, saved, { replaceOlder: false, persist: false });
    }
  }
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
    for (const key of swEvictions(current, swBudgetFor(await storageQuota()))) {
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

/** The origin's storage quota, where the browser says (`navigator.storage` in the worker). */
async function storageQuota(): Promise<number | undefined> {
  try {
    return (await (navigator as Partial<Navigator>).storage?.estimate?.())?.quota;
  } catch {
    return undefined;
  }
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
