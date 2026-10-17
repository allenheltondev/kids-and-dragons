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
 * and can be taken out again. Locking a room to new joins is #263's.
 */

import { settleChapterEndVote, type RunState } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { EventRecord } from "../store/repository.ts";
import { diff } from "../json-patch.ts";
import { fail, iso, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";

export interface RemovePlayerInput {
  code: string;
  /**
   * The device asking and who is holding it: a phone's own device token, or
   * a shared tablet's token plus its seated player's session (`tabletHost`).
   */
  principal: Pick<DeviceIdentity, "deviceId" | "playerId">;
  playerId: string;
}

/** Lost seq races retried before giving up, as presence does. */
const COMMIT_ATTEMPTS = 3;

export async function removePlayer(
  input: RemovePlayerInput,
  deps: HandlerDeps,
): Promise<HandlerResult<{ seq: number }>> {
  const room = await deps.repo.getRoom(input.code);
  if (!room) return fail("NOT_FOUND", `no open room ${input.code.toUpperCase()}`);
  if (!room.hostDeviceId || room.hostDeviceId !== input.principal.deviceId) {
    return fail("FORBIDDEN", "only the screen or phone that opened this room can take someone out");
  }
  if (input.playerId === input.principal.playerId) {
    return fail("ILLEGAL", "the host cannot take themselves out");
  }
  // Somebody who joined this room has a profile in its household, whether or
  // not they made a character. An id that names nobody is refused rather than
  // written down, so `removed` only ever lists real players.
  const player = await deps.repo.getPlayer(room.householdId, input.playerId);
  if (!player) return fail("NOT_FOUND", `no player ${input.playerId} in this room`);

  for (let attempt = 1; ; attempt++) {
    const state = await deps.repo.getState(room.runId);
    if (!state) return fail("NOT_FOUND", `run ${room.runId} has no state`);
    if (state.removed?.includes(input.playerId)) {
      await unfound(room.householdId, input.playerId, deps);
      return ok({ seq: state.seq });
    }

    const nowMs = deps.now();
    // Out of any vote at the chapter's end too: if they were the last one still
    // reading, the table goes on now, as it does when a phone drops.
    const next: RunState = settleChapterEndVote({
      ...state,
      seq: state.seq + 1,
      updatedAt: iso(nowMs),
      removed: [...(state.removed ?? []), input.playerId],
      party: state.party.map((m) =>
        m.playerId === input.playerId ? { ...m, connected: false, ready: false } : m,
      ),
    });
    const event: EventRecord = {
      seq: next.seq,
      runId: next.runId,
      patch: diff(state, next),
      at: iso(nowMs),
      playerId: input.principal.playerId,
    };

    if (await deps.repo.commit({ runId: next.runId, expectedSeq: state.seq, state: next, event })) {
      await unfound(room.householdId, input.playerId, deps);
      await deps.channel.publish(next.roomCode, {
        kind: "patch",
        seq: event.seq,
        runId: event.runId,
        patch: event.patch,
      });
      return ok({ seq: next.seq });
    }
    if (attempt >= COMMIT_ATTEMPTS) {
      return fail("STALE_SEQ", "the game moved on while taking them out; try again");
    }
  }
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

/** On `RunState.removed`: taken out of this room, and kept out. */
export function isRemoved(state: Pick<RunState, "removed">, playerId: string): boolean {
  return state.removed?.includes(playerId) ?? false;
}
