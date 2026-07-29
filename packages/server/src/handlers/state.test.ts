import { describe, expect, it } from "vitest";
import type { RunState } from "@kad/shared";
import { applyOps } from "../json-patch.ts";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom } from "./room.ts";
import { getState, MAX_REPLAY_EVENTS } from "./state.ts";

/** A run advanced by `steps` accepted intents. */
async function runWithHistory(harness: TestHarness, steps: number) {
  const { householdId, players } = await seedHousehold(harness, 1);
  const created = await createRoom({ householdId, mode: "party" }, harness.deps);
  if (!created.ok || !players[0]) throw new Error("setup failed");
  const playerId = players[0].principal.playerId;

  const snapshots: RunState[] = [];
  for (let i = 0; i < steps; i++) {
    const before = await harness.repo.getState(created.value.runId);
    if (before) snapshots.push(before);
    await applyAction(
      { runId: created.value.runId, playerId, seq: i, intent: { type: "CHOOSE", choiceId: `c${i}` } },
      harness.deps,
    );
  }
  return { runId: created.value.runId, snapshots };
}

describe("getState — reconnect (architecture §4.3)", () => {
  it("returns nothing to do when the client is current", async () => {
    const harness = makeHarness();
    const { runId } = await runWithHistory(harness, 3);

    const result = await getState({ runId, sinceSeq: 3 }, harness.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ seq: 3, events: [] });
  });

  it("replays a small gap, and the patches reconstruct the current state", async () => {
    const harness = makeHarness();
    const { runId, snapshots } = await runWithHistory(harness, 5);
    const atSeq2 = snapshots[2];
    if (!atSeq2) throw new Error("setup failed");

    const result = await getState({ runId, sinceSeq: 2 }, harness.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBeUndefined();
    expect(result.value.events?.map((e) => e.seq)).toEqual([3, 4, 5]);

    let mirror: RunState = atSeq2;
    for (const event of result.value.events ?? []) {
      mirror = applyOps(mirror, event.patch);
    }
    expect(mirror).toEqual(await harness.repo.getState(runId));
  });

  it("sends a full snapshot when the gap is too large", async () => {
    const harness = makeHarness();
    const { runId } = await runWithHistory(harness, MAX_REPLAY_EVENTS + 2);

    const result = await getState({ runId, sinceSeq: 0 }, harness.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events).toBeUndefined();
    expect(result.value.state?.seq).toBe(MAX_REPLAY_EVENTS + 2);
    expect(result.value.seq).toBe(MAX_REPLAY_EVENTS + 2);
  });

  it("sends a snapshot to a cold client and to one claiming to be ahead", async () => {
    const harness = makeHarness();
    const { runId } = await runWithHistory(harness, 2);

    for (const sinceSeq of [undefined, -1, Number.NaN, 99]) {
      const result = await getState({ runId, sinceSeq }, harness.deps);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.state?.seq).toBe(2);
    }
  });

  it("falls back to a snapshot when the log does not cover the gap", async () => {
    const harness = makeHarness();
    const { runId } = await runWithHistory(harness, 5);
    // A hole in the log: patches only apply in an unbroken chain, so a partial
    // replay is worse than no replay.
    const real = harness.repo.listEvents.bind(harness.repo);
    harness.repo.listEvents = async (id, sinceSeq, limit) =>
      (await real(id, sinceSeq, limit)).filter((e) => e.seq !== 4);

    const result = await getState({ runId, sinceSeq: 2 }, harness.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.events).toBeUndefined();
    expect(result.value.state?.seq).toBe(5);
  });

  it("404s an unknown run", async () => {
    const harness = makeHarness();
    const result = await getState({ runId: "r_nope", sinceSeq: 0 }, harness.deps);
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});
