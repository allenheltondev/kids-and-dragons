/**
 * The service worker (`/sw.js`) — see `policy.ts` for what it is for and what
 * it decides. This file is only the wiring: install, activate, fetch, message,
 * and the overnight refresh (`periodicsync`, #467).
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

import type { Campaign, Chapter, JournalResponse } from "@kad/shared";
import {
  SW_JOURNAL_DB,
  swActiveStory,
  swCampaignPath,
  swChapterPath,
  swChaptersToRead,
  swHeroesOf,
  swNextChapterArt,
  swNextChapters,
  type SwChapterFacts,
} from "./next-chapter";
import {
  SW_BUNDLE_LIST_KEY,
  SW_CACHES,
  SW_FILES_META_KEY,
  SW_IMAGE_LIMIT,
  SW_LEGACY_IMAGE_CACHES,
  SW_PERIODIC_DEADLINE_MS,
  SW_PERIODIC_HANDOFF,
  SW_PERIODIC_KEY,
  SW_PERIODIC_TAG,
  SW_PRECACHE_CONTENT,
  SW_SHELL_KEY,
  SW_SHELL_STAGED_KEY,
  SW_SHELL_TIMEOUT_MS,
  swAfterInstallError,
  swBudgetFor,
  swCacheable,
  swContentToRefresh,
  swEvictions,
  swIsImage,
  swOverLimit,
  swPeriodicByteCap,
  swPeriodicWork,
  swQuotaTrim,
  swShellAnswer,
  swShellEntry,
  swStaleBundles,
  swStaleVersions,
  swStrategyFor,
  swVersionedKey,
  swWarmList,
  type FileIndex,
  type FileMeta,
  type SwPeriodicOutcome,
  type SwPeriodicRecord,
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
/** Prepended by `sw-build.ts`: this build's id, the same one the page reports (`VITE_KAD_BUILD`). */
declare const __KAD_BUILD__: string;

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
  /** A page (a `Client`, which has a `url`) or another worker (a `ServiceWorker`, which has a `scriptURL`). */
  readonly source?: { readonly url?: unknown; readonly scriptURL?: unknown } | null;
}
interface SwPeriodicSyncEvent extends SwExtendableEvent {
  readonly tag: string;
}
/** A `ServiceWorker` as the worker sees one: itself, or another build's. */
interface SwWorkerRef {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
  removeEventListener(type: "statechange", listener: () => void): void;
}
interface SwScope {
  readonly location: Location;
  readonly clients: {
    claim(): Promise<void>;
    matchAll(options?: { includeUncontrolled?: boolean; type?: "window" | "worker" | "sharedworker" | "all" }): Promise<readonly { postMessage(message: unknown): void }[]>;
  };
  readonly registration: {
    navigationPreload?: { enable(): Promise<void> };
    update?(): Promise<unknown>;
    readonly installing?: SwWorkerRef | null;
    readonly waiting?: SwWorkerRef | null;
    readonly active?: SwWorkerRef | null;
  };
  /** This worker itself, where the browser exposes it. */
  readonly serviceWorker?: SwWorkerRef;
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: SwExtendableEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: SwFetchEvent) => void): void;
  addEventListener(type: "message", listener: (event: SwMessageEvent) => void): void;
  addEventListener(type: "periodicsync", listener: (event: SwPeriodicSyncEvent) => void): void;
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
    guarded("install", async () => {
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
    }),
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
  if (swCacheable(page)) await put(shell, SW_SHELL_STAGED_KEY, page);

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
    guarded("activate", async () => {
      // This build's page, staged at install, becomes the offline app.
      const shellCache = await caches.open(SW_CACHES.shell);
      const staged = await shellCache.match(SW_SHELL_STAGED_KEY, SAME);
      if (staged) {
        await put(shellCache, SW_SHELL_KEY, staged);
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
      await put(bundle, SW_BUNDLE_LIST_KEY, new Response(JSON.stringify(__KAD_BUNDLE__)));

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
    }),
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
// Overnight refresh (#467)
// ---------------------------------------------------------------------------

/*
 * Chromium on Android wakes an installed app's worker about once a day for a
 * periodic sync the page registered (`periodic.ts`). The run:
 *
 *   1. asks the browser for a newer `sw.js` (`registration.update()`). A new
 *      build's install re-reads its own file index and fetches the content
 *      that changed, so when one turns up this run hands over to it
 *      (`SW_PERIODIC_HANDOFF`) and stops: its index is the one to warm by;
 *   2. fetches again every `/content/*` file kept or wanted whose copy at this
 *      index's fingerprint is missing (`swContentToRefresh`);
 *   3. unless Data Saver is on, finds the household's next chapter from the
 *      saved journal (refreshed from `/api/journal` with the saved device
 *      token when it answers) and the campaign's content (next-chapter.ts),
 *      and saves its art (`swNextChapterArt`), at most a quarter of the files
 *      budget a night (`swPeriodicByteCap`) and inside `SW_PERIODIC_DEADLINE_MS`.
 *
 * Nothing escapes: every step is caught, the whole run is bounded inside
 * `waitUntil`, and how it ended is recorded for Diagnostics (`SW_PERIODIC_KEY`).
 */

worker.addEventListener("periodicsync", (event) => {
  if (event.tag !== SW_PERIODIC_TAG) return;
  event.waitUntil(periodicOnce(true));
});

worker.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown } | null | undefined;
  if (data?.type !== SW_PERIODIC_HANDOFF) return;
  // Only another worker hands a run over; a page cannot start one.
  if (typeof event.source?.scriptURL !== "string") return;
  event.waitUntil(
    afterActivation()
      .then((active) => (active ? periodicOnce(false) : undefined))
      .catch(() => undefined),
  );
});

