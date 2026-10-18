/**
 * The HTTP API entry point — every game route, one function.
 *
 * This is `dev-server.ts` with Express swapped for API Gateway's event shape.
 * The routes, the order of checks, and the error codes are deliberately
 * identical: the two files are the only places in the server that know about
 * HTTP, so a difference between them is a difference between what you tested on
 * a laptop and what your daughter is playing.
 *
 * One function rather than the per-route split drawn in architecture §2. The
 * split there was by route; the thing that should actually drive it is least
 * privilege, and every route here needs the same three permissions (table, key,
 * publish). Splitting anyway would buy nothing and cost cold starts on a game
 * where a two-second pause is fatal to momentum. The functions that *do* have a
 * different blast radius — the channel authorizer and the sweeper — are separate.
 */

import { timingSafeEqual } from "node:crypto";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from "aws-lambda";
import { adoptDevice, addPlayer, createGuestHousehold, linkAccount, vetTypedName } from "../handlers/account.ts";
import { applyAction } from "../handlers/action.ts";
import {
  admitCodeLookup,
  clientKeyFor,
  retryAfterSeconds,
  SLOW_DOWN,
} from "../handlers/code-guard.ts";
import { relayPreview } from "../handlers/preview.ts";
import { beatPresence } from "../handlers/presence.ts";
import type { ActionError, HandlerDeps, HandlerResult } from "../handlers/deps.ts";
import { iso, ok } from "../handlers/deps.ts";
import { admitNewPhone, bindNewPhone, createRoom, findRoom, joinRoom, settleRoom, watchRoom } from "../handlers/room.ts";
import { setVisitors } from "../handlers/visitors.ts";
import { removePlayer } from "../handlers/remove.ts";
import { closeRoom, lockRoom, setQuiet, type HostPrincipal } from "../handlers/host.ts";
import { releaseSavedHero, resumeGame, stopForToday } from "../handlers/save.ts";
import { listHeroes } from "../handlers/heroes.ts";
import { getJournal } from "../handlers/journal.ts";
import { getState } from "../handlers/state.ts";
import { organizerRoute } from "../handlers/organizer.ts";
import { isSlowDown, pairFromDevice, redeemPairingCode } from "../handlers/pairing.ts";
import {
  forgetDevice,
  listSharedPlayers,
  seatOnSharedDevice,
  shareDevice,
  tabletHost,
} from "../handlers/shared-device.ts";
import type { DeviceIdentity, SessionIdentity, SharedDeviceIdentity } from "../identity.ts";
import type { RoomMode } from "@kad/shared";
import { requiredEnv, runtime, verifyAccountToken, type VerifiedAccount } from "./runtime.ts";

/** A request, already parsed into the few things the routes actually read. */
interface Req {
  method: string;
  path: string;
  query: Record<string, string>;
  body: Record<string, unknown>;
  headers: Record<string, string>;
  /** Who is asking, as the wrong-code budget sees it (`handlers/code-guard.ts`). */
  client: string;
}

/**
 * The two things in this file that need AWS, behind an interface — the same
 * seam `channel-authorizer.ts` uses, and for the same reason. `handler()` binds
 * the real ones; `http.test.ts` binds a `makeHarness()` and a scripted verifier,
 * so every route, status code and auth check below is reachable without a
 * table, a user pool, or a signing key.
 *
 * `deps` is a *function* rather than a value on purpose: `route()` must not
 * resolve it until a path has matched, or an unknown path pays a cold start and
 * reports a configuration problem in place of its 404.
 */
export interface HttpRuntime {
  deps(): Promise<HandlerDeps>;
  verifyAccount(token: string): Promise<VerifiedAccount | null>;
  /**
   * The value CloudFront stamps on every request it forwards here, as
   * `x-kad-origin` (`infra/template.yaml`). Only a request carrying it has a
   * viewer address worth believing — see `clientOf`.
   */
  originSecret?: string | undefined;
}

const AWS_RUNTIME: HttpRuntime = {
  deps: runtime,
  verifyAccount: verifyAccountToken,
  originSecret: process.env.KAD_ORIGIN_SECRET || undefined,
};

export async function handler(
  event: APIGatewayProxyEventV2,
  _context: Context,
): Promise<APIGatewayProxyStructuredResultV2> {
  return respond(event, AWS_RUNTIME);
}

/** `handler()` with the AWS wiring passed in rather than imported. */
export async function respond(
  event: APIGatewayProxyEventV2,
  rt: HttpRuntime,
): Promise<APIGatewayProxyStructuredResultV2> {
  const req = parse(event, rt);
  try {
    return await route(req, rt);
  } catch (err) {
    // The error shape matches `ActionResponse.error` so the client has exactly
    // one parser for every failure it can see. The *message* stays generic on
    // purpose: an unexpected throw carries SDK detail and filesystem paths,
    // which belong in the log line above and nowhere a phone can see.
    console.error("[error]", req.method, req.path, err);
    return error(500, "ILLEGAL", "something went wrong on our side; try again");
  }
}

async function route(req: Req, rt: HttpRuntime): Promise<APIGatewayProxyStructuredResultV2> {
  if (req.method === "OPTIONS") return { statusCode: 204 };

  // Neither of these touches the table, the key, or the channel — so both still
  // answer when one of those is what is broken.
  if (req.method === "GET" && req.path === "/api/health") return health();
  if (req.method === "GET" && req.path === "/api/config") return config();

  const match = matchRoute(req, rt);
  if (!match) return error(404, "NOT_FOUND", `no route ${req.method} ${req.path}`);

  // Resolved *after* matching, so an unknown path never pays a cold start (or
  // reports a configuration problem in place of the 404 it should have got).
  return match(await rt.deps());
}

