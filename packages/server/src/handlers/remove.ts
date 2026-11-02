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
 * member as away (`storyTurnHolder`, `turnHolderAway`, `rollerAway`,
 * `combatTurnAway`, the ready gate; #258), so a player taken out mid-fight
 * leaves nothing waiting on them.
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
import { rethinkNewcomers } from "./crew.ts";
import { commitRoomChange, hostedRoom, type HostPrincipal } from "./host.ts";
import { relockLobby } from "./progression.ts";

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
  // not they made a character, and a visitor one in their own (#249), which
  // the roster names. An id that names nobody is refused rather than written
  // down, so `removed` only ever lists real players.
  const visitorHome = (await deps.repo.getState(room.runId))?.seats?.[input.playerId]?.homeHouseholdId;
  const player = await deps.repo.getPlayer(visitorHome ?? room.householdId, input.playerId);
  if (!player) return fail("NOT_FOUND", `no player ${input.playerId} in this room`);

  const result = await commitRoomChange(
    room,
    input.principal.playerId,
    async (state): Promise<RunState | null> => {
      if (state.removed?.includes(input.playerId)) return null;
      // Out of any vote at the chapter's end too: if they were the last one
      // still reading, the table goes on now, as it does when a phone drops.
      return relockOut(
        state,
        settleChapterEndVote({
          ...unkept(state, input.playerId),
          removed: [...(state.removed ?? []), input.playerId],
          party: state.party.map((m) =>
            m.playerId === input.playerId ? { ...m, connected: false, ready: false } : m,
          ),
        }),
        room.householdId,
        deps,
      );
    },
    deps,
    // A visitor never founded this household. The phone that did stops being
    // its founder in this same commit (#272), so the room and the household
    // cannot disagree about who keeps the game, whatever interleaves.
    visitorHome === undefined
      ? { unfound: () => foundingDevice(room.householdId, input.playerId, deps) }
      : {},
  );
  if (!result.ok) {
    // Kept from before the shared loop, so a phone that showed this keeps reading it.
    return result.error.code === "STALE_SEQ"
      ? fail("STALE_SEQ", "the game moved on while taking them out; try again")
      : result;
  }
  // Also on a repeat that finds them already out, so a failure here is mended
  // by tapping Remove again. A visitor never founded this household.
  if (visitorHome === undefined) await unfound(room.householdId, input.playerId, deps);
  return ok({ seq: result.value.seq });
}

/** The household's founding device, when it is one of `playerId`'s own phones. */
async function foundingDevice(
  householdId: string,
  playerId: string,
  deps: Pick<HandlerDeps, "repo">,
): Promise<{ householdId: string; deviceId: string } | undefined> {
  const household = await deps.repo.getHousehold(householdId);
  if (!household?.founderDeviceId) return undefined; // none, or already dropped
  const device = await deps.repo.getDevice(householdId, household.founderDeviceId);
  // A shared tablet is nobody, so taking a kid out never unfounds it (#250).
  return device && device.kind !== "shared" && device.playerId === playerId
    ? { householdId, deviceId: household.founderDeviceId }
    : undefined;
}

/**
 * If the household's founder is a device of the player just taken out, it is
 * not the founder any more. Run on every removal, including a repeat that
 * finds them already out, so a failure here is mended by tapping Remove again.
 */
async function unfound(householdId: string, playerId: string, deps: HandlerDeps): Promise<void> {
  const founder = await foundingDevice(householdId, playerId, deps);
  if (founder) await deps.repo.dropFounder(founder.householdId, founder.deviceId);
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
  deps: Pick<HandlerDeps, "repo" | "now" | "channel" | "content">,
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
      async (state): Promise<RunState | null> => {
        const seated = state.party.some((m) => m.playerId === playerId) || state.seats?.[playerId] !== undefined;
        if (!seated || isRemoved(state, playerId)) return null;
        return relockOut(
          state,
          settleChapterEndVote({
            ...unkept(state, playerId),
            removed: [...(state.removed ?? []), playerId],
            party: state.party.map((m) => (m.playerId === playerId ? { ...m, connected: false, ready: false } : m)),
          }),
          room.householdId,
          deps,
        );
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

/**
 * A lobby whose hero was just taken out, with its locks read again (#283): if
 * she was the only one who had finished a prerequisite, the campaign it opened
 * locks for the table she left. Only in the lobby, where locks are shown; a
 * Begin re-reads the party anyway (`lockedRefusal`, without the removed).
 */
async function relockOut(
  before: RunState,
  state: RunState,
  householdId: string,
  deps: Pick<HandlerDeps, "repo" | "content">,
): Promise<RunState> {
  if (state.phase !== "lobby" && state.phase !== "creation") return state;
  // And whether the heroes left are new to the crew's adventure (crew.ts): the
  // one who was on it may be the one taken out, and a keep-going given for the
  // old lineup is not one for this.
  return rethinkNewcomers(before, await relockLobby(state, householdId, deps), householdId, deps);
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
 * Out of this run, any of three ways: taken out by its host, retired, or
 * moved to another home (#251). The household is the player's own, from their
 * session; without one it is a visitor's own from the roster (#249), else the
 * run's, which is the same household for everybody else seated in it.
 *
 * A profile that is no longer in that household is a kid who moved: her
 * profile went with her, and a session or seat minted before the move still
 * names the home she left. The profile is the record, as it is for
 * retiring, so this holds at every door whether or not the move's tidy-up
 * (`takeOutEverywhere`) reached the room, and at a table in a household she
 * never belonged to, which that tidy-up cannot find.
 */
export async function isOut(
  state: Pick<RunState, "removed" | "runId" | "seats">,
  playerId: string,
  householdId: string | null,
  repo: Pick<HandlerDeps["repo"], "getPlayer" | "getRun">,
): Promise<boolean> {
  if (isRemoved(state, playerId)) return true;
  const household =
    householdId ?? state.seats?.[playerId]?.homeHouseholdId ?? (await repo.getRun(state.runId))?.householdId;
  if (household === undefined) return false;
  const profile = await repo.getPlayer(household, playerId);
  return profile === null || profile.retired === true;
}

/**
 * The run without the keeper role a host handed `playerId` (#272): somebody
 * taken out is not advertised as the one who keeps the game. Their phone stops
 * being the founder in `unfound`, right after this commits.
 */
function unkept(state: RunState, playerId: string): RunState {
  if (state.keeperPlayerId !== playerId) return state;
  const { keeperPlayerId: _handed, ...rest } = state;
  return rest;
}
