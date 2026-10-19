/**
 * Shared devices — a family tablet, a borrowed phone, a pool of tablets (#250).
 *
 * A personal device's token *is* a player (§4.5), which is right for a kid's
 * own phone and wrong for a tablet three kids take turns on: it would either be
 * whoever used it last or, once its storage is cleared, nobody. So a shared
 * device is bound to the **household** instead, and to nobody in it:
 *
 *   - It opens on a "who's playing?" picker of the household's profiles
 *     (`listSharedPlayers`). Kids pick freely; no grown-up approves a seat.
 *   - The kid picked is seated with a **room session** and nothing more
 *     (`seatOnSharedDevice`, then `joinRoom`). It dies with the room, so no kid
 *     ever holds a long-lived token on a shared device, and when the room ends
 *     the tablet is back to the picker.
 *   - Heroes belong to the household, so clearing the tablet's storage, or
 *     forgetting it (`forgetDevice`), loses nobody's hero.
 *
 * Making a device shared and forgetting one are both an owner's call, so both
 * need a verified sign-in. Picking yourself on the tablet needs nothing.
 */

import type { PlayerProfile, SharedDevicePlayer, SharedDevicePlayersResponse, ShareDeviceResponse } from "@kad/shared";
import type { DeviceIdentity, SessionIdentity, SharedDeviceIdentity } from "../identity.ts";
import type { RoomRecord } from "../store/repository.ts";
import { createProfile, vetTypedName, type AccountDeps } from "./account.ts";
import { fail, ok, type HandlerResult } from "./deps.ts";

/** Long enough for any kid's name, short enough to fit under an avatar. */
export const NEW_PLAYER_NAME_MAX = 24;

