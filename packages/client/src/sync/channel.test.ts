import { describe, expect, it, vi } from "vitest";
import type { ChannelMessage, RunState, ServerMessage } from "@kad/shared";
import {
  MessageSequencer,
  backoffDelay,
  openChannel,
  parseChannelMessage,
  type EventSourceLike,
  type SequencerHandlers,
  type TimerHandle,
} from "./channel";
import type { PresentationEvent, ProgressionEvent } from "../store/contract";
import { makeState } from "../testing/fixtures";

/** A scheduler the test drives by hand, so gap handling needs no real time. */
function manualScheduler() {
  const pending = new Map<number, () => void>();
  let nextId = 1;
  return {
    schedule: (fn: () => void): TimerHandle => {
      const id = nextId++;
      pending.set(id, fn);
      return id;
    },
    cancel: (handle: TimerHandle) => void pending.delete(handle as number),
    /** Fire everything currently queued. */
    flush: () => {
      const queued = [...pending.values()];
      pending.clear();
      for (const fn of queued) fn();
    },
    get size() {
      return pending.size;
    },
  };
}

function harness(options: { gate?: (event: PresentationEvent) => Promise<void> | void } = {}) {
  const states: RunState[] = [];
  const presentations: PresentationEvent[] = [];
  const progressions: ProgressionEvent[] = [];
  const gaps: number[] = [];
  const scheduler = manualScheduler();

  const handlers: SequencerHandlers = {
    onState: (state) => void states.push(state),
    onPresentation: (event) => void presentations.push(event),
    onProgression: (event) => void progressions.push(event),
    onGap: (sinceSeq) => void gaps.push(sinceSeq),
  };

  const sequencer = new MessageSequencer({
    handlers,
    gate: options.gate ?? null,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  return { sequencer, states, presentations, progressions, gaps, scheduler };
}

function patch(
  seq: number,
  narration: string,
  presentation?: ServerMessage["presentation"],
): { kind: "patch" } & ServerMessage {
  const message: ChannelMessage = {
    kind: "patch",
    seq,
    runId: "r_1",
    patch: [
      { op: "replace", path: "/narration", value: narration },
      { op: "replace", path: "/seq", value: seq },
    ],
  };
  return presentation ? { ...message, presentation } : message;
}

describe("MessageSequencer", () => {
  it("applies patches in order and advances seq", () => {
    const { sequencer, states } = harness();
    sequencer.reset(makeState({ seq: 1, narration: "one" }), 1);

    sequencer.ingest(patch(2, "two"));
    sequencer.ingest(patch(3, "three"));

    expect(sequencer.seq).toBe(3);
    expect(sequencer.state?.narration).toBe("three");
    expect(states.map((s) => s.narration)).toEqual(["one", "two", "three"]);
  });

  it("never mutates the mirror in place — React needs a new reference", () => {
    const { sequencer } = harness();
    const seed = makeState({ seq: 1, narration: "one" });
    sequencer.reset(seed, 1);

    sequencer.ingest(patch(2, "two"));

    expect(seed.narration).toBe("one");
    expect(sequencer.state).not.toBe(seed);
  });

  it("buffers a message that arrives early and applies it once the hole fills", () => {
    const { sequencer, states } = harness();
    sequencer.reset(makeState({ seq: 1 }), 1);

    sequencer.ingest(patch(4, "four"));
    sequencer.ingest(patch(3, "three"));

    // Nothing is applied while seq 2 is missing.
    expect(sequencer.seq).toBe(1);
    expect(sequencer.buffered).toEqual([3, 4]);

    sequencer.ingest(patch(2, "two"));

    expect(sequencer.seq).toBe(4);
    expect(sequencer.buffered).toEqual([]);
    expect(states.map((s) => s.narration)).toEqual(["", "two", "three", "four"]);
  });

  it("ignores duplicates and replays of applied events", () => {
    const { sequencer, states } = harness();
    sequencer.reset(makeState({ seq: 5 }), 5);

    sequencer.ingest(patch(5, "stale"));
    sequencer.ingest(patch(3, "older"));
    sequencer.ingest(patch(6, "six"));
    sequencer.ingest(patch(6, "six again"));

    expect(sequencer.seq).toBe(6);
    expect(sequencer.state?.narration).toBe("six");
    expect(states).toHaveLength(2); // the reset, and seq 6 exactly once
  });

  it("asks for a resync when a hole does not fill in time", () => {
    const { sequencer, gaps, scheduler } = harness();
    sequencer.reset(makeState({ seq: 1 }), 1);

    sequencer.ingest(patch(3, "three"));
    expect(gaps).toEqual([]);

    scheduler.flush();

    // sinceSeq is the last thing we actually applied (architecture §4.3).
    expect(gaps).toEqual([1]);
  });

  it("cancels the gap timer when the missing message shows up", () => {
    const { sequencer, gaps, scheduler } = harness();
    sequencer.reset(makeState({ seq: 1 }), 1);

    sequencer.ingest(patch(3, "three"));
    sequencer.ingest(patch(2, "two"));
    scheduler.flush();

    expect(gaps).toEqual([]);
    expect(sequencer.seq).toBe(3);
  });

  it("takes a snapshot as the truth and drops stale buffered events", () => {
    const { sequencer } = harness();
    sequencer.reset(makeState({ seq: 1 }), 1);
    sequencer.ingest(patch(9, "nine"));

    sequencer.ingest({
      kind: "snapshot",
      seq: 12,
      runId: "r_1",
      state: makeState({ seq: 12, narration: "resynced" }),
    });

    expect(sequencer.seq).toBe(12);
    expect(sequencer.state?.narration).toBe("resynced");
    expect(sequencer.buffered).toEqual([]);
  });

  it("replays a batch of missed events from a resync", () => {
    const { sequencer } = harness();
    sequencer.reset(makeState({ seq: 1 }), 1);

    sequencer.ingestAll([
      { seq: 2, runId: "r_1", patch: [{ op: "replace", path: "/narration", value: "two" }] },
      { seq: 3, runId: "r_1", patch: [{ op: "replace", path: "/narration", value: "three" }] },
    ]);

    expect(sequencer.seq).toBe(3);
    expect(sequencer.state?.narration).toBe("three");
  });

  it("delivers progression in seq order exactly once across replay and duplicate reconnect events", () => {
    const { sequencer, progressions } = harness();
    sequencer.reset(makeState({ seq: 1 }), 1);
    const update = (characterId: string) => ({
      characters: [],
      awards: [{ characterId, leveledTo: 2 }],
    });

    sequencer.ingest({
      ...patch(3, "three"),
      progression: update("c_3"),
    });
    sequencer.ingestAll([
      {
        seq: 2,
        runId: "r_1",
        patch: [{ op: "replace", path: "/narration", value: "two" }],
        progression: update("c_2"),
      },
    ]);
    // A reconnect can replay an event already delivered; the seq watermark
    // must suppress both its patch and its progression trigger.
    sequencer.ingestAll([
      {
        seq: 2,
        runId: "r_1",
        patch: [],
        progression: update("duplicate"),
      },
      {
        seq: 3,
        runId: "r_1",
        patch: [],
        progression: update("duplicate"),
      },
    ]);

    expect(progressions.map((event) => event.seq)).toEqual([2, 3]);
    expect(progressions.map((event) => event.progression.awards?.[0]?.characterId)).toEqual([
      "c_2",
      "c_3",
    ]);
  });

  describe("presentation", () => {
    const roll = {
      kind: "ROLL" as const,
      roll: {
        die: 17,
        mod: 3,
        total: 20,
        tn: 14,
        result: "success" as const,
        characterId: "c_1",
      },
    };

    it("surfaces presentation separately from state, and applies immediately without a gate", () => {
      // A Party Mode phone: applies the patch, ignores the spectacle (§4.2).
      const { sequencer, presentations } = harness();
      sequencer.reset(makeState({ seq: 1 }), 1);

      sequencer.ingest(patch(2, "two", roll));

      expect(presentations).toEqual([{ seq: 2, presentation: roll }]);
      expect(sequencer.seq).toBe(2);
    });

    it("with a gate, plays the presentation before applying the patch", async () => {
      let release = (): void => {};
      const gate = () => new Promise<void>((resolve) => (release = resolve));
      const { sequencer, presentations } = harness({ gate });
      sequencer.reset(makeState({ seq: 1, narration: "one" }), 1);

      sequencer.ingest(patch(2, "two", roll));

      // The die is in the air: presentation out, state untouched.
      expect(presentations).toHaveLength(1);
      expect(sequencer.state?.narration).toBe("one");
      expect(sequencer.seq).toBe(1);

      release();
      await Promise.resolve();
      await Promise.resolve();

      expect(sequencer.state?.narration).toBe("two");
      expect(sequencer.seq).toBe(2);
    });

    it("discards a gated patch that a snapshot has already superseded", async () => {
      let release = (): void => {};
      const gate = () => new Promise<void>((resolve) => (release = resolve));
      const { sequencer } = harness({ gate });
      sequencer.reset(makeState({ seq: 1, narration: "one" }), 1);

      sequencer.ingest(patch(2, "two", roll));
      expect(sequencer.seq).toBe(1);

      // A reconnect mid-animation: the server's own view already includes the
      // patch being held, and then some.
      sequencer.ingest({
        kind: "snapshot",
        seq: 9,
        runId: "r_1",
        state: makeState({ seq: 9, narration: "resynced" }),
      });
      expect(sequencer.seq).toBe(9);

      release();
      await Promise.resolve();
      await Promise.resolve();

      // The stale patch is dropped rather than replayed on top of the
      // snapshot: seq never walks backwards and nothing is applied twice.
      expect(sequencer.seq).toBe(9);
      expect(sequencer.state?.narration).toBe("resynced");
    });

    it("still applies a gated patch the snapshot did not cover", async () => {
      let release = (): void => {};
      const gate = () => new Promise<void>((resolve) => (release = resolve));
      const { sequencer } = harness({ gate });
      sequencer.reset(makeState({ seq: 1, narration: "one" }), 1);

      sequencer.ingest(patch(2, "two", roll));
      // A snapshot at the seq *before* the held patch leaves it still valid.
      sequencer.ingest({
        kind: "snapshot",
        seq: 1,
        runId: "r_1",
        state: makeState({ seq: 1, narration: "one" }),
      });

      release();
      await Promise.resolve();
      await Promise.resolve();

      expect(sequencer.seq).toBe(2);
      expect(sequencer.state?.narration).toBe("two");
    });

    it("holds later messages behind the gated one, then drains them in order", async () => {
      let release = (): void => {};
      const gate = () => new Promise<void>((resolve) => (release = resolve));
      const { sequencer } = harness({ gate });
      sequencer.reset(makeState({ seq: 1 }), 1);

      sequencer.ingest(patch(2, "two", roll));
      sequencer.ingest(patch(3, "three"));
      expect(sequencer.seq).toBe(1);

      release();
      await Promise.resolve();
      await Promise.resolve();

      expect(sequencer.seq).toBe(3);
      expect(sequencer.state?.narration).toBe("three");
    });

    it("applies the patch even when the animation blows up", async () => {
      const gate = () => Promise.reject(new Error("rive exploded"));
      const { sequencer } = harness({ gate });
      sequencer.reset(makeState({ seq: 1 }), 1);

      sequencer.ingest(patch(2, "two", roll));
      await Promise.resolve();
      await Promise.resolve();

      expect(sequencer.seq).toBe(2);
    });
  });

  describe("chained presentation (`after`)", () => {
    const sequence = {
      kind: "COMBAT_SEQUENCE" as const,
      events: [{ type: "down" as const, actorId: "e_1" }],
      after: { kind: "SCENE_ENTER" as const, sceneId: "s_2" },
    };

    it("without a gate, surfaces the parent then the child, in order", () => {
      const { sequencer, presentations } = harness();
      sequencer.reset(makeState({ seq: 1 }), 1);

      sequencer.ingest(patch(2, "two", sequence));

      expect(presentations.map((e) => e.presentation.kind)).toEqual([
        "COMBAT_SEQUENCE",
        "SCENE_ENTER",
      ]);
      // The child's synthetic seq sits strictly between its parent and the
      // next real message, so a subscriber's watermark neither replays the
      // parent nor skips whatever seq 3 carries.
      expect(presentations.map((e) => e.seq)).toEqual([2, 2.5]);
      expect(sequencer.seq).toBe(2);
    });

    it("with a gate, plays parent then child, and only then applies the patch", async () => {
      const releases: (() => void)[] = [];
      const played: string[] = [];
      const gate = (event: PresentationEvent) => {
        played.push(event.presentation.kind);
        return new Promise<void>((resolve) => releases.push(resolve));
      };
      const { sequencer } = harness({ gate });
      sequencer.reset(makeState({ seq: 1, narration: "one" }), 1);

      sequencer.ingest(patch(2, "two", sequence));

      // The parent beat is playing; the child has not started.
      expect(played).toEqual(["COMBAT_SEQUENCE"]);
      expect(sequencer.seq).toBe(1);

      releases[0]?.();
      await Promise.resolve();
      await Promise.resolve();

      // Parent finished → the child plays. The patch is still held.
      expect(played).toEqual(["COMBAT_SEQUENCE", "SCENE_ENTER"]);
      expect(sequencer.state?.narration).toBe("one");

      releases[1]?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(sequencer.state?.narration).toBe("two");
      expect(sequencer.seq).toBe(2);
    });

    it("still plays the child when the parent's animation blows up", async () => {
      const played: string[] = [];
      const gate = (event: PresentationEvent) => {
        played.push(event.presentation.kind);
        return event.presentation.kind === "COMBAT_SEQUENCE"
          ? Promise.reject(new Error("rive exploded"))
          : Promise.resolve();
      };
      const { sequencer } = harness({ gate });
      sequencer.reset(makeState({ seq: 1 }), 1);

      sequencer.ingest(patch(2, "two", sequence));
      // A macrotask: the reject → catch → child-gate chain is several
      // microtask hops deep, and counting them is not the point of the test.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(played).toEqual(["COMBAT_SEQUENCE", "SCENE_ENTER"]);
      expect(sequencer.seq).toBe(2);
    });
  });

  it("re-arms the gap timer so a failed resync is asked for again", () => {
    const { sequencer, gaps, scheduler } = harness();
    sequencer.reset(makeState({ seq: 1 }), 1);

    sequencer.ingest(patch(3, "three"));
    scheduler.flush();
    expect(gaps).toEqual([1]);

    // The resync went nowhere (offline, dropped, empty answer). The hole is
    // still there, so the sequencer must ask again rather than stall forever.
    scheduler.flush();
    expect(gaps).toEqual([1, 1]);

    // Once the hole fills, the nagging stops.
    sequencer.ingest(patch(2, "two"));
    scheduler.flush();
    expect(gaps).toEqual([1, 1]);
  });

  it("stops applying once disposed", () => {
    const { sequencer } = harness();
    sequencer.reset(makeState({ seq: 1 }), 1);
    sequencer.dispose();

    sequencer.ingest(patch(2, "two"));

    expect(sequencer.seq).toBe(1);
  });
});

describe("openChannel", () => {
  function fakeSource(): EventSourceLike {
    return { onopen: null, onerror: null, onmessage: null, close: vi.fn() };
  }

  it("re-issues a resync that was asked for while one was in flight", async () => {
    const scheduler = manualScheduler();
    const sources: EventSourceLike[] = [];
    const resolvers: (() => void)[] = [];
    const resync = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)));
    const sequencer = new MessageSequencer({
      handlers: {
        onState: () => undefined,
        onPresentation: () => undefined,
        onProgression: () => undefined,
        onGap: () => undefined,
      },
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
    });
    sequencer.reset(makeState({ seq: 1 }), 1);

    openChannel({
      url: () => "/events/ABCD",
      sequencer,
      onStatus: () => undefined,
      resync,
      createEventSource: () => {
        const source = fakeSource();
        sources.push(source);
        return source;
      },
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      backoff: { random: () => 0 },
    });

    // First connect: the catch-up fetch starts and stays in flight.
    sources[0]?.onopen?.({});
    expect(resync).toHaveBeenCalledTimes(1);

    // The connection drops and comes back before that fetch settles. The
    // request this open makes must not simply vanish — anything published
    // after the first fetch was answered would never be asked for again.
    sources[0]?.onerror?.({});
    scheduler.flush(); // the backoff timer → reconnect
    sources[1]?.onopen?.({});
    expect(resync).toHaveBeenCalledTimes(1); // still busy: recorded, not fired

    resolvers[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(resync).toHaveBeenCalledTimes(2);
    expect(resync).toHaveBeenLastCalledWith(sequencer.seq);
  });
});

