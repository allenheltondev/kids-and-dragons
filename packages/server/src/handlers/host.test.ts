import { describe, expect, it, vi } from "vitest";
import type { ChannelMessage, PartyMember } from "@kad/shared";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { addPlayer } from "./account.ts";
import { applyAction } from "./action.ts";
import { closeRoom, lockRoom, setQuiet } from "./host.ts";
import { removePlayer } from "./remove.ts";
import { setPresence } from "./presence.ts";
import { relayPreview } from "./preview.ts";
import { createRoom, joinRoom } from "./room.ts";

function member(playerId: string): PartyMember {
  return { playerId, character: { name: `Hero ${playerId}` } as never, hp: 10, down: false, connected: true, ready: true };
}

/** A room opened by p_1's device, with p_1 and p_2 joined and seated. */
async function hostedRoom() {
  const harness = makeHarness();
  const { householdId, players } = await seedHousehold(harness, 2);
  const [host, guest] = players;
  if (!host || !guest) throw new Error("setup failed");
  const created = await createRoom(
    { householdId, mode: "travel", hostDeviceId: host.principal.deviceId },
    harness.deps,
  );
  if (!created.ok) throw new Error("setup failed");
  const { code, runId } = created.value;
  for (const p of players) await joinRoom({ code, principal: p.principal }, harness.deps);
  const state = await harness.repo.getState(runId);
  if (!state) throw new Error("no state");
  await harness.repo.putState({ ...state, party: players.map((p) => member(p.principal.playerId)) });
  return { harness, householdId, code, runId, host, guest };
}

describe("the room's roster (RunState.seats)", () => {
  it("lists everybody who joined, on what, before they have a hero", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 2);
    const [phone, kid] = players;
    if (!phone || !kid) throw new Error("setup failed");
    const created = await createRoom({ householdId, mode: "travel", hostDeviceId: phone.principal.deviceId }, harness.deps);
    if (!created.ok) throw new Error("setup failed");

    await joinRoom({ code: created.value.code, principal: phone.principal }, harness.deps);
    await joinRoom({ code: created.value.code, principal: kid.principal, device: "tablet" }, harness.deps);

    const state = await harness.repo.getState(created.value.runId);
    expect(state?.party).toEqual([]);
    expect(state?.seats).toEqual({
      p_1: { name: "Player 1", color: "#7FD4C1", device: "phone" },
      p_2: { name: "Player 2", color: "#7FD4C1", device: "tablet" },
    });
  });

  it("costs a rejoin nothing when nothing changed", async () => {
    const { harness, code, runId, guest } = await hostedRoom();
    const before = await harness.repo.getState(runId);
    await joinRoom({ code, principal: guest.principal }, harness.deps);
    expect((await harness.repo.getState(runId))?.seq).toBe(before?.seq);
  });
});

