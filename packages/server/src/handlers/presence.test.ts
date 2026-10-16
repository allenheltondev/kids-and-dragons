import { describe, expect, it } from "vitest";
import type { PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { createRoom, joinRoom } from "./room.ts";
import { setPresence } from "./presence.ts";
import { applyAction } from "./action.ts";

/** A room with one seated player, which is what presence is about. */
async function seatedRoom() {
  const harness = makeHarness();
  const { householdId, players } = await seedHousehold(harness, 1);
  const created = await createRoom({ householdId, mode: "travel" }, harness.deps);
  if (!created.ok || !players[0]) throw new Error("setup failed");
  const principal = players[0].principal;
  await joinRoom({ code: created.value.code, principal }, harness.deps);

  // The test engine seats a member for any intent it does not understand, so
  // drive one accepted action to get a party to talk about.
  await applyAction(
    {
      runId: created.value.runId,
      playerId: principal.playerId,
      seq: 0,
      intent: { type: "CHOOSE", choiceId: "seat" },
    },
    harness.deps,
  );

  return { harness, runId: created.value.runId, playerId: principal.playerId };
}

describe("setPresence", () => {
  it("does nothing for a player who is not in the party", async () => {
    const { harness, runId } = await seatedRoom();
    const before = await harness.repo.getState(runId);

    expect(await setPresence({ runId, playerId: "p_nobody", connected: false }, harness.deps)).toBeNull();
    expect((await harness.repo.getState(runId))?.seq).toBe(before?.seq);
  });

  it("does nothing when the flag already says what the stream is saying", async () => {
    const { harness, runId } = await seatedRoom();
    const state = await harness.repo.getState(runId);
    const seated = state?.party[0];
    if (!seated) return;

    // Members are seated connected, so "connected: true" is a no-op. Burning a
    // seq on every reconnect would churn every mirror in the room for nothing.
    expect(
      await setPresence({ runId, playerId: seated.playerId, connected: true }, harness.deps),
    ).toBeNull();
  });

  it("publishes a patch when a stream drops, so ready-gates stop waiting", async () => {
    const { harness, runId } = await seatedRoom();
    const state = await harness.repo.getState(runId);
    const seated = state?.party[0];
    if (!seated || !state) return;

    const received: unknown[] = [];
    const stop = harness.channel.subscribe(state.roomCode, (m) => received.push(m));

    const seq = await setPresence(
      { runId, playerId: seated.playerId, connected: false },
      harness.deps,
    );
    stop();

    expect(seq).toBe(state.seq + 1);
    const after = await harness.repo.getState(runId);
    expect(after?.party[0]?.connected).toBe(false);
    // Every other client has to hear about it, or their engine keeps waiting
    // on a phone that is face-down in a car footwell.
    expect(received).toHaveLength(1);
  });

  it("carries the chapter-end vote when the last phone still reading drops off", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    // Two at the table on the chapter's summary: this phone has said it's
    // done, the other is still reading.
    await onTheSummary(harness, runId, [seat(playerId, true), seat("p_reader", false)]);

    await setPresence({ runId, playerId: "p_reader", connected: false }, harness.deps);

    const after = await harness.repo.getState(runId);
    expect(after?.phase).toBe("lobby");
    expect(after?.chapterId).toBeNull();
    expect(after?.party.every((m) => !m.ready)).toBe(true);
    expect(after?.party.find((m) => m.playerId === "p_reader")?.connected).toBe(false);
  });

  it("leaves the summary up when the phone that drops is the only one done", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    await onTheSummary(harness, runId, [seat(playerId, true), seat("p_reader", false)]);

    // The reader is still here, so the one who was done going away settles
    // nothing: nobody left at the table has voted.
    await setPresence({ runId, playerId, connected: false }, harness.deps);
    expect((await harness.repo.getState(runId))?.phase).toBe("chapter_complete");
  });
});

/** A party member as presence reads them: who, whether here, whether done. */
function seat(playerId: string, ready: boolean): PartyMember {
  return {
    character: { id: `c_${playerId}`, name: playerId } as unknown as ResolvedCharacter,
    playerId,
    hp: 10,
    down: false,
    connected: true,
    ready,
  };
}

/** Put the run on a chapter's end summary with this party, committed. */
async function onTheSummary(harness: TestHarness, runId: string, party: PartyMember[]): Promise<void> {
  const state = await harness.repo.getState(runId);
  if (!state) throw new Error("setup failed");
  const ended: RunState = { ...state, seq: state.seq + 1, phase: "chapter_complete", chapterId: "ch_1", party };
  const committed = await harness.repo.commit({
    runId,
    expectedSeq: state.seq,
    state: ended,
    event: { seq: ended.seq, runId, patch: [], at: ended.updatedAt, playerId: party[0]!.playerId },
  });
  if (!committed) throw new Error("setup failed");
}
