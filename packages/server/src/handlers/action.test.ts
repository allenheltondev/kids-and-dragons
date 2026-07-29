import { describe, expect, it } from "vitest";
import type { ChannelMessage } from "@kad/shared";
import { applyOps } from "../json-patch.ts";
import type { EngineContext, IntentInput } from "../engine/port.ts";
import {
  makeHarness,
  seedHousehold,
  stubEngine,
  type TestHarness,
} from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom } from "./room.ts";

/** A room with one player, ready to be acted on. */
async function setup(harness: TestHarness) {
  const { householdId, players } = await seedHousehold(harness, 1);
  const created = await createRoom({ householdId, mode: "party" }, harness.deps);
  if (!created.ok) throw new Error("setup failed");
  const player = players[0];
  if (!player) throw new Error("setup failed");

  const received: ChannelMessage[] = [];
  harness.channel.subscribe(created.value.code, (m) => received.push(m));

  return { householdId, player, received, ...created.value };
}

function choose(choiceId: string) {
  return { type: "CHOOSE" as const, choiceId };
}

describe("applyAction — the seq gate (architecture §4.2)", () => {
  it("accepts an intent built on the current seq and advances by exactly one", async () => {
    const harness = makeHarness();
    const room = await setup(harness);

    const response = await applyAction(
      { runId: room.runId, playerId: room.player.principal.playerId, seq: 0, intent: choose("east") },
      harness.deps,
    );

    expect(response).toEqual({ ok: true, seq: 1 });
    const state = await harness.repo.getState(room.runId);
    expect(state?.seq).toBe(1);
    expect(state?.flags.east).toBe(true);
  });

  it("refuses to act for another player when a principal is present", async () => {
    const harness = makeHarness();
    const room = await setup(harness);
    const me = room.player.principal;

    // Party player IDs are in the room state every client already holds, so
    // without a principal the body's playerId is the only claim being made.
    const response = await applyAction(
      {
        runId: room.runId,
        playerId: "p_somebody_else",
        seq: 0,
        intent: choose("east"),
        principal: { householdId: me.householdId, playerId: me.playerId, role: me.role },
      },
      harness.deps,
    );

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe("FORBIDDEN");
    const state = await harness.repo.getState(room.runId);
    expect(state?.seq).toBe(0);
  });

  it("rejects a stale seq without touching the run", async () => {
    const harness = makeHarness();
    const room = await setup(harness);
    const playerId = room.player.principal.playerId;

    await applyAction({ runId: room.runId, playerId, seq: 0, intent: choose("east") }, harness.deps);
    room.received.length = 0;

    const stale = await applyAction(
      { runId: room.runId, playerId, seq: 0, intent: choose("west") },
      harness.deps,
    );

    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe("STALE_SEQ");
    // The response carries the real seq so the client knows where to resync.
    expect(stale.seq).toBe(1);
    expect((await harness.repo.getState(room.runId))?.flags.west).toBeUndefined();
    expect(room.received).toHaveLength(0);
    expect(await harness.repo.listEvents(room.runId, 1)).toHaveLength(0);
  });

  it("rejects a client claiming to be ahead of the server", async () => {
    const harness = makeHarness();
    const room = await setup(harness);
    const response = await applyAction(
      {
        runId: room.runId,
        playerId: room.player.principal.playerId,
        seq: 7,
        intent: choose("east"),
      },
      harness.deps,
    );
    expect(response.error?.code).toBe("STALE_SEQ");
    expect(response.seq).toBe(0);
  });

  it("turns a lost commit race into STALE_SEQ", async () => {
    const harness = makeHarness();
    const room = await setup(harness);
    // Two phones tapped in the same millisecond: the conditional write fails.
    harness.repo.commit = async () => false;

    const response = await applyAction(
      { runId: room.runId, playerId: room.player.principal.playerId, seq: 0, intent: choose("east") },
      harness.deps,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "STALE_SEQ" } });
    expect(room.received).toHaveLength(0);
  });
});

