/**
 * A kid tapping one of the camp's friends on her phone (docs/camp.md §4.4,
 * §8.5; #624): the friend says something on the TV and walks over to her
 * hero.
 *
 * Relayed like a spectator's cheer (cheer.ts, #388), and for the same
 * reasons: not an action, so nothing is validated against the rules,
 * nothing is committed or saved, and the seq does not move (a tap that
 * bumped it would turn a friend's hop into somebody's STALE_SEQ). It is
 * checked for shape and seat and put straight on the room's channel; a
 * dropped one costs a friend's hop, never a turn.
 *
 * Only a seated hero's kid may tap, only a friend who is out now
 * (`CampMoment.friends.out`), and only in downtime, when the camp is up.
 * What the friend says is one of its catalog reactions, picked here so the
 * words are the content's, never the phone's.
 *
 * Counted per phone in fixed windows on the same conditional-write counter a
 * cheer uses (`reserveCodeLookup`), since a server answering from more than
 * one Lambda has no memory of its own to count in. The TV queues and drops
 * what still gets through (client camp-taps.ts), so a hammered button is a
 * happy friend, never a jittering one.
 */

import { FRIEND_TAP_LIMIT, FRIEND_TAP_WINDOW_MS } from "@kad/shared";
import type { HandlerDeps } from "./deps.ts";
import { isOut } from "./remove.ts";

export type FriendTapDeps = Pick<HandlerDeps, "repo" | "channel" | "now" | "content">;

export interface FriendTapInput {
  /** From the room session token, never the body. */
  runId: string;
  playerId: string;
  /** The player's household, from the same token. Absent, the run's is used. */
  householdId?: string;
  friendId: unknown;
}

export type FriendTapResult =
  | { ok: true }
  | {
      ok: false;
      status: 400 | 403 | 404 | 429;
      code: "ILLEGAL" | "FORBIDDEN" | "NOT_FOUND" | "SLOW_DOWN";
      message: string;
    };

export async function relayFriendTap(input: FriendTapInput, deps: FriendTapDeps): Promise<FriendTapResult> {
  const friendId = input.friendId;
  if (typeof friendId !== "string" || friendId.length === 0 || friendId.length > 64) {
    return { ok: false, status: 400, code: "ILLEGAL", message: "that is not a friend" };
  }
  const state = await deps.repo.getState(input.runId);
  if (!state) return { ok: false, status: 404, code: "NOT_FOUND", message: `no run ${input.runId}` };
  const removed = new Set(state.removed ?? []);
  const hero = state.party.find((m) => m.playerId === input.playerId && !removed.has(m.playerId));
  if (!hero || state.closed || (await isOut(state, input.playerId, input.householdId ?? null, deps.repo))) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "only a kid with a hero at the table can call a friend over" };
  }
  if (!state.campMoment?.friends?.out.includes(friendId)) {
    return { ok: false, status: 400, code: "ILLEGAL", message: "that friend is not out in camp right now" };
  }
  const friend = deps.content.campCatalog()?.friends.find((f) => f.id === friendId);
  if (!friend || friend.reactions.length === 0) return { ok: false, status: 400, code: "ILLEGAL", message: "that is not a friend" };

  const window = Math.floor(deps.now() / FRIEND_TAP_WINDOW_MS);
  // The row outlives its window by one more, as a cheer's does.
  const ttl = Math.floor(((window + 2) * FRIEND_TAP_WINDOW_MS) / 1000);
  const admitted = await deps.repo.reserveCodeLookup(`friendtap#${input.runId}#${input.playerId}`, window, FRIEND_TAP_LIMIT, ttl);
  if (!admitted) return { ok: false, status: 429, code: "SLOW_DOWN", message: `${friend.name} is on the way. Wait a moment!` };

  // A different line each second, so taps a moment apart rarely say the same thing.
  const words = friend.reactions[Math.floor(deps.now() / 1000) % friend.reactions.length]!;
  await deps.channel.publish(state.roomCode, {
    kind: "friendTap",
    seq: state.seq,
    runId: state.runId,
    friendId,
    heroId: hero.character.id,
    words,
  });
  return { ok: true };
}
