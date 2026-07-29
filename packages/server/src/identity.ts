/**
 * The auth seam — architecture §4.5.
 *
 * Two layers of identity, deliberately separated:
 *
 *   household account  — permanent, Cognito, adults only
 *   player profile     — permanent, a **device-bound** long-lived token, no password ever
 *   room session       — ≤ 6 hours, scoped to one run
 *
 * The one invariant every call site depends on: **a device token resolves to
 * `{ householdId, playerId, role }` on its own.** That is what makes joining a
 * room have no "who are you?" step — you scan the code and your character is
 * already on the board (§4.5). Nothing above this file ever asks a player to
 * identify themselves, so replacing the implementation cannot reintroduce a
 * login screen.
 *
 * Roadmap Chapter 1 owns the real implementation: Cognito for the household,
 * signed JWTs for devices, rotation on every use with a 30-day sliding
 * expiry, revocation from the owner's device. `DevIdentity` below is the local
 * stand-in and is **unsigned** — it is a base64 envelope, not a credential. It
 * exists so that the rest of the server can be written against the final shape
 * today. When Chapter 1 lands, this file changes and its callers do not.
 */

import { createHash, randomUUID } from "node:crypto";
import type { Role } from "@kad/shared";
import type { GameRepository } from "./store/repository.ts";

/** What a device token resolves to. */
export interface DeviceIdentity {
  deviceId: string;
  householdId: string;
  playerId: string;
  role: Role;
  /**
   * A fresh token, when this resolve renewed a sliding expiry (§4.5). Present
   * on a small fraction of requests and never twice for the same token.
   *
   * Entry points hand it back as the `x-kad-device-token` response header, which
   * is the only reason the field is on the *resolved principal* rather than
   * buried in the identity implementation: a device that is never told about its
   * new token eventually expires while being used every week.
   */
  rotatedToken?: string;
}

/** What a room-session token resolves to. Scoped to one run, short-lived. */
export interface SessionIdentity {
  runId: string;
  roomCode: string;
  householdId: string;
  playerId: string;
  role: Role;
  /** Epoch millis. */
  expiresAt: number;
}

export interface IssueDeviceTokenInput {
  householdId: string;
  playerId: string;
  role: Role;
  /** Omit to mint a new device binding. */
  deviceId?: string;
  userAgent?: string;
}

export interface IssueSessionTokenInput {
  runId: string;
  roomCode: string;
  householdId: string;
  playerId: string;
  role: Role;
  /** Epoch millis. Rooms live ≤ 6 hours, so sessions never outlive them. */
  expiresAt: number;
}

/**
 * What a **display client** gets. The TV is not a player: it has no device
 * binding, no profile, and nothing it is allowed to do (spec §2.1) — it may be
 * hard-refreshed at any time and simply reattaches to whatever the room says.
 *
 * It still needs a credential, because in prod the realtime channel is
 * authorised per subscriber. So it gets one that names a room and nothing else.
 * Keeping it a separate type from `SessionIdentity` is what stops a display
 * token ever satisfying a code path that expects a player.
 */
export interface ViewerIdentity {
  runId: string;
  roomCode: string;
  /** Epoch millis. Never outlives the room. */
  expiresAt: number;
}

export interface IssueViewerTokenInput {
  runId: string;
  roomCode: string;
  /** Epoch millis. */
  expiresAt: number;
}

export interface IdentityService {
  /** `null` for an unknown, malformed, or revoked token. Never throws. */
  resolveDevice(token: string): Promise<DeviceIdentity | null>;
  /** Binds (or re-binds) a device to a player and returns its token. */
  issueDeviceToken(input: IssueDeviceTokenInput): Promise<{ token: string; deviceId: string }>;
  issueSessionToken(input: IssueSessionTokenInput): Promise<string>;
  resolveSession(token: string): Promise<SessionIdentity | null>;
  /** Read-only, room-scoped, no player. For the TV. */
  issueViewerToken(input: IssueViewerTokenInput): Promise<string>;
  resolveViewer(token: string): Promise<ViewerIdentity | null>;
}

// ---------------------------------------------------------------------------
// Local dev implementation — UNSIGNED. Never deploy this.
// ---------------------------------------------------------------------------

const DEVICE_PREFIX = "kaddev.d1.";
const SESSION_PREFIX = "kaddev.s1.";
const VIEWER_PREFIX = "kaddev.v1.";

interface DevDeviceClaims {
  deviceId: string;
  householdId: string;
  playerId: string;
  role: Role;
  issuedAt: number;
}

/**
 * Dev identity backed by the `DEVICE#<deviceId>` items in the repository.
 *
 * The token itself is unsigned, but the *binding* is real: the token's hash is
 * stored on the device item and checked on every resolve, and a revoked device
 * stops resolving immediately. That means the revocation path from §4.5 — the
 * one worth testing while it is cheap — is exercised locally with the same code
 * path it will have in prod.
 */
export class DevIdentity implements IdentityService {
  constructor(
    private readonly repo: GameRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async issueDeviceToken(
    input: IssueDeviceTokenInput,
  ): Promise<{ token: string; deviceId: string }> {
    const deviceId = input.deviceId ?? `d_${randomUUID().slice(0, 8)}`;
    const claims: DevDeviceClaims = {
      deviceId,
      householdId: input.householdId,
      playerId: input.playerId,
      role: input.role,
      issuedAt: this.now(),
    };
    const token = DEVICE_PREFIX + encode(claims);
    await this.repo.putDevice({
      deviceId,
      householdId: input.householdId,
      playerId: input.playerId,
      tokenHash: hashToken(token),
      lastSeen: new Date(this.now()).toISOString(),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });
    return { token, deviceId };
  }

  async resolveDevice(token: string): Promise<DeviceIdentity | null> {
    const claims = decode<DevDeviceClaims>(token, DEVICE_PREFIX);
    if (!claims) return null;

    const binding = await this.repo.getDeviceById(claims.deviceId);
    if (!binding || binding.revoked) return null;
    if (binding.tokenHash !== hashToken(token)) return null;
    if (binding.householdId !== claims.householdId) return null;

    // Real tokens rotate on use with a sliding expiry; locally we just keep
    // `lastSeen` honest so the revocation UI has something to show.
    await this.repo.putDevice({ ...binding, lastSeen: new Date(this.now()).toISOString() });

    return {
      deviceId: binding.deviceId,
      householdId: binding.householdId,
      playerId: binding.playerId,
      role: claims.role,
    };
  }

  async issueSessionToken(input: IssueSessionTokenInput): Promise<string> {
    return SESSION_PREFIX + encode(input);
  }

  async resolveSession(token: string): Promise<SessionIdentity | null> {
    const claims = decode<SessionIdentity>(token, SESSION_PREFIX);
    if (!claims) return null;
    if (claims.expiresAt <= this.now()) return null;
    return claims;
  }

  async issueViewerToken(input: IssueViewerTokenInput): Promise<string> {
    return VIEWER_PREFIX + encode(input);
  }

  async resolveViewer(token: string): Promise<ViewerIdentity | null> {
    const claims = decode<ViewerIdentity>(token, VIEWER_PREFIX);
    if (!claims) return null;
    if (claims.expiresAt <= this.now()) return null;
    return claims;
  }
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode<T>(token: string, prefix: string): T | null {
  if (typeof token !== "string" || !token.startsWith(prefix)) return null;
  try {
    return JSON.parse(Buffer.from(token.slice(prefix.length), "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** Tokens are stored hashed, never in the clear — true in dev and in prod. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
