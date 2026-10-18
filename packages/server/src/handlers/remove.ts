/**
 * Taking a player out of a room — issue #267.
 *
 * A room code is read aloud across a living room, typed by a child, printed on
 * a TV. Somebody who should not be in the game will sometimes have it. The
 * room shows who arrives (`ArrivalMessage`), and this is what the host does
 * about one: one tap, and that player is out.
 *
 * Only the device that opened the room may do it (`RoomRecord.hostDeviceId`):
 * the TV in Party Mode, the host's phone in Travel Mode. That is the host
 * authority #265 settles on for room-level controls, which are low-stakes and
 * recoverable.
 *
 * "Out" is `connected: false` plus a place on `RunState.removed`, not a hole in
 * `party`. Every turn, vote, roll and ready-gate already reads a disconnected
 * member as away (`storyTurnHolder`, `turnHolderAway`, `rollerAway`, the ready
 * gate), so a player taken out mid-fight leaves nothing waiting on them.
 * Deleting the member instead would leave an encounter's turn order pointing
 * at nobody. `removed` is what keeps them away: `joinRoom`, `applyAction`,
 * `relayPreview`, presence and the channel authorizer all refuse a player on it.
 *
 * A removed phone that founded the household (a TV's, whose founder is the
 * first phone to join) stops being its founder, and nobody takes its place:
 * the household can no longer be kept by signing in (#265). A stranger who
 * beat the family to the code must not leave with the family's heroes.
 *
 * What it cannot do: a phone that clears its storage is a new phone, with a
 * new player, and can join again with the code. It shows up as a new arrival,
 * and can be taken out again, and a host who has seen enough locks the room
 * (`lockRoom`, #263).
 */

import { settleChapterEndVote, type RunState } from "@kad/shared";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { commitRoomChange, hostedRoom, type HostPrincipal } from "./host.ts";

export interface RemovePlayerInput {
  code: string;
  principal: HostPrincipal;
  playerId: string;
}

export async function removePlayer(
  input: RemovePlayerInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ seq: number }>> {
  const hosted = await hostedRoom(input.code, input.principal, deps);
  if (!hosted.ok) return hosted;
  const room = hosted.value;
  if (input.playerId === input.principal.playerId) {
    return fail("ILLEGAL", "the host cannot take themselves out");
  }
  // Somebody who joined this room has a profile in its household, whether or
  // not they made a character. An id that names nobody is refused rather than
  // written down, so `removed` only ever lists real players.
  const player = await deps.repo.getPlayer(room.householdId, input.playerId);
  if (!player) return fail("NOT_FOUND", `no player ${input.playerId} in this room`);

  const result = await commitRoomChange(
    room,
    input.principal.playerId,
    (state): RunState | null => {
      if (state.removed?.includes(input.playerId)) return null;
      // Out of any vote at the chapter's end too: if they were the last one
      // still reading, the table goes on now, as it does when a phone drops.
      return settleChapterEndVote({
        ...state,
        removed: [...(state.removed ?? []), input.playerId],
        party: state.party.map((m) =>
          m.playerId === input.playerId ? { ...m, connected: false, ready: false } : m,
        ),
      });
    },
    deps,
  );
  if (!result.ok) {
    // Kept from before the shared loop, so a phone that showed this keeps reading it.
    return result.error.code === "STALE_SEQ"
      ? fail("STALE_SEQ", "the game moved on while taking them out; try again")
      : result;
  }
  // Also on a repeat that finds them already out, so a failure here is mended
  // by tapping Remove again.
  await unfound(room.householdId, input.playerId, deps);
  return ok({ seq: result.value.seq });
}

/**
 * If the household's founder is a device of the player just taken out, it is
 * not the founder any more. Run on every removal, including a repeat that
 * finds them already out, so a failure here is mended by tapping Remove again.
 */
async function unfound(householdId: string, playerId: string, deps: HandlerDeps): Promise<void> {
  const household = await deps.repo.getHousehold(householdId);
  if (!household?.founderDeviceId) return; // none, or already dropped
  const device = await deps.repo.getDevice(householdId, household.founderDeviceId);
  // A shared tablet is nobody, so taking a kid out never unfounds it (#250).
  if (device && device.kind !== "shared" && device.playerId === playerId) await deps.repo.dropFounder(householdId, household.founderDeviceId);
}

/**
 * Take a player out of every room their household has open, as `removePlayer`
 * does for one: on `removed`, away, out of any vote (#248, a retired profile).
 * Nobody's host control, so there is no host to check; the caller has already
 * proved a signed-in owner. A room they never sat in, a closed run, and a
 * room already showing them out are left alone. Stops at the first room it
 * could not write, so the caller can say so and be asked again.
 */
export async function takeOutEverywhere(
  householdId: string,
  playerId: string,
  deps: Pick<HandlerDeps, "repo" | "now" | "channel">,
): Promise<HandlerResult<{ rooms: number }>> {
  let rooms = 0;
  for (const run of await deps.repo.listRuns(householdId)) {
    if (run.status !== "active") continue;
    // Codes recycle: only the room that still points at this run is this run's.
    const room = await deps.repo.getRoom(run.roomCode);
    if (!room || room.runId !== run.id) continue;
    const result = await commitRoomChange(
      room,
      playerId,
      (state): RunState | null => {
        const seated = state.party.some((m) => m.playerId === playerId) || state.seats?.[playerId] !== undefined;
        if (!seated || isRemoved(state, playerId)) return null;
        return settleChapterEndVote({
          ...state,
          removed: [...(state.removed ?? []), playerId],
          party: state.party.map((m) => (m.playerId === playerId ? { ...m, connected: false, ready: false } : m)),
        });
      },
      deps,
    );
    if (!result.ok) {
      if (result.error.code === "NOT_FOUND") continue; // closed, or gone
      return fail(result.error.code, "Couldn't take them out of a game in progress. Try again.");
    }
    if (result.value.changed) rooms++;
  }
  return ok({ rooms });
}

/** On `RunState.removed`: taken out of this room, and kept out. */
export function isRemoved(state: Pick<RunState, "removed">, playerId: string): boolean {
  return state.removed?.includes(playerId) ?? false;
}

/**
 * Retired by an organizer (#248), read from the profile itself. Checked beside
 * `isRemoved` everywhere a room accepts a player, because `takeOutEverywhere`
 * runs after the profile is retired and can fail: the profile is the record,
 * and the run's `removed` list only the tidy-up. A profile that cannot be
 * found is not retired (the caller's own checks decide what a missing player
 * means).
 */
export async function isRetired(
  repo: Pick<HandlerDeps["repo"], "getPlayer">,
  householdId: string,
  playerId: string,
): Promise<boolean> {
  return (await repo.getPlayer(householdId, playerId))?.retired === true;
}

/**
 * Out of this run, either way: taken out by its host, or retired. The
 * household is the player's own, from their session; without one it is the
 * run's, which is the same household for anybody seated in it.
 */
export async function isOut(
  state: Pick<RunState, "removed" | "runId">,
  playerId: string,
  householdId: string | null,
  repo: Pick<HandlerDeps["repo"], "getPlayer" | "getRun">,
): Promise<boolean> {
  if (isRemoved(state, playerId)) return true;
  const household = householdId ?? (await repo.getRun(state.runId))?.householdId;
  return household !== undefined && (await isRetired(repo, household, playerId));
}
