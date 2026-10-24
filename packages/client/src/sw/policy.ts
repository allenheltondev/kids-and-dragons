/**
 * The service worker's decisions, as pure functions (architecture §4.6,
 * "Offline" and "Caching").
 *
 * `sw.ts` is the worker itself; this file is what it decides, kept apart so it
 * can be tested without a worker. Both are concatenated into one classic
 * script by `sw-build.ts`, which drops the `export` keywords — so nothing in
 * here may import anything, and every name here is a global in the worker.
 *
 * Two jobs:
 *
 *   - The adventure book opens with no signal (`/journal`, spec §2.3), on a
 *     reload as well as in an open tab: the page, its code, the content it
 *     reads and the map painting are kept on the phone.
 *   - Nothing the phone already has is downloaded twice. Art, audio and
 *     content are not hashed in their URLs, so each build publishes a
 *     fingerprint of every one (`FileIndex`), and a saved copy whose
 *     fingerprint still matches is served without asking the network at all.
 *     A deploy that changes a file changes its fingerprint, and only that file
 *     is fetched again.
 *
 * The API and the event stream are never touched, and a page load always
 * tries the network first, but waits for it only briefly when a saved app is
 * there to show instead (`swShellAnswer`).
 */

/** How one request is answered. */
export type SwStrategy =
  /** A page load: the network, or the saved page when it fails or is slow. */
  | "shell"
  /** Hashed code (`/bundle/*`): never changes, so the cache answers first. */
  | "bundle"
  /** `/content/*.json`: by fingerprint when indexed, else network first. */
  | "content"
  /** `/assets/*`: by fingerprint when indexed, else as `image` or untouched. */
  | "asset"
  /** Unindexed pictures (`/brand/*`, the favicon): saved, refreshed behind. */
  | "image"
  /** Not the worker's business — the browser fetches it exactly as without one. */
  | "passthrough";

export const SW_CACHES = {
  shell: "kad-shell-v1",
  bundle: "kad-bundle-v1",
  /** Content that is not in the index (none, in a normal build). */
  content: "kad-content-v1",
  /** Fingerprinted art, audio and content, keyed `path?v=fingerprint`. */
  files: "kad-files-v1",
  image: "kad-image-v2",
} as const;

/**
 * Caches earlier workers kept pictures in, under names this one no longer
 * uses. Their pictures are adopted into the fingerprinted cache (when they
 * verify) before the old cache is dropped, so an upgrade does not take the
 * offline book's map and finds away. `kad-image-v1`: #224's worker.
 */
export const SW_LEGACY_IMAGE_CACHES: readonly string[] = ["kad-image-v1"];

/** Every page is the one app: a navigation anywhere is answered by this. */
export const SW_SHELL_KEY = "/";

/**
 * How long a page load waits for the network before the saved app is shown
 * instead. A captive portal (a hotel's or a car's Wi-Fi sign-in page) or one
 * bar of signal does not fail a request, it holds it, and without a limit the
 * phone shows a white screen for tens of seconds before the browser gives up.
 * A healthy network answers a page well inside three seconds even on a slow
 * phone, so a load that takes longer is better served by the copy already on
 * the phone; the network's page, when it does arrive, is still saved for the
 * next load (`keepShell`). Long enough that an ordinary 3G load is not
 * cut short and handed an older page after every deploy.
 */
export const SW_SHELL_TIMEOUT_MS = 3_000;

/** Where a page load stands: the network answered, failed, or is still out past the timeout. */
export type SwShellNetwork = "ok" | "failed" | "pending";

/** What a page load is answered with now, or whether to keep waiting. */
export type SwShellAnswer = "network" | "saved" | "wait" | "fail";

/**
 * A page load's answer. The network's page whenever it has one; the saved app
 * when the network fails, or is still out at the timeout; with no saved app,
 * the network is waited for however long it takes, and its failure is the
 * page's.
 */
export function swShellAnswer(network: SwShellNetwork, hasSaved: boolean): SwShellAnswer {
  if (network === "ok") return "network";
  if (hasSaved) return "saved";
  return network === "pending" ? "wait" : "fail";
}

/**
 * Where an installing worker keeps its build's page until it takes over. The
 * worker in charge keeps serving its own page offline meanwhile, and keeps it
 * if the install fails.
 */
export const SW_SHELL_STAGED_KEY = "/__kad/shell-next";

/** The build a page belongs to: its entry script (`/bundle/index-*.js`), or null. */
export function swShellEntry(html: string): string | null {
  return /<script\b[^>]*\bsrc="(\/bundle\/[^"]+\.js)"/.exec(html)?.[1] ?? null;
}

/**
 * Where the fingerprinted files' bookkeeping lives (sizes, last use), inside
 * the files cache under a path no request can have.
 */
