/**
 * Relaying what a player has tapped but not confirmed (`IntentPreview`).
 *
 * Not an action and deliberately not `applyAction`: nothing is validated
 * against the rules, nothing is committed, and the seq does not move. A
 * preview that bumped the seq would turn every exploratory tap into a
 * STALE_SEQ for whoever confirms a real move next — at a table of three that
 * is a rejected tap every few seconds. So it is read once, checked for shape
 * and seat, and put straight on the room's channel. A dropped one costs a
 * highlight, never a turn.
 */

import { readIntentPreview } from "@kad/shared";
import type { HandlerDeps } from "./deps.ts";

export type PreviewDeps = Pick<HandlerDeps, "repo" | "channel">;

export interface PreviewInput {
  /** From the room session token, never the body. */
  runId: string;
  playerId: string;
  preview: unknown;
}

export type PreviewResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; code: "ILLEGAL" | "FORBIDDEN" | "NOT_FOUND"; message: string };

export async function relayPreview(input: PreviewInput, deps: PreviewDeps): Promise<PreviewResult> {
  const preview = readIntentPreview(input.preview);
  if (preview === undefined) {
    return { ok: false, status: 400, code: "ILLEGAL", message: "that is not a preview" };
  }

  const state = await deps.repo.getState(input.runId);
  if (!state) return { ok: false, status: 404, code: "NOT_FOUND", message: `no run ${input.runId}` };
  // Only a seat at this table has a phone to tap on.
  if (!state.party.some((member) => member.playerId === input.playerId)) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "not seated at this table" };
  }

  await deps.channel.publish(state.roomCode, {
    kind: "preview",
    seq: state.seq,
    runId: state.runId,
    playerId: input.playerId,
    preview,
  });
  return { ok: true };
}
