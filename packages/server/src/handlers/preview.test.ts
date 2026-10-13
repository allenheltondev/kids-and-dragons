import { describe, expect, it } from "vitest";
import type { ChannelMessage } from "@kad/shared";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { createRoom, joinRoom } from "./room.ts";
import { relayPreview } from "./preview.ts";

/** A room with one player seated in its party. */
async function seatedRoom() {
  const harness = makeHarness();
  const { householdId, players } = await seedHousehold(harness, 1);
  const created = await createRoom({ householdId, mode: "travel" }, harness.deps);
  if (!created.ok || !players[0]) throw new Error("setup failed");
  const principal = players[0].principal;
  await joinRoom({ code: created.value.code, principal }, harness.deps);
  // The stub engine seats nobody, so the seat is written straight in: the
  // relay reads the party and nothing else about the run.
  const state = await harness.repo.getState(created.value.runId);
  if (!state) throw new Error("no state");
  await harness.repo.putState({
    ...state,
    party: [{ playerId: principal.playerId, character: {} as never, hp: 10, down: false, connected: true, ready: true }],
  });
  return { harness, runId: created.value.runId, playerId: principal.playerId };
}

describe("relayPreview", () => {
  it("puts the preview on the room's channel without moving the seq", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    const before = await harness.repo.getState(runId);
    if (!before) throw new Error("no state");

    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(before.roomCode, (m) => received.push(m));
    const result = await relayPreview(
      { runId, playerId, preview: { kind: "choice", choiceId: "east" } },
      harness.deps,
    );
    stop();

    expect(result).toEqual({ ok: true });
    expect(received).toEqual([
      { kind: "preview", seq: before.seq, runId, playerId, preview: { kind: "choice", choiceId: "east" } },
    ]);
    // The whole point: a tap that is not confirmed must not make the next
    // player's real move stale.
    expect((await harness.repo.getState(runId))?.seq).toBe(before.seq);
  });

  it("relays backing out", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    expect(await relayPreview({ runId, playerId, preview: null }, harness.deps)).toEqual({ ok: true });
  });

  it("refuses a player who is not seated", async () => {
    const { harness, runId } = await seatedRoom();
    const result = await relayPreview({ runId, playerId: "p_nobody", preview: null }, harness.deps);
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("refuses a malformed preview", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    const result = await relayPreview({ runId, playerId, preview: { kind: "roll" } }, harness.deps);
    expect(result).toMatchObject({ ok: false, code: "ILLEGAL" });
  });
});
