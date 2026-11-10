/**
 * Leaving a device: a phone or tablet stops being the kid it plays as.
 *
 * A personal binding makes a device one kid for a month at a time, and a new
 * one is a scan away (`pairing.ts`: "a hospital tablet, a borrowed phone").
 * There was no way back. A tablet a ward lends out stayed the last patient's
 * hero until its token ran down, and a phone handed to a sibling stayed its
 * first owner's.
 *
 * Leaving needs nothing but the device itself: whoever is holding it can say
 * "this isn't me", with no grown-up signed in, because the device's own token
 * is the proof and giving up a binding takes nothing from anybody else. The
 * kid, her heroes and her other devices are untouched; revoking is a flag on
 * this one binding (`revokeDevice`).
 *
 * The one thing it must not do is strand a hero. A kid who exists only on
 * this device, in a household no grown-up has kept, has no other way back to
 * her: nobody can sign in to find her and no other device can make her a
 * code. So a device may leave only when there is still a way to reach her
 * (`canLeave`), and is otherwise told to save her first.
 */

import type { DeviceStanding } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import { DEVICE_TOKEN_TTL_MS } from "../token-identity.ts";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";

type LeaveDeps = Pick<HandlerDeps, "repo" | "now">;

export async function deviceStanding(
  principal: DeviceIdentity,
  deps: LeaveDeps,
): Promise<HandlerResult<DeviceStanding>> {
  const [household, player, devices] = await Promise.all([
    deps.repo.getHousehold(principal.householdId),
    deps.repo.getPlayer(principal.householdId, principal.playerId),
    deps.repo.listDevices(principal.householdId),
  ]);
  if (!household || !player) return fail("NOT_FOUND", "This device isn't anybody anymore.");

  const kept = !household.guest;
  // Another device that is still her: not this one, not revoked, and seen
  // recently enough that its token has not run out.
  const freshSince = deps.now() - DEVICE_TOKEN_TTL_MS;
  const elsewhere = devices.some(
    (device) =>
      device.kind !== "shared" &&
      device.playerId === principal.playerId &&
      device.deviceId !== principal.deviceId &&
      !device.revoked &&
      Date.parse(device.lastSeen) > freshSince,
  );
  // An unkept household can only ever be kept from the device that started it
  // (`Household.founderDeviceId`). If that device leaves, nobody can save these
  // heroes at all, however many other devices are hers.
  const founder = household.founderDeviceId === principal.deviceId;

  return ok({ displayName: player.displayName, kept, canLeave: kept || (elsewhere && !founder) });
}

/**
 * Revokes this device's own binding. Its token is dead from the next request
 * (`getDevice` is read strongly consistent on every resolve), and the turn
 * notifications it asked for go with it, so a device that is nobody is not
 * told when it is her turn.
 */
export async function leaveDevice(
  principal: DeviceIdentity,
  deps: LeaveDeps,
): Promise<HandlerResult<{ left: true }>> {
  const standing = await deviceStanding(principal, deps);
  if (!standing.ok) return standing;
  if (!standing.value.canLeave) {
    return fail(
      "ILLEGAL",
      `${standing.value.displayName}’s heroes are only on this device. Save them to an account first, and then it can leave.`,
    );
  }

  await deps.repo.revokeDevice(principal.householdId, principal.deviceId);
  try {
    await deps.repo.deletePushSubscription(principal.playerId, principal.deviceId);
  } catch (err) {
    // The binding is gone, which is what was asked. A subscription left behind
    // is dropped the first time a push to it is refused (`handlers/push.ts`).
    console.error(`leaveDevice: could not drop the push subscription of ${principal.deviceId}:`, err);
  }
  return ok({ left: true });
}
