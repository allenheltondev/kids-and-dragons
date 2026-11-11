/**
 * Leaving a device. Two things have to hold at once: whoever is holding a
 * device can make it stop being a kid with nothing but the device, and nobody
 * can strand a hero by doing it.
 */

import { describe, expect, it, vi } from "vitest";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { DEVICE_TOKEN_TTL_MS } from "../token-identity.ts";
import { deviceStanding, leaveDevice } from "./leave-device.ts";

/** An unkept household (nobody has signed in), founded by its first device. */
async function seedGuest(harness: TestHarness, devices = 1) {
  const householdId = "h_guest";
  const playerId = "p_ada";
  await harness.repo.putPlayer({ id: playerId, householdId, displayName: "Ada", color: "#7FD4C1" });
  const bound = [];
  for (let i = 0; i < devices; i++) {
    const { token, deviceId } = await harness.identity.issueDeviceToken({ householdId, playerId });
    bound.push({ principal: { deviceId, householdId, playerId }, deviceToken: token });
  }
  const founder = bound[0];
  if (!founder) throw new Error("setup failed");
  await harness.repo.putHousehold({
    id: householdId,
    displayName: "Guest household",
    ownerSub: null,
    guest: true,
    expiresAt: new Date(harness.clock.now() + 7 * 24 * 3600_000).toISOString(),
    createdAt: new Date(harness.clock.now()).toISOString(),
    founderDeviceId: founder.principal.deviceId,
  });
  return { householdId, playerId, bound };
}

describe("what a device is told about itself", () => {
  it("names who it plays as, and may leave a household a grown-up keeps", async () => {
    const harness = makeHarness();
    const { players } = await seedHousehold(harness, 1);
    const result = await deviceStanding(players[0]!.principal, harness.deps);
    expect(result).toEqual({ ok: true, value: { displayName: "Player 1", kept: true, canLeave: true } });
  });

  it("may not leave when it is the only way to reach a kid nobody has kept", async () => {
    const harness = makeHarness();
    const { bound } = await seedGuest(harness);
    const result = await deviceStanding(bound[0]!.principal, harness.deps);
    expect(result).toEqual({
      ok: true,
      value: { displayName: "Ada", kept: false, canLeave: false, staysBecause: "onlyDevice" },
    });
  });

  it("lets a borrowed device leave an unkept household while her own device is still her", async () => {
    // Mum's phone started the game and nobody has signed in; a ward's tablet was made Ada by a code.
    const harness = makeHarness();
    const { bound } = await seedGuest(harness, 2);
    const [phone, tablet] = bound;
    expect(await deviceStanding(tablet!.principal, harness.deps)).toMatchObject({ value: { kept: false, canLeave: true } });
    // The phone that started the household is the only one that can ever keep it,
    // and it is told that: her heroes are not "only on this device".
    expect(await deviceStanding(phone!.principal, harness.deps)).toMatchObject({
      value: { kept: false, canLeave: false, staysBecause: "founder" },
    });
  });

  it("gives no reason to stay to a device that may leave", async () => {
    const harness = makeHarness();
    const { bound } = await seedGuest(harness, 2);
    const result = await deviceStanding(bound[1]!.principal, harness.deps);
    expect(result.ok && "staysBecause" in result.value).toBe(false);
  });

  it("does not count another device that was revoked, or whose token has run out", async () => {
    const revoked = makeHarness();
    const a = await seedGuest(revoked, 2);
    await revoked.repo.revokeDevice(a.householdId, a.bound[0]!.principal.deviceId);
    expect(await deviceStanding(a.bound[1]!.principal, revoked.deps)).toMatchObject({ value: { canLeave: false } });

    const stale = makeHarness();
    const b = await seedGuest(stale, 2);
    stale.clock.advance(DEVICE_TOKEN_TTL_MS + 1);
    expect(await deviceStanding(b.bound[1]!.principal, stale.deps)).toMatchObject({ value: { canLeave: false } });
  });

  it("answers a device whose kid is gone as nobody", async () => {
    const harness = makeHarness();
    const result = await deviceStanding({ deviceId: "d_x", householdId: "h_none", playerId: "p_none" }, harness.deps);
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("leaving a device", () => {
  it("kills this device's token and nothing else: the kid and her other devices stay", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 2);
    const [ada, ben] = players;

    expect(await leaveDevice(ada!.principal, harness.deps)).toEqual({ ok: true, value: { left: true } });

    expect(await harness.identity.resolveDevice(ada!.deviceToken)).toBeNull();
    expect(await harness.identity.resolveDevice(ben!.deviceToken)).not.toBeNull();
    // Revoked, not deleted: she is still on the household's pickers.
    expect(await harness.repo.getPlayer(householdId, ada!.principal.playerId)).not.toBeNull();
  });

  it("drops the turn notifications that device asked for", async () => {
    const harness = makeHarness();
    const { players } = await seedHousehold(harness, 1);
    const dropped = vi.spyOn(harness.repo, "deletePushSubscription");
    await leaveDevice(players[0]!.principal, harness.deps);
    expect(dropped).toHaveBeenCalledWith(players[0]!.principal.playerId, players[0]!.principal.deviceId);
  });

  it("still leaves when the notifications could not be dropped", async () => {
    const harness = makeHarness();
    const { players } = await seedHousehold(harness, 1);
    vi.spyOn(harness.repo, "deletePushSubscription").mockRejectedValue(new Error("table is busy"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await leaveDevice(players[0]!.principal, harness.deps)).toMatchObject({ ok: true });
      expect(await harness.identity.resolveDevice(players[0]!.deviceToken)).toBeNull();
    } finally {
      logged.mockRestore();
    }
  });

  it("refuses to strand a hero, says how to fix it, and leaves the binding alone", async () => {
    const harness = makeHarness();
    const { bound } = await seedGuest(harness);
    const result = await leaveDevice(bound[0]!.principal, harness.deps);
    expect(result).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(result.ok ? "" : result.error.message).toContain("only on this device");
    expect(result.ok ? "" : result.error.message).toContain("Save them to an account first");
    expect(await harness.identity.resolveDevice(bound[0]!.deviceToken)).not.toBeNull();
  });

  it("tells a founding device with a second device the true reason, not that it is her only one", async () => {
    const harness = makeHarness();
    const { bound } = await seedGuest(harness, 2);
    const result = await leaveDevice(bound[0]!.principal, harness.deps);
    expect(result).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    const said = result.ok ? "" : result.error.message;
    expect(said).not.toContain("only on this device");
    expect(said).toContain("this is the device that can save them");
    expect(await harness.identity.resolveDevice(bound[0]!.deviceToken)).not.toBeNull();
  });

  it("ends the room sessions the device was handed, and nobody else's", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 2);
    const [ada, ben] = players;
    const session = (who: typeof ada) =>
      harness.identity.issueSessionToken({
        runId: "r_1",
        roomCode: "ABCD",
        householdId,
        playerId: who!.principal.playerId,
        expiresAt: harness.clock.now() + 3600_000,
        deviceId: who!.principal.deviceId,
      });
    const [hers, his] = [await session(ada), await session(ben)];
    expect(await harness.identity.resolveSession(hers)).not.toBeNull();

    await leaveDevice(ada!.principal, harness.deps);

    expect(await harness.identity.resolveSession(hers)).toBeNull();
    expect(await harness.identity.resolveSession(his)).not.toBeNull();
  });
});
