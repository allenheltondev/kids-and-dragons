import { describe, expect, it } from "vitest";
import type { ChannelMessage } from "@kad/shared";
import { makeHarness } from "../test-support.ts";
import { addPlayer, createGuestHousehold, linkAccount } from "./account.ts";
import { handKeeper } from "./keeper.ts";
import { removePlayer } from "./remove.ts";
import { createRoom, joinRoom } from "./room.ts";

/** A TV's room, where the first phone to join founds the household (#265). */
async function tvRoom() {
  const harness = makeHarness();
  const tv = await createGuestHousehold({ displayName: "Host", display: true }, harness.deps);
  const created = await createRoom(
    { householdId: tv.household.id, mode: "party", claimable: true, hostDeviceId: tv.principal.deviceId },
    harness.deps,
  );
  if (!created.ok) throw new Error("setup failed");
  const { code, runId } = created.value;
  const householdId = tv.household.id;
  const join = async (displayName: string) => {
    const phone = await addPlayer({ householdId, displayName }, harness.deps);
    const joined = await joinRoom({ code, principal: phone.principal }, harness.deps);
    if (!joined.ok) throw new Error("join failed");
    return phone;
  };
  return { harness, tv, code, runId, householdId, join };
}

describe("a host handing the keeper role to a phone in the room (#272)", () => {
  it("lets the family keep the game though a stranger beat them to the code (items 1 and 2)", async () => {
    const { harness, tv, code, runId, householdId, join } = await tvRoom();
    const stranger = await join("Who?");
    const family = await join("Mia");
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(stranger.principal.deviceId);

    const handed = await handKeeper({ code, principal: tv.principal, playerId: family.principal.playerId }, harness.deps);
    expect(handed.ok).toBe(true);

    // The stranger can no longer keep it; the family's phone can.
    expect(await linkAccount({ cognitoSub: "sub_stranger", principal: stranger.principal }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    const kept = await linkAccount({ cognitoSub: "sub_family", principal: family.principal }, harness.deps);
    expect(kept.ok && kept.value.claimed).toBe(true);
    // Said to every screen, on the run.
    expect((await harness.repo.getState(runId))?.keeperPlayerId).toBe(family.principal.playerId);
  });

  it("gives the role to a phone when a dropped founder left nobody (item 2)", async () => {
    const { harness, tv, code, householdId, join } = await tvRoom();
    const stranger = await join("Who?");
    const family = await join("Mia");
    await removePlayer({ code, principal: tv.principal, playerId: stranger.principal.playerId }, harness.deps);
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe("");

    expect((await handKeeper({ code, principal: tv.principal, playerId: family.principal.playerId }, harness.deps)).ok).toBe(true);
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(family.principal.deviceId);
    const kept = await linkAccount({ cognitoSub: "sub_family", principal: family.principal }, harness.deps);
    expect(kept.ok && kept.value.claimed).toBe(true);
  });

  it("tells a phone that rejoins it is the keeper, and the old one it is not", async () => {
    const { harness, tv, code, join } = await tvRoom();
    const first = await join("Mia");
    const second = await join("Sam");
    await handKeeper({ code, principal: tv.principal, playerId: second.principal.playerId }, harness.deps);
    const a = await joinRoom({ code, principal: first.principal }, harness.deps);
    const b = await joinRoom({ code, principal: second.principal }, harness.deps);
    expect(a.ok && a.value.keeper).toBeUndefined();
    expect(b.ok && b.value.keeper).toBe(true);
  });

  it("is published, so every screen sees the change at once", async () => {
    const { harness, tv, code, join } = await tvRoom();
    const family = await join("Mia");
    const sent: ChannelMessage[] = [];
    const publish = harness.deps.channel.publish.bind(harness.deps.channel);
    harness.deps.channel.publish = async (room, message) => {
      sent.push(message);
      return publish(room, message);
    };
    await handKeeper({ code, principal: tv.principal, playerId: family.principal.playerId }, harness.deps);
    expect(sent.some((m) => m.kind === "patch")).toBe(true);
  });

  it("is the host's alone", async () => {
    const { harness, code, householdId, join } = await tvRoom();
    const first = await join("Mia");
    const second = await join("Sam");
    const refused = await handKeeper({ code, principal: second.principal, playerId: second.principal.playerId }, harness.deps);
    expect(refused).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(first.principal.deviceId);
  });

  it("will not hand it to somebody who is not in the room, was taken out, or has no phone of their own", async () => {
    const { harness, tv, code, householdId, join } = await tvRoom();
    const first = await join("Mia");
    const out = await join("Out");
    const noPhone = await join("Kid");
    await removePlayer({ code, principal: tv.principal, playerId: out.principal.playerId }, harness.deps);
    for (const d of await harness.repo.listDevices(householdId)) {
      if (d.kind !== "shared" && d.playerId === noPhone.principal.playerId) await harness.repo.revokeDevice(householdId, d.deviceId);
    }

    for (const playerId of ["p_nobody", out.principal.playerId, noPhone.principal.playerId]) {
      const refused = await handKeeper({ code, principal: tv.principal, playerId }, harness.deps);
      expect(refused.ok).toBe(false);
    }
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(first.principal.deviceId);
  });

  it("will not hand it to a family tablet, which is nobody (#250)", async () => {
    const { harness, tv, code, runId, householdId, join } = await tvRoom();
    const first = await join("Mia");
    const kid = await join("Kid");
    const state = await harness.repo.getState(runId);
    if (!state?.seats) throw new Error("no roster");
    await harness.repo.putState({
      ...state,
      seats: { ...state.seats, [kid.principal.playerId]: { ...state.seats[kid.principal.playerId]!, device: "tablet" } },
    });
    const refused = await handKeeper({ code, principal: tv.principal, playerId: kid.principal.playerId }, harness.deps);
    expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(first.principal.deviceId);
  });

  it("will not move a game that has already been kept", async () => {
    const { harness, tv, code, householdId, join } = await tvRoom();
    const first = await join("Mia");
    const second = await join("Sam");
    await linkAccount({ cognitoSub: "sub_family", principal: first.principal }, harness.deps);
    const refused = await handKeeper({ code, principal: tv.principal, playerId: second.principal.playerId }, harness.deps);
    expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(first.principal.deviceId);
  });
});
