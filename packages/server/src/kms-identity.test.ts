import { generateKeyPairSync, sign as nodeSign, randomBytes, verify as nodeVerify } from "node:crypto";
import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
import { describe, expect, it } from "vitest";
import { DEVICE_TOKEN_TTL_MS, derToJose, KmsIdentity } from "./kms-identity.ts";
import { MemoryRepository } from "./store/memory-repository.ts";
import { makeClock, T0 } from "./test-support.ts";

/**
 * A real P-256 keypair standing in for the KMS key. `Sign` produces a genuine
 * DER-encoded ECDSA signature and `GetPublicKey` a genuine SPKI, so everything
 * these tests exercise — the DER→JOSE conversion, the local verification, the
 * forgery rejections — is the same arithmetic that runs in prod. Only the API
 * call is faked.
 */
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

function fakeKms(): KMSClient {
  return {
    async send(command: unknown) {
      if (command instanceof GetPublicKeyCommand) {
        return { PublicKey: new Uint8Array(publicKey.export({ format: "der", type: "spki" })) };
      }
      if (command instanceof SignCommand) {
        const message = Buffer.from(command.input.Message as Uint8Array);
        return {
          Signature: new Uint8Array(
            nodeSign("sha256", message, { key: privateKey, dsaEncoding: "der" }),
          ),
        };
      }
      throw new Error("unexpected KMS command");
    },
  } as unknown as KMSClient;
}

function setup(startMs = T0) {
  const clock = makeClock(startMs);
  const repo = new MemoryRepository({ now: clock.now });
  const identity = new KmsIdentity({
    repo,
    keyId: "alias/kad-tokens",
    client: fakeKms(),
    now: clock.now,
  });
  return { clock, repo, identity };
}

const device = { householdId: "h_1", playerId: "p_1", role: "adult" as const };

