/**
 * `TokenIdentity` — the prod `IdentityService`, architecture §4.5.
 *
 * HS256 JWTs, signed with a key this stack never chooses and nobody ever types:
 * the API function mints 32 random bytes the first time it needs one and parks
 * them in a Parameter Store **SecureString**, encrypted under the
 * **Amazon-managed** `aws/ssm` key. We create no KMS key of our own.
 *
 * That is a deliberate step down from the asymmetric ES256 this used to be. An
 * AWS-managed key cannot sign — every `aws/*` key is symmetric and
 * encrypt-only — so keeping asymmetric signing would have meant keeping a
 * customer-managed KMS key, which is exactly the thing being removed. What the
 * public half actually bought was the ability for something *other* than these
 * two Lambdas to verify a token without being trusted to mint one; nothing does,
 * and the only candidate ever considered (an API Gateway JWT authorizer) was
 * speculative. Both signer and verifier are our own functions in one account, so
 * a shared secret draws the same trust boundary with less machinery.
 *
 * What it buys, beyond removing the key: signing is now local arithmetic. The
 * old `Sign` call put a KMS round trip in front of every pairing and every
 * session start; an HMAC costs microseconds. The key is fetched once per
 * container, exactly as the public half used to be.
 *
 * Two token kinds, matching the two layers of identity in §4.5:
 *
 *   **device token**  `aud: "device"`, 30-day sliding expiry. Long-lived, stored
 *                     in `localStorage`, and the reason there is no login screen:
 *                     the phone opens the app and it is already that player.
 *   **session token** `aud: "room"`, expires with the room (≤ 6 hours). Scoped to
 *                     one run, and what actually authorises play.
 *   **shared token**  `aud: "shared"`, a family tablet's (#250). The device
 *                     token's lifetime, but it names a household and no player:
 *                     every kid on the tablet plays on a session token alone.
 *
 * They are ordinary JWTs on purpose rather than a bespoke envelope — a format
 * worth keeping even now that the signature is symmetric, because it is the one
 * every library, log viewer, and debugging session already understands.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { GetParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import {
  hashToken,
  movedBinding,
  type DeviceIdentity,
  type IdentityService,
  type IssueDeviceTokenInput,
  type IssueSessionTokenInput,
  type IssueSharedDeviceTokenInput,
  type IssueViewerTokenInput,
  type SessionIdentity,
  type SharedDeviceIdentity,
  type ViewerIdentity,
} from "./identity.ts";
import { newId } from "./ids.ts";
import type { GameRepository } from "./store/repository.ts";

/** §4.5 — a bound device stays bound for 30 days of not being used. */
export const DEVICE_TOKEN_TTL_MS = 30 * 24 * 3600_000;

/**
 * Re-issue once a token is past halfway. That is what makes the 30 days
 * *sliding*: a phone used every Tuesday never expires, one that spends two
 * months in a drawer re-pairs by QR.
 *
 * Deliberately not "rotate on every use". Rotation only helps if the predecessor
 * is invalidated, and invalidating it means a phone whose response was lost to a
 * dropped Wi-Fi connection is locked out of the game it is holding. Revocation
 * — the property that actually matters when a phone goes missing — is immediate
 * either way, because it is a flag on the device item checked on every resolve.
 */
export const DEVICE_TOKEN_REFRESH_AFTER_MS = DEVICE_TOKEN_TTL_MS / 2;

/**
 * How stale `lastSeen` may get before a resolve refreshes it. An hour keeps the
 * owner's device screen honest to the evening while keeping the write out of
 * the per-request path — resolve is on every API call.
 */
export const LAST_SEEN_STALE_MS = 3600_000;

const ALG = "HS256";

interface DeviceClaims {
  sub: string;
  aud: "device";
  hh: string;
  pid: string;
  iat: number;
  exp: number;
}

/** A shared tablet's (#250): a household, and deliberately no `pid`. */
interface SharedClaims {
  sub: string;
  aud: "shared";
  hh: string;
  iat: number;
  exp: number;
}

interface SessionClaims {
  sub: string;
  aud: "room";
  run: string;
  code: string;
  hh: string;
  iat: number;
  exp: number;
}

/** No `sub`, no household, no role. A display token can only ever watch. */
interface ViewerClaims {
  aud: "view";
  run: string;
  code: string;
  iat: number;
  exp: number;
}

/** Resolves the signing secret. Called at most once per container. */
export type SecretSource = () => Promise<string>;

export interface TokenIdentityOptions {
  repo: GameRepository;
  /**
   * Where the signing secret comes from. A function rather than a value because
   * fetching it is async and must not happen at module load: a cold start that
   * cannot reach Parameter Store should fail the request it is serving, and then
   * try again on the next one — not poison the container.
   */
  secret: SecretSource;
  now?: () => number;
}