export const SW_FILES_META_KEY = "/__kad/files-meta";

/**
 * The content the book reads, saved at install so a phone that has never
 * opened the book online can still read it offline. Campaign files are added
 * at build time (every one, so the lobby's launch campaign is always there).
 */
export const SW_PRECACHE_CONTENT: readonly string[] = [
  "/content/rules.json",
  "/content/items.json",
  "/content/abilities.json",
  "/content/world.json",
  "/content/field-guide.json",
  "/content/help.json",
];

/**
 * Limit cached art and audio on a family phone; evict least recently used
 * files first. The most it ever is, and what is used where the browser will
 * not say how much room there is (`swBudgetFor`).
 */
export const SW_FILES_BUDGET_BYTES = 200 * 1024 * 1024;

/** The least the budget is, however small the quota: a chapter's art is a few MB. */
export const SW_FILES_BUDGET_FLOOR_BYTES = 50 * 1024 * 1024;

/** The share of the origin's quota art and audio may take. */
export const SW_FILES_BUDGET_SHARE = 0.2;

/**
 * The budget for this phone, from `navigator.storage.estimate()`'s quota:
 * a fifth of it, at most `SW_FILES_BUDGET_BYTES` and at least the floor. A
 * phone short on space gets a smaller cache rather than an install that fails;
 * a missing or nonsense quota gets the fixed budget.
 */
export function swBudgetFor(quota: number | undefined): number {
  if (quota === undefined || !Number.isFinite(quota) || quota <= 0) return SW_FILES_BUDGET_BYTES;
  return Math.round(Math.max(SW_FILES_BUDGET_FLOOR_BYTES, Math.min(SW_FILES_BUDGET_BYTES, quota * SW_FILES_BUDGET_SHARE)));
}

/** Unindexed pictures are few (brand art); a count is enough. */
export const SW_IMAGE_LIMIT = 100;

const IMAGE = /\.(?:webp|png|jpe?g|gif|svg|avif|ico)$/i;

export interface SwRequestFacts {
  method: string;
  url: string;
  /** `Request.mode`: "navigate" for a page load. */
  mode: string;
  /** A `Range` header — audio scrubbing; partial responses are never cached. */
  hasRange: boolean;
}

export function swStrategyFor(request: SwRequestFacts, origin: string): SwStrategy {
  if (request.method !== "GET" || request.hasRange) return "passthrough";
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return "passthrough";
  }
  if (url.origin !== origin) return "passthrough";
  const path = url.pathname;
  // Live game state: always the network, never a copy.
  if (path.startsWith("/api/") || path.startsWith("/events/")) return "passthrough";
  if (request.mode === "navigate") return "shell";
  if (path.startsWith("/bundle/")) return "bundle";
  if (path.startsWith("/content/") && path.endsWith(".json")) return "content";
  if (path.startsWith("/assets/")) return "asset";
  if (IMAGE.test(path)) return "image";
  return "passthrough";
}

/** Whether a path that is not fingerprinted is still worth saving as a picture. */
export function swIsImage(path: string): boolean {
  return IMAGE.test(path);
}

/** Whether a response is worth keeping: a whole, same-origin success. */
export function swCacheable(response: { ok: boolean; status: number; type: string }): boolean {
  return response.ok && response.status === 200 && response.type === "basic";
}

/**
 * Where the worker records which build's code it last kept, inside the bundle
 * cache under a path no request can have.
 */
export const SW_BUNDLE_LIST_KEY = "/__kad/bundle-list";

/**
 * Hashed code to drop when a new build's worker takes over: what is in
 * neither this build nor the one before it.
 *
 * Not "everything this build does not list". The new worker takes over pages
 * that are already open (`skipWaiting` + `clients.claim`), and those pages
 * were built against the previous build: the first time one opens the book or
 * a room, it imports that build's chunks — which the deploy has already
 * deleted from the bucket (`--delete`). Keeping one build back is what lets
 * that import still succeed. Two deploys back is a tab left open across two
 * releases; it gets the "Try again" a missing chunk always gets (ui/ChunkBoundary.tsx),
 * which reloads it onto the current build.
 */
export function swStaleBundles(
  cached: readonly string[],
  current: readonly string[],
  previous: readonly string[] = [],
): string[] {
  const keep = new Set([...current, ...previous]);
  return cached.filter((path) => path !== SW_BUNDLE_LIST_KEY && !keep.has(path));
}

/** The oldest entries to drop to get back under `limit` (cache keys are oldest first). */
export function swOverLimit<T>(keys: readonly T[], limit: number): T[] {
  return keys.length > limit ? keys.slice(0, keys.length - limit) : [];
}

// ---------------------------------------------------------------------------
// Fingerprinted files
// ---------------------------------------------------------------------------