describe("lockRoom", () => {
  it("turns away somebody new, keeps the roster's way back in, and opens again", async () => {
    const { harness, householdId, code, runId, host, guest } = await hostedRoom();
    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(code, (m) => received.push(m));
    expect(await lockRoom({ code, principal: host.principal, locked: true }, harness.deps)).toMatchObject({ ok: true });
    stop();
    expect((await harness.repo.getState(runId))?.locked).toBe(true);
    // One logged patch, by the host, that every screen receives.
    expect(received.map((m) => m.kind)).toEqual(["patch"]);
    const log = await harness.repo.listEvents(runId, 0);
    expect(log[log.length - 1]).toMatchObject({ playerId: host.principal.playerId });

    const stranger = await addPlayer({ householdId, displayName: "Who?" }, harness.deps);
    expect(await joinRoom({ code, principal: stranger.principal }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    // Somebody already on the roster comes back, even from a new device.
    expect(await joinRoom({ code, principal: guest.principal }, harness.deps)).toMatchObject({ ok: true });

    await lockRoom({ code, principal: host.principal, locked: false }, harness.deps);
    expect((await harness.repo.getState(runId))?.locked).toBeUndefined();
    expect(await joinRoom({ code, principal: stranger.principal }, harness.deps)).toMatchObject({ ok: true });
  });

  it("lets a seated hero back in from a run older than the roster", async () => {
    const { harness, code, runId, host, guest } = await hostedRoom();
    const state = await harness.repo.getState(runId);
    if (!state) throw new Error("no state");
    const { seats: _seats, ...older } = state;
    await harness.repo.putState(older);
    await lockRoom({ code, principal: host.principal, locked: true }, harness.deps);
    expect(await joinRoom({ code, principal: guest.principal }, harness.deps)).toMatchObject({ ok: true });
  });

  it("does nothing twice", async () => {
    const { harness, code, runId, host } = await hostedRoom();
    await lockRoom({ code, principal: host.principal, locked: true }, harness.deps);
    const seq = (await harness.repo.getState(runId))?.seq;
    await lockRoom({ code, principal: host.principal, locked: true }, harness.deps);
    expect((await harness.repo.getState(runId))?.seq).toBe(seq);
  });

  it("is something only the device that opened the room can do", async () => {
    const { harness, code, runId, guest } = await hostedRoom();
    expect(await lockRoom({ code, principal: guest.principal, locked: true }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect((await harness.repo.getState(runId))?.locked).toBeUndefined();
  });
});

describe("setQuiet", () => {
  it("sets the flag as one logged patch every screen receives, and clears it", async () => {
    const { harness, code, runId, host } = await hostedRoom();
    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(code, (m) => received.push(m));
    expect(await setQuiet({ code, principal: host.principal, quiet: true }, harness.deps)).toMatchObject({ ok: true });
    stop();
    expect((await harness.repo.getState(runId))?.quiet).toBe(true);
    expect(received.map((m) => m.kind)).toEqual(["patch"]);
    const log = await harness.repo.listEvents(runId, 0);
    expect(log[log.length - 1]).toMatchObject({ playerId: host.principal.playerId });

    await setQuiet({ code, principal: host.principal, quiet: false }, harness.deps);
    expect((await harness.repo.getState(runId))?.quiet).toBeUndefined();
  });

  it("costs nothing when the room is already as asked", async () => {
    const { harness, code, runId, host } = await hostedRoom();
    await setQuiet({ code, principal: host.principal, quiet: true }, harness.deps);
    const seq = (await harness.repo.getState(runId))?.seq;
    await setQuiet({ code, principal: host.principal, quiet: true }, harness.deps);
    expect((await harness.repo.getState(runId))?.seq).toBe(seq);
  });

  it("is something only the device that opened the room can do", async () => {
    const { harness, code, runId, guest } = await hostedRoom();
    expect(await setQuiet({ code, principal: guest.principal, quiet: true }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect((await harness.repo.getState(runId))?.quiet).toBeUndefined();
  });

  it("is refused once the room is closed", async () => {
    const { harness, code, runId, host } = await hostedRoom();
    await closeRoom({ code, principal: host.principal }, harness.deps);
    expect(await setQuiet({ code, principal: host.principal, quiet: true }, harness.deps)).toMatchObject({ ok: false });
    expect((await harness.repo.getState(runId))?.quiet).toBeUndefined();
  });
});

describe("closeRoom", () => {
  it("ends the room for everybody: the code is gone and nothing more is accepted", async () => {
    const { harness, code, runId, host, guest } = await hostedRoom();
    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(code, (m) => received.push(m));
    expect(await closeRoom({ code, principal: host.principal }, harness.deps)).toMatchObject({ ok: true });
    stop();

    const state = await harness.repo.getState(runId);
    expect(state?.closed).toBe(true);
    expect(received.map((m) => m.kind)).toEqual(["patch"]);
    expect(await harness.repo.getRoom(code)).toBeNull();

    expect(await joinRoom({ code, principal: guest.principal }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    const action = await applyAction(
      {
        runId,
        playerId: guest.principal.playerId,
        seq: state?.seq ?? 0,
        intent: { type: "SET_READY", ready: true } as never,
        principal: guest.principal,
      },
      harness.deps,
    );
    expect(action).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const preview = await relayPreview(
      { runId, playerId: guest.principal.playerId, preview: null, context: null },
      harness.deps,
    );
    expect(preview).toMatchObject({ ok: false, status: 403 });
    expect(await setPresence({ runId, playerId: guest.principal.playerId, connected: false }, harness.deps)).toBeNull();
  });

  it("is something only the device that opened the room can do", async () => {
    const { harness, code, guest } = await hostedRoom();
    expect(await closeRoom({ code, principal: guest.principal }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await harness.repo.getRoom(code)).not.toBeNull();
  });

  it("finishes the job on a second tap if the code outlived the first", async () => {
    const { harness, code, runId, host } = await hostedRoom();
    const room = await harness.repo.getRoom(code);
    await closeRoom({ code, principal: host.principal }, harness.deps);
    // As if the server died between marking the run and deleting the code.
    if (room) await harness.repo.putRoomIfAbsent(room);
    const seq = (await harness.repo.getState(runId))?.seq;
    expect(await closeRoom({ code, principal: host.principal }, harness.deps)).toMatchObject({ ok: true });
    expect(await harness.repo.getRoom(code)).toBeNull();
    expect((await harness.repo.getState(runId))?.seq).toBe(seq);
  });
});

describe("a host's change landing in the middle of a join", () => {
  /**
   * The newcomer's join reads the room open, and then, before its own write
   * lands, the host's change does: exactly the gap a lock used to slip
   * through. The hook runs `hostChange` the first time the newcomer's seat is
   * committed, so the order is the same on every run.
   */
  async function raced(hostChange: (room: Awaited<ReturnType<typeof hostedRoom>>) => Promise<unknown>) {
    const room = await hostedRoom();
    const { harness, householdId, code } = room;
    const stranger = await addPlayer({ householdId, displayName: "Who?" }, harness.deps);
    const real = harness.repo.commit.bind(harness.repo);
    let fired = false;
    vi.spyOn(harness.repo, "commit").mockImplementation(async (input) => {
      if (!fired && input.event.playerId === stranger.player.id) {
        fired = true;
        await hostChange(room);
      }
      return real(input);
    });
    const joined = await joinRoom({ code, principal: stranger.principal }, harness.deps);
    return { ...room, joined, stranger, fired: () => fired };
  }

  it("refuses the newcomer when the lock lands first, and writes no seat for them", async () => {
    const { harness, runId, joined, stranger, fired } = await raced(({ harness, code, host }) =>
      lockRoom({ code, principal: host.principal, locked: true }, harness.deps),
    );
    expect(fired()).toBe(true);
    expect(joined).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const state = await harness.repo.getState(runId);
    expect(state?.locked).toBe(true);
    expect(state?.seats?.[stranger.player.id]).toBeUndefined();
  });

  it("refuses the newcomer when the close lands first", async () => {
    const { harness, runId, joined, stranger, fired } = await raced(({ harness, code, host }) =>
      closeRoom({ code, principal: host.principal }, harness.deps),
    );
    expect(fired()).toBe(true);
    expect(joined).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await harness.repo.getState(runId))?.seats?.[stranger.player.id]).toBeUndefined();
  });
});

describe("a closed run is terminal", () => {
  it("refuses a removal it would not even have to write", async () => {
    const { harness, code, runId, host, guest } = await hostedRoom();
    await removePlayer({ code, principal: host.principal, playerId: guest.principal.playerId }, harness.deps);
    const room = await harness.repo.getRoom(code);
    await closeRoom({ code, principal: host.principal }, harness.deps);
    if (room) await harness.repo.putRoomIfAbsent(room);
    const seq = (await harness.repo.getState(runId))?.seq;

    // The guest is already out, so this is a no-op, and still refused.
    expect(
      await removePlayer({ code, principal: host.principal, playerId: guest.principal.playerId }, harness.deps),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await harness.repo.getState(runId))?.seq).toBe(seq);
  });

  it("takes no lock or removal once closed, even if its code outlived the close", async () => {
    const { harness, code, runId, host, guest } = await hostedRoom();
    const room = await harness.repo.getRoom(code);
    await closeRoom({ code, principal: host.principal }, harness.deps);
    // The supported recovery case: the run is closed but the code was not deleted.
    if (room) await harness.repo.putRoomIfAbsent(room);
    const seq = (await harness.repo.getState(runId))?.seq;

    expect(await lockRoom({ code, principal: host.principal, locked: true }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(
      await removePlayer({ code, principal: host.principal, playerId: guest.principal.playerId }, harness.deps),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const state = await harness.repo.getState(runId);
    expect(state?.seq).toBe(seq);
    expect(state?.locked).toBeUndefined();
    expect(state?.removed).toBeUndefined();

    // Nor does a control that would change nothing report success on it: an
    // unlock of a room that is not locked, a removal of somebody already out.
    expect(await lockRoom({ code, principal: host.principal, locked: false }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect((await harness.repo.getState(runId))?.seq).toBe(seq);

    // And Close still finishes its own job.
    expect(await closeRoom({ code, principal: host.principal }, harness.deps)).toMatchObject({ ok: true });
    expect(await harness.repo.getRoom(code)).toBeNull();
  });
});