export class TokenIdentity implements IdentityService {
  private readonly repo: GameRepository;
  private readonly source: SecretSource;
  private readonly now: () => number;
  /** Fetched once per container, then reused for every sign and verify. */
  private key: Promise<Buffer> | null = null;

  constructor(options: TokenIdentityOptions) {
    this.repo = options.repo;
    this.source = options.secret;
    this.now = options.now ?? Date.now;
  }

  // --- device tokens ---------------------------------------------------------

  async issueDeviceToken(
    input: IssueDeviceTokenInput,
  ): Promise<{ token: string; deviceId: string }> {
    const deviceId = input.deviceId ?? newId("d");
    const nowMs = this.now();
    const token = await this.signDevice(deviceId, input.householdId, input.playerId, nowMs);

    await this.repo.putDevice({
      deviceId,
      householdId: input.householdId,
      playerId: input.playerId,
      // Recorded, not enforced — the signature is what proves the token, and
      // rejecting on a hash mismatch would lock out a phone whose refresh
      // response was lost. Kept because the owner's device-management screen
      // wants to show when each phone last got a fresh credential.
      tokenHash: hashToken(token),
      lastSeen: new Date(nowMs).toISOString(),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });
    return { token, deviceId };
  }

  async resolveDevice(token: string): Promise<DeviceIdentity | null> {
    const claims = await this.verify<DeviceClaims>(token, "device");
    if (!claims) return null;

    /*
     * By primary key, strongly consistent — never the GSI. The signature alone
     * is not enough: revocation has to be able to kill a token that is still
     * cryptographically valid — "lost phone → the owner revokes it from their
     * own device, that token is dead immediately" (§4.5) only works if every
     * resolve reads the binding, and only if that read cannot be a stale index
     * copy from before the revocation. The token carries the household, so the
     * key is right there in the claims.
     */
    const here = await this.repo.getDevice(claims.hh, claims.sub);
    // A kid who moved home took this binding with her (#251). The token names
    // the household she left, so a binding found by following her is the only
    // one allowed to name a different one.
    const binding = here ?? (await movedBinding(this.repo, claims.hh, claims.sub));
    if (!binding || binding.revoked || binding.kind === "shared") return null;
    if (here && binding.householdId !== claims.hh) return null;
    if (binding.playerId !== claims.pid) return null;

    // Re-issuing writes `lastSeen` as a side effect, so a rotation does not
    // also need to touch the device item.
    const rotatedToken = await this.keepFresh(claims.exp, binding, (nowMs) =>
      this.signDevice(binding.deviceId, binding.householdId, binding.playerId, nowMs),
    );
    // Revoked between the read above and the rotation's write.
    if (rotatedToken === false) return null;

    return {
      deviceId: binding.deviceId,
      householdId: binding.householdId,
      playerId: binding.playerId,
      ...(rotatedToken ? { rotatedToken } : {}),
    };
  }

  // --- shared device tokens (#250) ------------------------------------------

  async issueSharedDeviceToken(
    input: IssueSharedDeviceTokenInput,
  ): Promise<{ token: string; deviceId: string }> {
    const deviceId = input.deviceId ?? newId("d");
    const nowMs = this.now();
    const token = await this.signShared(deviceId, input.householdId, nowMs);
    await this.repo.putDevice({
      kind: "shared",
      deviceId,
      householdId: input.householdId,
      tokenHash: hashToken(token),
      lastSeen: new Date(nowMs).toISOString(),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });
    return { token, deviceId };
  }

  async resolveSharedDevice(token: string): Promise<SharedDeviceIdentity | null> {
    const claims = await this.verify<SharedClaims>(token, "shared");
    if (!claims) return null;
    // By primary key, for the reason `resolveDevice` gives: "forget this
    // device" has to kill a token that still verifies.
    const binding = await this.repo.getDevice(claims.hh, claims.sub);
    if (!binding || binding.revoked || binding.kind !== "shared") return null;
    if (binding.householdId !== claims.hh) return null;

    const rotatedToken = await this.keepFresh(claims.exp, binding, (nowMs) =>
      this.signShared(binding.deviceId, binding.householdId, nowMs),
    );
    if (rotatedToken === false) return null;
    return {
      kind: "shared",
      deviceId: binding.deviceId,
      householdId: binding.householdId,
      ...(rotatedToken ? { rotatedToken } : {}),
    };
  }

  private signDevice(deviceId: string, householdId: string, playerId: string, nowMs: number): Promise<string> {
    return this.sign<DeviceClaims>({
      sub: deviceId,
      aud: "device",
      hh: householdId,
      pid: playerId,
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor((nowMs + DEVICE_TOKEN_TTL_MS) / 1000),
    });
  }

