import { describe, expect, it } from "vitest";
import type { ChannelMessage } from "@kad/shared";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { createRoom, joinRoom } from "./room.ts";
import { relayPreview } from "./preview.ts";
import { previewContext } from "@kad/shared";

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
    chapterId: "ch1",
    sceneId: "fork",
    visited: ["start", "fork"],
    prompt: {
      kind: "choice",
      sceneId: "fork",
      options: [{ id: "east", label: "Go east", icon: "arrow" }],
      forPlayerIds: [],
      vote: false,
    },
    party: [{ playerId: principal.playerId, character: {} as never, hp: 10, down: false, connected: true, ready: true }],
  });
  return { harness, runId: created.value.runId, playerId: principal.playerId };
}

/** The decision a phone looking at the room right now would stamp. */
async function contextNow(harness: ReturnType<typeof makeHarness>, runId: string): Promise<string> {
  const context = previewContext(await harness.repo.getState(runId));
  if (context === null) throw new Error("no decision on the table");
  return context;
}

describe("relayPreview", () => {
  it("puts the preview on the room's channel without moving the seq", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    const before = await harness.repo.getState(runId);
    if (!before) throw new Error("no state");

    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(before.roomCode, (m) => received.push(m));
    const context = await contextNow(harness, runId);
    const result = await relayPreview(
      { runId, playerId, preview: { kind: "choice", choiceId: "east" }, context },
      harness.deps,
    );
    stop();

    expect(result).toEqual({ ok: true });
    expect(received).toEqual([
      { kind: "preview", seq: before.seq, runId, playerId, preview: { kind: "choice", choiceId: "east" }, context },
    ]);
    // The whole point: a tap that is not confirmed must not make the next
    // player's real move stale.
    expect((await harness.repo.getState(runId))?.seq).toBe(before.seq);
  });

  it("relays backing out, whatever decision it names", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    expect(await relayPreview({ runId, playerId, preview: null, context: "anything" }, harness.deps)).toEqual({ ok: true });
  });

  it("drops a pick that arrives after its question has moved on", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    const madeFor = await contextNow(harness, runId);
    // The story moves on and comes back to the very same fork — same scene,
    // same option ids — before the late pick lands.
    const state = await harness.repo.getState(runId);
    await harness.repo.putState({ ...state!, visited: ["start", "fork", "brook", "fork"] });

    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(state!.roomCode, (m) => received.push(m));
    const result = await relayPreview(
      { runId, playerId, preview: { kind: "choice", choiceId: "east" }, context: madeFor },
      harness.deps,
    );
    stop();

    expect(result).toMatchObject({ ok: false, code: "STALE_SEQ" });
    expect(received).toEqual([]);
  });

  it("drops a pick that names no decision at all", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    const result = await relayPreview({ runId, playerId, preview: { kind: "end_turn" }, context: undefined }, harness.deps);
    expect(result).toMatchObject({ ok: false, code: "STALE_SEQ" });
  });

  it("refuses a player who is not seated", async () => {
    const { harness, runId } = await seatedRoom();
    const result = await relayPreview({ runId, playerId: "p_nobody", preview: null, context: null }, harness.deps);
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("refuses a malformed preview", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    const result = await relayPreview({ runId, playerId, preview: { kind: "roll" }, context: null }, harness.deps);
    expect(result).toMatchObject({ ok: false, code: "ILLEGAL" });
  });
});
