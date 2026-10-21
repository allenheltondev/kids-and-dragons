/**
 * Who holds a seat at the table (#389).
 *
 * A player the host took out (`RunState.removed`, #267) stays in `party`,
 * disconnected, so a fight they were in still has their figure to point at.
 * They do not hold a seat: the ceiling (`MAX_PARTY`) counts the members still
 * in the game, so a stranger who was taken out leaves room for the family's
 * own kid, and a fight places only the members still in the game.
 */

import { MAX_PARTY } from "./types/domain.js";
import type { PartyMember, RunState } from "./types/state.js";

/** What a phone is told when every seat is taken. Read aloud to an eight-year-old. */
export const TABLE_FULL_MESSAGE =
  "This table is full. Four heroes are already playing! If a seat opens up, you can make your hero right here.";

/** The party less anybody taken out: the members who hold a seat. */
export function seatedMembers(state: Pick<RunState, "party" | "removed">): PartyMember[] {
  const out = new Set(state.removed ?? []);
  return state.party.filter((member) => !out.has(member.playerId));
}

/**
 * Whether `playerId` would find no seat: every seat is held and none of them
 * is theirs. A player with a hero in the party is never shut out by this.
 */
export function tableFull(state: Pick<RunState, "party" | "removed">, playerId?: string | null): boolean {
  if (playerId && state.party.some((member) => member.playerId === playerId)) return false;
  return seatedMembers(state).length >= MAX_PARTY;
}