type Route = (deps: HandlerDeps) => Promise<APIGatewayProxyStructuredResultV2>;

function matchRoute(req: Req, rt: HttpRuntime): Route | null {
  if (req.method === "POST") {
    if (req.path === "/api/room") return (deps) => postRoom(req, deps);
    if (req.path === "/api/action") return (deps) => postAction(req, deps);
    if (req.path === "/api/preview") return (deps) => postPreview(req, deps);
    if (req.path === "/api/presence") return (deps) => postPresence(req, deps);
    if (req.path === "/api/progression/spend") return (deps) => postProgressionSpend(req, deps);
    if (req.path === "/api/resume") return (deps) => postResume(req, deps);
    if (req.path === "/api/save/release") return (deps) => postReleaseHero(req, deps);
    if (req.path === "/api/auth/link") return (deps) => postLink(req, deps, rt);
    if (req.path === "/api/auth/device") return (deps) => postAdopt(req, deps, rt);
    if (req.path === "/api/auth/shared-device") return (deps) => postShareDevice(req, deps, rt);
    if (req.path === "/api/pair/code") return (deps) => postPairCode(req, deps);
    if (req.path === "/api/pair/redeem") return (deps) => postPairRedeem(req, deps);
    if (req.path === "/api/auth/forget-device") return (deps) => postForgetDevice(req, deps, rt);

    // Four letters, or an open room's six-letter visitor code (#249).
    const join = /^\/api\/room\/([A-Za-z]{4}|[A-Za-z]{6})\/join$/.exec(req.path);
    if (join?.[1]) {
      const code = join[1].toUpperCase();
      return (deps) => postJoin(req, deps, code);
    }
    const watch = /^\/api\/room\/([A-Za-z]{4})\/watch$/.exec(req.path);
    if (watch?.[1]) {
      const code = watch[1].toUpperCase();
      return (deps) => postWatch(req, deps, code);
    }
    const remove = /^\/api\/room\/([A-Za-z]{4})\/remove$/.exec(req.path);
    if (remove?.[1]) {
      const code = remove[1].toUpperCase();
      return (deps) => postRemove(req, deps, code);
    }
    const lock = /^\/api\/room\/([A-Za-z]{4})\/lock$/.exec(req.path);
    if (lock?.[1]) {
      const code = lock[1].toUpperCase();
      return (deps) => postLock(req, deps, code);
    }
    const quiet = /^\/api\/room\/([A-Za-z]{4})\/quiet$/.exec(req.path);
    if (quiet?.[1]) {
      const code = quiet[1].toUpperCase();
      return (deps) => postQuiet(req, deps, code);
    }
    const close = /^\/api\/room\/([A-Za-z]{4})\/close$/.exec(req.path);
    if (close?.[1]) {
      const code = close[1].toUpperCase();
      return (deps) => postClose(req, deps, code);
    }
    const stop = /^\/api\/room\/([A-Za-z]{4})\/stop$/.exec(req.path);
    if (stop?.[1]) {
      const code = stop[1].toUpperCase();
      return (deps) => postStop(req, deps, code);
    }
    const visitors = /^\/api\/room\/([A-Za-z]{4})\/visitors$/.exec(req.path);
    if (visitors?.[1]) {
      const code = visitors[1].toUpperCase();
      return (deps) => postVisitors(req, deps, rt, code);
    }
  }
  if (req.method === "GET" && req.path === "/api/state") return (deps) => getStateRoute(req, deps);
  if (req.method === "GET" && req.path === "/api/heroes") return (deps) => getHeroes(req, deps);
  if (req.method === "GET" && req.path === "/api/journal") return (deps) => getJournalRoute(req, deps);
  if (req.method === "GET" && req.path === "/api/household/players") return (deps) => getSharedPlayers(req, deps);

  // A grown-up running a household or a group (#248). Signed in, always.
  const organizer = organizerRoute(req);
  if (organizer) {
    return async (deps) => {
      const account = await rt.verifyAccount(bearer(req));
      if (!account) return error(401, "FORBIDDEN", "a verified Cognito id token is required");
      const result = await organizer(account, deps);
      return result.ok ? json(200, result.value) : fromError(result.error);
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

async function postRoom(req: Req, deps: HandlerDeps) {
  const mode = readMode(req.body.mode);
  if (!mode) return error(400, "ILLEGAL", 'mode must be "party" or "travel"');
  const display = req.body.display === true;
  if (display && mode !== "party") return error(400, "ILLEGAL", "only a Party Mode room has a TV");

  // A shared tablet opens a room for whichever kid was picked on it (#250).
  const shared = await resolveShared(req, deps);
  if (shared !== undefined) return postRoomShared(req, deps, mode, display, shared);

  // Anonymous play (§4.5): a device nobody has seen before gets a household on
  // the spot. Nobody signs up to start a game.
  const existing = await resolvePrincipal(req, deps);
  const hostName = vetTypedName(req.body.displayName, "Host");
  if (!existing && !hostName.ok) return fromError(hostName.error);
  const host =
    existing ??
    (await createGuestHousehold(
      { displayName: hostName.ok ? hostName.value : "Host", userAgent: req.headers["user-agent"], display },
      deps,
    ));

  const created = await createRoom(
    {
      householdId: host.principal.householdId,
      mode,
      campaignId: (req.body.campaignId as string | null | undefined) ?? null,
      // The TV's household is a placeholder until a phone joins (RoomRecord.claimable).
      claimable: display,
      hostDeviceId: host.principal.deviceId,
    },
    deps,
  );
  if (!created.ok) return fromError(created.error);

  // The TV opened the room: it is the lobby, not a seat. It keeps the device
  // binding anyway, but only as a placeholder household — the first phone to
  // join decides whose room this is (RoomRecord.claimable).
  if (display) {
    return json(
      200,
      {
        ...created.value,
        roomCode: created.value.code,
        host: true,
        ...(host.deviceToken ? { deviceToken: host.deviceToken } : {}),
      },
      host.principal,
    );
  }

  const joined = await joinRoom({ code: created.value.code, principal: host.principal }, deps);
  if (!joined.ok) return fromError(joined.error);

  return json(
    200,
    {
      ...joined.value,
      code: created.value.code,
      roomCode: created.value.code,
      expiresAt: created.value.expiresAt,
      ...(host.deviceToken ? { deviceToken: host.deviceToken } : {}),
    },
    host.principal,
  );
}

/**
 * `POST /api/room` from a shared tablet (#250): seated as the kid it names, on
 * a session token alone. With `display` (#274) it is the TV instead: the room
 * opens under the tablet's own household with the tablet as its host, nobody
 * seated and nothing claimable, and the tablet is handed no device token and
 * no session. Its shared token is the proof of host from then on.
 */
async function postRoomShared(
  req: Req,
  deps: HandlerDeps,
  mode: RoomMode,
  display: boolean,
  shared: SharedDeviceIdentity | null,
) {
  if (!shared) return forgottenDevice();
  if (display) {
    const created = await createRoom(
      {
        householdId: shared.householdId,
        mode,
        campaignId: (req.body.campaignId as string | null | undefined) ?? null,
        hostDeviceId: shared.deviceId,
        display: true,
      },
      deps,
    );
    if (!created.ok) return fromError(created.error);
    return json(200, { ...created.value, roomCode: created.value.code, host: true }, shared);
  }
  const seat = await seatOnSharedDevice({ shared, playerId: req.body.playerId, newPlayer: req.body.newPlayer }, deps);
  if (!seat.ok) return fromError(seat.error);

  const created = await createRoom(
    {
      householdId: shared.householdId,
      mode,
      campaignId: (req.body.campaignId as string | null | undefined) ?? null,
      hostDeviceId: shared.deviceId,
    },
    deps,
  );
  if (!created.ok) return fromError(created.error);
  const joined = await joinRoom({ code: created.value.code, principal: seat.value, device: "tablet" }, deps);
  if (!joined.ok) return fromError(joined.error);
  // No `deviceToken`, ever: the kid leaves with the session and nothing else.
  return json(
    200,
    {
      ...joined.value,
      code: created.value.code,
      roomCode: created.value.code,
      expiresAt: created.value.expiresAt,
    },
    shared,
  );
}

async function postJoin(req: Req, deps: HandlerDeps, typed: string) {
  const lookup = await admitCodeLookup(req.client, deps);
  if (!lookup) return slowDown(deps);
  const named = await findRoom(typed, deps);
  if (!named) return error(404, "NOT_FOUND", `no open room ${typed}`);
  await lookup.hit();
  // The room's own four letters from here on, whichever code was typed.
  const found = named.room;
  const code = found.code;
  const visitor = named.visitorCode ? { visitorCode: named.visitorCode } : {};

  // A shared tablet seats the kid picked on it, with a session and nothing
  // longer-lived (#250). It never falls through to `addPlayer` below, which
  // would bind the tablet to that kid for a month.
  const shared = await resolveShared(req, deps);
  if (shared !== undefined) {
    if (!shared) return forgottenDevice();
    const seat = await seatOnSharedDevice({ shared, playerId: req.body.playerId, newPlayer: req.body.newPlayer }, deps);
    if (!seat.ok) return fromError(seat.error);
    const joined = await joinRoom({ code, principal: seat.value, device: "tablet", ...visitor }, deps);
    if (!joined.ok) return fromError(joined.error);
    return json(200, { ...joined.value, code, roomCode: code, expiresAt: found.expiresAt }, shared);
  }

  const existing = await resolvePrincipal(req, deps);
  // A new phone joins whichever household the room settles on — and settling
  // comes first, so a TV room another phone claimed a moment ago is joined in
  // the claimer's household rather than stranding this one in the TV's.
  const settled = existing ? ok(found) : await settleRoom(found, found.householdId, deps);
  if (!settled.ok) return fromError(settled.error);
  const room = settled.value;
  if (!room) return error(404, "NOT_FOUND", `no open room ${code}`);
  // An unbound device joining a room gets a player created for it on the spot,
  // so a phone that has never seen this game joins in one tap. On a visitor
  // code it is a visitor, in a guest household of its own (#249).
  // Never-seen phones are admitted *before* anything is bound to them
  // (`admitNewPhone`): a refused one must leave no membership behind.
  const joinerName = vetTypedName(req.body.displayName, "Player");
  if (!existing && !joinerName.ok) return fromError(joinerName.error);
  let admitted: "family" | "visitor" | null = null;
  if (!existing) {
    const admission = await admitNewPhone(room, named.visitorCode, deps);
    if (!admission.ok) return fromError(admission.error);
    admitted = admission.value;
  }
  const joiner =
    existing ??
    (await bindNewPhone(
      room,
      admitted ?? "family",
      { displayName: joinerName.ok ? joinerName.value : "Player", userAgent: req.headers["user-agent"] },
      deps,
    ));

  const joined = await joinRoom({ code, principal: joiner.principal, ...visitor }, deps);
  if (!joined.ok) return fromError(joined.error);

  return json(
    200,
    {
      ...joined.value,
      code,
      roomCode: code,
      expiresAt: room.expiresAt,
      ...(joiner.deviceToken ? { deviceToken: joiner.deviceToken } : {}),
    },
    joiner.principal,
  );
}

/** The TV attaching. No device, no player, no sign-in — see `watchRoom`. */
async function postWatch(req: Req, deps: HandlerDeps, code: string) {
  const lookup = await admitCodeLookup(req.client, deps);
  if (!lookup) return slowDown(deps);
  // Optional: a TV that opened the room presents its binding to learn it is the
  // host: its device token, or a family tablet's shared token (#274). A tablet
  // whose binding is gone is told so rather than watched as a stranger.
  const tablet = await resolveShared(req, deps);
  if (tablet === null) return forgottenDevice();
  const screen = tablet ? null : await resolvePrincipal(req, deps);
  const result = await watchRoom(
    { code, deviceId: tablet?.deviceId ?? screen?.principal.deviceId, ...(tablet ? { householdId: tablet.householdId } : {}) },
    deps,
  );
  if (result.ok || result.error.code !== "NOT_FOUND") await lookup.hit();
  // The answer is a viewer token whoever asked; a tablet's own token is only renewed.
  return result.ok ? json(200, result.value, tablet ?? undefined) : fromError(result.error);
}

/**
 * What a host control does once its host is known (#263, #267). It answers
 * with the run's seq, as every control is one committed change to the run.
 */
type HostAct = (principal: HostPrincipal) => Promise<HandlerResult<{ seq: number }>>;

/**
 * Remove, lock and close: the room's host, proved by a phone's device token,
 * or by a shared tablet's token with its seated player's session (#250). The
 * body is checked only once the host is, so a stranger learns nothing from
 * it. Each looks a room up by code, so each spends the wrong-code budget.
 */
async function postHostControl(
  req: Req,
  deps: HandlerDeps,
  code: string,
  invalid: string | null,
  act: HostAct,
) {
  const shared = await resolveShared(req, deps);
  if (shared === null) return forgottenDevice();
  let principal: HostPrincipal;
  // Whose renewed token, if any, rides back on the answer.
  let asker: DeviceIdentity | SharedDeviceIdentity;
  if (shared) {
    asker = shared;
    const seat = tabletHost(shared, await resolveSession(req, deps), code, await deps.repo.getRoom(code));
    if (!seat.ok) return error(401, seat.error.code, seat.error.message);
    principal = seat.value;
  } else {
    const host = await resolvePrincipal(req, deps);
    if (!host) return error(401, "FORBIDDEN", "running this room needs the device that opened it");
    principal = host.principal;
    asker = host.principal;
  }
  if (invalid !== null) return error(400, "ILLEGAL", invalid);
  const lookup = await admitCodeLookup(req.client, deps);
  if (!lookup) return slowDown(deps);
  const result = await act(principal);
  const missed = !result.ok && result.error.code === "NOT_FOUND" && result.error.message.startsWith("no open room");
  if (!missed) await lookup.hit();
  if (result.ok) return json(200, { ok: true, seq: result.value.seq }, asker);
  return fromError(result.error);
}

/** The host taking a player out (#267). */
async function postRemove(req: Req, deps: HandlerDeps, code: string) {
  const playerId = req.body.playerId;
  const valid = typeof playerId === "string" && playerId !== "";
  return postHostControl(req, deps, code, valid ? null : "expected { playerId }", (principal) =>
    removePlayer({ code, principal, playerId: playerId as string }, deps),
  );
}

/** The host locking the room to new joins, or opening it again (#263). */
async function postLock(req: Req, deps: HandlerDeps, code: string) {
  const locked = req.body.locked;
  const valid = typeof locked === "boolean";
  return postHostControl(req, deps, code, valid ? null : "expected { locked: true | false }", (principal) =>
    lockRoom({ code, principal, locked: locked as boolean }, deps),
  );
}

/**
 * A signed-in owner opening the room to visitors, or closing it to new ones
 * (#249, handlers/visitors.ts). An owner, not the host: it lowers the barrier
 * to joining. Looks a room up by code, so it spends the wrong-code budget.
 */
async function postVisitors(req: Req, deps: HandlerDeps, rt: HttpRuntime, code: string) {
  const account = await rt.verifyAccount(bearer(req));
  if (!account) return error(401, "FORBIDDEN", "a verified Cognito id token is required");
  if (typeof req.body.open !== "boolean") return error(400, "ILLEGAL", "expected { open: true | false }");
  const lookup = await admitCodeLookup(req.client, deps);
  if (!lookup) return slowDown(deps);
  const result = await setVisitors({ cognitoSub: account.cognitoSub, email: account.email, code, open: req.body.open }, deps);
  const missed = !result.ok && result.error.code === "NOT_FOUND" && result.error.message.startsWith("no open room");
  if (!missed) await lookup.hit();
  return result.ok ? json(200, result.value) : fromError(result.error);
}

/** The host turning quiet mode on for the room, or off again (#260). */
async function postQuiet(req: Req, deps: HandlerDeps, code: string) {
  const quiet = req.body.quiet;
  const valid = typeof quiet === "boolean";
  return postHostControl(req, deps, code, valid ? null : "expected { quiet: true | false }", (principal) =>
    setQuiet({ code, principal, quiet: quiet as boolean }, deps),
  );
}

/** The host closing the room for everyone (#263). */
async function postClose(req: Req, deps: HandlerDeps, code: string) {
  return postHostControl(req, deps, code, null, (principal) => closeRoom({ code, principal }, deps));
}

/**
 * The host saving the chapter and closing the room, to pick it up another day
 * (#259, handlers/save.ts).
 */
async function postStop(req: Req, deps: HandlerDeps, code: string) {
  return postHostControl(req, deps, code, null, (principal) => stopForToday({ code, principal }, deps));
}

/**
 * The host of a stopped game letting a hero go from it (#259). The device
 * token, not a session: the room is closed. A personal device only; the
 * hero's own grown-up uses the organizer screen.
 */
async function postReleaseHero(req: Req, deps: HandlerDeps) {
  const { characterId, homeHouseholdId } = req.body;
  if (typeof characterId !== "string" || characterId === "") return error(400, "ILLEGAL", "expected { characterId }");
  if (homeHouseholdId !== undefined && typeof homeHouseholdId !== "string") {
    return error(400, "ILLEGAL", "homeHouseholdId must be a string");
  }
  const host = await resolvePrincipal(req, deps);
  if (!host) return error(401, "FORBIDDEN", "letting a hero go needs the device that stopped the game");
  const result = await releaseSavedHero(
    {
      deviceId: host.principal.deviceId,
      householdId: host.principal.householdId,
      characterId,
      ...(homeHouseholdId ? { homeHouseholdId } : {}),
    },
    deps,
  );
  return result.ok ? json(200, { ok: true, left: result.value.left }, host.principal) : fromError(result.error);
}

/**
 * A seated phone taking the household's saved chapter into this room (#259).
 * Session token only, so a phone can keep going for nobody but its own seat.
 */
async function postResume(req: Req, deps: HandlerDeps) {
  const session = await resolveSession(req, deps);
  if (!session) return error(401, "FORBIDDEN", "keeping going needs a room session token");
  const result = await resumeGame(
    { runId: session.runId, playerId: session.playerId, householdId: session.householdId },
    deps,
  );
  return result.ok ? json(200, { ok: true, seq: result.value.seq }) : fromError(result.error);
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

async function postAction(req: Req, deps: HandlerDeps) {
  const { runId, playerId, seq, intent } = req.body as {
    runId?: unknown;
    playerId?: unknown;
    seq?: unknown;
    intent?: unknown;
  };
  if (typeof runId !== "string" || typeof playerId !== "string" || !intent) {
    return error(400, "ILLEGAL", "expected { runId, playerId, seq, intent }");
  }

  const session = await resolveSession(req, deps);
  if (session && session.runId !== runId) {
    return error(403, "FORBIDDEN", "that session belongs to another run");
  }
  const resolved = session ? null : await resolvePrincipal(req, deps);
  const principal =
    (session
      ? { householdId: session.householdId, playerId: session.playerId }
      : undefined) ?? resolved?.principal;

  /*
   * No principal, no action. Binding the token when one is *present* is not
   * enough: omitting it entirely would fall through to trusting the body's
   * playerId, and party player ids are in the room state every client holds.
   */
  if (!principal) return error(401, "FORBIDDEN", "this action needs a room session token");

  const response = await applyAction(
    { runId, playerId, seq: Number(seq ?? 0), intent: intent as never, principal },
    deps,
  );
  // A rejection is part of the protocol, not an HTTP failure: the client reads
  // `error.code` and resyncs. 200 keeps that path free of fetch() error
  // handling on a phone with a flaky connection.
  return json(200, response, resolved?.principal);
}

/**
 * A tap that has not been confirmed yet (handlers/preview.ts). Session token
 * only: the seat comes from the token, so the body cannot light up somebody
 * else's choice on the TV.
 */
async function postPreview(req: Req, deps: HandlerDeps) {
  const session = await resolveSession(req, deps);
  if (!session) return error(401, "FORBIDDEN", "a preview needs a room session token");
  const result = await relayPreview(
    {
      runId: session.runId,
      playerId: session.playerId,
      householdId: session.householdId,
      preview: req.body.preview,
      context: req.body.context,
    },
    deps,
  );
  if (!result.ok) return error(result.status, result.code, result.message);
  return json(200, { ok: true });
}

/**
 * A seated phone saying it is still here, or that it is leaving
 * (handlers/presence.ts). The only presence production has: AppSync Events
 * tells this Lambda nothing when a socket closes (#258). Session token only,
 * so a phone can speak for nobody but itself.
 */
async function postPresence(req: Req, deps: HandlerDeps) {
  const session = await resolveSession(req, deps);
  if (!session) return error(401, "FORBIDDEN", "presence needs a room session token");
  const result = await beatPresence(
    {
      runId: session.runId,
      playerId: session.playerId,
      householdId: session.householdId,
      leaving: req.body.leaving === true,
    },
    deps,
  );
  if (!result.ok) return error(result.status, result.code, result.message);
  return json(200, { ok: true, connected: result.connected });
}

async function postProgressionSpend(req: Req, deps: HandlerDeps) {
  const session = await resolveSession(req, deps);
  if (!session) {
    return error(401, "FORBIDDEN", "spending a stat point needs a room session token");
  }
  if (!Object.prototype.hasOwnProperty.call(req.body, "stat")) {
    return error(400, "ILLEGAL", "expected { stat }");
  }

  const state = await deps.repo.getState(session.runId);
  const response = await applyAction(
    {
      runId: session.runId,
      playerId: session.playerId,
      seq: Number(req.body.seq ?? state?.seq ?? 0),
      intent: { type: "SPEND_STAT_POINT", stat: req.body.stat as never },
      principal: {
        householdId: session.householdId,
        playerId: session.playerId,
      },
    },
    deps,
  );
  return json(200, response);
}

/** This player's saved characters, to bring one back instead of making one. */
async function getHeroes(req: Req, deps: HandlerDeps) {
  const session = await resolveSession(req, deps);
  if (!session) return error(401, "FORBIDDEN", "listing heroes needs a room session token");
  const result = await listHeroes({ householdId: session.householdId, playerId: session.playerId }, deps);
  return result.ok ? json(200, result.value) : fromError(result.error);
}

/**
 * What this phone can study between games (handlers/journal.ts). The device
 * token, not a session: there is no room to have a session in.
 */
async function getJournalRoute(req: Req, deps: HandlerDeps) {
  const found = await resolvePrincipal(req, deps);
  if (!found) return error(401, "FORBIDDEN", "the journal needs this device's token");
  const { principal } = found;
  const result = await getJournal({ householdId: principal.householdId, playerId: principal.playerId }, deps);
  return result.ok ? json(200, result.value, principal) : fromError(result.error);
}

async function getStateRoute(req: Req, deps: HandlerDeps) {
  let runId = req.query.runId ?? "";
  const code = (req.query.code ?? "").toUpperCase();
  if (!runId && !code) return error(400, "ILLEGAL", "runId or code is required");

  /*
   * The room is what expires, not the run. Whenever a caller names a code — and
   * a stored session always does — the room has to still be open, even if the
   * caller also knows the runId. Skipping that restores a session whose channel
   * subscription is dead and whose token has expired, leaving a phone showing an
   * old game it cannot play instead of saying the room is gone.
   */
  /*
   * Only somebody in the room may read it (#267): a seated phone's session
   * token, or the host screen's viewer token, naming this run. Without one the
   * answer is the one an unknown code gets, so this route says nothing about
   * which codes are live and needs no wrong-code budget. A code alone used to
   * be enough, which let anyone with it read the party's names and every move
   * without ever showing up in the room.
   */
  const reader = await roomReader(req, deps);
  const named = code ? `no open room ${code}` : `no run ${runId}`;
  if (!reader) return error(404, "NOT_FOUND", named);
  if ((code && reader.roomCode.toUpperCase() !== code) || (runId && reader.runId !== runId)) {
    return error(404, "NOT_FOUND", named);
  }
  if (!runId) runId = reader.runId;

  if (code) {
    const room = await deps.repo.getRoom(code);
    if (!room) return error(404, "NOT_FOUND", `no open room ${code}`);
    if (runId && room.runId !== runId) {
      return error(404, "NOT_FOUND", `room ${code} is not that run`);
    }
    runId = room.runId;
  }

  const raw = req.query.sinceSeq;
  const result = await getState(
    {
      runId,
      ...(raw ? { sinceSeq: Number(raw) } : {}),
      ...("playerId" in reader ? { playerId: reader.playerId, householdId: reader.householdId } : {}),
    },
    deps,
  );
  return result.ok ? json(200, result.value) : fromError(result.error);
}

// ---------------------------------------------------------------------------
// Optional sign-in
// ---------------------------------------------------------------------------

async function postLink(req: Req, deps: HandlerDeps, rt: HttpRuntime) {
  const account = await rt.verifyAccount(bearer(req));
  if (!account) return error(401, "FORBIDDEN", "a verified Cognito id token is required");

  const existing = await resolvePrincipal(req, deps);
  const result = await linkAccount(
    {
      cognitoSub: account.cognitoSub,
      email: account.email,
      principal: existing?.principal ?? null,
      preferExisting: req.body.preferExisting === true,
      householdId: typeof req.body.householdId === "string" ? req.body.householdId : undefined,
    },
    deps,
  );
  return result.ok ? json(200, result.value, existing?.principal) : fromError(result.error);
}

/**
 * A signed-in owner makes this device the household's shared tablet (#250).
 * Whatever binding it held, personal or shared, is revoked on the way.
 */
async function postShareDevice(req: Req, deps: HandlerDeps, rt: HttpRuntime) {
  const account = await rt.verifyAccount(bearer(req));
  if (!account) return error(401, "FORBIDDEN", "a verified Cognito id token is required");

  const existing = await resolvePrincipal(req, deps);
  const shared = await resolveShared(req, deps);
  const result = await shareDevice(
    {
      cognitoSub: account.cognitoSub,
      principal: existing?.principal ?? null,
      shared: shared ?? null,
      userAgent: req.headers["user-agent"],
      householdId: typeof req.body.householdId === "string" ? req.body.householdId : undefined,
    },
    deps,
  );
  return result.ok ? json(200, result.value) : fromError(result.error);
}

/**
 * "Forget this device" (#250): an owner revokes a shared tablet. The tablet's
 * own token names it; `{ deviceId }` names one that is not in hand.
 */
async function postForgetDevice(req: Req, deps: HandlerDeps, rt: HttpRuntime) {
  const account = await rt.verifyAccount(bearer(req));
  if (!account) return error(401, "FORBIDDEN", "a verified Cognito id token is required");

  const shared = await resolveShared(req, deps);
  const deviceId = shared?.deviceId ?? req.body.deviceId;
  if (typeof deviceId !== "string" || deviceId === "") {
    return error(400, "ILLEGAL", "expected this tablet's x-kad-shared-token, or { deviceId }");
  }
  const result = await forgetDevice({ cognitoSub: account.cognitoSub, deviceId }, deps);
  return result.ok ? json(200, result.value) : fromError(result.error);
}

/** The "who's playing?" picker on a shared tablet (#250). Its token, nothing else. */
async function getSharedPlayers(req: Req, deps: HandlerDeps) {
  const shared = await resolveShared(req, deps);
  if (!shared) return forgottenDevice();
  const result = await listSharedPlayers(shared, deps);
  return result.ok ? json(200, result.value, shared) : fromError(result.error);
}

/**
 * "Play as me on another device" (#281): her own phone asks for a one-time
 * code. A personal device token only: a shared tablet is nobody, so it is
 * told so rather than treated as unbound.
 */
async function postPairCode(req: Req, deps: HandlerDeps) {
  const found = await resolvePrincipal(req, deps);
  if (!found) {
    if (req.headers["x-kad-shared-token"]) {
      return error(403, "FORBIDDEN", "A shared tablet isn't one kid. Ask a grown-up to make the code.");
    }
    return error(401, "FORBIDDEN", "Only a device that is already her can make a code.");
  }
  const result = await pairFromDevice(found.principal, deps);
  return result.ok ? json(200, result.value, found.principal) : fromError(result.error);
}

/**
 * The new device redeems a code. No sign-in: the code is the credential.
 * A token the device already holds, if it still resolves, is the binding that
 * gets replaced.
 */
async function postPairRedeem(req: Req, deps: HandlerDeps) {
  const previous = await resolvePrincipal(req, deps);
  const result = await redeemPairingCode(
    { code: req.body.code, client: req.client, userAgent: req.headers["user-agent"], previous: previous?.principal },
    deps,
  );
  if (isSlowDown(result)) return slowDown(deps);
  return result.ok ? json(200, result.value) : fromError(result.error);
}

async function postAdopt(req: Req, deps: HandlerDeps, rt: HttpRuntime) {
  const account = await rt.verifyAccount(bearer(req));
  if (!account) return error(401, "FORBIDDEN", "a verified Cognito id token is required");

  const { householdId, playerId } = req.body as { householdId?: unknown; playerId?: unknown };
  if (typeof householdId !== "string" || typeof playerId !== "string") {
    return error(400, "ILLEGAL", "expected { householdId, playerId }");
  }

  const result = await adoptDevice(
    {
      cognitoSub: account.cognitoSub,
      householdId,
      playerId,
      userAgent: req.headers["user-agent"],
    },
    deps,
  );
  return result.ok ? json(200, result.value) : fromError(result.error);
}

// ---------------------------------------------------------------------------
// Unauthenticated
// ---------------------------------------------------------------------------

/**
 * What the client needs to reach the realtime channel and the user pool.
 *
 * Served rather than baked into the bundle so the same built artifact can be
 * deployed to a second stack without a rebuild — and so that rotating any of it
 * is a stack update rather than a redeploy of the SPA.
 */
function config(): APIGatewayProxyStructuredResultV2 {
  return json(200, {
    region: requiredEnv("AWS_REGION"),
    realtime: {
      httpDomain: requiredEnv("APPSYNC_HTTP_DOMAIN"),
      realtimeDomain: requiredEnv("APPSYNC_REALTIME_DOMAIN"),
      namespace: "room",
    },
    auth: {
      userPoolId: requiredEnv("USER_POOL_ID"),
      clientId: requiredEnv("USER_POOL_CLIENT_ID"),
    },
  });
}

/** Deliberately does not touch the table — it must answer when the table cannot. */
function health(): APIGatewayProxyStructuredResultV2 {
  return json(200, { ok: true, service: "kad-api", time: iso(Date.now()) });
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function parse(event: APIGatewayProxyEventV2, rt: HttpRuntime): Req {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers[key.toLowerCase()] = value;
  }

  let body: Record<string, unknown> = {};
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
    } catch {
      // A malformed body is an empty body; the route's own validation then
      // produces a message about what it actually wanted.
    }
  }

  return {
    client: clientOf(headers, event.requestContext.http.sourceIp, rt),
    method: event.requestContext.http.method,
    // `rawPath` includes the stage prefix on a non-default stage; the stack
    // deploys to `$default`, so it does not here.
    path: event.rawPath,
    query: (event.queryStringParameters ?? {}) as Record<string, string>,
    body,
    headers,
  };
}

/** Header first, body second — a real client always sends the header. */
async function resolvePrincipal(
  req: Req,
  deps: HandlerDeps,
): Promise<{ principal: DeviceIdentity; deviceToken?: string } | null> {
  const token = req.headers["x-kad-device-token"] ?? req.body.deviceToken;
  if (typeof token !== "string" || token === "") return null;
  const principal = await deps.identity.resolveDevice(token);
  return principal ? { principal } : null;
}

/**
 * A shared tablet's token (#250): `undefined` when the request carries none,
 * `null` when it carries one that no longer resolves (forgotten, or never
 * real). The difference matters: a forgotten tablet must be told so, never
 * quietly treated as a new phone and bound to whoever is holding it.
 */
async function resolveShared(req: Req, deps: HandlerDeps): Promise<SharedDeviceIdentity | null | undefined> {
  const token = req.headers["x-kad-shared-token"];
  if (typeof token !== "string" || token === "") return undefined;
  return deps.identity.resolveSharedDevice(token);
}

/** What a shared tablet whose binding is gone is told. The client goes back to an ordinary start. */
function forgottenDevice(): APIGatewayProxyStructuredResultV2 {
  return error(401, "FORBIDDEN", "This tablet was forgotten. Ask a grown-up to set it up again.");
}

/**
 * Who is asking, for the wrong-code budget (`handlers/code-guard.ts`).
 *
 * Behind CloudFront, the connection's address is an edge's, shared by everyone
 * near it. So CloudFront writes the viewer's own address into `x-kad-viewer`,
 * overwriting anything the viewer sent (`infra/template.yaml`,
 * ViewerAddressFunction).
 *
 * But the HTTP API also answers on its own `execute-api` address, where a
 * caller can send any `x-kad-viewer` it likes, a new one per guess. So the
 * header counts only alongside `x-kad-origin`, a secret CloudFront adds to
 * everything it forwards. Without it, the connection's address is used, and
 * for a direct caller that *is* the caller, which it cannot change per request.
 */
function clientOf(
  headers: Record<string, string>,
  sourceIp: string | undefined,
  rt: HttpRuntime,
): string {
  const viewer = headers["x-kad-viewer"];
  // Fail closed: with no secret configured there is nothing to vouch for the
  // header, so it is never believed (a stage deployed without the variable
  // must not hand every direct caller a fresh budget per request).
  if (viewer && rt.originSecret !== undefined && sameSecret(headers["x-kad-origin"], rt.originSecret)) {
    return clientKeyFor(viewer);
  }
  return clientKeyFor(sourceIp);
}

function sameSecret(sent: string | undefined, expected: string): boolean {
  const a = Buffer.from(sent ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The room a request's session or viewer token was issued for, if it carries one. */
async function roomReader(
  req: Req,
  deps: HandlerDeps,
): Promise<{ runId: string; roomCode: string; playerId?: string; householdId?: string } | null> {
  const token = bearer(req) || (typeof req.query.token === "string" ? req.query.token : "");
  if (!token) return null;
  return (await deps.identity.resolveSession(token)) ?? (await deps.identity.resolveViewer(token));
}

/** The room-scoped token issued at join. This is what authenticates play. */
async function resolveSession(req: Req, deps: HandlerDeps): Promise<SessionIdentity | null> {
  const token =
    bearer(req) ||
    (typeof req.query.token === "string" ? req.query.token : "") ||
    (typeof req.body.sessionToken === "string" ? req.body.sessionToken : "");
  if (!token) return null;
  return deps.identity.resolveSession(token);
}

function bearer(req: Req): string {
  const header = req.headers.authorization ?? "";
  return /^Bearer\s+(.+)$/i.exec(header.trim())?.[1] ?? "";
}

function readMode(value: unknown): RoomMode | null {
  return value === "party" || value === "travel" ? value : null;
}

/**
 * `principal` is passed in only so a rotated device token can ride back on the
 * response. A phone that is never told about its new token eventually expires
 * while being used every week (§4.5), and this is the one place that can tell it.
 */
function json(
  statusCode: number,
  body: unknown,
  principal?: DeviceIdentity | SharedDeviceIdentity | undefined,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...(principal?.rotatedToken ? { [rotationHeader(principal)]: principal.rotatedToken } : {}),
    },
    body: JSON.stringify(body),
  };
}

/** A shared tablet's renewed token rides on its own header, never the player one. */
function rotationHeader(principal: DeviceIdentity | SharedDeviceIdentity): string {
  return "kind" in principal ? "x-kad-shared-token" : "x-kad-device-token";
}

function error(
  statusCode: number,
  code: ActionError["code"] | typeof SLOW_DOWN.code,
  message: string,
): APIGatewayProxyStructuredResultV2 {
  return json(statusCode, { ok: false, error: { code, message } });
}

/** Refused by the wrong-code budget (`handlers/code-guard.ts`). */
function slowDown(deps: HandlerDeps): APIGatewayProxyStructuredResultV2 {
  const refused = error(SLOW_DOWN.status, SLOW_DOWN.code, SLOW_DOWN.message);
  return {
    ...refused,
    headers: { ...refused.headers, "retry-after": String(retryAfterSeconds(deps.now())) },
  };
}

function fromError(err: ActionError): APIGatewayProxyStructuredResultV2 {
  return error(statusFor(err), err.code, err.message);
}

function statusFor(err: ActionError): number {
  switch (err.code) {
    case "NOT_FOUND":
      return 404;
    case "FORBIDDEN":
      return 403;
    case "STALE_SEQ":
    case "ILLEGAL":
    case "HERO_BUSY":
      return 409;
  }
}