let periodicRun: Promise<void> | null = null;

/** One run at a time, never rejecting, and never outlasting the deadline by much. */
function periodicOnce(mayUpdate: boolean): Promise<void> {
  periodicRun ??= (async () => {
    const deadline = Date.now() + SW_PERIODIC_DEADLINE_MS;
    const record: SwPeriodicRecord = { at: 0, outcome: "failed", build: __KAD_BUILD__, refreshed: 0, warmed: 0, chapters: [] };
    try {
      record.outcome = await periodicRefresh(record, deadline, mayUpdate);
    } catch (error) {
      noteQuota(error);
      record.outcome = "failed";
    }
    await saveMeta().catch(() => undefined);
    record.at = Date.now();
    await savePeriodicRecord(record).catch(() => undefined);
  })()
    .catch(() => undefined)
    .finally(() => {
      periodicRun = null;
    });
  const run = periodicRun;
  return Promise.race([run, new Promise<void>((resolve) => setTimeout(resolve, SW_PERIODIC_DEADLINE_MS + 15_000))]);
}

async function periodicRefresh(record: SwPeriodicRecord, deadline: number, mayUpdate: boolean): Promise<SwPeriodicOutcome> {
  if (mayUpdate && (await handedToNewerWorker())) return "handed-over";
  const index = await fileIndex();
  if (Object.keys(index).length === 0) return "failed";
  const files = await caches.open(SW_CACHES.files);
  const work = swPeriodicWork(savingData());
  const next = work.warmNext ? await nextChapterPlan(index, files) : null;

  const wanted = [...SW_PRECACHE_CONTENT, ...__KAD_PRECACHE_CAMPAIGNS__, ...(next?.ids ?? []).map(swChapterPath)];
  for (const path of swContentToRefresh(index, await savedKeys(files), wanted)) {
    if (Date.now() > deadline) return "partial";
    if ((await keepFromNetwork(files, path, index[path]!)) > 0) record.refreshed += 1;
  }

  if (!work.warmNext) return "saved-data";
  if (!next || next.chapters.length === 0) return "nothing-next";
  record.chapters = next.ids;
  const cap = swPeriodicByteCap(swBudgetFor(await storageQuota()));
  let bytes = 0;
  for (const { path, fingerprint } of swWarmList(swNextChapterArt(next.chapters, next.heroes), index, await savedKeys(files))) {
    if (Date.now() > deadline || bytes >= cap) return "partial";
    const kept = await keepFromNetwork(files, path, fingerprint);
    if (kept > 0) {
      record.warmed += 1;
      bytes += kept;
    }
  }
  return "done";
}

/**
 * Ask for a newer build. When one is installing or waiting, hand the run to
 * it and say so; anything that goes wrong just means this worker does the run.
 */
async function handedToNewerWorker(): Promise<boolean> {
  const registration = worker.registration;
  try {
    await registration.update?.();
    const next = registration.installing ?? registration.waiting;
    if (!next || next === registration.active) return false;
    next.postMessage({ type: SW_PERIODIC_HANDOFF });
    return true;
  } catch {
    return false;
  }
}

