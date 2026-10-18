/**
 * Shared devices (#250), end to end through `respond()`: a family tablet the
 * kids take turns on. What this file proves is the issue's "done when":
 *
 *   - two kids take turns on one tablet across two sessions, and each always
 *     lands in their own hero;
 *   - clearing the tablet's storage loses nobody's hero;
 *   - no long-lived token for a kid is ever handed to a shared device.
 */

import { describe, expect, it, vi } from "vitest";
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

  it("leaves the device as it was when setting up fails partway", async () => {
    const { harness, householdId, ada } = await family();
    const headers = { authorization: "Bearer id-token", "x-kad-device-token": ada.deviceToken };

    // The new token cannot be minted: nothing has been revoked yet.
    const minting = vi.spyOn(harness.identity, "issueSharedDeviceToken").mockRejectedValueOnce(new Error("store down"));
    const first = await respond(event("POST", "/api/auth/shared-device", { headers }), runtime(harness));
    expect(first.statusCode).toBe(500);
    expect(await harness.identity.resolveDevice(ada.deviceToken)).not.toBeNull();
    minting.mockRestore();

    // Minted, then the answer cannot be built: the old binding survives, and
    // the new one, never delivered, is revoked rather than left lying around.
    const reading = vi.spyOn(harness.repo, "listCharacters").mockRejectedValueOnce(new Error("store down"));
    const second = await respond(event("POST", "/api/auth/shared-device", { headers }), runtime(harness));
    expect(second.statusCode).toBe(500);
    expect(await harness.identity.resolveDevice(ada.deviceToken)).not.toBeNull();
    const shared = (await harness.repo.listDevices(householdId)).filter((d) => d.kind === "shared");
    expect(shared.length).toBe(1);
    expect(shared.every((d) => d.revoked === true)).toBe(true);
    reading.mockRestore();

    // And trying again simply works.
    const third = await respond(event("POST", "/api/auth/shared-device", { headers }), runtime(harness));
    expect(third.statusCode).toBe(200);
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

  it("opens a room for the kid picked, as its host, which nobody else may watch", async () => {
    const { harness } = await family();
    const tablet = recorder(harness);
    const shared = await makeShared(tablet.send);

    const created = await tablet.send(
      event("POST", "/api/room", { body: { mode: "travel", playerId: "p_2" }, headers: { "x-kad-shared-token": shared } }),
    );
    expect(created.statusCode).toBe(200);
    const body = bodyOf(created);
    expect(body).toMatchObject({ playerId: "p_2", host: true });
    expect(body.sessionToken).toEqual(expect.any(String));

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

describe("taking a player out of a room the tablet opened (#267)", () => {
  /** The tablet opens a room for Ada; a stranger's phone joins it with the code. */
  async function hostedRoom() {
    const { harness, householdId } = await family();
    const rt = runtime(harness);
    const shared = await makeShared((e) => respond(e, rt));
    const created = bodyOf(
      await respond(
        event("POST", "/api/room", { body: { mode: "travel", playerId: "p_1" }, headers: { "x-kad-shared-token": shared } }),
        rt,
      ),
    );
    const code = String(created.code);
    const stranger = bodyOf(
      await respond(event("POST", `/api/room/${code}/join`, { body: { displayName: "Who?" } }), rt),
    );
    return {
      harness,
      householdId,
      rt,
      shared,
      code,
      session: String(created.sessionToken),
      stranger: String(stranger.playerId),
    };
  }

  function remove(code: string, playerId: string, headers: Record<string, string>) {
    return event("POST", `/api/room/${code}/remove`, { body: { playerId }, headers });
  }

  it("takes the stranger out on the tablet's token and the seated kid's session", async () => {
    const { harness, rt, shared, code, session, stranger } = await hostedRoom();
    const result = await respond(
      remove(code, stranger, { "x-kad-shared-token": shared, authorization: `Bearer ${session}` }),
      rt,
    );
    expect(result.statusCode).toBe(200);
    const room = await harness.repo.getRoom(code);
    expect((await harness.repo.getState(room?.runId ?? ""))?.removed).toContain(stranger);
  });

  it("will not let the seated kid take themselves out", async () => {
    const { rt, shared, code, session } = await hostedRoom();
    const result = await respond(remove(code, "p_1", { "x-kad-shared-token": shared, authorization: `Bearer ${session}` }), rt);
    expect(result.statusCode).toBe(409);
  });

  it("needs a session for this room, and a tablet that is still the family's", async () => {
    const { harness, householdId, rt, shared, code, stranger } = await hostedRoom();

    const bare = await respond(remove(code, stranger, { "x-kad-shared-token": shared }), rt);
    expect(bare.statusCode).toBe(401);

    // A session for a different room, even this family's, is not this room's host.
    const other = await openRoom(harness, householdId);
    const elsewhere = bodyOf(
      await respond(
        event("POST", `/api/room/${other}/join`, { body: { playerId: "p_2" }, headers: { "x-kad-shared-token": shared } }),
        rt,
      ),
    );
    const wrong = await respond(
      remove(code, stranger, { "x-kad-shared-token": shared, authorization: `Bearer ${String(elsewhere.sessionToken)}` }),
      rt,
    );
    expect(wrong.statusCode).toBe(401);

    await respond(
      event("POST", "/api/auth/forget-device", { headers: { authorization: "Bearer id-token", "x-kad-shared-token": shared } }),
      rt,
    );
    const forgotten = await respond(remove(code, stranger, { "x-kad-shared-token": shared }), rt);
    expect(forgotten.statusCode).toBe(401);
  });

  it("is refused to a tablet that did not open the room", async () => {
    const { harness, householdId } = await family();
    const rt = runtime(harness);
    const shared = await makeShared((e) => respond(e, rt));
    const code = await openRoom(harness, householdId);
    const seated = bodyOf(
      await respond(
        event("POST", `/api/room/${code}/join`, { body: { playerId: "p_1" }, headers: { "x-kad-shared-token": shared } }),
        rt,
      ),
    );
    expect(seated).not.toHaveProperty("host");
    const result = await respond(
      remove(code, "p_2", { "x-kad-shared-token": shared, authorization: `Bearer ${String(seated.sessionToken)}` }),
      rt,
    );
    expect(result.statusCode).toBe(403);
  });
});

describe("locking and closing a room (#263)", () => {
  async function tabletRoom() {
    const { harness } = await family();
    const rt = runtime(harness);
    const shared = await makeShared((e) => respond(e, rt));
    const created = bodyOf(
      await respond(
        event("POST", "/api/room", { body: { mode: "travel", playerId: "p_1" }, headers: { "x-kad-shared-token": shared } }),
        rt,
      ),
    );
    const host = { "x-kad-shared-token": shared, authorization: `Bearer ${String(created.sessionToken)}` };
    return { harness, rt, code: String(created.code), runId: String(created.runId), host };
  }

  it("lets the tablet that opened the room lock it, then close it", async () => {
    const { harness, rt, code, runId, host } = await tabletRoom();

    const locked = await respond(event("POST", `/api/room/${code}/lock`, { body: { locked: true }, headers: host }), rt);
    expect(locked.statusCode).toBe(200);
    const newcomer = await respond(event("POST", `/api/room/${code}/join`, { body: {} }), rt);
    expect(newcomer.statusCode).toBe(403);
    expect(bodyOf(newcomer).error).toMatchObject({ message: expect.stringMatching(/locked/) });

    const closed = await respond(event("POST", `/api/room/${code}/close`, { headers: host }), rt);
    expect(closed.statusCode).toBe(200);
    expect((await harness.repo.getState(runId))?.closed).toBe(true);
    const again = await respond(event("POST", `/api/room/${code}/join`, { body: {} }), rt);
    expect(again.statusCode).toBe(404);
  });

  it("refuses everybody else, and reads the body only once the host is proved", async () => {
    const { rt, code, host } = await tabletRoom();
    const guest = bodyOf(await respond(event("POST", `/api/room/${code}/join`, { body: {} }), rt));
    const asGuest = { "x-kad-device-token": String(guest.deviceToken) };

    for (const path of ["lock", "close"]) {
      const nobody = await respond(event("POST", `/api/room/${code}/${path}`, { body: { locked: true } }), rt);
      expect(nobody.statusCode, path).toBe(401);
      const player = await respond(event("POST", `/api/room/${code}/${path}`, { body: { locked: true }, headers: asGuest }), rt);
      expect(player.statusCode, path).toBe(403);
    }
    const garbled = await respond(event("POST", `/api/room/${code}/lock`, { body: { locked: "yes" } }), rt);
    expect(garbled.statusCode).toBe(401);
    const hostGarbled = await respond(event("POST", `/api/room/${code}/lock`, { body: { locked: "yes" }, headers: host }), rt);
    expect(hostGarbled.statusCode).toBe(400);
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
