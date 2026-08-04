/**
 * The HTTP entry point — the one file between a phone and every handler.
 *
 * Why this suite exists: `handlers/flow.test.ts` says in its header that if it
 * passes, "`dev-server.ts` is only responsible for parsing JSON". That is true
 * of the dev server and *not* true of this file, which also decides who you are
 * (`resolvePrincipal`, `resolveSession`), which errors become which status
 * codes, what a malformed body means, and — for sign-in — is the only place in
 * the server that knows Cognito exists (`handlers/account.ts` header). None of
 * that was reachable by a test, and two of its routes have no dev-server twin
 * at all, so they were reachable only in production.
 *
 * Everything here drives `respond()`, the real thing, with a `makeHarness()`
 * behind it. No AWS, no module mocking: the seam is the `HttpRuntime` argument,
 * the same shape `channel-authorizer.ts` already uses.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import type { DeviceIdentity, IdentityService } from "../identity.ts";
import {
  makeHarness,
  scriptedRandom,
  seedHousehold,
  type TestHarness,
} from "../test-support.ts";
import { createRoom } from "../handlers/room.ts";
import { respond, type HttpRuntime } from "./http.ts";
import type { VerifiedAccount } from "./runtime.ts";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface TestRuntime extends HttpRuntime {
  /** How many times a route actually reached for the container-scoped deps. */
  depsCalls: number;
  /** What `verifyAccount` returns for a non-empty token. */
  account: VerifiedAccount | null;
}

function runtimeFor(harness: TestHarness, overrides: Partial<HttpRuntime> = {}): TestRuntime {
  const rt: TestRuntime = {
    depsCalls: 0,
    account: null,
    deps: async () => {
      rt.depsCalls++;
      return harness.deps;
    },
    // The real one returns null for any token that does not verify and never
    // throws (runtime.ts) — so an empty token is a null here too.
    verifyAccount: async (token: string) => (token ? rt.account : null),
    ...overrides,
  };
  return rt;
}

interface EventInit {
  body?: unknown;
  /** Overrides `body`, for the malformed-JSON and base64 cases. */
  rawBody?: string;
  isBase64Encoded?: boolean;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

/**
 * Only the fields `parse()` reads. Building the full `APIGatewayProxyEventV2`
 * would be forty lines of `requestContext` nobody asserts on, and the cast is
 * the honest version of that.
 */
function event(method: string, path: string, init: EventInit = {}): APIGatewayProxyEventV2 {
  const body =
    init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body));
  return {
    rawPath: path,
    requestContext: { http: { method } },
    ...(body === undefined ? {} : { body }),
    ...(init.isBase64Encoded ? { isBase64Encoded: true } : {}),
    ...(init.query ? { queryStringParameters: init.query } : {}),
    headers: init.headers ?? {},
  } as unknown as APIGatewayProxyEventV2;
}

function bodyOf(result: APIGatewayProxyStructuredResultV2): Record<string, never> {
  return JSON.parse(result.body ?? "{}") as Record<string, never>;
}

