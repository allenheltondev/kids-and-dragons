/**
 * A ~100-line history router. No dependency, because the whole route table is
 * three entries (architecture §4.6):
 *
 *   /            → home: create or join a room
 *   /journal     → between games: study your hero, the map and the Field
 *                  Guide with nothing at stake, and join a game from there.
 *                  No room, so no code — the device binding is enough.
 *   /guide       → the grown-up's guide to running a session (#257). Needs
 *                  nothing at all, and prints.
 *   /account     → accounts and devices: sign in, move a hero between
 *                  devices, set up a family tablet or a group. A grown-up's
 *                  errands, kept off the join screen.
 *   /tv/:code    → Party Mode WorldView. A pure display client with no
 *                  authority, refreshable at any time (spec §2.1).
 *   /p/:code     → PlayerView in Party Mode, or the toggled
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
  | { name: "journal" }
  | { name: "guide" }
  | { name: "account" }
  | { name: "tv"; code: string }
  | { name: "player"; code: string }
  | { name: "notFound"; path: string };

/**
 * Room codes use an unambiguous alphabet — no I, O, 0 or 1 (architecture §4.5).
 * The router is deliberately *more* permissive than the generator: it accepts
 * any 4 alphanumerics and lets the server reject unknown codes. A kid mistyping
 * a code should get "no such room", not a blank 404 page.
 *
 * Or 6: a room open to visitors (#249) is joined from another household with
 * its visitor code, the room's four letters and two more, which is what its
 * QR carries. Once joined, a phone is on the room's own four-letter path.
 */
const ROOM_CODE = /^(?:[A-Z0-9]{4}|[A-Z0-9]{6})$/;

export const ROOM_CODE_LENGTH = 4;

export const VISITOR_CODE_LENGTH = 6;

/** A code with nothing left to type: a room's four letters, or a visitor code's six. */
export function codeComplete(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH || code.length === VISITOR_CODE_LENGTH;
}

/**
 * How many boxes the code entry draws: four, until a fifth letter says this is
 * a visitor code, and then six.
 */
export function codeSlots(code: string): number {
  return code.length > ROOM_CODE_LENGTH ? VISITOR_CODE_LENGTH : ROOM_CODE_LENGTH;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Normalize free-typed (or URL-prefilled) room-code *input*: uppercase, drop
 * anything that could never be part of a code, cap at the longest code (a
 * visitor code's six).
 *
 * Deliberately the same alphabet the router accepts — any 4 alphanumerics —
 * and not the generator's digit-free one. HomeScreen used to filter against
 * the generator alphabet, so a scanned `/p/AB1C` prefilled as "AB1C" here and
 * as "ABC" there, and the join button stayed disabled on a code the server
 * would have taken. One helper, one answer.
 */
export function normalizeCodeInput(raw: string): string {
  let out = "";
  for (const ch of raw.toUpperCase()) {
    if (/[A-Z0-9]/.test(ch) && out.length < VISITOR_CODE_LENGTH) out += ch;
  }
  return out;
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
  if (segments.length === 1 && head === "journal") return { name: "journal" };
  if (segments.length === 1 && head === "guide") return { name: "guide" };
  if (segments.length === 1 && head === "account") return { name: "account" };

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
    case "journal":
      return "/journal";
    case "guide":
      return "/guide";
    case "account":
      return "/account";
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

// ---------------------------------------------------------------------------
// Pairing links (#281)
//
// Here, with the other URL shapes the home screen reads on first paint, rather
// than in the pairing module: the home screen must read `?pair=` without
// pulling the rest of pairing into the first-paint payload.
// ---------------------------------------------------------------------------

/** Query parameter a pairing link carries. The account screen reads it and clears it. */
export const PAIR_PARAM = "pair";

/** Eight letters, as the server mints them. */
export const PAIRING_CODE_LENGTH = 8;

/** What a QR holds: the account screen with the code ready to spend, one tap away. */
export function pairingUrl(origin: string, code: string): string {
  return `${origin}/account?${PAIR_PARAM}=${encodeURIComponent(code)}`;
}

/** As typed, pasted or scanned: any case, dash or spaces dropped, capped at the code's length. */
export function normalizePairingInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, PAIRING_CODE_LENGTH);
}

/** The code a `?pair=` link carries, or `null` if the URL has none. */
export function pairingFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get(PAIR_PARAM);
  if (raw === null) return null;
  const code = normalizePairingInput(raw);
  return code === "" ? null : code;
}
