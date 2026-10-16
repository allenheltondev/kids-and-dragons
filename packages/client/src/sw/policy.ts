/**
 * The service worker's decisions, as pure functions (architecture §4.6,
 * "Offline").
 *
 * `sw.ts` is the worker itself; this file is what it decides, kept apart so it
 * can be tested without a worker. Both are concatenated into one classic
 * script by `sw-build.ts`, which drops the `export` keywords — so nothing in
 * here may import anything, and every name here is a global in the worker.
 *
 * The worker exists for one promise: the adventure book (`/journal`) opens
 * with no signal, on a reload as well as in a tab that was already open. That
 * needs the page, its code, the content the book reads and the map painting
 * to be on the phone. Everything the game does *online* is unchanged: the API
 * and the event stream are never touched, the page and content are always
 * fetched fresh when the network answers, and only hashed code is served from
 * the cache first.
 */

/** How one request is answered. */
export type SwStrategy =
  /** A page load: the network, or the saved page when there is none. */
  | "shell"
  /** Hashed code (`/bundle/*`): never changes, so the cache answers first. */
  | "bundle"
  /** `/content/*.json`: the network, or the saved copy when there is none. */
  | "content"
  /** Art: the saved copy at once, refreshed behind it; the network the first time. */
  | "image"
  /** Not the worker's business — the browser fetches it exactly as without one. */
  | "passthrough";

export const SW_CACHES = {
  shell: "kad-shell-v1",
  bundle: "kad-bundle-v1",
  content: "kad-content-v1",
  image: "kad-image-v1",
} as const;

/** Every page is the one app: a navigation anywhere is answered by this. */
export const SW_SHELL_KEY = "/";

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
];

/**
 * Art is kept as it is seen, so the cache grows with play. A cap keeps a phone
 * that has seen every scene from holding all of them for good; the oldest go
 * first, and anything evicted is simply fetched again next time it is online.
 */
export const SW_IMAGE_LIMIT = 400;

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
  if (IMAGE.test(path)) return "image";
  return "passthrough";
}

/** Whether a response is worth keeping: a whole, same-origin success. */
export function swCacheable(response: { ok: boolean; status: number; type: string }): boolean {
  return response.ok && response.status === 200 && response.type === "basic";
}

/**
 * Hashed code no longer in this build's list. A deploy deletes the old files
 * from the bucket too, so keeping them would only spend the phone's space.
 */
export function swStaleBundles(cached: readonly string[], current: readonly string[]): string[] {
  const keep = new Set(current);
  return cached.filter((path) => !keep.has(path));
}

/** The oldest entries to drop to get back under `limit` (cache keys are oldest first). */
export function swOverLimit<T>(keys: readonly T[], limit: number): T[] {
  return keys.length > limit ? keys.slice(0, keys.length - limit) : [];
}