function tamper(token: string, payload: object): string {
  const [header, , signature] = token.split(".") as [string, string, string];
  return `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
}

describe("derToJose", () => {
  it("produces 64 fixed-width bytes for every signature, not most of them", () => {
    /*
     * The bug this exists to prevent: DER drops leading zero bytes and adds a
     * 0x00 sign byte when the high bit is set, so r or s is shorter or longer
     * than 32 bytes roughly one time in 256. A naive slice verifies almost
     * always, and the failure surfaces months later as "her phone sometimes
     * has to re-pair."
     */
    for (let i = 0; i < 300; i++) {
      const message = randomBytes(32);
      const der = nodeSign("sha256", message, { key: privateKey, dsaEncoding: "der" });
      const jose = derToJose(new Uint8Array(der));

      expect(jose).toHaveLength(64);
      expect(
        nodeVerify("sha256", message, { key: publicKey, dsaEncoding: "ieee-p1363" }, jose),
      ).toBe(true);
    }
  });

  it("rejects something that is not a DER signature", () => {
    expect(() => derToJose(new Uint8Array([1, 2, 3]))).toThrow(/bad DER/);
  });
});

describe("KmsIdentity — device tokens", () => {
  it("issues a token that resolves to the player who owns the device", async () => {
    const { identity } = setup();
    const { token, deviceId } = await identity.issueDeviceToken(device);

    expect(await identity.resolveDevice(token)).toMatchObject({
      deviceId,
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
    });
  });

  it("refuses a tampered payload", async () => {
    const { identity } = setup();
    const { token } = await identity.issueDeviceToken(device);

    // The attack that matters here: re-point a real token at another player.
    const forged = tamper(token, {
      sub: "d_x",
      aud: "device",
      hh: "h_1",
      pid: "p_2",
      role: "adult",
      iat: 0,
      exp: 4_000_000_000,
    });
    expect(await identity.resolveDevice(forged)).toBeNull();
  });

  it("refuses an unsigned token claiming alg none", async () => {
    const { identity } = setup();
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "d_x", aud: "device", hh: "h_1", pid: "p_1", role: "adult", exp: 4e9 }),
    ).toString("base64url");
    expect(await identity.resolveDevice(`${header}.${payload}.`)).toBeNull();
  });

  it("refuses garbage without throwing", async () => {
    const { identity } = setup();
    for (const bad of ["", "not-a-token", "a.b", "a.b.c", "kaddev.d1.eyJ9"]) {
      expect(await identity.resolveDevice(bad)).toBeNull();
    }
  });

  it("refuses a session token presented as a device token", async () => {
    const { identity, clock } = setup();
    const session = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
      expiresAt: clock.now() + 3600_000,
    });
    // Correctly signed, wrong audience — a room token must not become a
    // permanent credential.
    expect(await identity.resolveDevice(session)).toBeNull();
  });

  it("expires", async () => {
    const { identity, clock } = setup();
    const { token } = await identity.issueDeviceToken(device);
    clock.advance(DEVICE_TOKEN_TTL_MS + 1000);
    expect(await identity.resolveDevice(token)).toBeNull();
  });

  it("stops resolving the moment the device is revoked", async () => {
    const { identity, repo } = setup();
    const { token, deviceId } = await identity.issueDeviceToken(device);
    expect(await identity.resolveDevice(token)).not.toBeNull();

    // Lost phone. The token is still perfectly signed; it must still be dead.
    await repo.revokeDevice("h_1", deviceId);
    expect(await identity.resolveDevice(token)).toBeNull();
  });

  it("refuses a token naming a player the device is no longer bound to", async () => {
    // Re-binding a phone to a different player (the "she borrowed a phone"
    // affordance in roadmap open item 3) has to invalidate the old credential,
    // or the previous player's token keeps acting as them.
    const { identity, repo } = setup();
    const { token, deviceId } = await identity.issueDeviceToken(device);
    await identity.issueDeviceToken({ ...device, playerId: "p_2", deviceId });

    expect(await identity.resolveDevice(token)).toBeNull();
    expect(await repo.listDevices("h_1")).toHaveLength(1);
  });

  it("slides the expiry once a token is past halfway, and not before", async () => {
    const { identity, clock } = setup();
    const { token } = await identity.issueDeviceToken(device);

    // A phone used the next day gets no churn.
    clock.advance(24 * 3600_000);
    expect((await identity.resolveDevice(token))?.rotatedToken).toBeUndefined();

    // One used three weeks later gets a fresh 30 days, handed back to it.
    clock.advance(20 * 24 * 3600_000);
    const resolved = await identity.resolveDevice(token);
    expect(resolved?.rotatedToken).toBeTypeOf("string");
    expect(resolved?.rotatedToken).not.toBe(token);

    const renewed = await identity.resolveDevice(resolved?.rotatedToken ?? "");
    expect(renewed).toMatchObject({ householdId: "h_1", playerId: "p_1" });
    expect(renewed?.rotatedToken).toBeUndefined();
  });

  it("keeps the same device id across a rotation", async () => {
    // Rotation must not mint a second device row, or revoking "the phone" would
    // only revoke its most recent credential.
    const { identity, repo, clock } = setup();
    const { token, deviceId } = await identity.issueDeviceToken(device);
    clock.advance(DEVICE_TOKEN_TTL_MS - 1000);

    const resolved = await identity.resolveDevice(token);
    expect(resolved?.deviceId).toBe(deviceId);
    expect(await repo.listDevices("h_1")).toHaveLength(1);
  });

  it("keeps lastSeen honest so the owner's revocation screen has something to show", async () => {
    const { identity, repo, clock } = setup();
    const { token, deviceId } = await identity.issueDeviceToken(device);
    clock.advance(3600_000);
    await identity.resolveDevice(token);

    expect((await repo.getDeviceById(deviceId))?.lastSeen).toBe(
      new Date(clock.now()).toISOString(),
    );
  });
});

describe("KmsIdentity — session tokens", () => {
  it("round-trips the run it is scoped to", async () => {
    const { identity, clock } = setup();
    const expiresAt = clock.now() + 6 * 3600_000;
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      role: "child",
      expiresAt,
    });

    expect(await identity.resolveSession(token)).toEqual({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      role: "child",
      expiresAt,
    });
  });

  it("expires with its room", async () => {
    const { identity, clock } = setup();
    const token = await identity.issueSessionToken({
      runId: "r_1",
      roomCode: "ABCD",
      householdId: "h_1",
      playerId: "p_1",
      role: "adult",
      expiresAt: clock.now() + 6 * 3600_000,
    });

    clock.advance(6 * 3600_000 + 1000);
    expect(await identity.resolveSession(token)).toBeNull();
  });

  it("refuses a device token presented as a session token", async () => {
    const { identity } = setup();
    const { token } = await identity.issueDeviceToken(device);
    expect(await identity.resolveSession(token)).toBeNull();
  });
});
