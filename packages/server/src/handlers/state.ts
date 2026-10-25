/**
 * `GET /state?runId&sinceSeq=N` — reconnect, architecture §4.3.
 *
 * Every client tracks the last seq it applied. On reconnect it asks for what it
 * missed and gets one of two answers:
 *
 *   • the missed events, when the gap is small and the log actually covers it
 *   • a full snapshot, when it isn't or doesn't
 *
 * The snapshot is always correct, so the replay path is purely an optimisation
 * — which is why every ambiguous case below falls through to the snapshot. The
 * requirement is "hard-refresh the TV mid-encounter and recover in under a
 * second", and a snapshot of one `RunState` item does that comfortably.
 */

import type { StateResponse } from "@kad/shared";
import { fail, ok, type HandlerDeps, type HandlerResult } from "./deps.ts";
import { closedIfIdle } from "./host.ts";
import { isOut } from "./remove.ts";

/**
 * Above this many missed events, one snapshot is cheaper than the patches —
 * both on the wire and in reads. A 30-minute chapter produces a few hundred
 * events, so this is "you were gone for a moment" vs. "you were gone".
 */
export const MAX_REPLAY_EVENTS = 50;

export interface GetStateInput {
  runId: string;
  /** Omit (or send a negative) to force a snapshot — a cold client's default. */
  sinceSeq?: number | undefined;
  /**
   * The player reading, when the reader is a seated phone rather than the
   * host's screen. A player the host took out (`RunState.removed`, #267) is
   * refused: their session token stays well-formed until the room ends.
   */
  playerId?: string | undefined;
  /** That player's household, from their session. Absent, the run's is used. */
  householdId?: string | undefined;
}

export async function getState(
  input: GetStateInput,
  deps: HandlerDeps,
): Promise<HandlerResult<StateResponse>> {
  const stored = await deps.repo.getState(input.runId);
  if (!stored) return fail("NOT_FOUND", `no run ${input.runId}`);
  // An open room idle too long is closed now (#249), and the reader is told.
  const state = await closedIfIdle(stored, deps);
  // Taken out by the host (#267), or retired by an organizer (#248).
  if (input.playerId !== undefined && (await isOut(state, input.playerId, input.householdId ?? null, deps.repo))) {
    return fail("FORBIDDEN", "This phone was taken out of the game.");
  }

  const sinceSeq = input.sinceSeq;
  const snapshot = (): HandlerResult<StateResponse> =>
    ok({ seq: state.seq, state });

  if (sinceSeq === undefined || !Number.isFinite(sinceSeq) || sinceSeq < 0) return snapshot();
  // A client claiming to be ahead of the server is a client with a mirror we
  // cannot reason about (a stale tab, a replayed patch). Reset it.
  if (sinceSeq > state.seq) return snapshot();
  if (sinceSeq === state.seq) return ok({ seq: state.seq, events: [] });

  const gap = state.seq - sinceSeq;
  if (gap > MAX_REPLAY_EVENTS) return snapshot();

  const events = await deps.repo.listEvents(input.runId, sinceSeq, MAX_REPLAY_EVENTS);
  // The log must cover the gap exactly: patches only apply in an unbroken
  // chain, so a single missing seq makes the whole replay unusable.
  const contiguous =
    events.length === gap && events.every((e, i) => e.seq === sinceSeq + i + 1);
  if (!contiguous) return snapshot();

  // A replay is the protocol's messages and nothing more. The log row also
  // holds who acted, when, and the intent as it was sent, which no client
  // reads and which would otherwise ride every reconnect to every screen.
  return ok({
    seq: state.seq,
    events: events.map(({ runId, seq, patch, presentation, progression }) => ({
      runId,
      seq,
      patch,
      ...(presentation ? { presentation } : {}),
      ...(progression ? { progression } : {}),
    })),
  });
}
