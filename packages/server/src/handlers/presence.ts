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
 * to say — an unknown player, an already-correct flag, or a losing race that
 * still would not stick after retries.
 *
 * A lost seq race is retried rather than dropped. Presence changes *cause*
 * traffic — a phone dying mid-turn arrives together with the tap it
 * interrupted — so "best effort, the stream re-announces itself" was weakest at
 * exactly the moment it mattered: a disconnect that lost its race was never
 * recorded, and the ready-gate then waited forever on a phone that was gone.
 * The re-read makes the retry cheap; the cap keeps a hot room from looping.
 */
const COMMIT_ATTEMPTS = 3;

export async function setPresence(
  input: PresenceInput,
  deps: PresenceDeps,
): Promise<number | null> {
  for (let attempt = 1; ; attempt++) {
    const result = await trySetPresence(input, deps);
    if (result !== "lost-race") return result;
    if (attempt >= COMMIT_ATTEMPTS) return null;
  }
}

/** One optimistic attempt: read, diff, conditional commit. */
async function trySetPresence(
  input: PresenceInput,
  deps: PresenceDeps,
): Promise<number | null | "lost-race"> {
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
  if (!committed) return "lost-race";

  await deps.channel.publish(next.roomCode, {
    kind: "patch",
    seq: event.seq,
    runId: event.runId,
    patch: event.patch,
  });

  return nextSeq;
}
