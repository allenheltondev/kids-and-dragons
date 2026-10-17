/**
 * Shared devices (#250), end to end through `respond()`: a family tablet the
 * kids take turns on. What this file proves is the issue's "done when":
 *
 *   - two kids take turns on one tablet across two sessions, and each always
 *     lands in their own hero;
 *   - clearing the tablet's storage loses nobody's hero;
 *   - no long-lived token for a kid is ever handed to a shared device.
 */

import { describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { createRoom } from "../handlers/room.ts";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { respond, type HttpRuntime } from "./http.ts";
import type { VerifiedAccount } from "./runtime.ts";

const OWNER: VerifiedAccount = { cognitoSub: "sub-test", email: "grown-up@example.com" };

function runtime(harness: TestHarness, account: VerifiedAccount | null = OWNER): HttpRuntime {
  return {
    deps: async () => harness.deps,
    verifyAccount: async (token: string) => (token ? account : null),
  };
}

function event(
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method, sourceIp: "10.0.0.1" } },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: init.headers ?? {},
  } as unknown as APIGatewayProxyEventV2;
}

function bodyOf(result: APIGatewayProxyStructuredResultV2): Record<string, unknown> {
  return JSON.parse(result.body ?? "{}") as Record<string, unknown>;
}

/**
 * Everything a tablet is ever handed, so the last test can say none of it is a
 * kid's device token: every body and every header of every response.
 */
function recorder(harness: TestHarness, account: VerifiedAccount | null = OWNER) {
  const rt = runtime(harness, account);
  const seen: APIGatewayProxyStructuredResultV2[] = [];
  return {
    seen,
    async send(e: APIGatewayProxyEventV2) {
      const result = await respond(e, rt);
      seen.push(result);
      return result;
    },
  };
}

/** A kept household with two kids, each with a hero, and an owner signed in. */
async function family() {
  const harness = makeHarness();
  const { householdId, players } = await seedHousehold(harness, 2);
  await harness.repo.putAccountPointer(OWNER.cognitoSub, householdId);
  const [ada, ben] = players;
  if (!ada || !ben) throw new Error("setup failed");
  await harness.repo.putCharacter({
    ...makeCharacter({ id: "c_ada", ownerPlayerId: ada.principal.playerId, name: "Sparklehoof" }),
    householdId,
  });
  await harness.repo.putCharacter({
    ...makeCharacter({ id: "c_ben", ownerPlayerId: ben.principal.playerId, name: "Rumble" }),
    householdId,
  });
  return { harness, householdId, ada, ben };
}

async function openRoom(harness: TestHarness, householdId: string): Promise<string> {
  const created = await createRoom({ householdId, mode: "party" }, harness.deps);
  if (!created.ok) throw new Error(created.error.message);
  return created.value.code;
}

