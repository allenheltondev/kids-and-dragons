import { describe, expect, it } from "vitest";
import type { PartyMember, ResolvedCharacter, RunState } from "@kad/shared";
import { makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { createRoom, joinRoom } from "./room.ts";
import { AWAY_AFTER_MS, beatPresence, setPresence } from "./presence.ts";
import { applyAction } from "./action.ts";

/** A room with one seated player, which is what presence is about. */
async function seatedRoom() {
  const harness = makeHarness();
  const { householdId, players } = await seedHousehold(harness, 1);
  const created = await createRoom({ householdId, mode: "travel" }, harness.deps);
  if (!created.ok || !players[0]) throw new Error("setup failed");
  const principal = players[0].principal;
  await joinRoom({ code: created.value.code, principal }, harness.deps);
  // The friends the tests seat beside them are household profiles too, as a
  // join makes them: a seat with no profile behind it is a kid who moved
  // away (#251), and every room door counts that as out.
  for (const id of ["p_rosie", "p_reader"]) {
    await harness.repo.putPlayer({ id, householdId, displayName: id.slice(2), color: "#7FD4C1" });
  }

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

/** Commit this party onto the run, mid-chapter. */
async function withParty(harness: TestHarness, runId: string, party: PartyMember[]): Promise<void> {
  const state = await harness.repo.getState(runId);
  if (!state) throw new Error("setup failed");
  const next: RunState = { ...state, seq: state.seq + 1, phase: "scene", party };
  const committed = await harness.repo.commit({
    runId,
    expectedSeq: state.seq,
    state: next,
    event: { seq: next.seq, runId, patch: [], at: next.updatedAt, playerId: party[0]!.playerId },
  });
  if (!committed) throw new Error("setup failed");
}

const connectedOf = async (harness: TestHarness, runId: string, playerId: string) =>
  (await harness.repo.getState(runId))?.party.find((m) => m.playerId === playerId)?.connected;

/*
 * Heartbeats (#258): presence where no stream reports it, which is
 * production. Each phone beats; the next beat from anyone notices a friend
 * who has gone quiet.
 */
describe("beatPresence", () => {
  it("marks a friend away once they have been quiet past the timeout, and back on their next beat", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    await withParty(harness, runId, [seat(playerId, false), seat("p_rosie", false)]);
    expect(await beatPresence({ runId, playerId }, harness.deps)).toEqual({ ok: true, connected: true });
    await beatPresence({ runId, playerId: "p_rosie" }, harness.deps);

    // Just inside the timeout: a phone set down for a moment is still here.
    harness.clock.advance(AWAY_AFTER_MS);
    await beatPresence({ runId, playerId }, harness.deps);
    expect(await connectedOf(harness, runId, "p_rosie")).toBe(true);

    // Past it, the next beat from anybody marks Rosie away, on the channel.
    harness.clock.advance(1_000);
    const received: unknown[] = [];
    const stop = harness.channel.subscribe((await harness.repo.getState(runId))!.roomCode, (m) => received.push(m));
    await beatPresence({ runId, playerId }, harness.deps);
    stop();
    expect(await connectedOf(harness, runId, "p_rosie")).toBe(false);
    expect(received).toHaveLength(1);
    expect(await connectedOf(harness, runId, playerId)).toBe(true);

    // Her phone wakes: its first beat brings her back.
    await beatPresence({ runId, playerId: "p_rosie" }, harness.deps);
    expect(await connectedOf(harness, runId, "p_rosie")).toBe(true);
  });

  it("takes a shorter timeout when the server sets one", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    await withParty(harness, runId, [seat(playerId, false), seat("p_rosie", false)]);
    await beatPresence({ runId, playerId: "p_rosie" }, harness.deps);
    harness.clock.advance(46_000);
    await beatPresence({ runId, playerId, awayAfterMs: 45_000 }, harness.deps);
    expect(await connectedOf(harness, runId, "p_rosie")).toBe(false);
  });

  it("marks a phone away at once when its page says goodbye", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    await withParty(harness, runId, [seat(playerId, false), seat("p_rosie", false)]);
    expect(await beatPresence({ runId, playerId: "p_rosie", leaving: true }, harness.deps)).toEqual({
      ok: true,
      connected: false,
    });
    expect(await connectedOf(harness, runId, "p_rosie")).toBe(false);
  });

  it("leaves alone a friend whose phone has never beaten", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    await withParty(harness, runId, [seat(playerId, false), seat("p_rosie", false)]);
    harness.clock.advance(AWAY_AFTER_MS * 10);
    await beatPresence({ runId, playerId }, harness.deps);
    expect(await connectedOf(harness, runId, "p_rosie")).toBe(true);
  });

  it("burns no seq while everybody keeps beating", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    await withParty(harness, runId, [seat(playerId, false), seat("p_rosie", false)]);
    const before = (await harness.repo.getState(runId))!.seq;
    for (let i = 0; i < 5; i++) {
      harness.clock.advance(20_000);
      await beatPresence({ runId, playerId }, harness.deps);
      await beatPresence({ runId, playerId: "p_rosie" }, harness.deps);
    }
    expect((await harness.repo.getState(runId))!.seq).toBe(before);
  });

  it("carries the chapter-end vote when the quiet phone was the last one reading", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    await onTheSummary(harness, runId, [seat(playerId, true), seat("p_reader", false)]);
    await beatPresence({ runId, playerId: "p_reader" }, harness.deps);
    harness.clock.advance(AWAY_AFTER_MS + 1_000);
    await beatPresence({ runId, playerId }, harness.deps);
    expect((await harness.repo.getState(runId))?.phase).toBe("lobby");
  });

  it("refuses a phone that is not at this table, or was taken out", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    expect(await beatPresence({ runId, playerId: "p_nobody" }, harness.deps)).toMatchObject({ ok: false, status: 403 });
    expect(await beatPresence({ runId: "r_nope", playerId }, harness.deps)).toMatchObject({ ok: false, status: 404 });

    const state = (await harness.repo.getState(runId))!;
    const out: RunState = { ...state, seq: state.seq + 1, removed: [playerId] };
    await harness.repo.commit({
      runId,
      expectedSeq: state.seq,
      state: out,
      event: { seq: out.seq, runId, patch: [], at: out.updatedAt, playerId },
    });
    expect(await beatPresence({ runId, playerId }, harness.deps)).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses a beat for a closed room", async () => {
    const { harness, runId, playerId } = await seatedRoom();
    const state = (await harness.repo.getState(runId))!;
    const closed: RunState = { ...state, seq: state.seq + 1, closed: true };
    await harness.repo.commit({
      runId,
      expectedSeq: state.seq,
      state: closed,
      event: { seq: closed.seq, runId, patch: [], at: closed.updatedAt, playerId },
    });
    expect(await beatPresence({ runId, playerId }, harness.deps)).toMatchObject({ ok: false, status: 403 });
  });
});