describe("parseChannelMessage", () => {
  it("parses a patch message", () => {
    const parsed = parseChannelMessage(
      JSON.stringify({ kind: "patch", seq: 2, runId: "r_1", patch: [] }),
    );
    expect(parsed).toEqual({ kind: "patch", seq: 2, runId: "r_1", patch: [] });
  });

  it("keeps the presentation payload", () => {
    const parsed = parseChannelMessage(
      JSON.stringify({
        seq: 2,
        runId: "r_1",
        patch: [],
        presentation: { kind: "DOWN", targetId: "c_1" },
      }),
    );
    expect(parsed).toMatchObject({ presentation: { kind: "DOWN", targetId: "c_1" } });
  });

  it("keeps additive progression snapshots and award triggers", () => {
    const progression = {
      characters: [],
      awards: [{ characterId: "c_1", leveledTo: 4, newTier: "sworn" }],
    };
    const parsed = parseChannelMessage(
      JSON.stringify({ seq: 2, runId: "r_1", patch: [], progression }),
    );

    expect(parsed).toMatchObject({ progression });
  });

  it("infers a snapshot from its payload when kind is missing", () => {
    const state = makeState({ seq: 4 });
    const parsed = parseChannelMessage(JSON.stringify({ seq: 4, runId: "r_1", state }));
    expect(parsed?.kind).toBe("snapshot");
  });

  it("returns null for junk rather than throwing at the transport", () => {
    expect(parseChannelMessage("not json")).toBeNull();
    expect(parseChannelMessage("null")).toBeNull();
    expect(parseChannelMessage(JSON.stringify({ seq: 1 }))).toBeNull();
    expect(parseChannelMessage(JSON.stringify({ seq: 1, runId: "r_1" }))).toBeNull();
  });
});

describe("backoffDelay", () => {
  it("grows exponentially and caps", () => {
    const random = () => 1; // full delay
    expect(backoffDelay(0, { random })).toBe(500);
    expect(backoffDelay(1, { random })).toBe(1000);
    expect(backoffDelay(2, { random })).toBe(2000);
    expect(backoffDelay(20, { random })).toBe(15_000);
  });

  it("jitters between half and full, so three phones do not retry in lockstep", () => {
    const spread = new Set(
      [0, 0.25, 0.5, 0.75, 0.99].map((r) => backoffDelay(3, { random: () => r })),
    );
    expect(spread.size).toBeGreaterThan(1);
    for (const delay of spread) {
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThanOrEqual(4000);
    }
  });

  it("never returns a negative delay for a nonsense attempt", () => {
    expect(backoffDelay(-5, { random: vi.fn(() => 0) })).toBe(250);
  });
});
