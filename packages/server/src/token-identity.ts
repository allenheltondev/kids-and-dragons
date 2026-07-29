/**
 * `TokenIdentity` — the prod `IdentityService`, architecture §4.5.
 *
 * HS256 JWTs, signed with a secret this stack never chooses and nobody ever
 * types: CloudFormation generates 64 random characters at create time and hands
 * them to Secrets Manager, which holds them under the **Amazon-managed**
 * `aws/secretsmanager` key. We create no KMS key of our own.
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
 * session start; an HMAC costs microseconds. The secret is fetched once per
 * container, exactly as the public key used to be.
 *
 * Two token kinds, matching the two layers of identity in §4.5:
 *
 *   **device token**  `aud: "device"`, 30-day sliding expiry. Long-lived, stored
 *                     in `localStorage`, and the reason there is no login screen:
 *                     the phone opens the app and it is already that player.
 *   **session token** `aud: "room"`, expires with the room (≤ 6 hours). Scoped to
 *                     one run, and what actually authorises play.
 *
 * They are ordinary JWTs on purpose rather than a bespoke envelope — a format
 * worth keeping even now that the signature is symmetric, because it is the one
 * every library, log viewer, and debugging session already understands.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { Role } from "@kad/shared";
import {
  hashToken,
  type DeviceIdentity,
  type IdentityService,
  type IssueDeviceTokenInput,
  type IssueSessionTokenInput,
  type IssueViewerTokenInput,
  type SessionIdentity,
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

const ALG = "HS256";

interface DeviceClaims {
  sub: string;
  aud: "device";
  hh: string;
  pid: string;
  role: Role;
  iat: number;
  exp: number;
}

interface SessionClaims {
  sub: string;
  aud: "room";
  run: string;
  code: string;
  hh: string;
  role: Role;
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
   * cannot reach Secrets Manager should fail the request it is serving, and then
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
    const token = await this.sign<DeviceClaims>({
      sub: deviceId,
      aud: "device",
      hh: input.householdId,
      pid: input.playerId,
      role: input.role,
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor((nowMs + DEVICE_TOKEN_TTL_MS) / 1000),
    });

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

    const binding = await this.repo.getDeviceById(claims.sub);
    /*
     * The signature alone is not enough. Revocation has to be able to kill a
     * token that is still cryptographically valid — "lost phone → the owner
     * revokes it from their own device, that token is dead immediately" (§4.5)
     * only works if every resolve reads the binding.
     */
    if (!binding || binding.revoked) return null;
    if (binding.householdId !== claims.hh) return null;
    if (binding.playerId !== claims.pid) return null;

    const nowMs = this.now();
    const rotate = claims.exp * 1000 - nowMs < DEVICE_TOKEN_REFRESH_AFTER_MS;
    let rotatedToken: string | undefined;

    if (rotate) {
      // Re-issuing writes `lastSeen` as a side effect, so this branch does not
      // also need to touch the device item.
      ({ token: rotatedToken } = await this.issueDeviceToken({
        householdId: binding.householdId,
        playerId: binding.playerId,
        role: claims.role,
        deviceId: binding.deviceId,
        ...(binding.userAgent ? { userAgent: binding.userAgent } : {}),
      }));
    } else {
      await this.repo.putDevice({ ...binding, lastSeen: new Date(nowMs).toISOString() });
    }

    return {
      deviceId: binding.deviceId,
      householdId: binding.householdId,
      playerId: binding.playerId,
      role: claims.role,
      ...(rotatedToken ? { rotatedToken } : {}),
    };
  }

  // --- session tokens --------------------------------------------------------

  async issueSessionToken(input: IssueSessionTokenInput): Promise<string> {
    return this.sign<SessionClaims>({
      sub: input.playerId,
      aud: "room",
      run: input.runId,
      code: input.roomCode,
      hh: input.householdId,
      role: input.role,
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
      role: claims.role,
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

/**
 * The prod secret source: one `GetSecretValue`, on the first token of a
 * container's life.
 *
 * There is no `kms:Decrypt` grant anywhere in the template for this, and that is
 * not an omission. The secret is encrypted under the Amazon-managed
 * `aws/secretsmanager` key, whose policy already allows principals in the
 * account to use it *when the request arrives via Secrets Manager* — so
 * `secretsmanager:GetSecretValue` on the one secret is the whole permission.
 */
export interface SecretsManagerLike {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string | undefined }>;
}

export function secretsManagerSource(
  secretId: string,
  client: SecretsManagerLike = new SecretsManagerClient({}),
): SecretSource {
  return async () => {
    const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!out.SecretString) throw new Error(`secret ${secretId} has no string value`);
    return out.SecretString;
  };
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
