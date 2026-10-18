/**
 * Rooms open to visitors (#249): phones from more than one household at one
 * table. Shared because the server enforces these rules and the screens draw
 * them, and the two must agree on who is a visitor and who may trade.
 *
 * The household is still the unit a hero belongs to (#266 is undecided), so
 * nothing here deepens it: a visitor's hero keeps living in its own household,
 * and a party member names that home only when it differs from the room's.
 */

import type { PartyMember, RunState } from "./types/state.js";

/** Letters an open room's visitor code adds to its room code: 4 + 2 = 6. */
export const VISITOR_CODE_EXTRA = 2;

/**
 * How long an open room may sit with nothing happening in it before it
 * closes itself: well inside the 6-hour room TTL a closed room keeps, since
 * an open room's code is the only thing between a stranger and the table.
 */
export const OPEN_ROOM_IDLE_MS = 30 * 60 * 1000;

/** The household a party member's hero lives in: its own, or the room's. */
export function memberHome(member: Pick<PartyMember, "homeHouseholdId">, roomHouseholdId: string): string {
  return member.homeHouseholdId ?? roomHouseholdId;
}

/**
 * Whether two party members' heroes live in the same household. Items move
 * only within one (#249: no trades across households in v1).
 */
export function sameHome(
  a: Pick<PartyMember, "homeHouseholdId">,
  b: Pick<PartyMember, "homeHouseholdId">,
): boolean {
  return (a.homeHouseholdId ?? null) === (b.homeHouseholdId ?? null);
}

/** Open to visitors, and nothing has happened in it for `OPEN_ROOM_IDLE_MS`. */
export function idleOpenRoom(state: Pick<RunState, "visitorCode" | "closed" | "updatedAt">, nowMs: number): boolean {
  if (state.visitorCode === undefined || state.closed === true) return false;
  const last = Date.parse(state.updatedAt);
  return Number.isFinite(last) && nowMs - last >= OPEN_ROOM_IDLE_MS;
}
