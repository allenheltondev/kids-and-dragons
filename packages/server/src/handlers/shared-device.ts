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
import type { DeviceIdentity, SharedDeviceIdentity } from "../identity.ts";
import { createProfile, type AccountDeps } from "./account.ts";
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
  const householdId = (await deps.repo.listHouseholdsForAccount(input.cognitoSub))[0];
  if (!householdId) {
    return fail("NOT_FOUND", "This account has no family yet. Play a game and keep it first.");
  }

  if (input.principal) await deps.repo.revokeDevice(input.principal.householdId, input.principal.deviceId);
  if (input.shared) await deps.repo.revokeDevice(input.shared.householdId, input.shared.deviceId);

  const { token } = await deps.identity.issueSharedDeviceToken({
    householdId,
    ...(input.userAgent ? { userAgent: input.userAgent } : {}),
  });
  return ok({ sharedToken: token, ...(await describePlayers(householdId, deps)) });
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
    if (!player) return fail("NOT_FOUND", `no player ${input.playerId}`);
  } else if (typeof input.newPlayer === "string") {
    const name = input.newPlayer.trim();
    if (name === "" || name.length > NEW_PLAYER_NAME_MAX) {
      return fail("ILLEGAL", `a new player needs a name of 1 to ${NEW_PLAYER_NAME_MAX} letters`);
    }
    // Two faces with one name on the picker is two kids who cannot tell
    // which is theirs. Somebody new with a name already here taps that face.
    const players = await deps.repo.listPlayers(shared.householdId);
    if (players.some((p) => p.displayName.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return fail("ILLEGAL", `Someone called ${name} is already here. Tap that face instead.`);
    }
    player = await createProfile(shared.householdId, name, deps);
  } else {
    return fail("ILLEGAL", "pick who is playing: expected { playerId } or { newPlayer }");
  }
  return ok({ deviceId: shared.deviceId, householdId: shared.householdId, playerId: player.id });
}

/**
 * A join as a tablet seat sees it. The tablet stays the room's host on the
 * server, so nobody else may watch a room it opened (#267), but it is not told
 * so: taking a player out is proved with a phone's own device token, which no
 * tablet holds, so a Remove button drawn there could only fail.
 */
export function asSharedSeat<T extends { host?: boolean }>(joined: T): Omit<T, "host"> {
  const { host: _host, ...seat } = joined;
  return seat;
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
  const faces: SharedDevicePlayer[] = players.map((player) => ({
    id: player.id,
    displayName: player.displayName,
    color: player.color,
    heroes: ranked.filter((c) => c.ownerPlayerId === player.id).map((c) => c.name),
  }));
  return { householdId, players: faces };
}
