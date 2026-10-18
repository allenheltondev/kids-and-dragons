/**
 * The host handing the keeper role to a phone in the room — issue #272.
 *
 * Only the device that started a guest household may keep it by signing in
 * (#265), and that rule left two holes the family could not mend: a stranger
 * who beat them to a TV's code founded the household, and a founder taken out
 * (or a founding phone lost) left it with nobody. The room's host is already
 * trusted with the low-stakes controls (`host.ts`), and "whose game is this"
 * is decided by who is in the room, so the host may move the role to a phone
 * seated in it. Nothing is claimed here: the new keeper still has to sign in,
 * on that phone, to keep the game.
 *
 * Conservative on purpose. The host picks from the roster, so it can only name
 * somebody it can see; the target must be a phone of the room's own household
 * (not a visitor, not a family tablet, which is nobody), still in the game,
 * and the household must still be a guest game nobody has kept. Moving the
 * role twice is fine; moving it off an account's household is refused in the
 * store's own write.
 */

import type { RunState } from "@kad/shared";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { commitRoomChange, hostedRoom, type HostPrincipal } from "./host.ts";

export interface HandKeeperInput {
  code: string;
  principal: HostPrincipal;
  playerId: string;
}

export async function handKeeper(
  input: HandKeeperInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ seq: number }>> {
  const hosted = await hostedRoom(input.code, input.principal, deps);
  if (!hosted.ok) return hosted;
  const room = hosted.value;

  const household = await deps.repo.getHousehold(room.householdId);
  if (!household) return fail("NOT_FOUND", `no household ${room.householdId}`);
  if (!household.guest || household.ownerSub) return fail("ILLEGAL", "This game is already kept.");

  const state = await deps.repo.getState(room.runId);
  if (!state) return fail("NOT_FOUND", `run ${room.runId} has no state`);
  const seat = state.seats?.[input.playerId];
  // On the roster and in the room's own household: a visitor's profile is in
  // theirs, and the game is not.
  if (!seat || seat.homeHouseholdId !== undefined || state.removed?.includes(input.playerId)) {
    return fail("NOT_FOUND", `no player ${input.playerId} in this room`);
  }
  if (seat.device === "tablet") return fail("ILLEGAL", "A family tablet can't keep the game. Pick a phone.");

  // The phone to hand it to: the player's own, most recently seen.
  const devices = (await deps.repo.listDevices(room.householdId))
    .filter((d) => d.kind !== "shared" && !d.revoked && d.playerId === input.playerId)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  const device = devices[0];
  if (!device) return fail("ILLEGAL", "That player has no phone of their own to keep the game on.");

  if (!(await deps.repo.setFounder(room.householdId, device.deviceId))) {
    return fail("ILLEGAL", "This game is already kept.");
  }

  // Told to every screen, so the old keeper's offer goes and the new one's
  // comes, and a phone restored from storage draws the right one.
  const result = await commitRoomChange(
    room,
    input.principal.playerId,
    (current: RunState): RunState | null =>
      current.keeperPlayerId === input.playerId ? null : { ...current, keeperPlayerId: input.playerId },
    deps,
  );
  return result.ok ? ok({ seq: result.value.seq }) : result;
}