  private signShared(deviceId: string, householdId: string, nowMs: number): Promise<string> {
    return this.sign<SharedClaims>({
      sub: deviceId,
      aud: "shared",
      hh: householdId,
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor((nowMs + DEVICE_TOKEN_TTL_MS) / 1000),
    });
  }

  /**
   * The sliding expiry, for either kind of device: a fresh token once this one
   * is past halfway, else `lastSeen` kept honest. Returns the fresh token, if
   * any, or false when the binding was revoked (or removed) after it was read.
   *
   * The fresh token's hash goes on with `rotateDevice`, a conditional update,
   * never `putDevice`: a full put of the binding read at resolve time could
   * land just after the owner revoked the phone, erase `revoked`, and hand
   * the lost phone a new 30-day token.
   */
  private async keepFresh(
    expSeconds: number,
    binding: { householdId: string; deviceId: string; lastSeen: string },
    sign: (nowMs: number) => Promise<string>,
  ): Promise<string | undefined | false> {
    const nowMs = this.now();
    if (expSeconds * 1000 - nowMs < DEVICE_TOKEN_REFRESH_AFTER_MS) {
      const token = await sign(nowMs);
      const rotated = await this.repo.rotateDevice(
        binding.householdId,
        binding.deviceId,
        hashToken(token),
        new Date(nowMs).toISOString(),
      );
      return rotated ? token : false;
    }
    if (nowMs - Date.parse(binding.lastSeen) >= LAST_SEEN_STALE_MS) {
      /*
       * `touchDevice`, not `putDevice`: a full put wrote back whatever the item
       * held at read time, which is how a revocation could be erased by the
       * very phone it was aimed at. And only when meaningfully stale — the
       * device screen shows "last used Tuesday", not "last used 340ms ago", so
       * a write on every single request bought nothing but doubled write cost
       * on the API's hottest path.
       */
      await this.repo.touchDevice(binding.householdId, binding.deviceId, new Date(nowMs).toISOString());
    }
    return undefined;
  }

  // --- session tokens --------------------------------------------------------

  async issueSessionToken(input: IssueSessionTokenInput): Promise<string> {
    return this.sign<SessionClaims>({
      sub: input.playerId,
      aud: "room",
      run: input.runId,
      code: input.roomCode,
      hh: input.householdId,
      iat: Math.floor(this.now() / 1000),
      // A session can never outlive its room, so the caller's expiry is the cap.
      exp: Math.floor(input.expiresAt / 1000),
    });
  }

  async resolveSession(token: string): Promise<SessionIdentity | null> {
    const claims = await this.verify<SessionClaims>(token, "room");
    if (!claims) return null;
    return {
      runId: claims.run,
      roomCode: claims.code,
      householdId: claims.hh,
      playerId: claims.sub,
      expiresAt: claims.exp * 1000,
    };
  }

  async issueViewerToken(input: IssueViewerTokenInput): Promise<string> {
    return this.sign<ViewerClaims>({
      aud: "view",
      run: input.runId,
      code: input.roomCode,
      iat: Math.floor(this.now() / 1000),
      exp: Math.floor(input.expiresAt / 1000),
    });
  }

  async resolveViewer(token: string): Promise<ViewerIdentity | null> {
    const claims = await this.verify<ViewerClaims>(token, "view");
    if (!claims) return null;
    return { runId: claims.run, roomCode: claims.code, expiresAt: claims.exp * 1000 };
  }

  // --- JWT plumbing ----------------------------------------------------------

  private async sign<T extends object>(claims: T): Promise<string> {
    const header = b64url(JSON.stringify({ alg: ALG, typ: "JWT" }));
    const payload = b64url(JSON.stringify(claims));
    const message = `${header}.${payload}`;
    const mac = await this.mac(message);
    return `${message}.${mac.toString("base64url")}`;
  }