/** Resolves true once this worker is the active one (a handed-over run waits for its own activate). */
function afterActivation(timeoutMs = 60_000): Promise<boolean> {
  const me = worker.serviceWorker;
  if (!me) return Promise.resolve(!worker.registration.installing && !worker.registration.waiting);
  if (me.state === "activated") return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (value: boolean): void => {
      clearTimeout(timer);
      me.removeEventListener("statechange", changed);
      resolve(value);
    };
    const changed = (): void => {
      if (me.state === "activated") done(true);
      else if (me.state === "redundant") done(false);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    me.addEventListener("statechange", changed);
  });
}

/** The chapters to get ready, read from what the phone has; null when nothing says. */
async function nextChapterPlan(
  index: FileIndex,
  files: Cache,
): Promise<{ ids: string[]; chapters: Chapter[]; heroes: ReturnType<typeof swHeroesOf> } | null> {
  const journal = await freshJournal();
  const story = swActiveStory(journal);
  if (!story) return null;
  const campaign = await contentJson<Campaign>(swCampaignPath(story.campaignId), index, files);
  if (!campaign) return null;
  const read: Record<string, Chapter> = {};
  for (const id of swChaptersToRead(campaign, story.played)) {
    const chapter = await contentJson<Chapter>(swChapterPath(id), index, files);
    if (chapter) read[id] = chapter;
  }
  const facts: SwChapterFacts = read;
  const chapters: Chapter[] = [];
  for (const id of swNextChapters(campaign, story, facts)) {
    const chapter = read[id] ?? (await contentJson<Chapter>(swChapterPath(id), index, files));
    if (chapter && chapter.scenes && typeof chapter.entry === "string") chapters.push(chapter);
  }
  return { ids: chapters.map((chapter) => chapter.id), chapters, heroes: swHeroesOf(journal) };
}

/**
 * The household's journal: fresh from `/api/journal` (the same read the book
 * makes, with the device token the page saved), else the saved copy. Never
 * written back: the page owns that store.
 */
async function freshJournal(): Promise<Partial<JournalResponse> | null> {
  const saved = await savedJournal();
  if (saved?.deviceToken) {
    try {
      const response = await fetch("/api/journal", {
        headers: { "x-kad-device-token": saved.deviceToken },
        cache: "no-store",
        ...(typeof AbortSignal.timeout === "function" ? { signal: AbortSignal.timeout(15_000) } : {}),
      });
      if (response.ok) return (await response.json()) as Partial<JournalResponse>;
    } catch {
      // Offline or refused: the saved copy is what there is.
    }
  }
  return saved?.journal ?? null;
}

/**
 * The page's saved journal (store/journal-db.ts), read only. Opened at
 * whatever version it is; a database that does not exist yet is not
 * created, so the page's own first open still makes its store.
 */
