/**
 * `KmsIdentity` — the prod `IdentityService`, architecture §4.5.
 *
 * Real ES256 JWTs. The private key is an asymmetric KMS key that never leaves
 * KMS: signing is a `Sign` call, and verification is done **locally** against
 * the public half fetched once per container. That asymmetry is the whole point
 * — signing happens once per pairing, verification happens on every request from
 * every phone, and a `Verify` API call in that path would put a network round
 * trip in front of every tap at the table.
 *
 * Two token kinds, matching the two layers of identity in §4.5:
 *
 *   **device token**  `aud: "device"`, 30-day sliding expiry. Long-lived, stored
 *                     in `localStorage`, and the reason there is no login screen:
 *                     the phone opens the app and it is already that player.
 *   **session token** `aud: "room"`, expires with the room (≤ 6 hours). Scoped to
 *                     one run, and what actually authorises play.
 *
 * They are ordinary JWTs on purpose rather than a bespoke envelope: the same
 * public key verifies them from anywhere, which keeps an API Gateway JWT
 * authorizer on the table as a later optimisation without a token migration.
 */

import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { GetPublicKeyCommand, KMSClient, SignCommand } from "@aws-sdk/client-kms";
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

const ALG = "ES256";
/** P-256: r and s are 32 bytes each in the JOSE encoding. */
const COORD_BYTES = 32;

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

export interface KmsIdentityOptions {
  repo: GameRepository;
  /** The KMS key id or alias for the signing key. */
  keyId: string;
  client?: KMSClient;
  now?: () => number;
}

export class KmsIdentity implements IdentityService {
  private readonly repo: GameRepository;
  private readonly kms: KMSClient;
  private readonly keyId: string;
  private readonly now: () => number;
  /** Fetched once per container, then reused for every verification. */
  private publicKey: Promise<KeyObject> | null = null;

  constructor(options: KmsIdentityOptions) {
    this.repo = options.repo;
    this.keyId = options.keyId;
    this.kms = options.client ?? new KMSClient({});
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
    const header = b64url(JSON.stringify({ alg: ALG, typ: "JWT", kid: this.keyId }));
    const payload = b64url(JSON.stringify(claims));
    const message = `${header}.${payload}`;

    const out = await this.kms.send(
      new SignCommand({
        KeyId: this.keyId,
        // KMS hashes the message for us; sending RAW keeps the 4KB limit well
        // clear of anything these claims could grow into.
        Message: Buffer.from(message, "utf8"),
        MessageType: "RAW",
        SigningAlgorithm: "ECDSA_SHA_256",
      }),
    );
    if (!out.Signature) throw new Error("KMS returned no signature");
    return `${message}.${b64urlBytes(derToJose(out.Signature))}`;
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

      const valid = verifySignature(
        "sha256",
        Buffer.from(`${header}.${payload}`, "utf8"),
        // ieee-p1363 *is* the JOSE r||s encoding, so no conversion is needed on
        // the way back in — only on the way out of KMS, which speaks DER.
        { key: await this.loadPublicKey(), dsaEncoding: "ieee-p1363" },
        fromB64url(signature),
      );
      if (!valid) return null;

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

  private loadPublicKey(): Promise<KeyObject> {
    this.publicKey ??= this.kms
      .send(new GetPublicKeyCommand({ KeyId: this.keyId }))
      .then((out) => {
        if (!out.PublicKey) throw new Error("KMS returned no public key");
        return createPublicKey({
          key: Buffer.from(out.PublicKey),
          format: "der",
          type: "spki",
        });
      })
      .catch((err: unknown) => {
        // Do not cache a failure: a throttled cold start would otherwise reject
        // every request for the life of the container.
        this.publicKey = null;
        throw err;
      });
    return this.publicKey;
  }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function b64urlBytes(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

/**
 * KMS returns an ECDSA signature as DER — `SEQUENCE { INTEGER r, INTEGER s }` —
 * and JOSE wants the fixed-width concatenation `r || s`. They are the same two
 * numbers in different clothes, but the DER integers are variable length: a
 * leading `0x00` appears whenever the high bit would otherwise read as a sign,
 * and leading zero bytes are dropped when they would not.
 *
 * Getting this wrong produces signatures that verify *most* of the time — about
 * one in 256 fails — which is the kind of bug that shows up as "a phone
 * occasionally has to re-pair" months later.
 */
export function derToJose(der: Uint8Array, coordBytes = COORD_BYTES): Uint8Array {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error("bad DER: expected SEQUENCE");

  // Skip the sequence length, long form included.
  const seqLen = der[offset++] ?? 0;
  if (seqLen & 0x80) offset += seqLen & 0x7f;

  const readInt = (): Uint8Array => {
    if (der[offset++] !== 0x02) throw new Error("bad DER: expected INTEGER");
    const len = der[offset++] ?? 0;
    const value = der.subarray(offset, offset + len);
    offset += len;
    return value;
  };

  const out = new Uint8Array(coordBytes * 2);
  out.set(fixedWidth(readInt(), coordBytes), 0);
  out.set(fixedWidth(readInt(), coordBytes), coordBytes);
  return out;
}

/** Strip DER's sign padding, then left-pad to the curve's coordinate width. */
function fixedWidth(value: Uint8Array, width: number): Uint8Array {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start++;
  const trimmed = value.subarray(start);
  if (trimmed.length > width) throw new Error("bad DER: integer wider than the curve");
  const out = new Uint8Array(width);
  out.set(trimmed, width - trimmed.length);
  return out;
}
