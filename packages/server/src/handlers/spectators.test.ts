/**
 * Spectators (#388): a fifth phone at a table of four watches and cheers.
 * Presence counts it as watching, and nothing else counts it at all; a cheer
 * goes on the channel and never moves the seq.
 */

import { describe, expect, it } from "vitest";
import {
  CHEER_LIMIT,
  CHEER_WINDOW_MS,
  MAX_PARTY,
  watchers,
  type ChannelMessage,
  type PartyMember,
  type ResolvedCharacter,
  type RunState,
} from "@kad/shared";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { createRoom, joinRoom } from "./room.ts";
import { AWAY_AFTER_MS, beatPresence, setPresence } from "./presence.ts";
import { relayCheer } from "./cheer.ts";

/** A hero at the table, as presence and the relay read one. */
function hero(playerId: string): PartyMember {
  return {
    character: { id: `c_${playerId}`, name: playerId } as unknown as ResolvedCharacter,
    playerId,
    hp: 10,
    down: false,
    connected: true,
    ready: false,
  };
}

/**
 * Five phones joined; the first four have heroes, so the fifth (`p_5`) is a
 * spectator. `seated` heroes instead, to leave a seat open.
 */
async function fullTable(seated = MAX_PARTY) {
  const harness = makeHarness();
  const { householdId, players } = await seedHousehold(harness, MAX_PARTY + 1);
  const created = await createRoom({ householdId, mode: "party", display: true }, harness.deps);
  if (!created.ok) throw new Error("setup failed");
  for (const player of players) {
    const joined = await joinRoom({ code: created.value.code, principal: player.principal }, harness.deps);
    if (!joined.ok) throw new Error(`join failed: ${joined.error.message}`);
  }
  const runId = created.value.runId;
  const party = players.slice(0, seated).map((player) => hero(player.principal.playerId));
  await commit(harness, runId, (state) => ({ ...state, phase: "scene", party }));
  return { harness, runId, watcher: `p_${MAX_PARTY + 1}`, heroId: "p_1" };
}

async function commit(harness: TestHarness, runId: string, change: (state: RunState) => RunState): Promise<void> {
  const state = await harness.repo.getState(runId);
  if (!state) throw new Error("setup failed");
  const next = { ...change(state), seq: state.seq + 1 };
  const committed = await harness.repo.commit({
    runId,
    expectedSeq: state.seq,
    state: next,
    event: { seq: next.seq, runId, patch: [], at: next.updatedAt, playerId: "p_1" },
  });
  if (!committed) throw new Error("setup failed");
}

const stateOf = async (harness: TestHarness, runId: string): Promise<RunState> => {
  const state = await harness.repo.getState(runId);
  if (!state) throw new Error("no state");
  return state;
};

