/**
 * Whether a viewer token still shows anything.
 *
 * A viewer token names a room and a run and is valid until the room's original
 * expiry, six hours. Nothing about Close, Stop or a host's idle close reaches a
 * token already in a TV's hand, and Close frees the room's four letters, so
 * the token's own claims cannot say the game is over. Only the room can: it
 * still exists, it still maps to *this* run, and the run is not closed.
 *
 * Asked wherever a viewer token is honoured (the channel authorizer, and a
 * state read), so a follower screen added by a screen code (`screens.ts`)
 * stops the moment its game does, and an old token can never be pointed at the
 * family that later takes the same four letters.
 */

import type { GameRepository } from "../store/repository.ts";

export async function viewerStillShows(
  repo: Pick<GameRepository, "getRoom" | "getState">,
  runId: string,
  roomCode: string,
): Promise<boolean> {
  const room = await repo.getRoom(roomCode);
  if (!room || room.runId !== runId) return false;
  const state = await repo.getState(runId);
  return state !== null && state.closed !== true;
}