/** A room with one seeded player on a bound device. */
async function seedRoom(harness: TestHarness) {
  const { householdId, players } = await seedHousehold(harness, 1);
  const created = await createRoom({ householdId, mode: "party" }, harness.deps);
  if (!created.ok) throw new Error("setup failed");
  const player = players[0];
  if (!player) throw new Error("setup failed");
  return { householdId, player, ...created.value };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe("routing", () => {
  it("answers an unknown path with a 404 that names what it did not find", async () => {
    const rt = runtimeFor(makeHarness());
    const result = await respond(event("GET", "/api/nope"), rt);

    expect(result.statusCode).toBe(404);
    expect(bodyOf(result)).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "no route GET /api/nope" },
    });
  });

  it("does not treat a known path under the wrong method as routed", async () => {
    // `/api/room` is POST-only; a GET must 404 rather than fall into postRoom.
    const rt = runtimeFor(makeHarness());
    const result = await respond(event("GET", "/api/room"), rt);
    expect(result.statusCode).toBe(404);
    expect(bodyOf(result).error).toMatchObject({ message: "no route GET /api/room" });
  });

  it("never pays a cold start for a path it does not have", async () => {
    /*
     * The property the comment above `route()` claims: deps are resolved after
     * matching. Resolving first would turn every 404 into a DynamoDB client, a
     * content load and an SSM read — and, when any of those is misconfigured,
     * would report *that* instead of the 404 the caller actually earned.
     */
    const rt = runtimeFor(makeHarness());
    await respond(event("GET", "/api/nope"), rt);
    await respond(event("POST", "/api/room/TOOLONG/join"), rt);
    expect(rt.depsCalls).toBe(0);
  });

  it("answers a CORS preflight without a body and without the runtime", async () => {
    const rt = runtimeFor(makeHarness());
    const result = await respond(event("OPTIONS", "/api/action"), rt);
    expect(result).toEqual({ statusCode: 204 });
    expect(rt.depsCalls).toBe(0);
  });

  it("serves health without touching the table — it must answer when the table cannot", async () => {
    const rt = runtimeFor(makeHarness());
    const result = await respond(event("GET", "/api/health"), rt);

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toMatchObject({ ok: true, service: "kad-api" });
    expect(rt.depsCalls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("GET /api/config", () => {
  const KEYS = [
    "AWS_REGION",
    "APPSYNC_HTTP_DOMAIN",
    "APPSYNC_REALTIME_DOMAIN",
    "USER_POOL_ID",
    "USER_POOL_CLIENT_ID",
  ] as const;

  function withEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
    for (const key of KEYS) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const FULL = {
    AWS_REGION: "us-east-1",
    APPSYNC_HTTP_DOMAIN: "http.example",
    APPSYNC_REALTIME_DOMAIN: "rt.example",
    USER_POOL_ID: "pool_1",
    USER_POOL_CLIENT_ID: "client_1",
  };

  it("serves what the client needs to reach the channel and the user pool", async () => {
    withEnv(FULL);
    const rt = runtimeFor(makeHarness());
    const result = await respond(event("GET", "/api/config"), rt);

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toEqual({
      region: "us-east-1",
      realtime: { httpDomain: "http.example", realtimeDomain: "rt.example", namespace: "room" },
      auth: { userPoolId: "pool_1", clientId: "client_1" },
    });
    // Served, not stored — no table read (that is the whole point of §config).
    expect(rt.depsCalls).toBe(0);
  });

  it("turns a missing variable into a 500 that does not name it", async () => {
    /*
     * `requiredEnv` throws with the variable's name, which is exactly right in
     * a log line and wrong on a phone: it is a map of the stack's environment
     * handed to anyone who can curl the API. The generic catch is what stops it.
     */
    withEnv({ ...FULL, USER_POOL_ID: undefined });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await respond(event("GET", "/api/config"), runtimeFor(makeHarness()));
    errorLog.mockRestore();

    expect(result.statusCode).toBe(500);
    expect(bodyOf(result)).toEqual({
      ok: false,
      error: { code: "ILLEGAL", message: "something went wrong on our side; try again" },
    });
    expect(result.body).not.toContain("USER_POOL_ID");
    withEnv(FULL);
  });
});

// ---------------------------------------------------------------------------
// Parsing the API Gateway event
// ---------------------------------------------------------------------------

describe("parsing the event", () => {
  it("decodes a base64 body", async () => {
    /*
     * API Gateway base64-encodes a body whenever it decides the content type is
     * binary, which it does on a surprising set of requests. Nothing on a
     * laptop ever produces one, so this branch could only have been wrong in
     * production — where it reads as "every field you sent is missing".
     */
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    const raw = Buffer.from(JSON.stringify({ mode: "party" })).toString("base64");

    const result = await respond(
      event("POST", "/api/room", { rawBody: raw, isBase64Encoded: true }),
      rt,
    );
    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toMatchObject({ mode: "party" });
  });

  it("treats a malformed body as an empty one, so the route explains what it wanted", async () => {
    const result = await respond(
      event("POST", "/api/room", { rawBody: "{not json" }),
      runtimeFor(makeHarness()),
    );
    expect(result.statusCode).toBe(400);
    expect(bodyOf(result).error).toMatchObject({
      code: "ILLEGAL",
      message: 'mode must be "party" or "travel"',
    });
  });

  it("treats a non-object JSON body as an empty one", async () => {
    // `JSON.parse("5")` succeeds and is not a body. Assigning it would make
    // every `req.body.x` read throw somewhere further in.
    for (const raw of ["5", "null", '"party"']) {
      const result = await respond(
        event("POST", "/api/room", { rawBody: raw }),
        runtimeFor(makeHarness()),
      );
      expect(result.statusCode, raw).toBe(400);
    }
  });

  it("matches header names case-insensitively", async () => {
    /*
     * API Gateway lower-cases header names; curl, the Vite proxy and a fetch()
     * from the client do not have to. `parse()` normalises, and this is the
     * test that keeps it normalising — a device token read as absent silently
     * downgrades a returning phone to a brand-new household.
     */
    const harness = makeHarness();
    const { players } = await seedHousehold(harness, 1);
    const player = players[0];
    if (!player) throw new Error("setup failed");

    const result = await respond(
      event("POST", "/api/room", {
        body: { mode: "party" },
        headers: { "X-KAD-Device-Token": player.deviceToken },
      }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(200);
    // Recognised, so no second household and no second token were minted.
    expect(bodyOf(result)).not.toHaveProperty("deviceToken");
    expect(bodyOf(result)).toMatchObject({ playerId: player.principal.playerId });
  });
});

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

describe("POST /api/room", () => {
  it("refuses a mode it does not have", async () => {
    for (const mode of [undefined, "solo", 4, null]) {
      const result = await respond(
        event("POST", "/api/room", { body: { mode } }),
        runtimeFor(makeHarness()),
      );
      expect(result.statusCode, String(mode)).toBe(400);
    }
  });

  it("gives a device nobody has seen a household, a room, and a token (§4.5)", async () => {
    const harness = makeHarness();
    const result = await respond(
      event("POST", "/api/room", { body: { mode: "travel", displayName: "Ada" } }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(200);
    const payload = bodyOf(result) as Record<string, string>;
    // Nobody signed up to start a game.
    expect(payload.deviceToken).toBeTypeOf("string");
    expect(payload.code).toMatch(/^[A-Z]{4}$/);
    // Both spellings ship: `code` is what the QR carries, `roomCode` what the
    // store keeps. Dropping either is a client-side undefined, not a 500.
    expect(payload.roomCode).toBe(payload.code);
    expect(payload.expiresAt).toBeTypeOf("string");
  });

  it("maps a room-code exhaustion onto 409, not 500", async () => {
    /*
     * The only route to `ILLEGAL` in this file that is not a 400, and the one
     * status in `statusFor` that no other test here reaches. Forced by handing
     * `createRoom` a generator that can only ever produce one code.
     */
    const harness = makeHarness({ random: scriptedRandom(["ABCD"]) });
    const rt = runtimeFor(harness);
    const first = await respond(event("POST", "/api/room", { body: { mode: "party" } }), rt);
    expect(bodyOf(first)).toMatchObject({ code: "ABCD" });

    const second = await respond(event("POST", "/api/room", { body: { mode: "party" } }), rt);
    expect(second.statusCode).toBe(409);
    expect(bodyOf(second).error).toMatchObject({ code: "ILLEGAL" });
  });
});

describe("POST /api/room/:code/join", () => {
  it("accepts a lower-case code and upper-cases it", async () => {
    // The QR carries upper case; a child typing it in does not.
    const harness = makeHarness();
    const room = await seedRoom(harness);
    const result = await respond(
      event("POST", `/api/room/${room.code.toLowerCase()}/join`, {
        headers: { "x-kad-device-token": room.player.deviceToken },
      }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toMatchObject({ code: room.code, runId: room.runId });
  });

  it("is a four-letter route and nothing else", async () => {
    /*
     * The path regex is the only validation a room code gets before it reaches
     * the table. Anything it lets through that `generateRoomCode` cannot
     * produce is a lookup that can only miss — so the shape is the guard.
     */
    const rt = runtimeFor(makeHarness());
    for (const code of ["ABC", "ABCDE", "AB1D", "ABCD5", "", "../.."]) {
      const result = await respond(event("POST", `/api/room/${code}/join`), rt);
      expect(result.statusCode, code).toBe(404);
      expect(bodyOf(result).error, code).toMatchObject({ message: `no route POST /api/room/${code}/join` });
    }
    expect(rt.depsCalls).toBe(0);
  });

  it("says a well-formed code with no room behind it is not found", async () => {
    const result = await respond(
      event("POST", "/api/room/WXYZ/join"),
      runtimeFor(makeHarness()),
    );
    expect(result.statusCode).toBe(404);
    expect(bodyOf(result).error).toMatchObject({
      code: "NOT_FOUND",
      message: "no open room WXYZ",
    });
  });

  it("refuses a device from another household with 403", async () => {
    // The FORBIDDEN → 403 leg of `statusFor`.
    const harness = makeHarness();
    const room = await seedRoom(harness);
    await harness.repo.putHousehold({
      id: "h_other",
      displayName: "Someone else",
      ownerSub: "sub-other",
      guest: false,
      createdAt: new Date(harness.clock.now()).toISOString(),
    });
    await harness.repo.putPlayer({
      id: "p_x",
      householdId: "h_other",
      displayName: "Stranger",
      color: "#7FD4C1",
      role: "adult",
    });
    const { token } = await harness.identity.issueDeviceToken({
      householdId: "h_other",
      playerId: "p_x",
      role: "adult",
    });

    const result = await respond(
      event("POST", `/api/room/${room.code}/join`, {
        headers: { "x-kad-device-token": token },
      }),
      runtimeFor(harness),
    );
    expect(result.statusCode).toBe(403);
    expect(bodyOf(result).error).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("POST /api/room/:code/watch", () => {
  it("hands the TV a viewer token and no player", async () => {
    const harness = makeHarness();
    const room = await seedRoom(harness);
    const result = await respond(
      event("POST", `/api/room/${room.code}/watch`),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(200);
    const payload = bodyOf(result) as Record<string, unknown>;
    expect(payload.viewerToken).toBeTypeOf("string");
    // A screen is not a player (spec §2.1) — nothing here may name one.
    expect(payload).not.toHaveProperty("playerId");
    expect(payload).not.toHaveProperty("sessionToken");
  });
});

// ---------------------------------------------------------------------------
// Play — the authorization surface
// ---------------------------------------------------------------------------

describe("POST /api/action", () => {
  async function joined(harness: TestHarness) {
    const room = await seedRoom(harness);
    const join = await respond(
      event("POST", `/api/room/${room.code}/join`, {
        headers: { "x-kad-device-token": room.player.deviceToken },
      }),
      runtimeFor(harness),
    );
    const { sessionToken } = bodyOf(join) as unknown as { sessionToken: string };
    return { ...room, sessionToken };
  }

  it("refuses an action carrying no credential at all", async () => {
    /*
     * The one that matters most in this file. Party player ids are in the room
     * state every client holds, so falling through to the body's `playerId`
     * would let any phone in the room act as anybody at the table. Binding the
     * token only when one is *present* is not enough — omitting it entirely has
     * to fail too, which is what this asserts.
     */
    const harness = makeHarness();
    const room = await joined(harness);

    const result = await respond(
      event("POST", "/api/action", {
        body: {
          runId: room.runId,
          playerId: room.player.principal.playerId,
          seq: 0,
          intent: { type: "CHOOSE", choiceId: "east" },
        },
      }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(401);
    expect(bodyOf(result).error).toMatchObject({ code: "FORBIDDEN" });
    // And nothing moved.
    expect((await harness.repo.getState(room.runId))?.seq).toBe(0);
  });

  it("refuses a valid session token pointed at another run", async () => {
    const harness = makeHarness();
    const room = await joined(harness);

    const result = await respond(
      event("POST", "/api/action", {
        body: {
          runId: "r_someone_else",
          playerId: room.player.principal.playerId,
          seq: 0,
          intent: { type: "CHOOSE", choiceId: "east" },
        },
        headers: { authorization: `Bearer ${room.sessionToken}` },
      }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(403);
    expect(bodyOf(result).error).toMatchObject({
      code: "FORBIDDEN",
      message: "that session belongs to another run",
    });
  });

  it("refuses a body that is missing any of runId, playerId or intent", async () => {
    const harness = makeHarness();
    const room = await joined(harness);
    const full = {
      runId: room.runId,
      playerId: room.player.principal.playerId,
      seq: 0,
      intent: { type: "CHOOSE", choiceId: "east" },
    };

    for (const key of ["runId", "playerId", "intent"] as const) {
      const body: Record<string, unknown> = { ...full };
      delete body[key];
      const result = await respond(
        event("POST", "/api/action", {
          body,
          headers: { authorization: `Bearer ${room.sessionToken}` },
        }),
        runtimeFor(harness),
      );
      expect(result.statusCode, key).toBe(400);
      expect(bodyOf(result).error, key).toMatchObject({
        message: "expected { runId, playerId, seq, intent }",
      });
    }
  });

  it("accepts the bearer token issued at join and advances the run", async () => {
    const harness = makeHarness();
    const room = await joined(harness);

    const result = await respond(
      event("POST", "/api/action", {
        body: {
          runId: room.runId,
          playerId: room.player.principal.playerId,
          seq: 0,
          intent: { type: "CHOOSE", choiceId: "east" },
        },
        headers: { authorization: `Bearer ${room.sessionToken}` },
      }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toEqual({ ok: true, seq: 1 });
    expect((await harness.repo.getState(room.runId))?.seq).toBe(1);
  });

  it("reads the bearer scheme case-insensitively and ignores a bare token", async () => {
    const harness = makeHarness();
    const room = await joined(harness);
    const body = {
      runId: room.runId,
      playerId: room.player.principal.playerId,
      seq: 0,
      intent: { type: "CHOOSE", choiceId: "east" },
    };

    const lower = await respond(
      event("POST", "/api/action", {
        body,
        headers: { authorization: `bearer ${room.sessionToken}` },
      }),
      runtimeFor(harness),
    );
    expect(lower.statusCode).toBe(200);

    // No scheme is not a credential — it must not be read as one.
    const bare = await respond(
      event("POST", "/api/action", {
        body: { ...body, seq: 1 },
        headers: { authorization: room.sessionToken },
      }),
      runtimeFor(harness),
    );
    expect(bare.statusCode).toBe(401);
  });

  it("returns a rejected intent as 200 with ok:false, not an HTTP error", async () => {
    /*
     * A rejection is part of the protocol: the client reads `error.code` and
     * resyncs. Turning it into a 4xx would put it through fetch()'s error path
     * on a phone with a flaky connection, where "the server said no" and "the
     * request never arrived" would become the same event.
     */
    const harness = makeHarness();
    const room = await joined(harness);

    const result = await respond(
      event("POST", "/api/action", {
        body: {
          runId: room.runId,
          playerId: room.player.principal.playerId,
          seq: 99, // ahead of the server
          intent: { type: "CHOOSE", choiceId: "east" },
        },
        headers: { authorization: `Bearer ${room.sessionToken}` },
      }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toMatchObject({ ok: false, error: { code: "STALE_SEQ" } });
  });
});

// ---------------------------------------------------------------------------
// GET /api/state
// ---------------------------------------------------------------------------

describe("GET /api/state", () => {
  it("insists on being told which run", async () => {
    const result = await respond(event("GET", "/api/state"), runtimeFor(makeHarness()));
    expect(result.statusCode).toBe(400);
    expect(bodyOf(result).error).toMatchObject({ message: "runId or code is required" });
  });

  it("resolves a room code, upper-cased, with no identity at all", async () => {
    // How the TV reattaches after a hard refresh (spec §2.1).
    const harness = makeHarness();
    const room = await seedRoom(harness);
    const result = await respond(
      event("GET", "/api/state", { query: { code: room.code.toLowerCase() } }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toMatchObject({ seq: 0 });
  });

  it("refuses a code whose room is gone even when the caller also knows the runId", async () => {
    /*
     * The room is what expires, not the run. Answering from the runId alone
     * restores a session whose channel subscription is dead and whose token has
     * expired — a phone showing a game it cannot play instead of being told the
     * room is over.
     */
    const harness = makeHarness();
    const room = await seedRoom(harness);
    harness.clock.advance(7 * 3600_000); // past the 6-hour room TTL

    const result = await respond(
      event("GET", "/api/state", { query: { code: room.code, runId: room.runId } }),
      runtimeFor(harness),
    );
    expect(result.statusCode).toBe(404);
    expect(bodyOf(result).error).toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a code and a runId that name different runs", async () => {
    const harness = makeHarness();
    const room = await seedRoom(harness);
    const result = await respond(
      event("GET", "/api/state", { query: { code: room.code, runId: "r_other" } }),
      runtimeFor(harness),
    );
    expect(result.statusCode).toBe(404);
    expect(bodyOf(result).error).toMatchObject({
      message: `room ${room.code} is not that run`,
    });
  });

  it("passes sinceSeq through as a number, and omits it when absent", async () => {
    const harness = makeHarness();
    const room = await seedRoom(harness);

    // seq 0 and sinceSeq 0 — caught up, so events rather than a snapshot.
    const caught = await respond(
      event("GET", "/api/state", { query: { runId: room.runId, sinceSeq: "0" } }),
      runtimeFor(harness),
    );
    expect(bodyOf(caught)).toEqual({ seq: 0, events: [] });

    // No sinceSeq is a cold client, which must get the whole state.
    const cold = await respond(
      event("GET", "/api/state", { query: { runId: room.runId } }),
      runtimeFor(harness),
    );
    expect(bodyOf(cold)).toHaveProperty("state");
  });
});

// ---------------------------------------------------------------------------
// Sign-in — the routes with no dev-server twin
// ---------------------------------------------------------------------------

describe("POST /api/auth/link", () => {
  it("refuses a request with no bearer token", async () => {
    const result = await respond(event("POST", "/api/auth/link"), runtimeFor(makeHarness()));
    expect(result.statusCode).toBe(401);
    expect(bodyOf(result).error).toMatchObject({
      code: "FORBIDDEN",
      message: "a verified Cognito id token is required",
    });
  });

  it("refuses a token the user pool does not verify", async () => {
    // `verifyAccountToken` returns null rather than throwing for anything that
    // fails signature, issuer, audience, expiry or token_use.
    const rt = runtimeFor(makeHarness());
    rt.account = null;
    const result = await respond(
      event("POST", "/api/auth/link", { headers: { authorization: "Bearer forged" } }),
      rt,
    );
    expect(result.statusCode).toBe(401);
  });

  it("claims the household the party is already playing in", async () => {
    /*
     * The case the whole anonymous-play design exists for: sign in at the end
     * of a session and the characters built twenty minutes ago become
     * permanent, with no ids changing and nothing copied.
     */
    const harness = makeHarness();
    const created = await respond(
      event("POST", "/api/room", { body: { mode: "party" } }),
      runtimeFor(harness),
    );
    const { deviceToken } = bodyOf(created) as unknown as { deviceToken: string };

    const rt = runtimeFor(harness);
    rt.account = { cognitoSub: "sub-new", email: "ada@example.com" };
    const result = await respond(
      event("POST", "/api/auth/link", {
        headers: { authorization: "Bearer good", "x-kad-device-token": deviceToken },
      }),
      rt,
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toMatchObject({ claimed: true });
  });

  it("will not let a child's device claim a household", async () => {
    // Ownership — and therefore revocation — must not end up behind a
    // credential a child was promised she would never need (§4.5).
    const harness = makeHarness();
    const { players } = await seedHousehold(harness, 1, "child");
    const player = players[0];
    if (!player) throw new Error("setup failed");
    await harness.repo.putHousehold({
      id: "h_test",
      displayName: "Guests",
      ownerSub: null,
      guest: true,
      createdAt: new Date(harness.clock.now()).toISOString(),
    });

    const rt = runtimeFor(harness);
    rt.account = { cognitoSub: "sub-child" };
    const result = await respond(
      event("POST", "/api/auth/link", {
        headers: { authorization: "Bearer good", "x-kad-device-token": player.deviceToken },
      }),
      rt,
    );

    expect(result.statusCode).toBe(403);
    expect(bodyOf(result).error).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("POST /api/auth/device", () => {
  it("refuses a request with no bearer token", async () => {
    const result = await respond(event("POST", "/api/auth/device"), runtimeFor(makeHarness()));
    expect(result.statusCode).toBe(401);
  });

  it("refuses a body missing householdId or playerId", async () => {
    const rt = runtimeFor(makeHarness());
    rt.account = { cognitoSub: "sub-1" };
    for (const body of [{}, { householdId: "h_1" }, { playerId: "p_1" }, { householdId: 1, playerId: 2 }]) {
      const result = await respond(
        event("POST", "/api/auth/device", { body, headers: { authorization: "Bearer good" } }),
        rt,
      );
      expect(result.statusCode, JSON.stringify(body)).toBe(400);
      expect(bodyOf(result).error).toMatchObject({ message: "expected { householdId, playerId }" });
    }
  });

  it("refuses a household the account does not own", async () => {
    /*
     * The ids in the body are not evidence. Every other device binds by
     * scanning a QR from a bound phone; this route is the one that binds on an
     * account alone, so it has to check the account actually owns what it names.
     */
    const harness = makeHarness();
    await seedHousehold(harness, 1);
    const rt = runtimeFor(harness);
    rt.account = { cognitoSub: "sub-stranger" };

    const result = await respond(
      event("POST", "/api/auth/device", {
        body: { householdId: "h_test", playerId: "p_1" },
        headers: { authorization: "Bearer good" },
      }),
      rt,
    );
    expect(result.statusCode).toBe(403);
  });

  it("maps a handler's NOT_FOUND onto 404", async () => {
    /*
     * The `fromError` path, which is a different code path from the routes that
     * call `error(404, ...)` directly — and the only leg of `statusFor` that
     * nothing else here reaches. An owned household with a player id that is
     * not in it is the cheapest way to get a handler to produce one.
     */
    const harness = makeHarness();
    await seedHousehold(harness, 1);
    await harness.repo.putAccountPointer("sub-owner", "h_test");

    const rt = runtimeFor(harness);
    rt.account = { cognitoSub: "sub-owner" };
    const result = await respond(
      event("POST", "/api/auth/device", {
        body: { householdId: "h_test", playerId: "p_nobody" },
        headers: { authorization: "Bearer good" },
      }),
      rt,
    );

    expect(result.statusCode).toBe(404);
    expect(bodyOf(result).error).toMatchObject({
      code: "NOT_FOUND",
      message: "no player p_nobody",
    });
  });

  it("binds a signed-in device to a player of its own household", async () => {
    const harness = makeHarness();
    await seedHousehold(harness, 1);
    await harness.repo.putAccountPointer("sub-owner", "h_test");

    const rt = runtimeFor(harness);
    rt.account = { cognitoSub: "sub-owner" };
    const result = await respond(
      event("POST", "/api/auth/device", {
        body: { householdId: "h_test", playerId: "p_1" },
        headers: { authorization: "Bearer good" },
      }),
      rt,
    );

    expect(result.statusCode).toBe(200);
    const payload = bodyOf(result) as unknown as { deviceToken: string; playerId: string };
    expect(payload.playerId).toBe("p_1");
    // The token is real: it resolves back to that player.
    expect(await harness.identity.resolveDevice(payload.deviceToken)).toMatchObject({
      householdId: "h_test",
      playerId: "p_1",
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting response plumbing
// ---------------------------------------------------------------------------

describe("responses", () => {
  it("hands a rotated device token back on the response header", async () => {
    /*
     * The sliding expiry in §4.5 renews a token on a small fraction of
     * resolves. This header is the only way a phone is ever told — drop it and
     * a device used every week still expires, silently, at the table.
     */
    const harness = makeHarness();
    const { players } = await seedHousehold(harness, 1);
    const player = players[0];
    if (!player) throw new Error("setup failed");

    // Delegating rather than spreading: `DevIdentity` is a class, and its
    // methods live on the prototype where an object spread cannot reach them.
    const real = harness.identity;
    const rotating: IdentityService = {
      issueDeviceToken: (input) => real.issueDeviceToken(input),
      issueSessionToken: (input) => real.issueSessionToken(input),
      resolveSession: (token) => real.resolveSession(token),
      issueViewerToken: (input) => real.issueViewerToken(input),
      resolveViewer: (token) => real.resolveViewer(token),
      resolveDevice: async (token: string): Promise<DeviceIdentity | null> => {
        const principal = await real.resolveDevice(token);
        return principal ? { ...principal, rotatedToken: "kaddev.d1.rotated" } : null;
      },
    };
    const rt = runtimeFor(harness, {
      deps: async () => ({ ...harness.deps, identity: rotating }),
    });

    const result = await respond(
      event("POST", "/api/room", {
        body: { mode: "party" },
        headers: { "x-kad-device-token": player.deviceToken },
      }),
      rt,
    );

    expect(result.statusCode).toBe(200);
    expect(result.headers?.["x-kad-device-token"]).toBe("kaddev.d1.rotated");
  });

  it("does not send the header when nothing rotated", async () => {
    const harness = makeHarness();
    const room = await seedRoom(harness);
    const result = await respond(
      event("POST", `/api/room/${room.code}/join`, {
        headers: { "x-kad-device-token": room.player.deviceToken },
      }),
      runtimeFor(harness),
    );
    expect(result.headers).not.toHaveProperty("x-kad-device-token");
  });

  it("answers JSON on every path, including the ones that failed", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    const results = [
      await respond(event("GET", "/api/health"), rt),
      await respond(event("GET", "/api/nope"), rt),
      await respond(event("POST", "/api/room", { body: {} }), rt),
      await respond(event("POST", "/api/room/WXYZ/join"), rt),
    ];
    for (const result of results) {
      expect(result.headers?.["content-type"]).toBe("application/json");
      expect(() => JSON.parse(result.body ?? "")).not.toThrow();
    }
  });

  it("turns an unexpected throw into a 500 that leaks nothing", async () => {
    /*
     * An SDK error carries table names, ARNs and filesystem paths. It belongs
     * in the log line and nowhere a phone can see, so the catch replaces the
     * message rather than forwarding it.
     */
    const rt = runtimeFor(makeHarness(), {
      deps: () => Promise.reject(new Error("ResourceNotFoundException: table kad-prod-4417")),
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await respond(event("POST", "/api/room", { body: { mode: "party" } }), rt);
    // Read before restoring — `mockRestore` clears the recorded calls too.
    const logged = errorLog.mock.calls.length;
    errorLog.mockRestore();

    expect(result.statusCode).toBe(500);
    expect(bodyOf(result)).toEqual({
      ok: false,
      error: { code: "ILLEGAL", message: "something went wrong on our side; try again" },
    });
    expect(result.body).not.toContain("kad-prod-4417");
    // Logged, though — the operator still needs it.
    expect(logged).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Parity with the dev server
// ---------------------------------------------------------------------------

/**
 * `http.ts` opens by claiming it is `dev-server.ts` with Express swapped out,
 * and that "a difference between them is a difference between what you tested
 * on a laptop and what your daughter is playing". Nothing checked that, and it
 * has already drifted — see `PROD_ONLY` below.
 *
 * The prod side is probed rather than read: every path is pushed through the
 * real `respond()`, and "routed" means it did not come back as `no route`. The
 * dev side is scraped, because `dev-server.ts` starts a listening server at
 * import time and cannot be loaded into a test.
 */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function read(relative: string): string {
  return readFileSync(`${REPO_ROOT}packages/server/src/${relative}`, "utf8");
}

function devServerRoutes(): Set<string> {
  const source = read("dev-server.ts");
  const found = new Set<string>();
  for (const [, method, path] of source.matchAll(/\bapp\.(get|post)\("([^"]+)"/g)) {
    found.add(`${method?.toUpperCase()} ${path}`);
  }
  return found;
}

/**
 * Every path `http.ts` routes, by source rather than by probe.
 *
 * The probes below prove that each *declared* path is really routed; only a
 * read of the file can prove there are no *undeclared* ones, since there is no
 * way to probe a path nobody has thought of. Both halves are needed: the scrape
 * alone would be satisfied by a route that matches but 500s.
 */
function httpRoutePaths(): Set<string> {
  const source = read("lambda/http.ts");
  const found = new Set<string>();
  for (const [, path] of source.matchAll(/\breq\.path === "([^"]+)"/g)) {
    if (path) found.add(path);
  }
  // The two parameterised ones, spelled as regexes: `([A-Za-z]{4})\/join$`.
  for (const [, segment] of source.matchAll(/\(\[A-Za-z\]\{4\}\)\\\/(\w+)\$/g)) {
    if (segment) found.add(`/api/room/:code/${segment}`);
  }
  return found;
}

/** Same paths, written the way each side spells them. */
const SHARED = [
  { path: "/api/room", method: "POST", probe: "/api/room" },
  { path: "/api/room/:code/join", method: "POST", probe: "/api/room/ABCD/join" },
  { path: "/api/room/:code/watch", method: "POST", probe: "/api/room/ABCD/watch" },
  { path: "/api/action", method: "POST", probe: "/api/action" },
  { path: "/api/state", method: "GET", probe: "/api/state" },
  { path: "/api/health", method: "GET", probe: "/api/health" },
] as const;

/**
 * Routes that exist in prod and have no local twin. Every entry here is a code
 * path that `npm run dev` cannot reach and the Playwright suite cannot cover,
 * because e2e drives the dev server — so it is only ever exercised against AWS.
 *
 * The sign-in pair is the live example: `handlers/account.ts` is well tested,
 * but the *route* in front of it — bearer extraction, `verifyAccount`, the 401s
 * — had no coverage at any level until this file. That is why they are pinned
 * rather than merely tolerated: the list is allowed to shrink, and growing it
 * should be a deliberate act with a comment, not a Tuesday.
 */
const PROD_ONLY = [
  // Served from the stack's environment; the dev client reads a static config.
  { path: "/api/config", method: "GET" },
  { path: "/api/auth/link", method: "POST" },
  { path: "/api/auth/device", method: "POST" },
] as const;

/** The reverse: local-only, and deliberately so. */
const DEV_ONLY = [
  // The SSE stand-in for the AppSync Events channel. In prod the client
  // subscribes to AppSync directly and never asks the API for a stream.
  { path: "/events/:code", method: "GET" },
] as const;

function routed(result: APIGatewayProxyStructuredResultV2): boolean {
  const message = (bodyOf(result).error as { message?: string } | undefined)?.message ?? "";
  return !message.startsWith("no route");
}

describe("route parity with dev-server.ts", () => {
  let dev: Set<string>;
  beforeEach(() => {
    dev = devServerRoutes();
  });

  it("can still read both route tables", () => {
    /*
     * Both scrapes are regexes over source, so they have to prove they still
     * work before anything is concluded from them. Without this, a rename to
     * `router.post(...)` would empty a set and every parity test below would
     * pass by finding no differences at all — which is the failure mode this
     * whole file was written to stop, so it must not have one of its own.
     */
    expect(dev.size).toBe(SHARED.length + DEV_ONLY.length);
    expect(dev).toContain("POST /api/room");
    expect(httpRoutePaths().size).toBe(SHARED.length + PROD_ONLY.length);
  });

  it("routes every path the dev server routes", async () => {
    const rt = runtimeFor(makeHarness());
    for (const { path, method, probe } of SHARED) {
      expect(dev, `${method} ${path} vanished from dev-server.ts`).toContain(`${method} ${path}`);
      const result = await respond(event(method, probe), rt);
      expect(routed(result), `${method} ${probe} is not routed by http.ts`).toBe(true);
    }
  });

  it("routes nothing the parity lists do not mention", async () => {
    /*
     * The check that catches drift in the direction that actually happened:
     * a route added to prod with no local twin is a code path `npm run dev`
     * cannot reach and Playwright cannot cover, because e2e drives the dev
     * server. Adding one should mean writing it down here.
     */
    expect(httpRoutePaths()).toEqual(
      new Set([...SHARED.map((r) => r.path), ...PROD_ONLY.map((r) => r.path)]),
    );

    const known = new Set([
      ...SHARED.map((r) => `${r.method} ${r.path}`),
      ...DEV_ONLY.map((r) => `${r.method} ${r.path}`),
    ]);
    for (const route of dev) {
      expect(known, `dev-server.ts routes ${route}, which no parity list mentions`).toContain(route);
    }
  });

  it("has exactly the prod-only routes it is supposed to have", async () => {
    const rt = runtimeFor(makeHarness());
    for (const { path, method } of PROD_ONLY) {
      const result = await respond(event(method, path), rt);
      expect(routed(result), `${method} ${path} is prod-only but http.ts does not route it`).toBe(
        true,
      );
      // And the dev server does not quietly grow a twin without this list shrinking.
      expect(dev, `${method} ${path} now exists in dev-server.ts — drop it from PROD_ONLY`).not.toContain(
        `${method} ${path}`,
      );
    }
  });

  it("has exactly the dev-only routes it is supposed to have", async () => {
    const rt = runtimeFor(makeHarness());
    for (const { path, method } of DEV_ONLY) {
      const probe = path.replace(":code", "ABCD");
      const result = await respond(event(method, probe), rt);
      expect(routed(result), `${method} ${path} is dev-only but http.ts routes it`).toBe(false);
    }
  });
});