describe("watching", () => {
  it("counts a spectator's phone as watching when it beats, and never as a party member", async () => {
    const { harness, runId, watcher } = await fullTable();
    expect(await beatPresence({ runId, playerId: watcher }, harness.deps)).toEqual({ ok: true, connected: true });

    const state = await stateOf(harness, runId);
    expect(watchers(state)).toEqual([watcher]);
    expect(state.party.map((m) => m.playerId)).not.toContain(watcher);
    expect(state.party).toHaveLength(MAX_PARTY);
  });

  it("burns no seq while a spectator keeps beating", async () => {
    const { harness, runId, watcher } = await fullTable();
    await beatPresence({ runId, playerId: watcher }, harness.deps);
    const before = (await stateOf(harness, runId)).seq;
    await beatPresence({ runId, playerId: watcher }, harness.deps);
    expect((await stateOf(harness, runId)).seq).toBe(before);
  });

  it("writes nothing for a kid still making a hero at a table with room", async () => {
    const { harness, runId, watcher } = await fullTable(MAX_PARTY - 1);
    const before = (await stateOf(harness, runId)).seq;
    await beatPresence({ runId, playerId: watcher }, harness.deps);
    expect(await setPresence({ runId, playerId: watcher, connected: true }, harness.deps)).toBeNull();
    const state = await stateOf(harness, runId);
    expect(state.seq).toBe(before);
    expect(state.watching).toBeUndefined();
  });

  it("stops counting a spectator who goes quiet, and one whose page says goodbye", async () => {
    const { harness, runId, watcher, heroId } = await fullTable();
    await beatPresence({ runId, playerId: watcher }, harness.deps);
    await beatPresence({ runId, playerId: heroId }, harness.deps);

    harness.clock.advance(AWAY_AFTER_MS + 1_000);
    await beatPresence({ runId, playerId: heroId }, harness.deps);
    expect((await stateOf(harness, runId)).watching).toBeUndefined();

    // Back on its next beat, then gone at once on goodbye.
    await beatPresence({ runId, playerId: watcher }, harness.deps);
    expect(watchers(await stateOf(harness, runId))).toEqual([watcher]);
    await beatPresence({ runId, playerId: watcher, leaving: true }, harness.deps);
    expect((await stateOf(harness, runId)).watching).toBeUndefined();
  });

  it("stops counting a spectator once a seat opens for them", async () => {
    const { harness, runId, watcher } = await fullTable();
    await beatPresence({ runId, playerId: watcher }, harness.deps);
    await commit(harness, runId, (state) => ({ ...state, removed: ["p_4"] }));
    expect(watchers(await stateOf(harness, runId))).toEqual([]);
  });
});

describe("relayCheer", () => {
  it("puts a spectator's cheer on the channel without moving the seq", async () => {
    const { harness, runId, watcher } = await fullTable();
    const before = await stateOf(harness, runId);
    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(before.roomCode, (m) => received.push(m));
    const result = await relayCheer({ runId, playerId: watcher, cheer: "star" }, harness.deps);
    stop();

    expect(result).toEqual({ ok: true });
    expect(received).toEqual([{ kind: "cheer", seq: before.seq, runId, cheer: "star" }]);
    expect((await stateOf(harness, runId)).seq).toBe(before.seq);
  });

  it("refuses anything that is not one of the fixed cheers", async () => {
    const { harness, runId, watcher } = await fullTable();
    expect(await relayCheer({ runId, playerId: watcher, cheer: "hello!" }, harness.deps)).toMatchObject({
      ok: false,
      code: "ILLEGAL",
    });
  });

  it("refuses a hero, a kid with a seat open to them, and a spectator taken out", async () => {
    const { harness, runId, watcher, heroId } = await fullTable();
    expect(await relayCheer({ runId, playerId: heroId, cheer: "star" }, harness.deps)).toMatchObject({ code: "FORBIDDEN" });

    await commit(harness, runId, (state) => ({ ...state, removed: [watcher] }));
    expect(await relayCheer({ runId, playerId: watcher, cheer: "star" }, harness.deps)).toMatchObject({ code: "FORBIDDEN" });

    const open = await fullTable(MAX_PARTY - 1);
    expect(
      await relayCheer({ runId: open.runId, playerId: open.watcher, cheer: "star" }, open.harness.deps),
    ).toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets a phone cheer a few times a window, then asks it to wait", async () => {
    const { harness, runId, watcher } = await fullTable();
    for (let i = 0; i < CHEER_LIMIT; i++) {
      expect(await relayCheer({ runId, playerId: watcher, cheer: "heart" }, harness.deps)).toEqual({ ok: true });
    }
    expect(await relayCheer({ runId, playerId: watcher, cheer: "heart" }, harness.deps)).toMatchObject({
      ok: false,
      status: 429,
      code: "SLOW_DOWN",
    });
    harness.clock.advance(CHEER_WINDOW_MS);
    expect(await relayCheer({ runId, playerId: watcher, cheer: "heart" }, harness.deps)).toEqual({ ok: true });
  });
});