export interface ShareDeviceInput {
  /** Already verified by the entry point, as for `linkAccount`. */
  cognitoSub: string;
  /** The personal binding this device holds, if any. Marking it shared revokes it. */
  principal?: DeviceIdentity | null;
  /** A shared binding it already holds (re-sharing), likewise revoked. */
  shared?: SharedDeviceIdentity | null;
  /**
   * Which household the tablet is for, when the account owns more than one
   * (#248): a family and a group. Required then; a tablet put in the wrong
   * one shows a club's kids a family's faces.
   */
  householdId?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * A signed-in owner makes this device their household's shared tablet.
 *
 * Whatever this device was before is revoked, not converted: a personal token
 * left alive on a tablet every kid uses is exactly the long-lived kid token
 * this design exists to keep off it. The binding is a fresh one, so nothing the
 * old token could still prove carries over. That includes founding a guest
 * household (#265), which a shared tablet, being nobody, cannot do.
 */
export async function shareDevice(
  input: ShareDeviceInput,
  deps: AccountDeps,
): Promise<HandlerResult<ShareDeviceResponse>> {
  const owned = await deps.repo.listHouseholdsForAccount(input.cognitoSub);
  if (owned.length === 0) {
    return fail("NOT_FOUND", "This account has no family yet. Play a game and keep it first.");
  }
  if (input.householdId !== undefined && !owned.includes(input.householdId)) {
    return fail("FORBIDDEN", "that household belongs to a different account");
  }
  if (input.householdId === undefined && owned.length > 1) {
    return fail("ILLEGAL", "This account runs more than one group. Pick which one this tablet is for.");
  }
  const householdId = input.householdId ?? owned[0] ?? "";

  /*
   * New binding first, old ones revoked last. Anything that fails before the
   * revocations leaves the device exactly as it was: its old token still
   * works, the new one was never handed over, and the owner can simply try
   * again. Revoking first meant a failure in between left a phone holding a
   * dead token, which the next join quietly turned into a brand-new player.
   */
  const { token, deviceId } = await deps.identity.issueSharedDeviceToken({
    householdId,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  });
  try {
    const players = await describePlayers(householdId, deps);
    if (input.principal) await deps.repo.revokeDevice(input.principal.householdId, input.principal.deviceId);
    if (input.shared) await deps.repo.revokeDevice(input.shared.householdId, input.shared.deviceId);
    return ok({ sharedToken: token, ...players });
  } catch (err) {
    // The new token is never delivered, so its binding is dead weight. A retry
    // mints another; the device keeps whichever old binding survived.
    await deps.repo.revokeDevice(householdId, deviceId).catch(() => undefined);
    throw err;
  }
}

/** The picker: everybody in the tablet's household, as big avatars. */
export async function listSharedPlayers(
  shared: SharedDeviceIdentity,
  deps: AccountDeps,
): Promise<HandlerResult<SharedDevicePlayersResponse>> {
  return ok(await describePlayers(shared.householdId, deps));
}

export interface SeatOnSharedDeviceInput {
  shared: SharedDeviceIdentity;
  /** The face that was tapped. */
  playerId?: unknown;
  /** Or a kid new to the household, by name. Gets a profile and no device. */
  newPlayer?: unknown;
}

/** Who sits at the tablet for one room: the shape `joinRoom` takes, and no token. */
export type Seat = Pick<DeviceIdentity, "deviceId" | "householdId" | "playerId">;

/**
 * Turns "this tablet" plus "that kid" into a seat for one join or create.
 *
 * The seat is never issued as a credential. It lives for one request, and what
 * the kid walks away with is the session token `joinRoom` mints from it.
 */
export async function seatOnSharedDevice(
  input: SeatOnSharedDeviceInput,
  deps: AccountDeps,
): Promise<HandlerResult<Seat>> {
  const { shared } = input;
  let player: PlayerProfile | null;
  if (typeof input.playerId === "string" && input.playerId !== "") {
    player = await deps.repo.getPlayer(shared.householdId, input.playerId);
    // A retired face is not on the picker (#248), so a tap on one is a stale screen.
    if (!player || player.retired) return fail("NOT_FOUND", `no player ${input.playerId}`);
  } else if (typeof input.newPlayer === "string") {
    const name = input.newPlayer.trim();
    if (name === "" || name.length > NEW_PLAYER_NAME_MAX) {
      return fail("ILLEGAL", `a new player needs a name of 1 to ${NEW_PLAYER_NAME_MAX} letters`);
    }
    const vetted = vetTypedName(name, name);
    if (!vetted.ok) return vetted;
    // Two faces with one name on the picker is two kids who cannot tell
    // which is theirs. Somebody new with a name already here taps that face.
    const players = await deps.repo.listPlayers(shared.householdId);
    if (players.some((p) => !p.retired && p.displayName.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return fail("ILLEGAL", `Someone called ${name} is already here. Tap that face instead.`);
    }
    player = await createProfile(shared.householdId, name, deps);
  } else {
    return fail("ILLEGAL", "pick who is playing: expected { playerId } or { newPlayer }");
  }
  return ok({ deviceId: shared.deviceId, householdId: shared.householdId, playerId: player.id });
}

/**
 * The tablet as a room's host (#267), for taking a player out of a room it
 * opened. The tablet's token proves the device; the room session of the kid
 * sitting at it says who is asking, so the host still cannot take themselves
 * out. The session must be for this room and this household: a session from
 * another tablet's room proves nothing here.
 *
 * A room the tablet opened as the TV (#274) has nobody seated, so there the
 * token alone proves the host, and `room` is how that is known.
 */
export function tabletHost(
  shared: SharedDeviceIdentity,
  session: SessionIdentity | null,
  code: string,
  room: Pick<RoomRecord, "display" | "hostDeviceId" | "householdId"> | null = null,
): HandlerResult<Seat> {
  // The tablet as the TV (#274): nobody is seated, so the token alone is the
  // proof, as a TV's device token is. Only the room this very tablet opened as
  // a display, in its own household; a seated kid's session is never needed
  // there and never accepted in its place.
  if (room?.display === true && room.hostDeviceId === shared.deviceId && room.householdId === shared.householdId) {
    return ok({ deviceId: shared.deviceId, householdId: shared.householdId, playerId: shared.deviceId });
  }
  if (!session) return fail("FORBIDDEN", "taking someone out from a tablet needs the seated player's session");
  if (session.roomCode.toUpperCase() !== code.toUpperCase() || session.householdId !== shared.householdId) {
    return fail("FORBIDDEN", "that session is not for this room");
  }
  return ok({ deviceId: shared.deviceId, householdId: shared.householdId, playerId: session.playerId });
}

export interface ForgetDeviceInput {
  cognitoSub: string;
  /** The shared device to forget: the asker's own, or one named by id. */
  deviceId: string;
}

/**
 * "Forget this device": an owner revokes a shared tablet's binding. The token
 * stops resolving on its next use (`resolveSharedDevice` reads the binding by
 * primary key). Heroes are untouched; they were never the tablet's.
 *
 * Only a shared binding, and only in a household the account owns. A kid's own
 * phone is not forgotten from here.
 */
export async function forgetDevice(
  input: ForgetDeviceInput,
  deps: AccountDeps,
): Promise<HandlerResult<{ deviceId: string }>> {
  for (const householdId of await deps.repo.listHouseholdsForAccount(input.cognitoSub)) {
    const binding = await deps.repo.getDevice(householdId, input.deviceId);
    if (!binding) continue;
    if (binding.kind !== "shared") return fail("ILLEGAL", "that is somebody's own device, not a shared one");
    await deps.repo.revokeDevice(householdId, input.deviceId);
    return ok({ deviceId: input.deviceId });
  }
  return fail("NOT_FOUND", "that device is not one of this family's");
}

async function describePlayers(householdId: string, deps: AccountDeps): Promise<SharedDevicePlayersResponse> {
  const [players, characters] = await Promise.all([
    deps.repo.listPlayers(householdId),
    deps.repo.listCharacters(householdId),
  ]);
  const ranked = [...characters].sort(
    (a, b) => b.committed.xp - a.committed.xp || a.name.localeCompare(b.name),
  );
  const faces: SharedDevicePlayer[] = players.filter((p) => !p.retired).map((player) => ({
    id: player.id,
    displayName: player.displayName,
    color: player.color,
    heroes: ranked.filter((c) => c.ownerPlayerId === player.id).map((c) => c.name),
  }));
  return { householdId, players: faces };
}
