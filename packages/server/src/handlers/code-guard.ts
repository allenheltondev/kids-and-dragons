/**
 * Wrong room codes, counted per client — issue #267.
 *
 * A room code is the only thing between a stranger and a game of kids. Any
 * phone that names a live code can watch it (`watchRoom`), read its state
 * (`GET /api/state?code=`), or join it, and an unbound phone that joins is
 * given a player on the spot (`lambda/http.ts`, `postJoin`). Four letters from
 * `ROOM_CODE_ALPHABET` is 331,776 codes, which a script walks in minutes.
 *
 * So every route that looks a room up by code asks this file first for a
 * lookup, and gives it back when the code was real. A client that has missed
 * too many in the current window is refused **before the lookup**, whatever
 * it asks for next: answering a right code while refusing wrong ones would
 * still tell a guesser which codes are live.
 *
 * Misses, not attempts, because a family's correct joins and reconnects are
 * most of the traffic and must never be what runs a budget down. Misses also
 * come from honest places: a typo, or a phone reopening last night's room.
 * Those are a handful per evening, nowhere near the limit.
 *
 * The budget per client is `CODE_MISS_LIMIT` per `CODE_MISS_WINDOW_MS`, which
 * caps one client at under four thousand guesses a day. It is that generous
 * because a client is an address, and a school's, a library's or a hotel's
 * Wi-Fi puts every device in the building behind one: its typos and stale
 * tabs share the budget, and running it out stops every new join and every
 * TV there for the rest of the window. With 36 rooms live at once, finding
 * any one of them takes about 9,000 guesses: minutes for a script before,
 * days per address now. That raises the cost of
 * guessing; it does not make it impossible, which is why rooms open to
 * visitors are meant to get longer codes (#267, #249).
 *
 * Fixed windows rather than a sliding one: one row per client per window, one
 * read and one `ADD`. The price is that a client can spend two budgets across a
 * window boundary, which doubles a small number.
 */

import type { HandlerDeps } from "./deps.ts";

/** Wrong codes one client may ask for in a window before it is refused. */
export const CODE_MISS_LIMIT = 40;

/** 15 minutes. Long enough to stop a script, short enough to forgive a typo. */
export const CODE_MISS_WINDOW_MS = 15 * 60 * 1000;

/** The status, code and sentence a refused client gets. A phone shows the message. */
export const SLOW_DOWN = {
  status: 429,
  code: "SLOW_DOWN",
  message: "Too many wrong codes. Wait a few minutes, then try again.",
} as const;

/** Clients with no address at all share one budget, rather than having none. */
const UNKNOWN_CLIENT = "unknown";

type GuardDeps = Pick<HandlerDeps, "repo" | "now">;

/**
 * Who is asking, as the budget sees it.
 *
 * IPv4 is the address. IPv6 is its /64 prefix: a home or a phone is handed a whole
 * /64, so one address per guess would cost a guesser nothing. A NAT'd building
 * shares one IPv4 address, which is why the limit counts misses and not joins.
 */
export function clientKeyFor(address: string | undefined): string {
  const raw = (address ?? "").trim().toLowerCase();
  if (!raw) return UNKNOWN_CLIENT;

  // `::ffff:192.0.2.1` is an IPv4 client on a dual-stack socket (the dev server).
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped?.[1]) return mapped[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return raw;

  const hextets = expandIpv6(raw);
  return hextets ? `${hextets.slice(0, 4).join(":")}::/64` : UNKNOWN_CLIENT;
}

/** The current window's number. Windows are fixed slices of the clock. */
function windowAt(nowMs: number): number {
  return Math.floor(nowMs / CODE_MISS_WINDOW_MS);
}

/** Seconds until the current window closes, for a `Retry-After` header. */
export function retryAfterSeconds(nowMs: number): number {
  const closes = (windowAt(nowMs) + 1) * CODE_MISS_WINDOW_MS;
  return Math.max(1, Math.ceil((closes - nowMs) / 1000));
}

/** A lookup this client may make. Hand it back with `hit()` if the code was real. */
export interface CodeLookupTicket {
  /** The code named an open room, so it was not a guess: the lookup is given back. */
  hit(): Promise<void>;
}

/**
 * Takes one lookup from this client's budget, or `null` when it is spent.
 * Ask before every lookup by code, and call `hit()` when the code was real.
 *
 * Reserved *before* the lookup and given back after, not counted after a
 * miss: a count taken after the lookup let a burst of parallel guesses all
 * read "under the limit" first and all reach the table. A reservation is one
 * conditional write, so at most `CODE_MISS_LIMIT` lookups are ever admitted
 * at once, and a refund afterwards means a right code still costs nothing.
 */
export async function admitCodeLookup(
  clientKey: string,
  deps: GuardDeps,
): Promise<CodeLookupTicket | null> {
  const window = windowAt(deps.now());
  // The row outlives its window by one more, so a clock skewed between two
  // Lambdas never reads a window as empty that another is still counting.
  const ttl = Math.floor(((window + 2) * CODE_MISS_WINDOW_MS) / 1000);
  const admitted = await deps.repo.reserveCodeLookup(clientKey, window, CODE_MISS_LIMIT, ttl);
  if (!admitted) return null;
  return { hit: () => deps.repo.refundCodeLookup(clientKey, window) };
}

/** Eight hextets, or null for anything that is not an IPv6 address. */
function expandIpv6(raw: string): string[] | null {
  const address = raw.split("%")[0] ?? ""; // drop a zone id (`fe80::1%eth0`)
  if (!/^[0-9a-f:]+$/.test(address)) return null;

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const hextets = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (hextets.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return hextets.map((h) => h.replace(/^0+(?=.)/, ""));
}
