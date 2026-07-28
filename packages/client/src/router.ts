/**
 * A ~100-line history router. No dependency, because the whole route table is
 * three entries (architecture §4.6):
 *
 *   /            → home: create or join a room
 *   /tv/:code    → Party Mode WorldView. A pure display client with no
 *                  authority, refreshable at any time (spec §2.1).
 *   /p/:code     → PlayerView in Party Mode, or the stacked
 *                  WorldView+PlayerView in Travel Mode. The route does not say
 *                  which — the room's mode does, and only the layout shell
 *                  reads it.
 *
 * Paths rather than hashes because these URLs get printed into a QR code on the
 * TV, and `#` in a scanned URL is a support call waiting to happen. Vite's dev
 * server and CloudFront both fall back to index.html.
 */

import { useSyncExternalStore } from "react";

export type Route =
  | { name: "home" }
  | { name: "tv"; code: string }
  | { name: "player"; code: string }
  | { name: "notFound"; path: string };

/**
 * Room codes use an unambiguous alphabet — no I, O, 0 or 1 (architecture §4.5).
 * The router is deliberately *more* permissive than the generator: it accepts
 * any 4 alphanumerics and lets the server reject unknown codes. A kid mistyping
 * a code should get "no such room", not a blank 404 page.
 */
const ROOM_CODE = /^[A-Z0-9]{4}$/;

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isRoomCode(raw: string): boolean {
  return ROOM_CODE.test(normalizeCode(raw));
}

/** Pure: URL path (query and hash tolerated) → Route. */
export function parseRoute(input: string): Route {
  const path = stripQuery(input);
  const segments = path.split("/").filter((s) => s.length > 0).map(decodeSafe);

  const [head, second] = segments;

  if (segments.length === 0) return { name: "home" };

  if (segments.length === 2 && second !== undefined) {
    const code = normalizeCode(second);
    if (isRoomCode(code)) {
      if (head === "tv") return { name: "tv", code };
      if (head === "p") return { name: "player", code };
    }
  }

  return { name: "notFound", path: "/" + segments.join("/") };
}

/** Pure: Route → URL path. `parseRoute(formatRoute(r))` round-trips. */
export function formatRoute(route: Route): string {
  switch (route.name) {
    case "home":
      return "/";
    case "tv":
      return `/tv/${normalizeCode(route.code)}`;
    case "player":
      return `/p/${normalizeCode(route.code)}`;
    case "notFound":
      return route.path;
  }
}

/** The room code a route is attached to, if any. */
export function routeCode(route: Route): string | null {
  return route.name === "tv" || route.name === "player" ? route.code : null;
}

function stripQuery(input: string): string {
  const cut = input.search(/[?#]/);
  return cut === -1 ? input : input.slice(0, cut);
}

function decodeSafe(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

// ---------------------------------------------------------------------------
// Browser binding
// ---------------------------------------------------------------------------

const listeners = new Set<(route: Route) => void>();
let current: Route = typeof location === "undefined"
  ? { name: "home" }
  : parseRoute(location.pathname);

function emit(): void {
  for (const listener of listeners) listener(current);
}

export function currentRoute(): Route {
  return current;
}

export function navigate(to: Route | string, options: { replace?: boolean } = {}): void {
  const path = typeof to === "string" ? to : formatRoute(to);
  const next = parseRoute(path);
  if (typeof history !== "undefined") {
    if (options.replace) history.replaceState(null, "", path);
    else history.pushState(null, "", path);
  }
  current = next;
  emit();
}

export function subscribeRoute(listener: (route: Route) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    current = parseRoute(location.pathname);
    emit();
  });
}

/** Subscribe a component to the current route. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribeRoute, currentRoute, currentRoute);
}
