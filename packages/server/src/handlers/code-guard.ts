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

/**
 * Takes one crash report from this client's budget, or says it is spent (#317).
 *
 * The same limit, window, client key and row as the wrong-code budget, under
 * a key of its own: a page stuck in an error loop must not be what stops a
 * school's Wi-Fi from joining a room. Nothing is handed back, because every
 * report costs, whatever it says.
 */
export function admitClientError(clientKey: string, deps: GuardDeps): Promise<boolean> {
  const window = windowAt(deps.now());
  const ttl = Math.floor(((window + 2) * CODE_MISS_WINDOW_MS) / 1000);
  return deps.repo.reserveCodeLookup(`report#${clientKey}`, window, CODE_MISS_LIMIT, ttl);
}

/**
 * Rooms one address may open in a window, from devices nobody has seen before.
 *
 * Opening a room with no device token makes a household, a player, a device,
 * a run and a room, and nothing else in the API writes that much for a
 * stranger. Unbounded, one script fills the table and the room-code space.
 *
 * A device is new exactly once: its first room hands it a token, and every
 * room after that is a known device's. So this counts first evenings at one
 * address, and twenty of those in fifteen minutes is a school hall, not a home.
 */
export const ROOM_OPEN_NEW_LIMIT = 20;

/**
 * Rooms one address may open in a window from devices that are already known
 * (and from shared tablets). Counted too, because a device token costs one
 * anonymous room, so "known" is not a promise of good faith. A budget of its
 * own, so strangers on a shared address spending the one above never stop a
 * family that is already playing from starting another game.
 */
export const ROOM_OPEN_KNOWN_LIMIT = 120;

/** What a refused opener is told. The status and code are `SLOW_DOWN`'s. */
export const TOO_MANY_ROOMS = "Too many new games from here just now. Wait a few minutes, then try again.";

/**
 * This machine talking to itself: the dev server's own browser tabs, the
 * end-to-end suite and the load smoke test, which between them open hundreds
 * of rooms a minute from one address. Production never sees these keys: an
 * address there comes from CloudFront or API Gateway, and neither reports
 * loopback. `::1` arrives here as its /64.
 */
const LOOPBACK_CLIENTS: ReadonlySet<string> = new Set(["127.0.0.1", "0:0:0:0::/64"]);

/**
 * Takes one room from this client's budget, or says it is spent. Ask after
 * the request is known to be well formed and before anything is written.
 * Nothing is handed back: every room opened costs, whatever becomes of it.
 */
export function admitRoomOpen(clientKey: string, opener: "new" | "known", deps: GuardDeps): Promise<boolean> {
  if (LOOPBACK_CLIENTS.has(clientKey)) return Promise.resolve(true);
  const window = windowAt(deps.now());
  const ttl = Math.floor(((window + 2) * CODE_MISS_WINDOW_MS) / 1000);
  const limit = opener === "new" ? ROOM_OPEN_NEW_LIMIT : ROOM_OPEN_KNOWN_LIMIT;
  return deps.repo.reserveCodeLookup(`open#${opener}#${clientKey}`, window, limit, ttl);
}

/**
 * Sign-ins one address may start in a window (`POST /api/auth/start`).
 *
 * Starting one makes an account for an address that has none, so unbounded it
 * is a way to fill the pool with other people's addresses. A family signs in
 * once per device and then stays signed in; twenty in fifteen minutes is every
 * phone in a large household, twice.
 */
export const SIGN_IN_START_LIMIT = 20;

/** What a refused starter is told. The status and code are `SLOW_DOWN`'s. */
export const TOO_MANY_SIGN_INS = "Too many sign-in tries from here just now. Wait a few minutes, then try again.";

/** Takes one sign-in start from this client's budget, or says it is spent. Nothing is handed back. */
export function admitSignInStart(clientKey: string, deps: GuardDeps): Promise<boolean> {
  const window = windowAt(deps.now());
  const ttl = Math.floor(((window + 2) * CODE_MISS_WINDOW_MS) / 1000);
  return deps.repo.reserveCodeLookup(`signin#${clientKey}`, window, SIGN_IN_START_LIMIT, ttl);
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