async function makeShared(
  send: (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>,
  headers: Record<string, string> = {},
): Promise<string> {
  const result = await send(
    event("POST", "/api/auth/shared-device", { headers: { authorization: "Bearer id-token", ...headers } }),
  );
  expect(result.statusCode).toBe(200);
  const token = bodyOf(result).sharedToken;
  if (typeof token !== "string") throw new Error("no shared token");
  return token;
}

describe("making a device shared", () => {
  it("needs a signed-in owner", async () => {
    const { harness } = await family();
    const anonymous = await respond(event("POST", "/api/auth/shared-device"), runtime(harness));
    expect(anonymous.statusCode).toBe(401);

    const stranger = runtime(harness, { cognitoSub: "sub-nobody" });
    const result = await respond(
      event("POST", "/api/auth/shared-device", { headers: { authorization: "Bearer id-token" } }),
      stranger,
    );
    expect(result.statusCode).toBe(404);
  });

  it("revokes the personal binding the device had, and lists the household for the picker", async () => {
    const { harness, ada } = await family();
    const tablet = recorder(harness);

    const result = await tablet.send(
      event("POST", "/api/auth/shared-device", {
        headers: { authorization: "Bearer id-token", "x-kad-device-token": ada.deviceToken },
      }),
    );
    expect(result.statusCode).toBe(200);
    const body = bodyOf(result);
    expect(body.players).toEqual([
      expect.objectContaining({ id: "p_1", heroes: ["Sparklehoof"] }),
      expect.objectContaining({ id: "p_2", heroes: ["Rumble"] }),
    ]);
    // Ada's own token, left on the tablet, is dead: it would have been a
    // month-long credential for her on a device everybody uses.
    expect(await harness.identity.resolveDevice(ada.deviceToken)).toBeNull();
  });

  it("is its own kind of token: never a player's, and a player's is never one", async () => {
    const { harness, ada } = await family();
    const shared = await makeShared((e) => respond(e, runtime(harness)));

    expect(await harness.identity.resolveDevice(shared)).toBeNull();
    expect(await harness.identity.resolveSharedDevice(ada.deviceToken)).toBeNull();
    expect(await harness.identity.resolveSharedDevice(shared)).toMatchObject({ kind: "shared" });

    // Nor does it stand in for one anywhere a device token is asked for.
    const journal = await respond(
      event("GET", "/api/journal", { headers: { "x-kad-device-token": shared } }),
      runtime(harness),
    );
    expect(journal.statusCode).toBe(401);
  });
});

describe("taking turns on one tablet", () => {
  it("lands each kid in their own hero, across two sessions", async () => {
    const { harness, householdId } = await family();
    const tablet = recorder(harness);
    const shared = await makeShared(tablet.send);

    const picker = await tablet.send(event("GET", "/api/household/players", { headers: { "x-kad-shared-token": shared } }));
    expect(picker.statusCode).toBe(200);
    expect((bodyOf(picker).players as unknown[]).length).toBe(2);

    for (const [kid, hero] of [
      ["p_1", "Sparklehoof"],
      ["p_2", "Rumble"],
      ["p_1", "Sparklehoof"],
    ] as const) {
      const code = await openRoom(harness, householdId);
      const joined = await tablet.send(
        event("POST", `/api/room/${code}/join`, {
          body: { playerId: kid },
          headers: { "x-kad-shared-token": shared },
        }),
      );
      expect(joined.statusCode).toBe(200);
      const seat = bodyOf(joined);
      expect(seat.playerId).toBe(kid);

      const heroes = await tablet.send(
        event("GET", "/api/heroes", { headers: { authorization: `Bearer ${String(seat.sessionToken)}` } }),
      );
      expect((bodyOf(heroes).heroes as Array<{ name: string }>).map((h) => h.name)).toEqual([hero]);
    }
  });

  it("opens a room for the kid picked, which only the tablet may watch", async () => {
    const { harness } = await family();
    const tablet = recorder(harness);
    const shared = await makeShared(tablet.send);

    const created = await tablet.send(
      event("POST", "/api/room", { body: { mode: "travel", playerId: "p_2" }, headers: { "x-kad-shared-token": shared } }),
    );
    expect(created.statusCode).toBe(200);
    const body = bodyOf(created);
    expect(body).toMatchObject({ playerId: "p_2" });
    expect(body.sessionToken).toEqual(expect.any(String));
    // Not told it is the host: Remove needs a phone's own token, which no tablet holds.
    expect(body).not.toHaveProperty("host");

    // But it is the host on the server, so a stranger with the code still cannot watch.
    const watched = await respond(event("POST", `/api/room/${String(body.code)}/watch`), runtime(harness));
    expect(watched.statusCode).toBe(403);
  });

  it("adds a kid new to the household as a profile with no device", async () => {
    const { harness, householdId } = await family();
    const tablet = recorder(harness);
    const shared = await makeShared(tablet.send);
    const code = await openRoom(harness, householdId);
    const before = (await harness.repo.listDevices(householdId)).length;

    const joined = await tablet.send(
      event("POST", `/api/room/${code}/join`, {
        body: { newPlayer: "  Cass  " },
        headers: { "x-kad-shared-token": shared },
      }),
    );
    expect(joined.statusCode).toBe(200);
    const players = await harness.repo.listPlayers(householdId);
    expect(players.map((p) => p.displayName)).toContain("Cass");
    expect((await harness.repo.listDevices(householdId)).length).toBe(before);
  });

  it("refuses a seat it cannot name", async () => {
    const { harness, householdId } = await family();
    const shared = await makeShared((e) => respond(e, runtime(harness)));
    const code = await openRoom(harness, householdId);

    // "Player 1" is already in the family: a second face with that name would be a coin toss.
    for (const body of [
      {},
      { playerId: "p_nobody" },
      { newPlayer: "   " },
      { newPlayer: "x".repeat(25) },
      { newPlayer: "player 1" },
    ]) {
      const result = await respond(
        event("POST", `/api/room/${code}/join`, { body, headers: { "x-kad-shared-token": shared } }),
        runtime(harness),
      );
      expect(result.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it("loses nobody's hero when the tablet's storage is cleared", async () => {
    const { harness, householdId } = await family();
    const tablet = recorder(harness);
    await makeShared(tablet.send);

    // Storage cleared: the token is simply gone. A grown-up sets the tablet
    // up again, and the kids are all still there to pick.
    const again = await makeShared(tablet.send);
    const code = await openRoom(harness, householdId);
    const joined = await tablet.send(
      event("POST", `/api/room/${code}/join`, { body: { playerId: "p_2" }, headers: { "x-kad-shared-token": again } }),
    );
    const heroes = await tablet.send(
      event("GET", "/api/heroes", { headers: { authorization: `Bearer ${String(bodyOf(joined).sessionToken)}` } }),
    );
    expect((bodyOf(heroes).heroes as Array<{ name: string }>).map((h) => h.name)).toEqual(["Rumble"]);
  });
});

describe("forget this device", () => {
  it("revokes the tablet, and a forgotten tablet is told so rather than made somebody", async () => {
    const { harness, householdId } = await family();
    const tablet = recorder(harness);
    const shared = await makeShared(tablet.send);
    const players = (await harness.repo.listPlayers(householdId)).length;

    const forgot = await tablet.send(
      event("POST", "/api/auth/forget-device", {
        headers: { authorization: "Bearer id-token", "x-kad-shared-token": shared },
      }),
    );
    expect(forgot.statusCode).toBe(200);
    expect(await harness.identity.resolveSharedDevice(shared)).toBeNull();

    const code = await openRoom(harness, householdId);
    const joined = await tablet.send(
      event("POST", `/api/room/${code}/join`, {
        body: { playerId: "p_1", displayName: "Ada" },
        headers: { "x-kad-shared-token": shared },
      }),
    );
    expect(joined.statusCode).toBe(401);
    expect((await harness.repo.listPlayers(householdId)).length).toBe(players);

    const picker = await tablet.send(event("GET", "/api/household/players", { headers: { "x-kad-shared-token": shared } }));
    expect(picker.statusCode).toBe(401);

    // Heroes are the household's, untouched.
    expect((await harness.repo.listCharacters(householdId)).length).toBe(2);
  });

  it("needs the owner, and only forgets a shared device", async () => {
    const { harness, ada } = await family();
    const shared = await makeShared((e) => respond(e, runtime(harness)));

    const stranger = await respond(
      event("POST", "/api/auth/forget-device", {
        headers: { authorization: "Bearer id-token", "x-kad-shared-token": shared },
      }),
      runtime(harness, { cognitoSub: "sub-nobody" }),
    );
    expect(stranger.statusCode).toBe(404);
    expect(await harness.identity.resolveSharedDevice(shared)).not.toBeNull();

    const personal = await respond(
      event("POST", "/api/auth/forget-device", {
        body: { deviceId: ada.principal.deviceId },
        headers: { authorization: "Bearer id-token" },
      }),
      runtime(harness),
    );
    expect(personal.statusCode).toBe(409);
    expect(await harness.identity.resolveDevice(ada.deviceToken)).not.toBeNull();
  });
});

describe("no long-lived token for a kid, ever", () => {
  it("hands a shared tablet nothing but its own token and room sessions", async () => {
    const { harness, householdId } = await family();
    const tablet = recorder(harness);
    const shared = await makeShared(tablet.send);
    const headers = { "x-kad-shared-token": shared };
    const bindingsBefore = await harness.repo.listDevices(householdId);

    await tablet.send(event("GET", "/api/household/players", { headers }));
    for (const kid of ["p_1", "p_2"]) {
      const code = await openRoom(harness, householdId);
      await tablet.send(event("POST", `/api/room/${code}/join`, { body: { playerId: kid }, headers }));
    }
    await tablet.send(event("POST", "/api/room", { body: { mode: "travel", playerId: "p_1" }, headers }));
    const code = await openRoom(harness, householdId);
    await tablet.send(event("POST", `/api/room/${code}/join`, { body: { newPlayer: "Cass" }, headers }));

    for (const result of tablet.seen) {
      expect(result.statusCode).toBe(200);
      expect(result.headers?.["x-kad-device-token"]).toBeUndefined();
      const body = bodyOf(result);
      expect(body).not.toHaveProperty("deviceToken");
      // Every token in a response is the tablet's own or a room session.
      for (const value of Object.values(body)) {
        if (typeof value !== "string") continue;
        expect(await harness.identity.resolveDevice(value)).toBeNull();
      }
    }
    // And nothing was bound behind its back: the store holds no new device for anybody.
    expect(await harness.repo.listDevices(householdId)).toEqual(bindingsBefore);
  });
});
