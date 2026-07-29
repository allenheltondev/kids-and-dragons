import { createHmac } from "node:crypto";
import { GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";
import { describe, expect, it, vi } from "vitest";
import { MemoryRepository } from "./store/memory-repository.ts";
import { makeClock, T0 } from "./test-support.ts";
import { DEVICE_TOKEN_TTL_MS, ssmParameterSource, TokenIdentity } from "./token-identity.ts";

/**
 * The same shape the stack produces: base64url over 32 random bytes, held in a
 * Parameter Store SecureString. Nothing here fakes the crypto — `createHmac` is
 * the same call that runs in prod, and only the SSM round trip is stubbed out.
 */
const SECRET = "n7QpVzL2xR8mKdY4wFbT6sJhC3gNaE5uP9rZvXqW1oHiUlBtDkSyMcAfGjOe0Z2";

const PARAM = "/kad/staging/token-signing-key";

/** An SSM that behaves like the real one for the four cases that matter. */
function fakeSsm(initial?: string) {
  let stored = initial;
  const puts: string[] = [];
  const named = (name: string) => Object.assign(new Error(name), { name });

  return {
    puts,
    get value() {
      return stored;
    },
    client: {
      send(command: GetParameterCommand | PutParameterCommand) {
        if (command instanceof GetParameterCommand) {
          expect(command.input.Name).toBe(PARAM);
          // The whole point of a SecureString: an undecrypted read hands back
          // ciphertext, which would sign tokens nothing can verify.
          expect(command.input.WithDecryption).toBe(true);
          if (stored === undefined) return Promise.reject(named("ParameterNotFound"));
          return Promise.resolve({ Parameter: { Value: stored } });
        }
        puts.push(String(command.input.Value));
        expect(command.input.Type).toBe("SecureString");
        // Without this the race below silently picks a winner per container.
        expect(command.input.Overwrite).toBe(false);
        if (stored !== undefined) return Promise.reject(named("ParameterAlreadyExists"));
        stored = String(command.input.Value);
        return Promise.resolve({});
      },
    },
  };
}

function setup(startMs = T0) {
  const clock = makeClock(startMs);
  const repo = new MemoryRepository({ now: clock.now });
  const identity = new TokenIdentity({
    repo,
    secret: () => Promise.resolve(SECRET),
    now: clock.now,
  });
  return { clock, repo, identity };
}

const device = { householdId: "h_1", playerId: "p_1", role: "adult" as const };

function tamper(token: string, payload: object): string {
  const [header, , signature] = token.split(".") as [string, string, string];
  return `${header}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
}

describe("the signature itself", () => {
  it("is an HS256 JWT over header.payload, verifiable by anything holding the secret", async () => {
    // The interop check. If this drifts, the tokens are still self-consistent —
    // we sign and verify them with the same code — but they have quietly stopped
    // being JWTs, and the next thing to read one (a log viewer, an API Gateway
    // authorizer, a debugging session) sees nonsense.
    const { identity } = setup();
    const { token } = await identity.issueDeviceToken(device);
    const [header, payload, signature] = token.split(".") as [string, string, string];

    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    const expected = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
    expect(signature).toBe(expected);
  });

  it("refuses a token signed with a different secret", async () => {
    const { identity } = setup();
    const { token } = await identity.issueDeviceToken(device);

    const other = new TokenIdentity({
      repo: new MemoryRepository(),
      secret: () => Promise.resolve(`${SECRET}x`),
    });
    expect(await other.resolveDevice(token)).toBeNull();
  });

  it("refuses a truncated signature rather than throwing", async () => {
    // `timingSafeEqual` throws on a length mismatch, so the length check ahead
    // of it is load-bearing: without it this is a 500 on a malformed token.
    const { identity } = setup();
    const { token } = await identity.issueDeviceToken(device);
    const [header, payload, signature] = token.split(".") as [string, string, string];

    expect(await identity.resolveDevice(`${header}.${payload}.${signature.slice(0, 10)}`)).toBeNull();
  });

  it("fetches the secret once, however many tokens it signs", async () => {
    const source = vi.fn(() => Promise.resolve(SECRET));
    const identity = new TokenIdentity({ repo: new MemoryRepository(), secret: source });

    const { token } = await identity.issueDeviceToken(device);
    await identity.resolveDevice(token);
    await identity.resolveDevice(token);

    expect(source).toHaveBeenCalledOnce();
  });

  it("does not cache a failed fetch", async () => {
    // A throttled cold start must not poison the container for its whole life.
    let attempts = 0;
    const identity = new TokenIdentity({
      repo: new MemoryRepository(),
      secret: () => {
        attempts++;
        return attempts === 1 ? Promise.reject(new Error("throttled")) : Promise.resolve(SECRET);
      },
    });

    await expect(identity.issueDeviceToken(device)).rejects.toThrow(/throttled/);
    expect(await identity.issueDeviceToken(device)).toMatchObject({ token: expect.any(String) });
  });
});

describe("ssmParameterSource", () => {
  it("reads an existing key and writes nothing", async () => {
    const ssm = fakeSsm(SECRET);
    const source = ssmParameterSource(PARAM, { client: ssm.client, createIfMissing: true });

    expect(await source()).toBe(SECRET);
    expect(ssm.puts).toEqual([]);
  });

  it("mints a key on a fresh stack, since CloudFormation cannot create one", async () => {
    const ssm = fakeSsm();
    const source = ssmParameterSource(PARAM, { client: ssm.client, createIfMissing: true });

    const minted = await source();
    // 32 bytes of base64url, and it is what actually landed in the parameter —
    // a mint that returns one value and stores another would work perfectly on
    // one container and reject that container's tokens everywhere else.
    expect(minted).toHaveLength(43);
    expect(ssm.value).toBe(minted);
  });

  it("adopts the winner's key when two cold starts race", async () => {
    /*
     * The failure this prevents is not a crash. Both containers succeed, each
     * signing with its own key, and every token minted by one is rejected by the
     * other — which reads at the table as "it logs her out at random".
     */
    const ssm = fakeSsm();
    const source = () =>
      ssmParameterSource(PARAM, { client: ssm.client, createIfMissing: true })();

    const [first, second] = await Promise.all([source(), source()]);

    expect(first).toBe(second);
    expect(ssm.value).toBe(first);
    expect(ssm.puts).toHaveLength(2);
  });

  it("refuses to mint without createIfMissing, so only the API can", async () => {
    // The channel authorizer's configuration. It has no ssm:PutParameter either;
    // this is the same rule stated where it can be tested.
    const ssm = fakeSsm();
    const source = ssmParameterSource(PARAM, { client: ssm.client });

    await expect(source()).rejects.toThrow(/does not exist/);
    expect(ssm.puts).toEqual([]);
  });

  it("does not mistake a real SSM failure for a missing parameter", async () => {
    // Throttling and AccessDenied must surface. Swallowing either would mint a
    // second key over a perfectly good one.
    const denied = Object.assign(new Error("AccessDeniedException"), {
      name: "AccessDeniedException",
    });
    const source = ssmParameterSource(PARAM, {
      client: { send: () => Promise.reject(denied) },
      createIfMissing: true,
    });

    await expect(source()).rejects.toThrow(/AccessDenied/);
  });
});

describe("TokenIdentity — device tokens", () => {
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

describe("TokenIdentity — session tokens", () => {
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
