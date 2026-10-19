/**
 * The auth seam — architecture §4.5.
 *
 * Two layers of identity, deliberately separated:
 *
 *   household account  — permanent, Cognito, claimed by signing in on the
 *                        device that started the household (#265)
 *   player profile     — permanent, a **device-bound** long-lived token, no password ever
 *   room session       — ≤ 6 hours, scoped to one run
 *
 * A device more than one kid uses (a family tablet) is bound to the household
 * instead, and to nobody in it (#250). Its token is a `SharedDeviceIdentity`,
 * which names no player and so can never stand in for one: each kid picks
 * themselves on it and is handed a room session, never a device token.
 *
 * The one invariant every call site depends on: **a device token resolves to
 * `{ householdId, playerId }` on its own.** That is what makes joining a
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
import type { DeviceBinding } from "@kad/shared";
import type { GameRepository } from "./store/repository.ts";

/** What a device token resolves to. */
export interface DeviceIdentity {
  deviceId: string;
  householdId: string;
  playerId: string;
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

/**
 * What a **shared device** token resolves to (#250): a household, and nobody in
 * it. The tablet opens on a "who's playing?" picker, and the kid picked gets a
 * room session for one run, never a device token of their own.
 *
 * Its own type, not a `DeviceIdentity` with the player left blank, for the
 * reason `ViewerIdentity` is: with no `playerId` it cannot satisfy a code path
 * that expects a player. Somebody has to be picked first (`seatOnSharedDevice`).
 */
export interface SharedDeviceIdentity {
  kind: "shared";
  deviceId: string;
  householdId: string;
  /** As on `DeviceIdentity`: a renewed token, sent back as `x-kad-shared-token`. */
  rotatedToken?: string;
}

export interface IssueSharedDeviceTokenInput {
  householdId: string;
  /** Omit to mint a new device binding. */
  deviceId?: string;
  userAgent?: string;
}

/** What a room-session token resolves to. Scoped to one run, short-lived. */
export interface SessionIdentity {
  runId: string;
  roomCode: string;
  householdId: string;
  playerId: string;
  /** Epoch millis. */
  expiresAt: number;
}

export interface IssueDeviceTokenInput {
  householdId: string;
  playerId: string;
  /** Omit to mint a new device binding. */
  deviceId?: string;
  userAgent?: string;
}

export interface IssueSessionTokenInput {
  runId: string;
  roomCode: string;
  householdId: string;
  playerId: string;
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
  /** Binds a device to a household and nobody in it (#250). */
  issueSharedDeviceToken(input: IssueSharedDeviceTokenInput): Promise<{ token: string; deviceId: string }>;
  /**
   * `null` for an unknown, malformed or revoked token, and for a personal
   * device's token. Never throws. `resolveDevice` likewise refuses a shared one.
   */
  resolveSharedDevice(token: string): Promise<SharedDeviceIdentity | null>;
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
const SHARED_PREFIX = "kaddev.h1.";

interface DevDeviceClaims {
  deviceId: string;
  householdId: string;
  playerId: string;
  issuedAt: number;
}

interface DevSharedClaims {
  deviceId: string;
  householdId: string;
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

    // By primary key, like the prod service: the revocation check must never
    // read a stale index copy it could then write back (see `TokenIdentity`).
    // A kid who moved home took this binding with her (#251).
    const binding =
      (await this.repo.getDevice(claims.householdId, claims.deviceId)) ??
      (await movedBinding(this.repo, claims.householdId, claims.deviceId));
    if (!binding || binding.revoked || binding.kind === "shared") return null;
    if (binding.tokenHash !== hashToken(token)) return null;
    if (binding.playerId !== claims.playerId) return null;

    // Real tokens rotate on use with a sliding expiry; locally we just keep
    // `lastSeen` honest so the revocation UI has something to show. `touch`,
    // not a full put — a resolve must never be able to un-revoke.
    await this.repo.touchDevice(
      binding.householdId,
      binding.deviceId,
      new Date(this.now()).toISOString(),
    );

    return {
      deviceId: binding.deviceId,
      householdId: binding.householdId,
      playerId: binding.playerId,
    };
  }

  async issueSharedDeviceToken(
    input: IssueSharedDeviceTokenInput,
  ): Promise<{ token: string; deviceId: string }> {
    const deviceId = input.deviceId ?? `d_${randomUUID().slice(0, 8)}`;
    const claims: DevSharedClaims = {
      deviceId,
      householdId: input.householdId,
      issuedAt: this.now(),
    };
    const token = SHARED_PREFIX + encode(claims);
    await this.repo.putDevice({
      kind: "shared",
      deviceId,
      householdId: input.householdId,
      tokenHash: hashToken(token),
      lastSeen: new Date(this.now()).toISOString(),
      ...(input.userAgent ? { userAgent: input.userAgent } : {}),
    });
    return { token, deviceId };
  }

  async resolveSharedDevice(token: string): Promise<SharedDeviceIdentity | null> {
    const claims = decode<DevSharedClaims>(token, SHARED_PREFIX);
    if (!claims) return null;
    const binding = await this.repo.getDevice(claims.householdId, claims.deviceId);
    if (!binding || binding.revoked || binding.kind !== "shared") return null;
    if (binding.tokenHash !== hashToken(token)) return null;
    await this.repo.touchDevice(
      binding.householdId,
      binding.deviceId,
      new Date(this.now()).toISOString(),
    );
    return { kind: "shared", deviceId: binding.deviceId, householdId: binding.householdId };
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

/** A chain of moves longer than this is not a kid going home; it is a loop. */
const MAX_MOVES = 4;

/**
 * The binding a phone's token names when its kid has moved home since the
 * token was minted (#251). The token still names the household she left, and
 * her binding went with her, so the old household keeps a forward
 * (`getMovedDevice`) naming the new one. Followed by primary key, hop by hop,
 * so the revocation check reads what it always read: the binding itself,
 * strongly consistent, never an index copy. `null` when nothing moved.
 *
 * Only on a miss, so a phone that never moved pays nothing for this.
 */
export async function movedBinding(
  repo: Pick<GameRepository, "getDevice" | "getMovedDevice">,
  householdId: string,
  deviceId: string,
): Promise<DeviceBinding | null> {
  let from = householdId;
  for (let hop = 0; hop < MAX_MOVES; hop++) {
    const to = await repo.getMovedDevice(from, deviceId);
    if (!to) return null;
    const binding = await repo.getDevice(to, deviceId);
    if (binding) return binding;
    from = to;
  }
  return null;
}

/** Tokens are stored hashed, never in the clear — true in dev and in prod. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