/** Path (`/assets/…`, `/content/…`) → a fingerprint of its bytes, per build. */
export type FileIndex = Readonly<Record<string, string>>;

/** The cache key a fingerprinted file is saved under. */
export function swVersionedKey(path: string, fingerprint: string): string {
  return `${path}?v=${fingerprint}`;
}

/** The path and fingerprint a saved key names, or null for anything else. */
export function swReadVersionedKey(key: string): { path: string; fingerprint: string } | null {
  const url = new URL(key, "https://kad.invalid");
  const fingerprint = url.searchParams.get("v");
  return fingerprint ? { path: url.pathname, fingerprint } : null;
}

/**
 * Saved files a new build has replaced or removed: their fingerprint is no
 * longer the index's. Dropped when a new worker takes over, so a deploy that
 * repaints a backdrop does not leave the old one on every phone.
 */
export function swStaleVersions(keys: readonly string[], index: FileIndex): string[] {
  return keys.filter((key) => {
    const read = swReadVersionedKey(key);
    return read !== null && index[read.path] !== read.fingerprint;
  });
}

/** Bookkeeping for one saved file. */
export interface FileMeta {
  bytes: number;
  /** When it was last served (ms since epoch). */
  used: number;
}

/**
 * Which saved files to drop to get back under budget — least recently used
 * first, down to 90% so trimming is not repeated on every new file. Content
 * is never dropped: it is small, and it is what the offline book reads.
 */
export function swEvictions(meta: Readonly<Record<string, FileMeta>>, budget: number): string[] {
  let total = Object.values(meta).reduce((sum, entry) => sum + entry.bytes, 0);
  if (total <= budget) return [];
  const target = budget * 0.9;
  const out: string[] = [];
  const candidates = Object.entries(meta)
    .filter(([key]) => !key.startsWith("/content/"))
    .sort(([, a], [, b]) => a.used - b.used);
  for (const [key, entry] of candidates) {
    if (total <= target) break;
    out.push(key);
    total -= entry.bytes;
  }
  return out;
}

/** Whether an error is the browser refusing to store more (`QuotaExceededError`). */
export function swIsQuotaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  // 22 is the legacy `DOMException.QUOTA_EXCEEDED_ERR`, which old WebKit still reports.
  return name === "QuotaExceededError" || code === 22;
}

/**
 * An install that failed: trim the saved art and try once more, or fail as
 * ever. Only a full disk is worth a retry, and only once: anything else
 * (a content file whose bytes are not this build's, a network failure) fails
 * the install, so the worker in charge stays in charge with its copies.
 */
export function swAfterInstallError(error: unknown, attempt: number): "trim-and-retry" | "fail" {
  return attempt === 0 && swIsQuotaError(error) ? "trim-and-retry" : "fail";
}

/** How far a full disk trims the saved art: to this share of what is saved now. */
export const SW_QUOTA_TRIM_SHARE = 0.5;

/**
 * What to drop when the disk is full mid-install: least recently used art and
 * audio until about half of what is saved now is left. Content is never
 * dropped (`swEvictions`).
 */
export function swQuotaTrim(meta: Readonly<Record<string, FileMeta>>): string[] {
  const total = Object.values(meta).reduce((sum, entry) => sum + entry.bytes, 0);
  return swEvictions(meta, total * SW_QUOTA_TRIM_SHARE);
}

// ---------------------------------------------------------------------------
// Overnight refresh (#467): Periodic Background Sync
// ---------------------------------------------------------------------------

/** The one periodic sync the installed app registers (`periodic.ts`), and the worker answers. */
export const SW_PERIODIC_TAG = "kad-refresh";

/** At most once a day: the browser stretches it further for an app that is seldom opened. */
export const SW_PERIODIC_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Where the worker records its last overnight run, inside the files cache
 * under a path no request can have. Help's Diagnostics panel reads it.
 */
export const SW_PERIODIC_KEY = "/__kad/periodic-sync";

/**
 * The hand-off to a newer build (files cache, a path no request can have).
 * A run whose `update()` finds a newer worker installing or waiting writes
 * this marker and stops, so the refresh runs against the new build's index.
 * The new worker's `activate` consumes it; if that worker never takes over,
 * the next run of whichever worker is active clears it first and does the
 * refresh itself, so a hand-off is never dropped and never runs twice.
 */
export const SW_PERIODIC_PENDING_KEY = "/__kad/periodic-pending";

/** A marker older than this is a hand-off nobody took: ignored, and the next run is the refresh. */
export const SW_PERIODIC_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** What the hand-off marker holds. */
export interface SwPeriodicPending {
  /** When it was written (ms since epoch). */
  at: number;
  tag: string;
}

