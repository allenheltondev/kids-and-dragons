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
 * tries the network first.
 */

/** How one request is answered. */
export type SwStrategy =
  /** A page load: the network, or the saved page when there is none. */
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

/** Limit cached art and audio on a family phone; evict least recently used files first. */
export const SW_FILES_BUDGET_BYTES = 200 * 1024 * 1024;

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
