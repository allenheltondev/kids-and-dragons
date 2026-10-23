/**
 * "Just watch" (#388): a kid with no hero chooses, on their own phone, to be
 * a spectator at a table that still has a seat for them, or changes their mind
 * and goes back to making a hero.
 *
 * Only ever about the phone that asks: the player comes from its room session
 * token, never the body, so nobody else (the host included) can set a kid to
 * watching. The choice is a flag on their roster seat (`RoomSeat.watching`),
 * committed like any room change so every screen hears it and a refresh keeps
 * it. A kid who chooses to watch has just tapped, so they are here: they go
 * on `RunState.watching` in the same patch, and presence keeps them there
 * from then on, as it does any spectator.
 *
 * A kid who already has a hero cannot choose to watch: their hero is in the
 * party, and votes and turns count it. Going back is always allowed.
 */

import type { RunState } from "@kad/shared";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { commitRoomChange } from "./host.ts";
import { isOut } from "./remove.ts";

export interface WatchInput {
  /** From the room session token, never the body. */
  runId: string;
  roomCode: string;
  playerId: string;
  /** The player's household, from the same token. */
  householdId: string;
  watching: unknown;
}

export async function chooseWatching(
  input: WatchInput,
  deps: Pick<HandlerDeps, "repo" | "now" | "channel">,
): Promise<HandlerResult<{ seq: number }>> {
  if (typeof input.watching !== "boolean") return fail("ILLEGAL", "expected { watching: boolean }");
  const watching = input.watching;
  const room = await deps.repo.getRoom(input.roomCode);
  if (!room || room.runId !== input.runId) return fail("NOT_FOUND", `no open room ${input.roomCode.toUpperCase()}`);
  const before = await deps.repo.getState(input.runId);
  if (before && (await isOut(before, input.playerId, input.householdId, deps.repo))) {
    return fail("FORBIDDEN", "not seated at this table");
  }

  let refusal: ReturnType<typeof fail> | null = null;
  const result = await commitRoomChange(
    room,
    input.playerId,
    (state: RunState) => {
      refusal = null;
      const seat = state.seats?.[input.playerId];
      if (!seat) {
        refusal = fail("FORBIDDEN", "not seated at this table");
        return null;
      }
      if (watching && state.party.some((member) => member.playerId === input.playerId)) {
        refusal = fail("ILLEGAL", "your hero is already playing");
        return null;
      }
      if ((seat.watching === true) === watching) return null;
      const { watching: _was, ...rest } = seat;
      const seats = { ...state.seats, [input.playerId]: watching ? { ...rest, watching: true as const } : rest };
      const listed = (state.watching ?? []).filter((id) => id !== input.playerId);
      const { watching: _list, ...without } = state;
      const here = watching ? [...listed, input.playerId] : listed;
      return { ...without, seats, ...(here.length > 0 ? { watching: here } : {}) };
    },
    deps,
  );
  if (refusal) return refusal;
  if (!result.ok) return result;
  return ok({ seq: result.value.seq });
}
