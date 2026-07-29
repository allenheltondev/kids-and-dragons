import { describe, expect, it } from "vitest";
import { makeHarness, seedHousehold } from "../test-support.ts";
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
});
