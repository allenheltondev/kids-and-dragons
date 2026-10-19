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
import { applyIntent, createRunState } from "@kad/shared";
import { createRoom } from "../handlers/room.ts";
import { CODE_MISS_LIMIT } from "../handlers/code-guard.ts";
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

  it("lets the TV open a Party Mode room without taking a seat (spec §2.1)", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    const result = await respond(
      event("POST", "/api/room", { body: { mode: "party", display: true } }),
      rt,
    );

    expect(result.statusCode).toBe(200);
    const payload = bodyOf(result) as Record<string, unknown>;
    expect(payload.code).toMatch(/^[A-Z]{4}$/);
    expect(payload.roomCode).toBe(payload.code);
    // Kept, so the phones and tomorrow's room share the TV's household.
    expect(payload.deviceToken).toBeTypeOf("string");
    // Nobody was seated: no player, no session, and the lobby is empty.
    expect(payload.playerId).toBeUndefined();
    expect(payload.sessionToken).toBeUndefined();
    const watched = await respond(
      event("POST", `/api/room/${String(payload.code)}/watch`, {
        body: {},
        headers: { "x-kad-device-token": String(payload.deviceToken) },
      }),
      rt,
    );
    expect(bodyOf(watched)).toMatchObject({ state: { party: [] } });
  });

  it("hands the TV's room to the family whose phone joins first", async () => {
    // A new TV, or one whose storage was cleared, opens under a household of
    // its own. A phone that already belongs to a family takes the room into
    // that family rather than being turned away from it.
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    const opened = bodyOf(
      await respond(event("POST", "/api/room", { body: { mode: "party", display: true } }), rt),
    ) as unknown as { code: string; runId: string };
    const { householdId, players } = await seedHousehold(harness, 1);

    const joined = await respond(
      event("POST", `/api/room/${opened.code}/join`, {
        headers: { "x-kad-device-token": players[0]!.deviceToken },
      }),
      rt,
    );
    expect(joined.statusCode).toBe(200);
    expect((await harness.repo.getRoom(opened.code))?.householdId).toBe(householdId);

    // And a new phone after it joins the family, not the TV.
    const fresh = await respond(
      event("POST", `/api/room/${opened.code}/join`, { body: { displayName: "Sam" } }),
      rt,
    );
    expect(fresh.statusCode).toBe(200);
    const freshId = (bodyOf(fresh) as unknown as { playerId: string }).playerId;
    expect(await harness.repo.getPlayer(householdId, freshId)).not.toBeNull();
  });

  it("refuses a TV for a Travel Mode room", async () => {
    const result = await respond(
      event("POST", "/api/room", { body: { mode: "travel", display: true } }),
      runtimeFor(makeHarness()),
    );
    expect(result.statusCode).toBe(400);
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

describe("blocked names at the HTTP door (#253)", () => {
  it("refuses a host or a joiner who types one, with the kid-friendly sentence", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness);

    const host = await respond(event("POST", "/api/room", { body: { mode: "travel", displayName: "Poopface" } }), rt);
    expect(host.statusCode).toBe(409);
    expect(bodyOf(host).error).toMatchObject({ code: "ILLEGAL", message: "Hmm, let's pick another one!" });

    const opened = bodyOf(
      await respond(event("POST", "/api/room", { body: { mode: "party", display: true } }), rt),
    ) as unknown as { code: string };
    const joined = await respond(
      event("POST", `/api/room/${opened.code}/join`, { body: { displayName: "sh1t" } }),
      rt,
    );
    expect(joined.statusCode).toBe(409);
    expect(bodyOf(joined).error).toMatchObject({ code: "ILLEGAL", message: "Hmm, let's pick another one!" });
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

  it("is a four-letter route, or six for a visitor code (#249), and nothing else", async () => {
    /*
     * The path regex is the only validation a room code gets before it reaches
     * the table. Anything it lets through that `generateRoomCode` cannot
     * produce is a lookup that can only miss — so the shape is the guard.
     */
    const rt = runtimeFor(makeHarness());
    for (const code of ["ABC", "ABCDE", "AB1D", "ABCD5", "ABCDEFG", "ABCDE1", "", "../.."]) {
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
    });
    const { token } = await harness.identity.issueDeviceToken({
      householdId: "h_other",
      playerId: "p_x",
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

describe("a room open to visitors (#249)", () => {
  const OWNER: VerifiedAccount = { cognitoSub: "sub-test", email: "owner@example.com" };

  /** A room of household h_test, whose owner is signed in, and a phone from h_other. */
  async function openable() {
    const harness = makeHarness();
    const room = await seedRoom(harness);
    await harness.repo.putAccountPointer(OWNER.cognitoSub, room.householdId);
    await harness.repo.putHousehold({
      id: "h_other",
      displayName: "Next door",
      ownerSub: "sub-other",
      guest: false,
      createdAt: new Date(harness.clock.now()).toISOString(),
    });
    await harness.repo.putPlayer({ id: "p_x", householdId: "h_other", displayName: "Wren", color: "#E8A33D" });
    const { token } = await harness.identity.issueDeviceToken({ householdId: "h_other", playerId: "p_x" });
    const rt = runtimeFor(harness);
    // The room's own phone joins first, which settles it.
    await respond(
      event("POST", `/api/room/${room.code}/join`, { headers: { "x-kad-device-token": room.player.deviceToken } }),
      rt,
    );
    return { harness, room, rt, visitorToken: token };
  }

  const opening = (code: string, open: unknown, token = "good") =>
    event("POST", `/api/room/${code}/visitors`, { body: { open }, headers: { authorization: `Bearer ${token}` } });

  it("needs a verified sign-in, and an owner of the room's household", async () => {
    const { room, rt } = await openable();
    expect((await respond(opening(room.code, true, ""), rt)).statusCode).toBe(401);
    rt.account = { cognitoSub: "sub-stranger" };
    const stranger = await respond(opening(room.code, true), rt);
    expect(stranger.statusCode).toBe(403);
    rt.account = OWNER;
    expect((await respond(opening(room.code, "yes"), rt)).statusCode).toBe(400);
    expect((await respond(opening("WXYZ", true), rt)).statusCode).toBe(404);
  });

  it("lets a phone from another household join with the six-letter code only", async () => {
    const { room, rt, visitorToken } = await openable();
    const join = (code: string) =>
      respond(event("POST", `/api/room/${code}/join`, { headers: { "x-kad-device-token": visitorToken } }), rt);
    expect((await join(room.code)).statusCode).toBe(403);

    rt.account = OWNER;
    const opened = await respond(opening(room.code, true), rt);
    expect(opened.statusCode).toBe(200);
    const visitorCode = String(bodyOf(opened).visitorCode);
    expect(visitorCode).toMatch(new RegExp(`^${room.code}[A-Z]{2}$`));

    // Still refused on the short code; in on the long one, answered with the
    // room's own code, which every later call names.
    expect((await join(room.code)).statusCode).toBe(403);
    const joined = await join(visitorCode.toLowerCase());
    expect(joined.statusCode).toBe(200);
    expect(bodyOf(joined)).toMatchObject({ code: room.code, roomCode: room.code, playerId: "p_x" });
    // A wrong last two letters is an unknown code.
    const wrong = room.code + (visitorCode.endsWith("ZZ") ? "YY" : "ZZ");
    const missed = await join(wrong);
    expect(missed.statusCode).toBe(404);
    expect(bodyOf(missed).error).toMatchObject({ message: `no open room ${wrong}` });
  });

  it("gives a brand-new phone on the long code a household of its own, never the host's", async () => {
    const { harness, room, rt } = await openable();
    rt.account = OWNER;
    const visitorCode = String(bodyOf(await respond(opening(room.code, true), rt)).visitorCode);

    const joined = await respond(event("POST", `/api/room/${visitorCode}/join`, { body: { displayName: "Wren" } }), rt);
    expect(joined.statusCode).toBe(200);
    const device = await harness.identity.resolveDevice(String(bodyOf(joined).deviceToken));
    expect(device?.householdId).toBeTruthy();
    expect(device?.householdId).not.toBe(room.householdId);
    expect(await harness.repo.getPlayer(room.householdId, device!.playerId)).toBeNull();
    const state = await harness.repo.getState(room.runId);
    expect(state?.seats?.[device!.playerId]).toMatchObject({ homeHouseholdId: device!.householdId });
    // It founded that household, so it, and only it, may keep it later.
    expect((await harness.repo.getHousehold(device!.householdId))?.founderDeviceId).toBe(device!.deviceId);

  });

  /** Everybody the room's household has, so a test can prove nobody was added. */
  async function members(harness: ReturnType<typeof makeHarness>, householdId: string) {
    const [players, devices] = await Promise.all([
      harness.repo.listPlayers(householdId),
      harness.repo.listDevices(householdId),
    ]);
    return { players: players.length, devices: devices.length };
  }

  it("never makes a brand-new phone family because it knows the room's four letters, while open or after", async () => {
    const { harness, room, rt } = await openable();
    rt.account = OWNER;
    const visitorCode = String(bodyOf(await respond(opening(room.code, true), rt)).visitorCode);
    // Every visitor has been shown the four letters: they are the long code's first four.
    const prefix = visitorCode.slice(0, 4);
    expect(prefix).toBe(room.code);
    const before = await members(harness, room.householdId);

    const whileOpen = await respond(event("POST", `/api/room/${prefix}/join`, { body: { displayName: "Stranger" } }), rt);
    expect(whileOpen.statusCode).toBe(403);
    expect(bodyOf(whileOpen).deviceToken).toBeUndefined();
    expect(await members(harness, room.householdId)).toEqual(before);

    // The switch goes off. The four letters are still out there, and still prove nothing.
    expect((await respond(opening(room.code, false), rt)).statusCode).toBe(200);
    const afterOff = await respond(event("POST", `/api/room/${prefix}/join`, { body: { displayName: "Stranger" } }), rt);
    expect(afterOff.statusCode).toBe(403);
    expect(bodyOf(afterOff).deviceToken).toBeUndefined();
    // Nor does the old long code, which is a wrong code now.
    const oldLong = await respond(event("POST", `/api/room/${visitorCode}/join`, { body: { displayName: "Stranger" } }), rt);
    expect(oldLong.statusCode).toBe(404);
    expect(await members(harness, room.householdId)).toEqual(before);

    // The family's own phone, already bound, still comes back on the four letters.
    const family = await respond(
      event("POST", `/api/room/${room.code}/join`, { headers: { "x-kad-device-token": room.player.deviceToken } }),
      rt,
    );
    expect(family.statusCode).toBe(200);
  });

  it("binds nothing to a brand-new phone a locked room turns away", async () => {
    const { harness, room, rt } = await openable();
    const state = await harness.repo.getState(room.runId);
    if (!state) throw new Error("no state");
    await harness.repo.putState({ ...state, locked: true });
    const before = await members(harness, room.householdId);

    const refused = await respond(event("POST", `/api/room/${room.code}/join`, { body: { displayName: "Late" } }), rt);
    expect(refused.statusCode).toBe(403);
    expect(bodyOf(refused).deviceToken).toBeUndefined();
    expect(await members(harness, room.householdId)).toEqual(before);
  });

  it("still makes a brand-new phone family in a room that was never opened", async () => {
    const { harness, room, rt } = await openable();
    const joined = await respond(event("POST", `/api/room/${room.code}/join`, { body: { displayName: "Kid" } }), rt);
    expect(joined.statusCode).toBe(200);
    const kin = await harness.identity.resolveDevice(String(bodyOf(joined).deviceToken));
    expect(kin?.householdId).toBe(room.householdId);
  });
});

describe("POST /api/room/:code/watch", () => {
  it("shows a room only to the screen that opened it (#267)", async () => {
    // Anybody else with the code would watch the party unannounced, out of
    // reach of Remove. To see the room, a stranger now has to join it.
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    const opened = await respond(event("POST", "/api/room", { body: { mode: "party", display: true } }), rt);
    const tv = bodyOf(opened) as unknown as { code: string; deviceToken: string };

    const asTv = await respond(
      event("POST", `/api/room/${tv.code}/watch`, { headers: { "x-kad-device-token": tv.deviceToken } }),
      rt,
    );
    expect(asTv.statusCode).toBe(200);
    expect(bodyOf(asTv)).toMatchObject({ host: true });

    const anonymous = await respond(event("POST", `/api/room/${tv.code}/watch`), rt);
    expect(anonymous.statusCode).toBe(403);
    const phone = await respond(event("POST", `/api/room/${tv.code}/join`, { body: {} }), rt);
    const { deviceToken } = bodyOf(phone) as unknown as { deviceToken: string };
    const asPhone = await respond(
      event("POST", `/api/room/${tv.code}/watch`, { headers: { "x-kad-device-token": deviceToken } }),
      rt,
    );
    expect(asPhone.statusCode).toBe(403);
  });

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
// Wrong room codes (#267) — the code is the real boundary
// ---------------------------------------------------------------------------

describe("the wrong-code budget", () => {
  /** What CloudFront sends: the viewer's address, vouched for by the origin secret. */
  const SECRET = "s3cret-from-ssm";
  const from = (address: string) => ({ "x-kad-viewer": address, "x-kad-origin": SECRET });

  /** Spend one client's whole budget on codes no room has. */
  async function exhaust(rt: HttpRuntime, address: string) {
    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      const missed = await respond(
        event("POST", `/api/room/${unusedCode(i)}/join`, { headers: from(address) }),
        rt,
      );
      expect(missed.statusCode, `miss ${i}`).toBe(404);
    }
  }

  /** Codes `seedRoom` will never have rolled — every one a miss. */
  function unusedCode(i: number): string {
    return `QQ${"ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(i / 24) % 24]}${"ABCDEFGHJKLMNPQRSTUVWXYZ"[i % 24]}`;
  }

  it("refuses a guesser before the lookup, so even a right code tells it nothing", async () => {
    const harness = makeHarness();
    const room = await seedRoom(harness);
    const rt = runtimeFor(harness, { originSecret: SECRET });
    await exhaust(rt, "198.51.100.7");

    // The live code now gets the same answer a dead one would.
    for (const path of [`/api/room/${room.code}/join`, `/api/room/${room.code}/watch`]) {
      const refused = await respond(event("POST", path, { headers: from("198.51.100.7") }), rt);
      expect(refused.statusCode, path).toBe(429);
      expect(bodyOf(refused).error, path).toMatchObject({ code: "SLOW_DOWN" });
      expect(Number(refused.headers?.["retry-after"]), path).toBeGreaterThan(0);
    }
  });

  it("counts misses on every route that looks a room up by code", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness, { originSecret: SECRET });
    const headers = from("198.51.100.7");
    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      const code = unusedCode(i);
      const missed =
        i % 2 === 0
          ? await respond(event("POST", `/api/room/${code}/join`, { headers }), rt)
          : await respond(event("POST", `/api/room/${code}/watch`, { headers }), rt);
      expect(missed.statusCode, code).toBe(404);
    }
    const refused = await respond(event("POST", "/api/room/WXYZ/join", { headers }), rt);
    expect(refused.statusCode).toBe(429);
  });

  it("never counts a family's right codes against it", async () => {
    // Joins and reconnects are most of the traffic; only misses spend the budget.
    const harness = makeHarness();
    const room = await seedRoom(harness);
    const rt = runtimeFor(harness, { originSecret: SECRET });
    for (let i = 0; i < CODE_MISS_LIMIT * 2; i++) {
      const joined = await respond(
        event("POST", `/api/room/${room.code}/join`, {
          headers: { ...from("198.51.100.7"), "x-kad-device-token": room.player.deviceToken },
        }),
        rt,
      );
      expect(joined.statusCode).toBe(200);
    }
  });

  it("keeps one client's budget its own", async () => {
    const harness = makeHarness();
    const room = await seedRoom(harness);
    const rt = runtimeFor(harness, { originSecret: SECRET });
    await exhaust(rt, "198.51.100.7");

    const joined = await respond(
      event("POST", `/api/room/${room.code}/join`, {
        headers: { ...from("203.0.113.9"), "x-kad-device-token": room.player.deviceToken },
      }),
      rt,
    );
    expect(joined.statusCode).toBe(200);
  });

  it("falls back to the connection's address when nothing set the header", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness, { originSecret: SECRET });
    const direct = (path: string) => {
      const e = event("POST", path);
      (e.requestContext.http as { sourceIp?: string }).sourceIp = "198.51.100.7";
      return e;
    };
    for (let i = 0; i < CODE_MISS_LIMIT; i++) await respond(direct(`/api/room/${unusedCode(i)}/join`), rt);
    expect((await respond(direct("/api/room/WXYZ/join"), rt)).statusCode).toBe(429);
    // The header is a different client.
    expect(
      (await respond(event("POST", "/api/room/WXYZ/join", { headers: from("203.0.113.9") }), rt))
        .statusCode,
    ).toBe(404);
  });

  it("lets a seated phone or TV reconnect even once its address is out of budget", async () => {
    /*
     * A building shares one IPv4 address. Strangers in it spending the budget
     * must not cut off a game already in progress: a session or viewer token
     * for this room is not a guess.
     */
    const harness = makeHarness();
    const room = await seedRoom(harness);
    const rt = runtimeFor(harness, { originSecret: SECRET });
    const joined = await respond(
      event("POST", `/api/room/${room.code}/join`, {
        headers: { ...from("198.51.100.7"), "x-kad-device-token": room.player.deviceToken },
      }),
      rt,
    );
    const { sessionToken } = bodyOf(joined) as unknown as { sessionToken: string };
    const watched = await respond(
      event("POST", `/api/room/${room.code}/watch`, { headers: from("198.51.100.7") }),
      rt,
    );
    const { viewerToken } = bodyOf(watched) as unknown as { viewerToken: string };
    await exhaust(rt, "198.51.100.7");

    for (const token of [sessionToken, viewerToken]) {
      const read = await respond(
        event("GET", "/api/state", {
          query: { code: room.code },
          headers: { ...from("198.51.100.7"), authorization: `Bearer ${token}` },
        }),
        rt,
      );
      expect(read.statusCode).toBe(200);
    }
  });

});

/** A well-formed code no test room has, distinct for each `i` below 576. */
function missCode(i: number): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `QQ${letters[Math.floor(i / 24) % 24]}${letters[i % 24]}`;
}

describe("POST /api/room/:code/remove", () => {
  /** A Travel Mode room opened over HTTP, so it has a host, and a second phone in it. */
  async function hosted(harness: TestHarness) {
    const rt = runtimeFor(harness);
    const opened = await respond(event("POST", "/api/room", { body: { mode: "travel" } }), rt);
    const host = bodyOf(opened) as unknown as { code: string; runId: string; deviceToken: string; host?: boolean };
    const joined = await respond(event("POST", `/api/room/${host.code}/join`, { body: {} }), rt);
    const guest = bodyOf(joined) as unknown as { playerId: string; deviceToken: string; sessionToken: string };
    return { rt, host, guest };
  }

  it("tells the device that opened a room it is the host, and nobody else", async () => {
    const harness = makeHarness();
    const { host, rt } = await hosted(harness);
    expect(host.host).toBe(true);
    const joined = await respond(event("POST", `/api/room/${host.code}/join`, { body: {} }), rt);
    expect(bodyOf(joined)).not.toHaveProperty("host");

    const tv = await respond(event("POST", "/api/room", { body: { mode: "party", display: true } }), rt);
    expect(bodyOf(tv)).toMatchObject({ host: true });
  });

  it("lets the host take a player out, by its device token", async () => {
    const harness = makeHarness();
    const { rt, host, guest } = await hosted(harness);
    const result = await respond(
      event("POST", `/api/room/${host.code}/remove`, {
        body: { playerId: guest.playerId },
        headers: { "x-kad-device-token": host.deviceToken },
      }),
      rt,
    );
    expect(result.statusCode).toBe(200);

    // And that phone cannot come back in.
    const back = await respond(
      event("POST", `/api/room/${host.code}/join`, { headers: { "x-kad-device-token": guest.deviceToken } }),
      rt,
    );
    expect(back.statusCode).toBe(403);

    // Nor go on reading the room with the session token it already holds,
    // by code or by run.
    for (const query of [{ code: host.code }, { runId: host.runId }] as Record<string, string>[]) {
      const read = await respond(
        event("GET", "/api/state", { query, headers: { authorization: `Bearer ${guest.sessionToken}` } }),
        rt,
      );
      expect(read.statusCode).toBe(403);
    }
  });

  it("refuses anybody else, and a request with no token at all", async () => {
    const harness = makeHarness();
    const { rt, host, guest } = await hosted(harness);
    const asGuest = await respond(
      event("POST", `/api/room/${host.code}/remove`, {
        body: { playerId: guest.playerId },
        headers: { "x-kad-device-token": guest.deviceToken },
      }),
      rt,
    );
    expect(asGuest.statusCode).toBe(403);
    const anonymous = await respond(
      event("POST", `/api/room/${host.code}/remove`, { body: { playerId: guest.playerId } }),
      rt,
    );
    expect(anonymous.statusCode).toBe(401);
  });

  it("insists on being told whom", async () => {
    const harness = makeHarness();
    const { rt, host } = await hosted(harness);
    const result = await respond(
      event("POST", `/api/room/${host.code}/remove`, { headers: { "x-kad-device-token": host.deviceToken } }),
      rt,
    );
    expect(result.statusCode).toBe(400);
  });

  it("counts a wrong code like any other lookup, so it is no way to test codes", async () => {
    // "No room" and "not your room" are different answers; without the guard
    // that difference would tell a guesser which codes are live.
    const harness = makeHarness();
    const { rt, host } = await hosted(harness);
    const headers = { "x-kad-device-token": host.deviceToken, "x-kad-viewer": "198.51.100.7" };
    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      const code = missCode(i);
      const missed = await respond(event("POST", `/api/room/${code}/remove`, { body: { playerId: "p" }, headers }), rt);
      expect(missed.statusCode, code).toBe(404);
    }
    const refused = await respond(
      event("POST", `/api/room/${host.code}/remove`, { body: { playerId: "p" }, headers }),
      rt,
    );
    expect(refused.statusCode).toBe(429);
  });
});

describe("whose address a miss is counted against", () => {
  /** A miss from the given headers, at the given connection address. */
  function miss(code: string, headers: Record<string, string>, sourceIp = "192.0.2.50") {
    const e = event("POST", `/api/room/${code}/join`, { headers });
    (e.requestContext.http as { sourceIp?: string }).sourceIp = sourceIp;
    return e;
  }

  it("believes CloudFront's viewer address when CloudFront's secret came with it", async () => {
    const rt = runtimeFor(makeHarness(), { originSecret: "s3cret-from-ssm" });
    const viaCloudFront = { "x-kad-viewer": "198.51.100.7", "x-kad-origin": "s3cret-from-ssm" };
    for (let i = 0; i < CODE_MISS_LIMIT; i++) await respond(miss(missCode(i), viaCloudFront), rt);

    expect((await respond(miss("WXYZ", viaCloudFront), rt)).statusCode).toBe(429);
    // The edge's own address is everyone near that edge; it was not the one counted.
    expect((await respond(miss("WXYZ", {}), rt)).statusCode).toBe(404);
  });

  it("believes no viewer address at all when no secret is configured", async () => {
    // Fail closed: a stage deployed without KAD_ORIGIN_SECRET must not let a
    // direct caller name a fresh address per guess.
    const rt = runtimeFor(makeHarness());
    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      await respond(miss(missCode(i), { "x-kad-viewer": `203.0.113.${i}` }, "198.51.100.66"), rt);
    }
    expect(
      (await respond(miss("WXYZ", { "x-kad-viewer": "203.0.113.250" }, "198.51.100.66"), rt)).statusCode,
    ).toBe(429);
  });

  it("refuses a parallel burst past the limit, however it interleaves", async () => {
    // Every request is admitted by one conditional write before its lookup,
    // so a burst cannot all read "under the limit" first.
    const rt = runtimeFor(makeHarness());
    const results = await Promise.all(
      Array.from({ length: CODE_MISS_LIMIT * 2 }, (_, i) => respond(miss(missCode(i), {}, "198.51.100.66"), rt)),
    );
    const statuses = results.map((r) => r.statusCode);
    expect(statuses.filter((s) => s === 404)).toHaveLength(CODE_MISS_LIMIT);
    expect(statuses.filter((s) => s === 429)).toHaveLength(CODE_MISS_LIMIT);
  });

  it("ignores a viewer address a caller sent around CloudFront", async () => {
    /*
     * The API's own execute-api address skips CloudFront. A caller there can
     * name a fresh `x-kad-viewer` on every guess; its connection address is the
     * one thing it cannot change, so that is what is counted.
     */
    const rt = runtimeFor(makeHarness(), { originSecret: "s3cret-from-ssm" });
    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      const forged = { "x-kad-viewer": `203.0.113.${i}`, "x-kad-origin": "wrong" };
      await respond(miss(missCode(i), forged, "198.51.100.66"), rt);
    }
    expect(
      (await respond(miss("WXYZ", { "x-kad-viewer": "203.0.113.200" }, "198.51.100.66"), rt)).statusCode,
    ).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Presence beats (#258): production's only presence
// ---------------------------------------------------------------------------

describe("POST /api/presence", () => {
  it("takes a beat from a seated phone's session token, and nothing without one", async () => {
    const harness = makeHarness();
    const room = await seedRoom(harness);
    const join = await respond(
      event("POST", `/api/room/${room.code}/join`, { headers: { "x-kad-device-token": room.player.deviceToken } }),
      runtimeFor(harness),
    );
    const { sessionToken } = bodyOf(join) as unknown as { sessionToken: string };

    const anonymous = await respond(event("POST", "/api/presence", { body: {} }), runtimeFor(harness));
    expect(anonymous.statusCode).toBe(401);

    const beat = await respond(
      event("POST", "/api/presence", { body: {}, headers: { authorization: `Bearer ${sessionToken}` } }),
      runtimeFor(harness),
    );
    expect(beat.statusCode).toBe(200);
    expect(bodyOf(beat)).toMatchObject({ ok: true, connected: true });

    const leaving = await respond(
      event("POST", "/api/presence", { body: { leaving: true }, headers: { authorization: `Bearer ${sessionToken}` } }),
      runtimeFor(harness),
    );
    expect(bodyOf(leaving)).toMatchObject({ ok: true, connected: false });
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
    const { sessionToken, state } = bodyOf(join) as unknown as { sessionToken: string; state: { seq: number } };
    // A first join puts the player on the host's roster (#263), which is a seq.
    return { ...room, sessionToken, seq: state.seq };
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
          seq: room.seq,
          intent: { type: "CHOOSE", choiceId: "east" },
        },
      }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(401);
    expect(bodyOf(result).error).toMatchObject({ code: "FORBIDDEN" });
    // And nothing moved.
    expect((await harness.repo.getState(room.runId))?.seq).toBe(room.seq);
  });

  it("refuses a valid session token pointed at another run", async () => {
    const harness = makeHarness();
    const room = await joined(harness);

    const result = await respond(
      event("POST", "/api/action", {
        body: {
          runId: "r_someone_else",
          playerId: room.player.principal.playerId,
          seq: room.seq,
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
      seq: room.seq,
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
          seq: room.seq,
          intent: { type: "CHOOSE", choiceId: "east" },
        },
        headers: { authorization: `Bearer ${room.sessionToken}` },
      }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toEqual({ ok: true, seq: room.seq + 1 });
    expect((await harness.repo.getState(room.runId))?.seq).toBe(room.seq + 1);
  });

  it("reads the bearer scheme case-insensitively and ignores a bare token", async () => {
    const harness = makeHarness();
    const room = await joined(harness);
    const body = {
      runId: room.runId,
      playerId: room.player.principal.playerId,
      seq: room.seq,
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
        body: { ...body, seq: room.seq + 1 },
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
// POST /api/progression/spend
// ---------------------------------------------------------------------------

describe("POST /api/progression/spend", () => {
  async function joinedRoom(harness: TestHarness) {
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

  it("refuses a spend with no session token", async () => {
    const harness = makeHarness();
    await joinedRoom(harness);

    const result = await respond(
      event("POST", "/api/progression/spend", { body: { stat: "might" } }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(401);
    expect(bodyOf(result).error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a body that names no stat", async () => {
    const harness = makeHarness();
    const room = await joinedRoom(harness);

    const result = await respond(
      event("POST", "/api/progression/spend", {
        body: {},
        headers: { authorization: `Bearer ${room.sessionToken}` },
      }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(400);
    expect(bodyOf(result).error).toMatchObject({ message: "expected { stat }" });
  });

  it("takes the run and the player from the session, never from the body", async () => {
    /*
     * The same rule `postAction` holds, and worth pinning separately because
     * this route does not forward an intent it was handed — it builds one, from
     * ids it chooses. Party player ids are in the room state every client
     * holds, so a body naming somebody else must not spend their stat point.
     *
     * Asserted as "the extra fields changed nothing": a request carrying a
     * foreign runId and playerId gets byte-identical output to one carrying
     * neither. If either were read, the foreign run would fail its own way
     * (an unknown run is NOT_FOUND, not this) and the two would diverge.
     */
    const harness = makeHarness();
    const room = await joinedRoom(harness);
    const rt = runtimeFor(harness);
    const spend = (body: Record<string, unknown>) =>
      respond(
        event("POST", "/api/progression/spend", {
          body,
          headers: { authorization: `Bearer ${room.sessionToken}` },
        }),
        rt,
      );

    const honest = await spend({ stat: "might" });
    const lying = await spend({ stat: "might", runId: "r_somebody_else", playerId: "p_99" });

    expect(lying.statusCode).toBe(honest.statusCode);
    expect(bodyOf(lying)).toEqual(bodyOf(honest));
    expect(honest.body).not.toContain("r_somebody_else");
    expect(honest.body).not.toContain("p_99");
  });

  it("returns a refused spend as 200 with ok:false, like every other intent", async () => {
    /*
     * A stat point that cannot be spent is protocol, not an HTTP failure — the
     * client reads `error.code` and carries on. The refusal here comes from
     * `applyAction`'s own guard rather than from the engine: a spend outside a
     * Rest scene never reaches `applyIntent` at all.
     */
    const harness = makeHarness();
    const room = await joinedRoom(harness);

    const result = await respond(
      event("POST", "/api/progression/spend", {
        body: { stat: "might" },
        headers: { authorization: `Bearer ${room.sessionToken}` },
      }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
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

  /** A seeded room and the session token its player gets on joining. */
  async function seated(harness: TestHarness) {
    const room = await seedRoom(harness);
    const joined = await respond(
      event("POST", `/api/room/${room.code}/join`, { headers: { "x-kad-device-token": room.player.deviceToken } }),
      runtimeFor(harness),
    );
    const { sessionToken } = bodyOf(joined) as unknown as { sessionToken: string };
    return { room, bearer: { authorization: `Bearer ${sessionToken}` } };
  }

  it("resolves a room code, upper-cased, for somebody in the room", async () => {
    const harness = makeHarness();
    const { room, bearer } = await seated(harness);
    const result = await respond(
      event("GET", "/api/state", { query: { code: room.code.toLowerCase() }, headers: bearer }),
      runtimeFor(harness),
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result)).toHaveProperty("state");
  });

  it("reads nothing for a caller with only the code, and says so as if there were no room", async () => {
    // #267. A code alone let anyone read the party's names and every move
    // without showing up in the room. The answer matches an unknown code's, so
    // it tells a guesser nothing about which codes are live.
    const harness = makeHarness();
    const room = await seedRoom(harness);
    for (const query of [{ code: room.code }, { runId: room.runId }] as Record<string, string>[]) {
      const result = await respond(event("GET", "/api/state", { query }), runtimeFor(harness));
      expect(result.statusCode).toBe(404);
      expect(bodyOf(result).error).toMatchObject({ code: "NOT_FOUND" });
    }
    const unknown = await respond(event("GET", "/api/state", { query: { code: "WXYZ" } }), runtimeFor(harness));
    expect(bodyOf(unknown).error).toMatchObject({ message: "no open room WXYZ" });
  });

  it("does not let a token for one room read another", async () => {
    const harness = makeHarness();
    const { bearer } = await seated(harness);
    const other = await createRoom({ householdId: "h_test", mode: "party" }, harness.deps);
    if (!other.ok) throw new Error("setup failed");
    for (const query of [{ code: other.value.code }, { runId: other.value.runId }] as Record<string, string>[]) {
      const result = await respond(event("GET", "/api/state", { query, headers: bearer }), runtimeFor(harness));
      expect(result.statusCode).toBe(404);
    }
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
    const { room, bearer } = await seated(harness);
    const result = await respond(
      event("GET", "/api/state", { query: { code: room.code, runId: "r_other" }, headers: bearer }),
      runtimeFor(harness),
    );
    expect(result.statusCode).toBe(404);
  });

  it("passes sinceSeq through as a number, and omits it when absent", async () => {
    const harness = makeHarness();
    const { room, bearer } = await seated(harness);
    const seq = (await harness.repo.getState(room.runId))?.seq ?? 0;

    // Caught up, so events rather than a snapshot.
    const caught = await respond(
      event("GET", "/api/state", { query: { runId: room.runId, sinceSeq: String(seq) }, headers: bearer }),
      runtimeFor(harness),
    );
    expect(bodyOf(caught)).toEqual({ seq, events: [] });

    // No sinceSeq is a cold client, which must get the whole state.
    const cold = await respond(
      event("GET", "/api/state", { query: { runId: room.runId }, headers: bearer }),
      runtimeFor(harness),
    );
    expect(bodyOf(cold)).toHaveProperty("state");
  });
});

// ---------------------------------------------------------------------------
// Sign-in — the routes with no dev-server twin
// ---------------------------------------------------------------------------

describe("/api/pair/* (#281)", () => {
  const post = (path: string, headers: Record<string, string>, body: Record<string, unknown> = {}) =>
    event("POST", path, { headers, body });

  it("pairs a new browser from a bound phone, with no sign-in anywhere", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    const { players } = await seedHousehold(harness, 1);
    const phone = players[0]!;

    const made = await respond(post("/api/pair/code", { "x-kad-device-token": phone.deviceToken }), rt);
    expect(made.statusCode).toBe(200);
    const { code } = bodyOf(made) as unknown as { code: string };

    const redeemed = await respond(post("/api/pair/redeem", {}, { code }), rt);
    expect(redeemed.statusCode).toBe(200);
    const bound = bodyOf(redeemed) as unknown as { deviceToken: string; playerId: string; householdId: string };
    expect(bound).toMatchObject({ playerId: "p_1", householdId: "h_test" });
    expect(await harness.identity.resolveDevice(bound.deviceToken)).toMatchObject({ playerId: "p_1" });

    // Single use.
    const again = await respond(post("/api/pair/redeem", {}, { code }), rt);
    expect(again.statusCode).toBe(404);
  });

  it("makes no code for a device that is not her: unbound is 401, a shared tablet 403", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    const { householdId } = await seedHousehold(harness, 1);

    expect((await respond(post("/api/pair/code", {}), rt)).statusCode).toBe(401);
    const tablet = await harness.identity.issueSharedDeviceToken({ householdId });
    const refused = await respond(post("/api/pair/code", { "x-kad-shared-token": tablet.token }), rt);
    expect(refused.statusCode).toBe(403);
  });

  it("answers 429 once a client has missed too many codes", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      expect((await respond(post("/api/pair/redeem", {}, { code: "ZZZZZZZZ" }), rt)).statusCode).toBe(404);
    }
    const slow = await respond(post("/api/pair/redeem", {}, { code: "ZZZZZZZZ" }), rt);
    expect(slow.statusCode).toBe(429);
    expect(slow.headers?.["retry-after"]).toBeTruthy();
  });
});

describe("/api/organizer/* (#248)", () => {
  const signedIn = (token: string) => ({ authorization: `Bearer ${token}` });
  const answer = (result: APIGatewayProxyStructuredResultV2) =>
    JSON.parse(result.body ?? "{}") as Record<string, unknown>;

  it("needs a verified sign-in on every route, and says which route it is not", async () => {
    const rt = runtimeFor(makeHarness());
    for (const [method, path] of [
      ["GET", "/api/organizer/households"],
      ["POST", "/api/organizer/households"],
      ["GET", "/api/organizer/household"],
      ["POST", "/api/organizer/household/rename"],
      ["POST", "/api/organizer/players"],
      ["POST", "/api/organizer/players/rename"],
      ["POST", "/api/organizer/players/retire"],
      ["POST", "/api/organizer/players/pair"],
      ["POST", "/api/organizer/invite"],
      ["POST", "/api/organizer/invite/accept"],
      ["POST", "/api/organizer/transfer"],
      ["POST", "/api/organizer/transfer/accept"],
      ["POST", "/api/organizer/owners/remove"],
      ["POST", "/api/organizer/heroes/leave"],
      ["POST", "/api/organizer/players/delete"],
      ["POST", "/api/organizer/household/delete"],
      ["POST", "/api/organizer/household/retention"],
    ] as const) {
      const result = await respond(event(method, path), rt);
      expect(result.statusCode, `${method} ${path}`).toBe(401);
    }
    const unknown = await respond(event("GET", "/api/organizer/nope", { headers: signedIn("t") }), rt);
    expect(unknown.statusCode).toBe(404);
  });

  it("lets two signed-in grown-ups run one group", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    const as = (account: VerifiedAccount) => {
      rt.account = account;
      return signedIn(account.cognitoSub);
    };
    const ana = { cognitoSub: "sub_ana", email: "ana@example.com" };
    const ben = { cognitoSub: "sub_ben", email: "ben@example.com" };

    const created = await respond(
      event("POST", "/api/organizer/households", { headers: as(ana), body: { displayName: "Club" } }),
      rt,
    );
    expect(created.statusCode).toBe(200);
    const groupId = answer(created).id as string;

    const invite = await respond(
      event("POST", "/api/organizer/invite", { headers: as(ana), body: { householdId: groupId } }),
      rt,
    );
    const accepted = await respond(
      event("POST", "/api/organizer/invite/accept", { headers: as(ben), body: { code: answer(invite).code } }),
      rt,
    );
    expect(accepted.statusCode).toBe(200);

    await respond(
      event("POST", "/api/organizer/players", { headers: as(ben), body: { householdId: groupId, displayName: "Posy" } }),
      rt,
    );
    const view = await respond(
      event("GET", "/api/organizer/household", { headers: as(ana), query: { householdId: groupId } }),
      rt,
    );
    expect(view.statusCode).toBe(200);
    expect((answer(view).players as { displayName: string }[]).map((p) => p.displayName)).toEqual(["Posy"]);

    // A third account is refused, with the status the client shows.
    const eve = await respond(
      event("GET", "/api/organizer/household", { headers: as({ cognitoSub: "sub_eve" }), query: { householdId: groupId } }),
      rt,
    );
    expect(eve.statusCode).toBe(403);
  });

  it("deletes a kid, sets how long kids are kept, and deletes the household (#252)", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    const as = (account: VerifiedAccount) => {
      rt.account = account;
      return signedIn(account.cognitoSub);
    };
    const ana = { cognitoSub: "sub_ana" };
    const ben = { cognitoSub: "sub_ben" };
    const groupId = answer(
      await respond(event("POST", "/api/organizer/households", { headers: as(ana), body: { displayName: "Club" } }), rt),
    ).id as string;
    const added = await respond(
      event("POST", "/api/organizer/players", { headers: as(ana), body: { householdId: groupId, displayName: "Posy" } }),
      rt,
    );
    const posy = (answer(added).players as { id: string }[])[0]!.id;

    const kept = await respond(
      event("POST", "/api/organizer/household/retention", { headers: as(ana), body: { householdId: groupId, retentionDays: 90 } }),
      rt,
    );
    expect(answer(kept).retentionDays).toBe(90);
    const odd = await respond(
      event("POST", "/api/organizer/household/retention", { headers: as(ana), body: { householdId: groupId, retentionDays: 3 } }),
      rt,
    );
    expect(odd.statusCode).toBe(409);

    // Only an owner of her home.
    const stranger = await respond(
      event("POST", "/api/organizer/players/delete", { headers: as(ben), body: { householdId: groupId, playerId: posy } }),
      rt,
    );
    expect(stranger.statusCode).toBe(403);
    const gone = await respond(
      event("POST", "/api/organizer/players/delete", { headers: as(ana), body: { householdId: groupId, playerId: posy } }),
      rt,
    );
    expect(gone.statusCode).toBe(200);
    expect(answer(gone).players).toEqual([]);
    expect(await harness.repo.getPlayer(groupId, posy)).toBeNull();

    const deleted = await respond(
      event("POST", "/api/organizer/household/delete", { headers: as(ana), body: { householdId: groupId } }),
      rt,
    );
    expect(deleted.statusCode).toBe(200);
    expect(answer(deleted)).toEqual({ householdId: groupId, households: [] });
    expect(await harness.repo.getHousehold(groupId)).toBeNull();
    const again = await respond(
      event("POST", "/api/organizer/household/delete", { headers: as(ana), body: { householdId: groupId } }),
      rt,
    );
    expect(again.statusCode).toBe(403);
  });

  it("passes the picked household through sign-in and tablet set-up", async () => {
    const harness = makeHarness();
    const rt = runtimeFor(harness);
    rt.account = { cognitoSub: "sub_ana" };
    const make = async (displayName: string) =>
      answer(
        await respond(event("POST", "/api/organizer/households", { headers: signedIn("t"), body: { displayName } }), rt),
      ).id as string;
    await make("Family");
    const club = await make("Club");

    const link = await respond(
      event("POST", "/api/auth/link", { headers: signedIn("t"), body: { householdId: club, preferExisting: true } }),
      rt,
    );
    expect(answer(link).householdId).toBe(club);
    expect((answer(link).households as unknown[]).length).toBe(2);

    const unsure = await respond(event("POST", "/api/auth/shared-device", { headers: signedIn("t") }), rt);
    expect(unsure.statusCode).toBe(409);
    const tablet = await respond(
      event("POST", "/api/auth/shared-device", { headers: signedIn("t"), body: { householdId: club } }),
      rt,
    );
    expect(answer(tablet).householdId).toBe(club);
  });
});

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

  it("refuses a phone that only joined with the room code, and tells only the host it may keep (#265)", async () => {
    // Review of #271: the join hands a stranger a real device token for the
    // household, and signing in to their own account must not claim it.
    const harness = makeHarness();
    const created = await respond(
      event("POST", "/api/room", { body: { mode: "travel" } }),
      runtimeFor(harness),
    );
    const host = bodyOf(created) as unknown as { code: string; keeper?: boolean };
    expect(host.keeper).toBe(true);

    const joined = await respond(
      event("POST", `/api/room/${host.code}/join`, { body: { displayName: "Who?" } }),
      runtimeFor(harness),
    );
    const stranger = bodyOf(joined) as unknown as { deviceToken: string; keeper?: boolean };
    expect(joined.statusCode).toBe(200);
    expect(stranger.keeper).toBeUndefined();

    const rt = runtimeFor(harness);
    rt.account = { cognitoSub: "sub-stranger" };
    const result = await respond(
      event("POST", "/api/auth/link", {
        headers: { authorization: "Bearer good", "x-kad-device-token": stranger.deviceToken },
      }),
      rt,
    );
    expect(result.statusCode).toBe(403);
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
      issueSharedDeviceToken: (input) => real.issueSharedDeviceToken(input),
      resolveSharedDevice: (token) => real.resolveSharedDevice(token),
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
  // The parameterised ones, spelled as regexes: `([A-Za-z]{4})\/watch$`, or
  // `([A-Za-z]{4}|[A-Za-z]{6})\/join$` where a visitor code is taken too.
  for (const [, segment] of source.matchAll(/\(\[A-Za-z\]\{4\}(?:\|\[A-Za-z\]\{6\})?\)\\\/(\w+)\$/g)) {
    if (segment) found.add(`/api/room/:code/${segment}`);
  }
  return found;
}

/**
 * Same paths, written the way each side spells them.
 *
 * The organizer routes (#248) are not here, and need not be: both sides
 * dispatch them through one table, `organizerRoute` in handlers/organizer.ts,
 * so they cannot drift apart.
 */
const SHARED = [
  { path: "/api/room", method: "POST", probe: "/api/room" },
  { path: "/api/room/:code/join", method: "POST", probe: "/api/room/ABCD/join" },
  { path: "/api/room/:code/watch", method: "POST", probe: "/api/room/ABCD/watch" },
  // The host taking a player out (#267, handlers/remove.ts).
  { path: "/api/room/:code/remove", method: "POST", probe: "/api/room/ABCD/remove" },
  // Host controls (#263, handlers/host.ts).
  { path: "/api/room/:code/lock", method: "POST", probe: "/api/room/ABCD/lock" },
  { path: "/api/room/:code/quiet", method: "POST", probe: "/api/room/ABCD/quiet" },
  { path: "/api/room/:code/close", method: "POST", probe: "/api/room/ABCD/close" },
  // Stop for today, and keep going another day (#259, handlers/save.ts).
  { path: "/api/room/:code/stop", method: "POST", probe: "/api/room/ABCD/stop" },
  { path: "/api/resume", method: "POST", probe: "/api/resume" },
  { path: "/api/save/release", method: "POST", probe: "/api/save/release" },
  // A signed-in owner opening the room to visitors (#249, handlers/visitors.ts).
  { path: "/api/room/:code/visitors", method: "POST", probe: "/api/room/ABCD/visitors" },
  { path: "/api/action", method: "POST", probe: "/api/action" },
  { path: "/api/preview", method: "POST", probe: "/api/preview" },
  // A phone saying it is still here, or leaving (#258, handlers/presence.ts).
  { path: "/api/presence", method: "POST", probe: "/api/presence" },
  { path: "/api/progression/spend", method: "POST", probe: "/api/progression/spend" },
  { path: "/api/state", method: "GET", probe: "/api/state" },
  { path: "/api/health", method: "GET", probe: "/api/health" },
  // A crash report from a phone or the TV, logged scrubbed and not stored (#317).
  { path: "/api/client-error", method: "POST", probe: "/api/client-error" },
  // Prod verifies a Cognito id token; dev verifies the unsigned stand-in from
  // `dev-auth.ts`. Same handlers, same shapes.
  // A player's saved heroes, to bring one back (handlers/heroes.ts).
  { path: "/api/heroes", method: "GET", probe: "/api/heroes" },
  // What a phone can study between games (handlers/journal.ts).
  { path: "/api/journal", method: "GET", probe: "/api/journal" },
  // What a kid picked for her own page (#299, handlers/profile.ts).
  { path: "/api/profile/flair", method: "POST", probe: "/api/profile/flair" },
  { path: "/api/auth/link", method: "POST", probe: "/api/auth/link" },
  { path: "/api/auth/device", method: "POST", probe: "/api/auth/device" },
  // A family tablet (#250, handlers/shared-device.ts): made shared, its
  // "who's playing?" picker, and forgotten.
  { path: "/api/auth/shared-device", method: "POST", probe: "/api/auth/shared-device" },
  { path: "/api/auth/forget-device", method: "POST", probe: "/api/auth/forget-device" },
  { path: "/api/household/players", method: "GET", probe: "/api/household/players" },
  // Pairing a new device to a kid (#281, handlers/pairing.ts): her own phone
  // makes a code, the new device redeems it.
  { path: "/api/pair/code", method: "POST", probe: "/api/pair/code" },
  { path: "/api/pair/redeem", method: "POST", probe: "/api/pair/redeem" },
] as const;

/**
 * Routes that exist in prod and have no local twin — **by design, not by
 * drift**.
 *
 * `/api/config` describes the stack's user pool and AppSync channel. A laptop
 * has neither, and the client reads the 404 as "use SSE" (`sync/client.ts`
 * `fetchConfig()`), so a local twin would switch realtime to a channel that
 * does not exist.
 *
 * The auth pair used to be here too, for want of a pool to mint id tokens. The
 * dev stand-in in `dev-auth.ts` is that pool, so they moved to `SHARED`.
 * Growing this list should be a deliberate act with a reason written down.
 */
const PROD_ONLY = [
  // Served from the stack's environment; the dev client has no pool to describe.
  { path: "/api/config", method: "GET" },
] as const;

/** The reverse: local-only, and deliberately so. */
const DEV_ONLY = [
  // The SSE stand-in for the AppSync Events channel. In prod the client
  // subscribes to AppSync directly and never asks the API for a stream.
  { path: "/events/:code", method: "GET" },
  // How the client learns it may offer the pool-free dev sign-in. Prod must
  // never answer it: the dev token it unlocks is unsigned.
  { path: "/api/auth/dev", method: "GET" },
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

/** The seq a create or join answered with: its state's, which a first join has moved (#263). */
function seqOf(body: Record<string, unknown>): number {
  return (body.state as unknown as { seq: number }).seq;
}

describe("bringing a hero back (spec §5)", () => {
  it("lists a player's saved hero in a later room, and seats it there", async () => {
    // The real engine: this is about a character surviving from one run to the
    // next, which the stub engine cannot build in the first place.
    const harness = makeHarness({ engine: { applyIntent, createRunState } });
    const rt = runtimeFor(harness);

    // Night one: a room, and a hero made in it.
    const first = bodyOf(
      await respond(event("POST", "/api/room", { body: { mode: "travel", displayName: "Ada" } }), rt),
    ) as Record<string, string>;
    const made = bodyOf(
      await respond(
        event("POST", "/api/action", {
          body: {
            runId: first.runId,
            playerId: first.playerId,
            seq: seqOf(first),
            intent: {
              type: "CREATE_CHARACTER",
              name: "Sparklehoof",
              species: "unicorn",
              class: "songkeeper",
              stats: { might: 0, quick: 0, clever: 0, heart: 3 },
              appearance: { palette: "meadow", accent: "#7FD4C1" },
            },
          },
          headers: { authorization: `Bearer ${String(first.sessionToken)}` },
        }),
        rt,
      ),
    );
    expect(made, JSON.stringify(made)).toMatchObject({ ok: true });

    // Night two: the same phone opens a new room in the same household.
    const second = bodyOf(
      await respond(
        event("POST", "/api/room", {
          body: { mode: "travel" },
          headers: { "x-kad-device-token": String(first.deviceToken) },
        }),
        rt,
      ),
    ) as Record<string, string>;
    expect(second.runId).not.toBe(first.runId);
    const bearer = { authorization: `Bearer ${String(second.sessionToken)}` };

    const listed = await respond(event("GET", "/api/heroes", { headers: bearer }), rt);
    expect(listed.statusCode).toBe(200);
    const heroes = (bodyOf(listed) as unknown as { heroes: { id: string; name: string; level: number }[] }).heroes;
    expect(heroes).toEqual([expect.objectContaining({ name: "Sparklehoof", level: 1 })]);

    const seated = bodyOf(
      await respond(
        event("POST", "/api/action", {
          body: {
            runId: second.runId,
            playerId: second.playerId,
            seq: seqOf(second),
            intent: { type: "SEAT_CHARACTER", characterId: heroes[0]!.id },
          },
          headers: bearer,
        }),
        rt,
      ),
    );
    expect(seated, JSON.stringify(seated)).toMatchObject({ ok: true });
    const state = await harness.repo.getState(String(second.runId));
    expect(state?.party.map((m) => m.character.id)).toEqual([heroes[0]!.id]);
  });

  it("opens the journal with only the device token, between games", async () => {
    const harness = makeHarness({ engine: { applyIntent, createRunState } });
    const rt = runtimeFor(harness);
    const room = bodyOf(
      await respond(event("POST", "/api/room", { body: { mode: "travel", displayName: "Ada" } }), rt),
    ) as Record<string, string>;
    await respond(
      event("POST", "/api/action", {
        body: {
          runId: room.runId,
          playerId: room.playerId,
          seq: seqOf(room),
          intent: {
            type: "CREATE_CHARACTER",
            name: "Sparklehoof",
            species: "unicorn",
            class: "songkeeper",
            stats: { might: 0, quick: 0, clever: 0, heart: 3 },
            appearance: { palette: "meadow", accent: "#7FD4C1" },
          },
        },
        headers: { authorization: `Bearer ${String(room.sessionToken)}` },
      }),
      rt,
    );

    const journal = await respond(
      event("GET", "/api/journal", { headers: { "x-kad-device-token": String(room.deviceToken) } }),
      rt,
    );
    expect(journal.statusCode).toBe(200);
    expect(bodyOf(journal)).toMatchObject({
      heroes: [expect.objectContaining({ name: "Sparklehoof" })],
      finders: { [String(room.playerId)]: "Sparklehoof" },
    });
  });

  it("refuses the journal without a device token", async () => {
    const result = await respond(event("GET", "/api/journal"), runtimeFor(makeHarness()));
    expect(result.statusCode).toBe(401);
  });

  it("needs a room session to list heroes", async () => {
    const result = await respond(event("GET", "/api/heroes"), runtimeFor(makeHarness()));
    expect(result.statusCode).toBe(401);
  });
});
