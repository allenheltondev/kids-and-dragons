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
import { adoptDevice, addPlayer, createGuestHousehold, linkAccount } from "../handlers/account.ts";
import { applyAction } from "../handlers/action.ts";
import {
  admitCodeLookup,
  clientKeyFor,
  retryAfterSeconds,
  SLOW_DOWN,
} from "../handlers/code-guard.ts";
import { relayPreview } from "../handlers/preview.ts";
import type { ActionError, HandlerDeps } from "../handlers/deps.ts";
import { iso, ok } from "../handlers/deps.ts";
import { createRoom, joinRoom, settleRoom, watchRoom } from "../handlers/room.ts";
import { removePlayer } from "../handlers/remove.ts";
import { listHeroes } from "../handlers/heroes.ts";
import { getJournal } from "../handlers/journal.ts";
import { getState } from "../handlers/state.ts";
import type { DeviceIdentity, SessionIdentity } from "../identity.ts";
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
    if (req.path === "/api/progression/spend") return (deps) => postProgressionSpend(req, deps);
    if (req.path === "/api/auth/link") return (deps) => postLink(req, deps, rt);
    if (req.path === "/api/auth/device") return (deps) => postAdopt(req, deps, rt);

    const join = /^\/api\/room\/([A-Za-z]{4})\/join$/.exec(req.path);
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
  }
  if (req.method === "GET" && req.path === "/api/state") return (deps) => getStateRoute(req, deps);
  if (req.method === "GET" && req.path === "/api/heroes") return (deps) => getHeroes(req, deps);
  if (req.method === "GET" && req.path === "/api/journal") return (deps) => getJournalRoute(req, deps);
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

  // Anonymous play (§4.5): a device nobody has seen before gets a household on
  // the spot. Nobody signs up to start a game.
  const existing = await resolvePrincipal(req, deps);
  const host =
    existing ??
    (await createGuestHousehold(
      { displayName: String(req.body.displayName ?? "Host"), userAgent: req.headers["user-agent"] },
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

async function postJoin(req: Req, deps: HandlerDeps, code: string) {
  const lookup = await admitCodeLookup(req.client, deps);
  if (!lookup) return slowDown(deps);
  const found = await deps.repo.getRoom(code);
  if (!found) return error(404, "NOT_FOUND", `no open room ${code}`);
  await lookup.hit();

  const existing = await resolvePrincipal(req, deps);
  // A new phone joins whichever household the room settles on — and settling
  // comes first, so a TV room another phone claimed a moment ago is joined in
  // the claimer's household rather than stranding this one in the TV's.
  const settled = existing ? ok(found) : await settleRoom(found, found.householdId, deps);
  if (!settled.ok) return fromError(settled.error);
  const room = settled.value;
  if (!room) return error(404, "NOT_FOUND", `no open room ${code}`);
  // An unbound device joining a room gets a player created for it on the spot,
  // so a phone that has never seen this game joins in one tap.
  const joiner =
    existing ??
    (await addPlayer(
      {
        householdId: room.householdId,
        displayName: String(req.body.displayName ?? "Player"),
        role: req.body.role === "child" ? "child" : "adult",
        userAgent: req.headers["user-agent"],
      },
      deps,
    ));

  const joined = await joinRoom({ code, principal: joiner.principal }, deps);
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
  // Optional: a TV that opened the room presents its binding to learn it is the host.
  const screen = await resolvePrincipal(req, deps);
  const result = await watchRoom({ code, deviceId: screen?.principal.deviceId }, deps);
  if (result.ok || result.error.code !== "NOT_FOUND") await lookup.hit();
  return result.ok ? json(200, result.value) : fromError(result.error);
}

/** The host taking a player out (#267). Device token only: it names the host. */
async function postRemove(req: Req, deps: HandlerDeps, code: string) {
  const host = await resolvePrincipal(req, deps);
  if (!host) return error(401, "FORBIDDEN", "taking someone out needs this device's token");
  const playerId = req.body.playerId;
  if (typeof playerId !== "string" || playerId === "") {
    return error(400, "ILLEGAL", "expected { playerId }");
  }
  const lookup = await admitCodeLookup(req.client, deps);
  if (!lookup) return slowDown(deps);
  const result = await removePlayer({ code, principal: host.principal, playerId }, deps);
  const missed = !result.ok && result.error.code === "NOT_FOUND" && result.error.message.startsWith("no open room");
  if (!missed) await lookup.hit();
  if (result.ok) return json(200, { ok: true, seq: result.value.seq }, host.principal);
  return fromError(result.error);
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
      ? { householdId: session.householdId, playerId: session.playerId, role: session.role }
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
    { runId: session.runId, playerId: session.playerId, preview: req.body.preview, context: req.body.context },
    deps,
  );
  if (!result.ok) return error(result.status, result.code, result.message);
  return json(200, { ok: true });
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
        role: session.role,
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
  if (code) {
    // A phone or a TV already seated in this room is not guessing, and the
    // reconnect path must not pay for the guard on every resync.
    const seated = await holdsRoom(req, deps, code);
    const lookup = seated ? null : await admitCodeLookup(req.client, deps);
    if (!seated && !lookup) return slowDown(deps);
    const room = await deps.repo.getRoom(code);
    if (!room) return error(404, "NOT_FOUND", `no open room ${code}`);
    await lookup?.hit();
    if (runId && room.runId !== runId) {
      return error(404, "NOT_FOUND", `room ${code} is not that run`);
    }
    runId = room.runId;
  }

  const raw = req.query.sinceSeq;
  const result = await getState(
    { runId, ...(raw ? { sinceSeq: Number(raw) } : {}) },
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
    },
    deps,
  );
  return result.ok ? json(200, result.value, existing?.principal) : fromError(result.error);
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

/** Does the request carry a session or viewer token for this room? */
async function holdsRoom(req: Req, deps: HandlerDeps, code: string): Promise<boolean> {
  const token = bearer(req) || (typeof req.query.token === "string" ? req.query.token : "");
  if (!token) return false;
  const session = await deps.identity.resolveSession(token);
  if (session) return session.roomCode.toUpperCase() === code;
  const viewer = await deps.identity.resolveViewer(token);
  return viewer?.roomCode.toUpperCase() === code;
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
  principal?: DeviceIdentity | undefined,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...(principal?.rotatedToken ? { "x-kad-device-token": principal.rotatedToken } : {}),
    },
    body: JSON.stringify(body),
  };
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
      return 409;
  }
}
