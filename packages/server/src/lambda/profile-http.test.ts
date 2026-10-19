/**
 * A kid's own page (#299), through `respond()`: who can read it, who can
 * change it, and that no table ever hears what she picked.
 */

import { describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { createRoom } from "../handlers/room.ts";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { respond, type HttpRuntime } from "./http.ts";
import type { VerifiedAccount } from "./runtime.ts";

const OWNER: VerifiedAccount = { cognitoSub: "sub-test", email: "grown-up@example.com" };

function runtime(harness: TestHarness): HttpRuntime {
  return { deps: async () => harness.deps, verifyAccount: async (token: string) => (token ? OWNER : null) };
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

const bodyOf = (r: APIGatewayProxyStructuredResultV2): Record<string, any> => JSON.parse(r.body ?? "{}");

async function family() {
  const harness = makeHarness();
  const { householdId, players } = await seedHousehold(harness, 2);
  await harness.repo.putAccountPointer(OWNER.cognitoSub, householdId);
  const [ada, ben] = players as [(typeof players)[number], (typeof players)[number]];
  for (const [id, who, name] of [["c_ada", ada, "Sparklehoof"], ["c_ben", ben, "Rumble"]] as const) {
    await harness.repo.putCharacter({ ...makeCharacter({ id, ownerPlayerId: who.principal.playerId, name }), householdId });
  }
  return { harness, rt: runtime(harness), householdId, ada, ben };
}

const asDevice = (token: string) => ({ headers: { "x-kad-device-token": token } });
const asSession = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe("her page over HTTP", () => {
  it("is her own device's: she picks, and her journal and a second device bound to her read it back", async () => {
    const { harness, rt, householdId, ada, ben } = await family();
    const saved = await respond(
      event("POST", "/api/profile/flair", { ...asDevice(ada.deviceToken), body: { color: "berry", frames: { c_ada: "ivy" } } }),
      rt,
    );
    expect(saved.statusCode).toBe(200);
    expect(bodyOf(saved).flair).toEqual({ v: 1, color: "berry", frames: { c_ada: "ivy" } });

    // A second phone bound to her (#281) is the same kid in the same home.
    const second = await harness.identity.issueDeviceToken({ householdId, playerId: ada.principal.playerId });
    const journal = await respond(event("GET", "/api/journal", asDevice(second.token)), rt);
    expect(bodyOf(journal).profile.flair).toEqual({ v: 1, color: "berry", frames: { c_ada: "ivy" } });

    // Her brother's phone is his own page.
    const his = await respond(event("GET", "/api/journal", asDevice(ben.deviceToken)), rt);
    expect(bodyOf(his).profile.flair).toEqual({ v: 1 });
  });

  it("names the kid by the device token alone: a body that names somebody else is not listened to", async () => {
    const { harness, rt, householdId, ada, ben } = await family();
    const res = await respond(
      event("POST", "/api/profile/flair", {
        ...asDevice(ben.deviceToken),
        body: { playerId: ada.principal.playerId, householdId: "h_other", color: "sky" },
      }),
      rt,
    );
    expect(res.statusCode).toBe(200);
    expect((await harness.repo.getPlayer(householdId, ben.principal.playerId))?.flair).toEqual({ v: 1, color: "sky" });
    expect((await harness.repo.getPlayer(householdId, ada.principal.playerId))?.flair).toBeUndefined();
  });

  it("refuses everything that is not her own device or her own seat", async () => {
    const { harness, rt, householdId, ada } = await family();
    const body = { color: "sky" };

    // No token at all.
    expect((await respond(event("POST", "/api/profile/flair", { body }), rt)).statusCode).toBe(401);
    // A token that was never anyone's, as a device and as a session.
    expect((await respond(event("POST", "/api/profile/flair", { ...asDevice("nope"), body }), rt)).statusCode).toBe(401);
    expect((await respond(event("GET", "/api/journal", asSession("nope")), rt)).statusCode).toBe(401);
    // A grown-up's sign-in is not a kid.
    expect(
      (await respond(event("POST", "/api/profile/flair", { headers: { authorization: "Bearer id-token" }, body }), rt)).statusCode,
    ).toBe(401);

    // A family tablet's own token is nobody's, in either header.
    const tablet = await respond(
      event("POST", "/api/auth/shared-device", { headers: { authorization: "Bearer id-token", "x-kad-device-token": ada.deviceToken } }),
      rt,
    );
    const shared = String(bodyOf(tablet).sharedToken);
    expect((await respond(event("POST", "/api/profile/flair", { headers: { "x-kad-shared-token": shared }, body }), rt)).statusCode).toBe(401);
    expect((await respond(event("POST", "/api/profile/flair", { ...asDevice(shared), body }), rt)).statusCode).toBe(401);
    expect((await respond(event("GET", "/api/journal", asSession(shared)), rt)).statusCode).toBe(401);
    expect((await harness.repo.getPlayer(householdId, ada.principal.playerId))?.flair).toBeUndefined();
  });

  it("is also the seat a kid holds once picked on a family tablet (#250): her own page, and nobody else's", async () => {
    const { harness, rt, householdId, ada, ben } = await family();
    const room = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!room.ok) throw new Error(room.error.message);
    const seat = async (who: typeof ada) =>
      String(bodyOf(await respond(event("POST", `/api/room/${room.value.code}/join`, asDevice(who.deviceToken)), rt)).sessionToken);
    const adaSeat = await seat(ada);
    const benSeat = await seat(ben);

    const saved = await respond(event("POST", "/api/profile/flair", { ...asSession(adaSeat), body: { color: "plum" } }), rt);
    expect(saved.statusCode).toBe(200);
    expect(bodyOf(saved).flair).toEqual({ v: 1, color: "plum" });
    expect(bodyOf(await respond(event("GET", "/api/journal", asSession(adaSeat)), rt)).profile.flair).toEqual({ v: 1, color: "plum" });

    // Ben's seat is Ben's page, and a body naming Ada does not change that.
    const his = await respond(event("GET", "/api/journal", asSession(benSeat)), rt);
    expect(bodyOf(his).profile.displayName).toBe("Player 2");
    expect(bodyOf(his).profile.flair).toEqual({ v: 1 });
    await respond(event("POST", "/api/profile/flair", { ...asSession(benSeat), body: { playerId: ada.principal.playerId, color: "sky" } }), rt);
    expect((await harness.repo.getPlayer(householdId, ada.principal.playerId))?.flair).toEqual({ v: 1, color: "plum" });
    expect((await harness.repo.getPlayer(householdId, ben.principal.playerId))?.flair).toEqual({ v: 1, color: "sky" });
  });

  it("refuses a pick that is not a preset, the way every illegal request is refused", async () => {
    const { rt, ada } = await family();
    const res = await respond(event("POST", "/api/profile/flair", { ...asDevice(ada.deviceToken), body: { color: "#ff0000" } }), rt);
    expect(res.statusCode).toBe(409);
  });

  it("never tells a table: the room she joins hears her nickname and color, not her page", async () => {
    const { harness, rt, householdId, ada } = await family();
    await respond(event("POST", "/api/profile/flair", { ...asDevice(ada.deviceToken), body: { color: "berry" } }), rt);

    const room = await createRoom({ householdId, mode: "party" }, harness.deps);
    if (!room.ok) throw new Error(room.error.message);
    const joined = await respond(event("POST", `/api/room/${room.value.code}/join`, asDevice(ada.deviceToken)), rt);
    expect(joined.statusCode).toBe(200);
    const state = await harness.repo.getState(room.value.runId);
    for (const text of [joined.body ?? "", JSON.stringify(state)]) {
      expect(text).not.toMatch(/flair|berry/);
    }
    // What a table does hear, as before.
    expect(JSON.stringify(state)).toContain("Player 1");
  });
});
