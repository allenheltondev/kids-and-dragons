import { describe, expect, it } from "vitest";
import { DevIdentity, hashToken } from "./identity.ts";
import { MemoryRepository } from "./store/memory-repository.ts";
import { makeClock } from "./test-support.ts";

function setup() {
  const clock = makeClock();
  const repo = new MemoryRepository({ now: clock.now });
  return { repo, clock, identity: new DevIdentity(repo, clock.now) };
}

describe("DevIdentity — device tokens (architecture §4.5)", () => {
  it("resolves a bound device to its household, player, and role", async () => {
    const { identity } = setup();
    const { token, deviceId } = await identity.issueDeviceToken({
      householdId: "h_1",
      playerId: "p_2",
      role: "child",
    });

    // The whole point: this is all a phone needs to be itself again.
    expect(await identity.resolveDevice(token)).toEqual({
      deviceId,
      householdId: "h_1",
      playerId: "p_2",
      role: "child",
    });
  });

  it("stores the token hashed, never in the clear", async () => {
    const { repo, identity } = setup();
    const { token, deviceId } = await identity.issueDeviceToken({
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
    });
    const binding = await repo.getDeviceById(deviceId);
    expect(binding?.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(binding)).not.toContain(token);
  });

  it("returns null for garbage, for a forged token, and for a revoked device", async () => {
    const { repo, identity } = setup();
    const { token, deviceId } = await identity.issueDeviceToken({
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
    });

    expect(await identity.resolveDevice("")).toBeNull();
    expect(await identity.resolveDevice("not-a-token")).toBeNull();
    // A payload that was not the one we issued fails the stored-hash check.
    const forged = `kaddev.d1.${Buffer.from(
      JSON.stringify({ deviceId, householdId: "h_1", playerId: "p_9", role: "adult" }),
    ).toString("base64url")}`;
    expect(await identity.resolveDevice(forged)).toBeNull();

    // Lost phone: the owner revokes it and the token is dead immediately —
    // and the character, which belongs to the household, is untouched.
    await repo.revokeDevice("h_1", deviceId);
    expect(await identity.resolveDevice(token)).toBeNull();
  });

  it("keeps lastSeen current on every resolve", async () => {
    const { repo, clock, identity } = setup();
    const { token, deviceId } = await identity.issueDeviceToken({
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
    });
    const before = (await repo.getDeviceById(deviceId))?.lastSeen;

    clock.advance(60_000);
    await identity.resolveDevice(token);

    expect((await repo.getDeviceById(deviceId))?.lastSeen).not.toBe(before);
  });
});

describe("DevIdentity — session tokens", () => {
  it("round-trips a room-scoped session and expires it", async () => {
    const { clock, identity } = setup();
    const expiresAt = clock.now() + 6 * 3600_000;
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
      expiresAt,
    });

    expect(await identity.resolveSession(token)).toMatchObject({ runId: "r_1", roomCode: "ABCD" });

    clock.advance(6 * 3600_000 + 1);
    expect(await identity.resolveSession(token)).toBeNull();
  });
});