  /** `null` for anything malformed, mis-signed, expired, or of the wrong kind. */
  private async verify<T extends { aud: string; exp: number }>(
    token: string,
    audience: T["aud"],
  ): Promise<T | null> {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts as [string, string, string];

    try {
      const head = JSON.parse(fromB64url(header).toString("utf8")) as { alg?: string };
      // Pin the algorithm. Trusting the header's `alg` is the classic JWT
      // forgery: `{"alg":"none"}` with no signature verifies against nothing.
      if (head.alg !== ALG) return null;

      const expected = await this.mac(`${header}.${payload}`);
      const actual = fromB64url(signature);
      /*
       * Length first, then a constant-time compare. `timingSafeEqual` throws on
       * a length mismatch rather than returning false, and a plain `equals`
       * would leak how far a guess got through the MAC — which for a symmetric
       * signature, unlike the asymmetric one this replaced, is a real forgery
       * path for anyone who can retry.
       */
      if (actual.length !== expected.length) return null;
      if (!timingSafeEqual(actual, expected)) return null;

      const claims = JSON.parse(fromB64url(payload).toString("utf8")) as T;
      if (claims.aud !== audience) return null;
      if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= this.now()) return null;
      return claims;
    } catch {
      // A malformed token is an unknown token, never a 500 (`IdentityService`
      // promises `resolveDevice` never throws).
      return null;
    }
  }

  private async mac(message: string): Promise<Buffer> {
    return createHmac("sha256", await this.secret()).update(message).digest();
  }

  private secret(): Promise<Buffer> {
    this.key ??= this.source()
      .then((value) => {
        if (!value) throw new Error("signing secret is empty");
        return Buffer.from(value, "utf8");
      })
      .catch((err: unknown) => {
        // Do not cache a failure: a throttled cold start would otherwise reject
        // every request for the life of the container.
        this.key = null;
        throw err;
      });
    return this.key;
  }
}

// ---------------------------------------------------------------------------
// The prod key source: a Parameter Store SecureString
//
// One `GetParameter` on the first token of a container's life, and then never
// again for the life of that container.
//
// The parameter is **not** a stack resource, and that is not an oversight:
// CloudFormation cannot create a SecureString at all — `AWS::SSM::Parameter`
// takes `String` and `StringList` and nothing else. The ways around that are a
// step in `deploy.sh` (which puts stack state outside the template, and breaks
// the documented `sam deploy` path) or a custom resource (a fourth Lambda, a
// role, and a response protocol that hangs the stack for an hour when it is
// got wrong). Minting it here is smaller than either: the template still owns
// the *name* and the *permissions*, which is the part that has to be reviewed.
//
// It also outlives the stack, which is the behavior we want. Deleting and
// recreating staging keeps every paired phone working, where a stack-owned
// secret would sign them all out — and it is one line to delete by hand on a
// real teardown (docs/deploy.md).
// ---------------------------------------------------------------------------

/** 256 bits, the block size HMAC-SHA256 actually uses. */
const KEY_BYTES = 32;

export interface SsmLike {
  send(
    command: GetParameterCommand | PutParameterCommand,
  ): Promise<{ Parameter?: { Value?: string | undefined } | undefined }>;
}

export interface SsmSourceOptions {
  client?: SsmLike;
  /**
   * Mint the key if the parameter is not there yet. **The API function only.**
   *
   * The channel authorizer is read-only by design (its whole policy is), and
   * cannot legitimately be first: it only ever verifies tokens the API has
   * already issued, so a missing parameter there means something is wrong and
   * failing is the right answer.
   */
  createIfMissing?: boolean;
  /**
   * What a minted value is, when it is not a signing key: the push keys
   * (#466) are a VAPID key pair, minted the same way, by the same function.
   */
  mint?: () => string;
  /** The minted parameter's description in the console. */
  description?: string;
}

export function ssmParameterSource(
  parameterName: string,
  options: SsmSourceOptions = {},
): SecretSource {
  const client = options.client ?? new SSMClient({});

  return async () => {
    const existing = await readParameter(client, parameterName);
    if (existing) return existing;
    if (!options.createIfMissing) {
      throw new Error(`signing key parameter ${parameterName} does not exist`);
    }

    const minted = options.mint ? options.mint() : randomBytes(KEY_BYTES).toString("base64url");
    try {
      await client.send(
        new PutParameterCommand({
          Name: parameterName,
          Value: minted,
          Type: "SecureString",
          // No `KeyId`: that is what selects the Amazon-managed `aws/ssm` key.
          Overwrite: false,
          Description: options.description ?? "Kids & Dragons device and session token signing key",
        }),
      );
      return minted;
    } catch (err) {
      if (errorName(err) !== "ParameterAlreadyExists") throw err;
      /*
       * Two cold containers raced, which on a first deploy is likely rather than
       * exotic — a family opens the app on three phones at once. `Overwrite:
       * false` is what makes the race safe: exactly one write lands, and the
       * loser adopts the winner's key. Overwriting instead would leave the two
       * containers signing with different keys, and every token minted by one
       * would be rejected by the other.
       */
      const won = await readParameter(client, parameterName);
      if (!won) throw new Error(`signing key parameter ${parameterName} vanished mid-race`);
      return won;
    }
  };
}

async function readParameter(client: SsmLike, name: string): Promise<string | null> {
  try {
    const out = await client.send(
      new GetParameterCommand({ Name: name, WithDecryption: true }),
    );
    return out.Parameter?.Value ?? null;
  } catch (err) {
    if (errorName(err) === "ParameterNotFound") return null;
    throw err;
  }
}

function errorName(err: unknown): string {
  return typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}
