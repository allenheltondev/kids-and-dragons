/**
 * Drop in, drop out (#258): the rules that open a wait to the rest of the
 * table once the player it waits on has stepped away (`connected: false`).
 *
 * Their own module rather than `engine.ts`, which uses them, because the
 * phones and the TV read them too, from screens that load lazily. The store
 * already pulls `engine.ts` into the first paint, so anything exported from
 * there rides in the first paint's budget (tools/perf/bundle-budget.ts)
 * whether the first paint needs it or not.
 */

import { currentActor } from "./encounter.js";
import type { PartyMember, Prompt, RunState } from "./types/state.js";

/**
 * The fight's clock is on a hero whose player has stepped away (#258): their
 * phone dropped, or the host took them out. Anybody still seated may then
 * pass that turn (END_TURN), so a fight never waits on an empty chair, the
 * way `turnHolderAway` opens a Story beat and `rollerAway` a check.
 *
 * A pass, not an automatic skip. A phone that has gone to sleep while its kid
 * watches the TV reads as away too, and a turn skipped the moment it arrived
 * would cost that kid their go; the table can see who is missing and decide.
 * The hero stays on the board, in the turn order, and acts again the moment
 * their phone is back. Nothing here reads anything but `connected`, so a
 * table with everybody present plays exactly as before.
 */
export function combatTurnAway(state: Pick<RunState, "encounter" | "party">): boolean {
  const encounter = state.encounter;
  if (!encounter) return false;
  const actor = currentActor(encounter);
  if (!actor || actor.side !== "party") return false;
  const member = state.party.find((m) => m.character.id === actor.id);
  return member !== undefined && !member.connected;
}

/**
 * A full bag's "keep it or leave it" whose owner has since stepped away
 * (#258). Open to anyone, but only to leave it (`doResolveItemSwap`).
 */
export function swapOwnerAway(
  party: readonly PartyMember[],
  prompt: Prompt & { kind: "item_swap" },
): boolean {
  const member = party.find((m) => m.character.id === prompt.characterId);
  return !member || !member.connected;
}

/**
 * A Choice point's vote whose every outstanding voter has stepped away
 * (#258), with at least one vote cast. `doChoose` already does not wait on
 * them, but it only counts when a vote lands, so a voter who already chose
 * re-sends their pick to close it. The phones offer that tap.
 */
export function voteWaitsOnlyOnAway(
  party: readonly PartyMember[],
  prompt: Prompt & { kind: "choice" },
): boolean {
  if (!prompt.vote) return false;
  const votes = prompt.votes ?? {};
  if (Object.keys(votes).length === 0) return false;
  const voters = prompt.forPlayerIds.length > 0 ? prompt.forPlayerIds : party.map((m) => m.playerId);
  const outstanding = voters.filter((id) => votes[id] === undefined);
  return (
    outstanding.length > 0 &&
    outstanding.every((id) => !(party.find((m) => m.playerId === id)?.connected ?? false))
  );
}

/**
 * The ready-gate's rule (spec §8.1's ready-up, the pre-fight pause and the
 * chapter start): everybody still at the table is ready, and at least one of
 * them is here to have said so. A player who stepped away is not waited on
 * (#258); a room whose phones have all dropped stays where it is.
 */
export function readyWithoutAway(party: readonly PartyMember[]): boolean {
  return party.some((m) => m.ready && m.connected) && party.every((m) => m.ready || !m.connected);
}