describe("applyAction — patches and broadcast", () => {
  it("publishes { seq, patch, presentation } and keeps seq monotonic and gapless", async () => {
    const harness = makeHarness();
    const room = await setup(harness);
    const playerId = room.player.principal.playerId;

    for (const [i, choiceId] of ["east", "shrine", "ridge"].entries()) {
      const response = await applyAction(
        { runId: room.runId, playerId, seq: i, intent: choose(choiceId) },
        harness.deps,
      );
      expect(response).toEqual({ ok: true, seq: i + 1 });
    }

    expect(room.received.map((m) => m.seq)).toEqual([1, 2, 3]);
    for (const [i, message] of room.received.entries()) {
      expect(message.kind).toBe("patch");
      if (message.kind !== "patch") continue;
      // Every published patch takes a client from seq-1 to seq. That is the
      // whole reconnect contract (§4.3): no gaps, no reordering.
      expect(message.patch).toContainEqual({ op: "replace", path: "/seq", value: i + 1 });
      expect(message.presentation).toMatchObject({ kind: "CHOICE_MADE" });
    }
  });

  it("writes the same patch to the event log that it broadcast", async () => {
    const harness = makeHarness();
    const room = await setup(harness);
    const playerId = room.player.principal.playerId;
    await applyAction({ runId: room.runId, playerId, seq: 0, intent: choose("east") }, harness.deps);

    const events = await harness.repo.listEvents(room.runId, 0);
    expect(events).toHaveLength(1);
    const [event, broadcast] = [events[0], room.received[0]];
    if (!event || !broadcast || broadcast.kind !== "patch") throw new Error("missing event");
    expect(event.patch).toEqual(broadcast.patch);
    // Provenance the wire does not need but a replay does.
    expect(event.playerId).toBe(playerId);
    expect(event.intent).toEqual(choose("east"));
  });

  it("applying the broadcast patches to the old state reproduces the new state", async () => {
    // The client mirror is only ever updated by patch (client contract), so a
    // patch that does not reconstruct the server's state is a desync.
    const harness = makeHarness();
    const room = await setup(harness);
    const playerId = room.player.principal.playerId;
    const before = await harness.repo.getState(room.runId);
    if (!before) throw new Error("setup failed");

    await applyAction({ runId: room.runId, playerId, seq: 0, intent: choose("east") }, harness.deps);
    await applyAction({ runId: room.runId, playerId, seq: 1, intent: choose("ridge") }, harness.deps);

    let mirror = before;
    for (const message of room.received) {
      if (message.kind !== "patch") continue;
      mirror = applyOps(mirror, message.patch);
    }
    expect(mirror).toEqual(await harness.repo.getState(room.runId));
  });

  it("does not burn a seq on a no-op intent", async () => {
    const harness = makeHarness();
    const room = await setup(harness);
    const response = await applyAction(
      { runId: room.runId, playerId: room.player.principal.playerId, seq: 0, intent: choose("noop") },
      harness.deps,
    );
    expect(response).toEqual({ ok: true, seq: 0 });
    expect(room.received).toHaveLength(0);
    expect((await harness.repo.getState(room.runId))?.seq).toBe(0);
  });

  it("leaves the run untouched when the engine rejects the intent", async () => {
    const harness = makeHarness();
    const room = await setup(harness);
    const response = await applyAction(
      {
        runId: room.runId,
        playerId: room.player.principal.playerId,
        seq: 0,
        intent: { type: "ROLL" },
      },
      harness.deps,
    );
    expect(response).toMatchObject({ ok: false, seq: 0, error: { code: "ILLEGAL" } });
    expect(room.received).toHaveLength(0);
  });
});

describe("applyAction — dice and context", () => {
  it("seeds the rng from runId:seq so a replay re-rolls identically", async () => {
    const seen: number[] = [];
    const spy = stubEngine((state, _input, ctx: EngineContext) => {
      seen.push(ctx.rng.next());
      return { state: { ...state, flags: { ...state.flags, rolled: true } } };
    });

    const rolls: number[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const harness = makeHarness({ engine: spy });
      const { householdId, players } = await seedHousehold(harness, 1);
      const created = await createRoom({ householdId, mode: "party" }, harness.deps);
      if (!created.ok || !players[0]) throw new Error("setup failed");
      // Force the same runId both times: the seed is (runId, seq), nothing else.
      const state = await harness.repo.getState(created.value.runId);
      if (!state) throw new Error("setup failed");
      await harness.repo.putState({ ...state, runId: "r_fixed" });
      await harness.repo.putRun({
        id: "r_fixed",
        householdId,
        roomCode: created.value.code,
        campaignId: null,
        status: "active",
        createdAt: "2026-01-01T00:00:00.000Z",
      });

      await applyAction(
        {
          runId: "r_fixed",
          playerId: players[0].principal.playerId,
          seq: 0,
          intent: { type: "ADVANCE" },
        },
        harness.deps,
      );
      rolls.push(seen[seen.length - 1] ?? -1);
    }

    expect(rolls[0]).toBe(rolls[1]);
    expect(rolls[0]).toBeGreaterThanOrEqual(0);
  });

  it("hands the engine the chapter a START_CHAPTER intent is moving to", async () => {
    const seen: (string | null)[] = [];
    const spy = stubEngine((state, _input: IntentInput, ctx: EngineContext) => {
      seen.push(ctx.chapter?.id ?? null);
      return { state: { ...state, flags: { ...state.flags, started: true } } };
    });
    const harness = makeHarness({ engine: spy });
    const room = await setup(harness);

    await applyAction(
      {
        runId: room.runId,
        playerId: room.player.principal.playerId,
        seq: 0,
        intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" },
      },
      harness.deps,
    );
    expect(seen).toEqual(["bramblewood-01"]);

    const missing = await applyAction(
      {
        runId: room.runId,
        playerId: room.player.principal.playerId,
        seq: 1,
        intent: { type: "START_CHAPTER", chapterId: "nope-99" },
      },
      harness.deps,
    );
    // A chapter that is not in content is a 404, not a mystery at play time.
    expect(missing).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("applyAction — authorization (§4.5)", () => {
  it("refuses an unknown run", async () => {
    const harness = makeHarness();
    await setup(harness);
    const response = await applyAction(
      { runId: "r_nope", playerId: "p_1", seq: 0, intent: choose("east") },
      harness.deps,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("refuses a player from outside the run's household", async () => {
    const harness = makeHarness();
    const room = await setup(harness);
    const response = await applyAction(
      { runId: room.runId, playerId: "p_stranger", seq: 0, intent: choose("east") },
      harness.deps,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("refuses a device acting for another player", async () => {
    const harness = makeHarness();
    const room = await setup(harness);
    const response = await applyAction(
      {
        runId: room.runId,
        playerId: room.player.principal.playerId,
        seq: 0,
        intent: choose("east"),
        principal: { ...room.player.principal, playerId: "p_someone_else" },
      },
      harness.deps,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});
