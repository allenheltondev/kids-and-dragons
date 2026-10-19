import { describe, expect, it } from "vitest";
import type { ChannelMessage, PartyMember } from "@kad/shared";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { addPlayer, createGuestHousehold, linkAccount } from "./account.ts";
import { applyAction } from "./action.ts";
import { setPresence } from "./presence.ts";
import { relayPreview } from "./preview.ts";
import { removePlayer } from "./remove.ts";
import { getState } from "./state.ts";
import { createRoom, joinRoom, watchRoom } from "./room.ts";

function member(playerId: string): PartyMember {
  return { playerId, character: { name: `Hero ${playerId}` } as never, hp: 10, down: false, connected: true, ready: true };
}

/** A room opened by p_1's device, with p_1, p_2 and p_3 joined and seated. */
async function hostedRoom() {
  const harness = makeHarness();
  const { householdId, players } = await seedHousehold(harness, 3);
  const [host, guest, other] = players;
  if (!host || !guest || !other) throw new Error("setup failed");
  const created = await createRoom(
    { householdId, mode: "travel", hostDeviceId: host.principal.deviceId },
    harness.deps,
  );
  if (!created.ok) throw new Error("setup failed");
  const { code, runId } = created.value;
  for (const p of players) await joinRoom({ code, principal: p.principal }, harness.deps);

  // The stub engine seats nobody, so the seats are written straight in.
  const state = await harness.repo.getState(runId);
  if (!state) throw new Error("no state");
  await harness.repo.putState({ ...state, party: players.map((p) => member(p.principal.playerId)) });
  return { harness, code, runId, host, guest, other };
}