/** Whether a stored marker is a hand-off still worth taking at `now`. */
export function swPendingFresh(raw: unknown, now: number): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const { at, tag } = raw as Partial<Record<keyof SwPeriodicPending, unknown>>;
  if (tag !== SW_PERIODIC_TAG || typeof at !== "number" || !Number.isFinite(at)) return false;
  const age = now - at;
  return age >= 0 && age < SW_PERIODIC_PENDING_MAX_AGE_MS;
}

/**
 * How long one overnight run may keep fetching. The browser gives a periodic
 * sync a few minutes before it stops the worker; the run stops starting new
 * downloads well inside that, so it ends on its own terms and records how far
 * it got.
 */
export const SW_PERIODIC_DEADLINE_MS = 2 * 60 * 1000;

/** How a run ended, for Diagnostics. */
export type SwPeriodicOutcome =
  /** Content refreshed and the next chapter's art saved. */
  | "done"
  /** A newer build was installing or waiting; it was left a marker to do the run instead. */
  | "handed-over"
  /** Data Saver is on: content refreshed, no art guessed at. */
  | "saved-data"
  /** Content refreshed; the journal names no chapter to get ready. */
  | "nothing-next"
  /** Stopped at the deadline or the night's byte cap; the next run carries on. */
  | "partial"
  | "failed";

export interface SwPeriodicRecord {
  /** When the run ended (ms since epoch). */
  at: number;
  outcome: SwPeriodicOutcome;
  /** The build whose worker ran it. */
  build: string;
  /** Content files fetched again. */
  refreshed: number;
  /** Art files saved for the next chapter. */
  warmed: number;
  /** The chapters it got ready. */
  chapters: string[];
}

const PERIODIC_OUTCOMES: readonly string[] = ["done", "handed-over", "saved-data", "nothing-next", "partial", "failed"];

/** A stored record, or null when it is missing or not one. */
export function swPeriodicRecordOf(raw: unknown): SwPeriodicRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Partial<Record<keyof SwPeriodicRecord, unknown>>;
  if (typeof r.at !== "number" || !Number.isFinite(r.at)) return null;
  if (typeof r.outcome !== "string" || !PERIODIC_OUTCOMES.includes(r.outcome)) return null;
  return {
    at: r.at,
    outcome: r.outcome as SwPeriodicOutcome,
    build: typeof r.build === "string" ? r.build : "",
    refreshed: typeof r.refreshed === "number" ? r.refreshed : 0,
    warmed: typeof r.warmed === "number" ? r.warmed : 0,
    chapters: Array.isArray(r.chapters) ? r.chapters.filter((id): id is string => typeof id === "string") : [],
  };
}

/** What a run does: content always (it is small and the book reads it); art only when data is not being saved. */
export function swPeriodicWork(saveData: boolean): { refreshContent: true; warmNext: boolean } {
  return { refreshContent: true, warmNext: !saveData };
}

/**
 * Content to fetch again, as paths: every `/content/*` file the phone keeps or
 * wants (`wanted`) whose copy at this index's fingerprint is not saved. A
 * saved copy under another fingerprint is a file the deploy changed, so this
 * is "what changed between the index the copy was saved against and this
 * one", read off the saved keys themselves. Unindexed paths are left alone.
 */
export function swContentToRefresh(index: FileIndex, saved: readonly string[], wanted: readonly string[]): string[] {
  const have = new Set(saved);
  const kept: string[] = [];
  for (const key of saved) {
    const read = swReadVersionedKey(key);
    if (read) kept.push(read.path);
  }
  const out: string[] = [];
  for (const path of new Set([...wanted, ...kept])) {
    if (!path.startsWith("/content/")) continue;
    const fingerprint = index[path];
    if (fingerprint === undefined || have.has(swVersionedKey(path, fingerprint))) continue;
    out.push(path);
  }
  return out;
}

/**
 * The art to download, in order, with the fingerprint to check it against:
 * indexed files not already saved. Anything unindexed is skipped, since a
 * copy that cannot be checked is not worth a night's download.
 */
export function swWarmList(
  urls: readonly string[],
  index: FileIndex,
  saved: readonly string[],
): { path: string; fingerprint: string }[] {
  const have = new Set(saved);
  const out: { path: string; fingerprint: string }[] = [];
  for (const path of new Set(urls)) {
    const fingerprint = index[path];
    if (fingerprint === undefined || have.has(swVersionedKey(path, fingerprint))) continue;
    out.push({ path, fingerprint });
  }
  return out;
}

/** The share of the files budget one night may download. */
export const SW_PERIODIC_BUDGET_SHARE = 0.25;

/**
 * The most one overnight run downloads: a quarter of the files budget, so a
 * night never pushes out most of what the phone already keeps. A chapter's
 * art is a few MB, far inside it.
 */
export function swPeriodicByteCap(budget: number): number {
  return Math.round(budget * SW_PERIODIC_BUDGET_SHARE);
}
