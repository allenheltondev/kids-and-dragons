/**
 * When a phone holds the screen wake lock (#463).
 *
 * A phone that dims in the middle of a scene drops out of the story, so while
 * a room is open the phone asks for the same lock the TV does (`keepAwake`).
 * Only in a room, never on the lobby or the journal: a lock held all day on a
 * home screen is battery spent for nothing.
 *
 * A family tablet that is only watching (no player seated on it) lets the
 * screen sleep; it holds the lock once a kid is seated.
 */

import type { ConnectionStatus } from "../store/contract";
import type { Route } from "../router";

export interface PhoneWakeInput {
  route: Route;
  connection: ConnectionStatus;
  /** The player seated on this device; "" when nobody is. */
  playerId: string;
  /** This is the household's shared tablet (`loadSharedDevice`). */
  sharedDevice: boolean;
}

export function shouldHoldPhoneWake(input: PhoneWakeInput): boolean {
  const { route, connection, playerId, sharedDevice } = input;
  if (route.name !== "player" || route.code === "") return false;
  if (connection !== "open" && connection !== "reconnecting") return false;
  if (sharedDevice && playerId === "") return false;
  return true;
}