describe("removePlayer", () => {
  it("takes a player out: away for every gate, and on the removed list", async () => {
    const { harness, code, runId, host, guest } = await hostedRoom();
    const before = await harness.repo.getState(runId);
    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(code, (m) => received.push(m));

    const result = await removePlayer(
      { code, principal: host.principal, playerId: guest.principal.playerId },
      harness.deps,
    );
    stop();

    expect(result.ok).toBe(true);
    const after = await harness.repo.getState(runId);
    expect(after?.removed).toEqual([guest.principal.playerId]);
    expect(after?.seq).toBe((before?.seq ?? 0) + 1);
    // Still in the party, so an encounter's turn order still points at a member;
    // `connected: false` is what every turn, vote and roll already reads as away.
    expect(after?.party.find((m) => m.playerId === guest.principal.playerId)).toMatchObject({
      connected: false,
      ready: false,
    });
    expect(received.map((m) => m.kind)).toEqual(["patch"]);
  });

  it("is something only the device that opened the room can do", async () => {
    const { harness, code, guest, other } = await hostedRoom();
    const result = await removePlayer(
      { code, principal: other.principal, playerId: guest.principal.playerId },
      harness.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("is something nobody can do in a room opened before rooms had a host", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 2);
    const created = await createRoom({ householdId, mode: "travel" }, harness.deps);
    if (!created.ok || !players[0] || !players[1]) throw new Error("setup failed");
    const result = await removePlayer(
      { code: created.value.code, principal: players[0].principal, playerId: players[1].principal.playerId },
      harness.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("will not let the host take themselves out", async () => {
    const { harness, code, host } = await hostedRoom();
    const result = await removePlayer(
      { code, principal: host.principal, playerId: host.principal.playerId },
      harness.deps,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
  });

  it("writes down only players who exist", async () => {
    const { harness, code, runId, host } = await hostedRoom();
    const result = await removePlayer({ code, principal: host.principal, playerId: "p_nobody" }, harness.deps);
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await harness.repo.getState(runId))?.removed).toBeUndefined();
  });

  it("is idempotent: a second tap changes nothing", async () => {
    const { harness, code, runId, host, guest } = await hostedRoom();
    const input = { code, principal: host.principal, playerId: guest.principal.playerId };
    await removePlayer(input, harness.deps);
    const once = await harness.repo.getState(runId);
    expect(await removePlayer(input, harness.deps)).toEqual({ ok: true, value: { seq: once?.seq } });
    expect((await harness.repo.getState(runId))?.removed).toEqual([guest.principal.playerId]);
  });

  it("can take out somebody who joined but never made a hero", async () => {
    // A stranger is in the room the moment they join, before any character exists.
    const { harness, code, runId, host } = await hostedRoom();
    await harness.repo.putPlayer({
      id: "p_new",
      householdId: "h_test",
      displayName: "New phone",
      color: "#7FD4C1",
    });
    const result = await removePlayer({ code, principal: host.principal, playerId: "p_new" }, harness.deps);
    expect(result.ok).toBe(true);
    expect((await harness.repo.getState(runId))?.removed).toEqual(["p_new"]);
  });
});

describe("a removed player stays out", () => {
  async function removed() {
    const room = await hostedRoom();
    await removePlayer(
      { code: room.code, principal: room.host.principal, playerId: room.guest.principal.playerId },
      room.harness.deps,
    );
    return room;
  }

  it("cannot join again", async () => {
    const { harness, code, guest } = await removed();
    const result = await joinRoom({ code, principal: guest.principal }, harness.deps);
    expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("cannot act, though its session token is still well-formed", async () => {
    const { harness, runId, guest } = await removed();
    const state = await harness.repo.getState(runId);
    const response = await applyAction(
      {
        runId,
        playerId: guest.principal.playerId,
        seq: state?.seq ?? 0,
        intent: { type: "READY", ready: true },
        principal: guest.principal,
      },
      harness.deps,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("cannot light up a choice on the TV", async () => {
    const { harness, runId, guest } = await removed();
    const result = await relayPreview(
      { runId, playerId: guest.principal.playerId, preview: null, context: null },
      harness.deps,
    );
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("cannot read the room with the session it already holds", async () => {
    const { harness, runId, guest, other } = await removed();
    expect(await getState({ runId, playerId: guest.principal.playerId }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect((await getState({ runId, playerId: other.principal.playerId }, harness.deps)).ok).toBe(true);
  });

  it("is not brought back by its stream reopening", async () => {
    const { harness, runId, guest } = await removed();
    expect(await setPresence({ runId, playerId: guest.principal.playerId, connected: true }, harness.deps)).toBeNull();
    const state = await harness.repo.getState(runId);
    expect(state?.party.find((m) => m.playerId === guest.principal.playerId)?.connected).toBe(false);
  });

  it("leaves everybody else playing", async () => {
    const { harness, code, other } = await removed();
    const result = await joinRoom({ code, principal: other.principal }, harness.deps);
    expect(result.ok).toBe(true);
  });
});

describe("arrivals", () => {
  it("tells the room who joined, by hero name once they have one", async () => {
    const { harness, code, runId, guest } = await hostedRoom();
    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(code, (m) => received.push(m));
    await joinRoom({ code, principal: guest.principal }, harness.deps);
    stop();

    expect(received.filter((m) => m.kind === "arrival")).toEqual([
      expect.objectContaining({ kind: "arrival", runId, playerId: guest.principal.playerId, name: "Hero p_2" }),
    ]);
  });

  it("names a phone with no hero yet by the name it gave", async () => {
    const harness = makeHarness();
    const { householdId, players } = await seedHousehold(harness, 2);
    const [host, guest] = players;
    if (!host || !guest) throw new Error("setup failed");
    const created = await createRoom(
      { householdId, mode: "travel", hostDeviceId: host.principal.deviceId },
      harness.deps,
    );
    if (!created.ok) throw new Error("setup failed");
    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(created.value.code, (m) => received.push(m));
    await joinRoom({ code: created.value.code, principal: guest.principal }, harness.deps);
    stop();

    const arrival = received.find((m) => m.kind === "arrival");
    expect(arrival).toMatchObject({ playerId: guest.principal.playerId, name: "Player 2" });
    // Live only: an arrival is news, so it never moves the seq.
    expect(arrival?.seq).toBe((await harness.repo.getState(created.value.runId))?.seq);
  });

  it("does not announce the host to itself", async () => {
    const { harness, code, host } = await hostedRoom();
    const received: ChannelMessage[] = [];
    const stop = harness.channel.subscribe(code, (m) => received.push(m));
    const joined = await joinRoom({ code, principal: host.principal }, harness.deps);
    stop();

    expect(received.some((m) => m.kind === "arrival")).toBe(false);
    expect(joined.ok && joined.value.host).toBe(true);
  });

  it("tells only the host's device that it is the host", async () => {
    const { harness, code, guest } = await hostedRoom();
    const joined = await joinRoom({ code, principal: guest.principal }, harness.deps);
    expect(joined.ok && joined.value.host).toBeUndefined();
  });

  it("lets only the screen that opened the room watch it, after a refresh too", async () => {
    const { harness, code, host, guest } = await hostedRoom();
    const asHost = await watchRoom({ code, deviceId: host.principal.deviceId }, harness.deps);
    expect(asHost.ok && asHost.value.host).toBe(true);
    // Anybody else, a removed phone included, would watch unannounced.
    expect(await watchRoom({ code, deviceId: guest.principal.deviceId }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await watchRoom({ code }, harness.deps)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("a tablet as the TV (#274)", () => {
  it("is watched only by the tablet's device, in the tablet's household", async () => {
    const harness = makeHarness();
    const { householdId } = await seedHousehold(harness, 1);
    const created = await createRoom(
      { householdId, mode: "party", hostDeviceId: "dev_tablet", display: true },
      harness.deps,
    );
    if (!created.ok) throw new Error("setup failed");
    const { code } = created.value;

    const own = await watchRoom({ code, deviceId: "dev_tablet", householdId }, harness.deps);
    expect(own.ok && own.value.host).toBe(true);
    expect(await watchRoom({ code, deviceId: "dev_tablet", householdId: "hh_other" }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await watchRoom({ code, deviceId: "dev_other", householdId }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("a removed phone and the household it joined (#265)", () => {
  /** A TV's room, where the first phone to join founds the household. */
  async function tvRoom() {
    const harness = makeHarness();
    const tv = await createGuestHousehold({ displayName: "Host", display: true }, harness.deps);
    const created = await createRoom(
      { householdId: tv.household.id, mode: "party", claimable: true, hostDeviceId: tv.principal.deviceId },
      harness.deps,
    );
    if (!created.ok) throw new Error("setup failed");
    return { harness, tv, code: created.value.code, householdId: tv.household.id };
  }

  it("tells only the founding phone it may keep the household", async () => {
    const { harness, code, householdId } = await tvRoom();
    const first = await addPlayer({ householdId, displayName: "Mia" }, harness.deps);
    const second = await addPlayer({ householdId, displayName: "Sam" }, harness.deps);
    const a = await joinRoom({ code, principal: first.principal }, harness.deps);
    const b = await joinRoom({ code, principal: second.principal }, harness.deps);
    expect(a.ok && a.value.keeper).toBe(true);
    expect(b.ok && b.value.keeper).toBeUndefined();
  });

  it("cannot claim it after the host takes them out, though they were first in", async () => {
    // Review of #271: a stranger who beat the family to the code founded the
    // TV's household. Taking them out has to take that away too.
    const { harness, tv, code, householdId } = await tvRoom();
    const stranger = await addPlayer({ householdId, displayName: "Who?" }, harness.deps);
    await joinRoom({ code, principal: stranger.principal }, harness.deps);

    expect(
      (await removePlayer({ code, principal: tv.principal, playerId: stranger.principal.playerId }, harness.deps)).ok,
    ).toBe(true);
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe("");

    const claim = await linkAccount({ cognitoSub: "sub_stranger", principal: stranger.principal }, harness.deps);
    expect(claim).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await harness.repo.getHousehold(householdId)).toMatchObject({ guest: true, ownerSub: null });
  });

  it("leaves the founder in place when somebody else is taken out", async () => {
    const { harness, tv, code, householdId } = await tvRoom();
    const family = await addPlayer({ householdId, displayName: "Mia" }, harness.deps);
    const stranger = await addPlayer({ householdId, displayName: "Who?" }, harness.deps);
    for (const p of [family, stranger]) await joinRoom({ code, principal: p.principal }, harness.deps);

    await removePlayer({ code, principal: tv.principal, playerId: stranger.principal.playerId }, harness.deps);
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(family.principal.deviceId);
    expect(
      await linkAccount({ cognitoSub: "sub_stranger", principal: stranger.principal }, harness.deps),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const kept = await linkAccount({ cognitoSub: "sub_family", principal: family.principal }, harness.deps);
    expect(kept.ok && kept.value.claimed).toBe(true);
  });
});