function savedJournal(): Promise<{ deviceToken?: string; journal?: Partial<JournalResponse> } | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const open = indexedDB.open(SW_JOURNAL_DB.name);
      open.onupgradeneeded = () => open.transaction?.abort();
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        try {
          if (!db.objectStoreNames.contains(SW_JOURNAL_DB.store)) {
            db.close();
            return resolve(null);
          }
          const get = db.transaction(SW_JOURNAL_DB.store, "readonly").objectStore(SW_JOURNAL_DB.store).get(SW_JOURNAL_DB.key);
          get.onsuccess = () => {
            db.close();
            const value = get.result as { deviceToken?: unknown; journal?: unknown } | undefined;
            if (!value || typeof value !== "object") return resolve(null);
            resolve({
              ...(typeof value.deviceToken === "string" ? { deviceToken: value.deviceToken } : {}),
              ...(value.journal && typeof value.journal === "object" ? { journal: value.journal as Partial<JournalResponse> } : {}),
            });
          };
          get.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch {
          db.close();
          resolve(null);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

/** A content file as JSON: the saved copy at this build's fingerprint, else the network (not kept). */
async function contentJson<T>(path: string, index: FileIndex, files: Cache): Promise<T | null> {
  try {
    const fingerprint = index[path];
    const saved = fingerprint === undefined ? undefined : await files.match(swVersionedKey(path, fingerprint), SAME);
    const response = saved ?? (await fetch(path, { cache: "no-cache" }));
    if (!response.ok) return null;
    const value = (await response.json()) as unknown;
    return value && typeof value === "object" ? (value as T) : null;
  } catch {
    return null;
  }
}

/** Download one fingerprinted file and keep it if its bytes check out; the bytes kept, or 0. */
async function keepFromNetwork(files: Cache, path: string, fingerprint: string): Promise<number> {
  try {
    const response = await fetch(path, { cache: "no-cache" });
    if (!swCacheable(response)) return 0;
    if (!(await keepVersioned(files, path, fingerprint, response, { persist: false }))) return 0;
    return (await filesMeta())[swVersionedKey(path, fingerprint)]?.bytes ?? 0;
  } catch (error) {
    noteQuota(error);
    return 0;
  }
}

async function savedKeys(files: Cache): Promise<string[]> {
  return (await files.keys()).map(keyOf);
}

/** Data Saver, as the worker's navigator reports it. */
function savingData(): boolean {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
}

async function savePeriodicRecord(record: SwPeriodicRecord): Promise<void> {
  const files = await caches.open(SW_CACHES.files);
  await put(files, SW_PERIODIC_KEY, new Response(JSON.stringify(record), { headers: { "content-type": "application/json" } }));
}

// ---------------------------------------------------------------------------
// Telling the crash reporter (#459)
// ---------------------------------------------------------------------------

type SwStage = "install" | "activate" | "fingerprint" | "quota";

/**
 * The phrases the server accepts (`diagnose` in shared/error-report.ts): a
 * report names a kind of failure, never what the exception said.
 */
const STAGE_MESSAGE: Record<SwStage, string> = {
  install: "Error: service worker install failed",
  activate: "Error: service worker activate failed",
  fingerprint: "Error: service worker file mismatch",
  quota: "Error: service worker out of space",
};

/** Reporting may never hold up an install or an activate for longer than this. */
const REPORT_WAIT_MS = 2000;

const reported = new Set<SwStage>();

/**
 * Run an install or activate body; if it throws, tell the reporter, then throw
 * the same error so the browser still treats the step as failed.
 */
async function guarded(stage: "install" | "activate", body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (error) {
    noteQuota(error);
    await reportOnce(stage, error);
    throw error;
  }
}

/** A full disk is worth one report per worker lifetime, wherever it surfaces. */
function noteQuota(error: unknown): void {
  const thrown = error as { name?: unknown; message?: unknown } | null | undefined;
  if (thrown?.name === "QuotaExceededError" || /quota/i.test(String(thrown?.message))) void reportOnce("quota", error);
}

/** `cache.put`, noting a full disk on the way past. */
async function put(cache: Cache, request: RequestInfo | URL, response: Response): Promise<void> {
  try {
    await cache.put(request, response);
  } catch (error) {
    noteQuota(error);
    throw error;
  }
}

/**
 * At most once per stage per worker lifetime. Never throws, and never takes
 * longer than `REPORT_WAIT_MS`, so it is safe to await inside `waitUntil`.
 */
function reportOnce(stage: SwStage, error?: unknown): Promise<void> {
  if (reported.has(stage)) return Promise.resolve();
  reported.add(stage);
  const sent = (async () => {
    try {
      const open = await worker.clients.matchAll({ includeUncontrolled: true });
      if (open.length > 0) {
        const message = String((error as { message?: unknown } | null | undefined)?.message ?? "").slice(0, 200);
        for (const client of open) client.postMessage({ type: "kad:sw-error", stage, message, build: __KAD_BUILD__ });
        return;
      }
      // No page is open to hand it to: the same endpoint and body as report.ts.
      const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
      await fetch("/api/client-error", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: STAGE_MESSAGE[stage],
          stack: [],
          version: __KAD_BUILD__,
          route: "other",
          layout: "other",
          browser: "other",
          id,
        }),
        keepalive: true,
      });
    } catch {
      // Never throw from the thing that reports throwing.
    }
  })();
  return Promise.race([sent, new Promise<void>((resolve) => setTimeout(resolve, REPORT_WAIT_MS))]);
}

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
  if (entry !== null && __KAD_BUNDLE__.includes(entry)) await put(cache, SW_SHELL_KEY, response);
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const saved = await cache.match(request, SAME);
  if (saved) return saved;
  const response = await fetch(request);
  if (swCacheable(response)) await put(cache, request, response.clone());
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
    if (swCacheable(response)) await put(cache, request, response.clone());
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
  await put(cache, request, response);
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
  if ((await fingerprintOf(bytes)) !== fingerprint) {
    void reportOnce("fingerprint");
    return false;
  }
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
  await put(cache, key, new Response(bytes, { status: 200, headers }));
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
    await put(
      files,
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
