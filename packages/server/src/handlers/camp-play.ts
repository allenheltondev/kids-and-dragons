import { campMomentKind, readCampPlay } from "@kad/shared";
import type { FriendTapDeps, FriendTapResult } from "./friend-tap.ts";
import { isOut } from "./remove.ts";

/** Seat-checked, bounded live play. Does not commit or advance the run sequence. */
export async function relayCampPlay(input: { runId: string; playerId: string; householdId?: string; play: unknown }, deps: FriendTapDeps): Promise<FriendTapResult> {
  const play = readCampPlay(input.play);
  if (!play) return { ok: false, status: 400, code: "ILLEGAL", message: "Choose a camp activity." };
  const state = await deps.repo.getState(input.runId);
  if (!state) return { ok: false, status: 404, code: "NOT_FOUND", message: "That camp has closed." };
  const hero = state.party.find(m => m.playerId === input.playerId && !state.removed?.includes(m.playerId));
  if (!hero || state.closed || await isOut(state, input.playerId, input.householdId ?? null, deps.repo)) return { ok: false, status: 403, code: "FORBIDDEN", message: "Join the crew to play at camp." };
  if (campMomentKind(state) === null || !state.campMoment) return { ok: false, status: 400, code: "ILLEGAL", message: "Camp play waits until the next rest." };
  if (play.activity === "fetch" && (!state.campMoment.outdoor || !state.campMoment.friends?.out.includes(play.friendId))) return { ok: false, status: 400, code: "ILLEGAL", message: "Choose a friend who is outside at camp." };
  const duration = play.activity === "fetch" ? 5000 : 1000;
  const window = Math.floor(deps.now() / duration);
  const admitted = await deps.repo.reserveCodeLookup(`campplay#${play.activity}#${input.runId}#${input.playerId}`, window, play.activity === "fetch" ? 1 : 6, Math.floor((window + 2) * duration / 1000));
  if (!admitted) return { ok: false, status: 429, code: "SLOW_DOWN", message: "Give that a moment, then try again." };
  await deps.channel.publish(state.roomCode, { kind: "campPlay", seq: state.seq, runId: state.runId, momentId: state.campMoment.id, heroId: hero.character.id, play });
  return { ok: true };
}
