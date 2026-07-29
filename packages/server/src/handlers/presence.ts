/**
 * Who is actually still at the table.
 *
 * Presence is a fact the *transport* observes, not a decision a player makes:
 * an SSE stream opening or closing is the only evidence there is. So it does
 * not go through `applyIntent` — there is no intent to send, and the phone that
 * would send it is the one that just vanished.
 *
 * It still has to be committed and broadcast like anything else, because the
 * engine reads it. A rest or an encounter waits for every member satisfying
 * `ready || !connected`; if a phone that walked out of Wi-Fi is remembered as
 * connected forever, the chapter stops until that exact device comes back —
 * which at a real table means "we can't carry on because Rosie's phone died".
 */

import type { RunState } from "@kad/shared";
import type { EventRecord } from "../store/repository.ts";
import { diff } from "../json-patch.ts";
import { iso, type HandlerDeps } from "./deps.ts";

/** Presence needs no engine and no dice — just the table and the channel. */
export type PresenceDeps = Pick<HandlerDeps, "repo" | "channel" | "now">;

export interface PresenceInput {
  runId: string;
  playerId: string;
  connected: boolean;
}

/**
 * Returns the new seq when something changed, or `null` when there was nothing
 * to say — an unknown player, an already-correct flag, or a race with another
 * write. Presence is best-effort by nature: a failed commit here is a stream
 * that will re-announce itself on the next connect.
 */
export async function setPresence(
  input: PresenceInput,
  deps: PresenceDeps,
): Promise<number | null> {
  const state = await deps.repo.getState(input.runId);
  if (!state) return null;

  const member = state.party.find((m) => m.playerId === input.playerId);
  if (!member || member.connected === input.connected) return null;

  const nowMs = deps.now();
  const nextSeq = state.seq + 1;
  const next: RunState = {
    ...state,
    seq: nextSeq,
    updatedAt: iso(nowMs),
    party: state.party.map((m) =>
      m.playerId === input.playerId ? { ...m, connected: input.connected } : m,
    ),
  };

  const event: EventRecord = {
    seq: nextSeq,
    runId: input.runId,
    patch: diff(state, next),
    at: iso(nowMs),
    playerId: input.playerId,
  };

  const committed = await deps.repo.commit({
    runId: input.runId,
    expectedSeq: state.seq,
    state: next,
    event,
  });
  if (!committed) return null;

  await deps.channel.publish(next.roomCode, {
    kind: "patch",
    seq: event.seq,
    runId: event.runId,
    patch: event.patch,
  });

  return nextSeq;
}
