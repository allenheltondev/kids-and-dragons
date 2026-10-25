/**
 * A spectator's cheer (#388): a tap that floats a small picture up the corner
 * of the shared screen.
 *
 * Not an action, like a preview: nothing is validated against the rules,
 * nothing is committed, and the seq does not move. A cheer that bumped the
 * seq would turn a kid on the sofa into a STALE_SEQ for whoever taps a real
 * move next. So it is checked for shape and seat and put straight on the
 * room's channel. A dropped one costs a sparkle, never a turn.
 *
 * Only a spectator may cheer (`isSpectator`): the heroes have the game to
 * play, and a cheer from them would be noise on their own screen.
 *
 * Counted per phone in fixed windows, on the same conditional-write counter
 * the wrong-code budget uses (code-guard.ts), because a server that answers
 * from more than one Lambda has no memory of its own to count in.
 */

import { CHEER_LIMIT, CHEER_WINDOW_MS, cheerById, isSpectator } from "@kad/shared";
import type { HandlerDeps } from "./deps.ts";
import { isOut } from "./remove.ts";

export type CheerDeps = Pick<HandlerDeps, "repo" | "channel" | "now">;

export interface CheerInput {
  /** From the room session token, never the body. */
  runId: string;
  playerId: string;
  /** The player's household, from the same token. Absent, the run's is used. */
  householdId?: string;
  cheer: unknown;
}

export type CheerResult =
  | { ok: true }
  | {
      ok: false;
      status: 400 | 403 | 404 | 429;
      code: "ILLEGAL" | "FORBIDDEN" | "NOT_FOUND" | "SLOW_DOWN";
      message: string;
    };

export async function relayCheer(input: CheerInput, deps: CheerDeps): Promise<CheerResult> {
  const cheer = cheerById(input.cheer);
  if (!cheer) return { ok: false, status: 400, code: "ILLEGAL", message: "that is not a cheer" };

  const state = await deps.repo.getState(input.runId);
  if (!state) return { ok: false, status: 404, code: "NOT_FOUND", message: `no run ${input.runId}` };
  if (
    !isSpectator(state, input.playerId) ||
    state.closed ||
    (await isOut(state, input.playerId, input.householdId ?? null, deps.repo))
  ) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "only somebody watching can cheer" };
  }

  const window = Math.floor(deps.now() / CHEER_WINDOW_MS);
  // The row outlives its window by one more, as the wrong-code budget's does.
  const ttl = Math.floor(((window + 2) * CHEER_WINDOW_MS) / 1000);
  const admitted = await deps.repo.reserveCodeLookup(
    `cheer#${input.runId}#${input.playerId}`,
    window,
    CHEER_LIMIT,
    ttl,
  );
  if (!admitted) return { ok: false, status: 429, code: "SLOW_DOWN", message: "Wait a moment, then cheer again!" };

  await deps.channel.publish(state.roomCode, {
    kind: "cheer",
    seq: state.seq,
    runId: state.runId,
    cheer: cheer.id,
  });
  return { ok: true };
}
