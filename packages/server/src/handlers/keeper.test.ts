import { describe, expect, it } from "vitest";
import type { ChannelMessage } from "@kad/shared";
import { makeHarness } from "../test-support.ts";
import { addPlayer, createGuestHousehold, linkAccount } from "./account.ts";
import { handKeeper } from "./keeper.ts";
import { removePlayer } from "./remove.ts";
import { closeRoom } from "./host.ts";
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

  it("changes nothing when the room cannot take the change (#272 review)", async () => {
    // The founder and the run move in one transaction, so a commit that loses
    // every race leaves the household exactly as it was.
    const { harness, tv, code, runId, householdId, join } = await tvRoom();
    const first = await join("Mia");
    const second = await join("Sam");
    harness.repo.commit = async () => false;

    const result = await handKeeper({ code, principal: tv.principal, playerId: second.principal.playerId }, harness.deps);
    expect(result).toMatchObject({ ok: false, error: { code: "STALE_SEQ" } });
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(first.principal.deviceId);
    expect((await harness.repo.getState(runId))?.keeperPlayerId).toBeUndefined();
    const kept = await linkAccount({ cognitoSub: "sub_family", principal: first.principal }, harness.deps);
    expect(kept.ok && kept.value.claimed).toBe(true);
  });

  it("changes nothing when the room closes just before the commit (#272 review)", async () => {
    const { harness, tv, code, householdId, join } = await tvRoom();
    const first = await join("Mia");
    const second = await join("Sam");
    const commit = harness.repo.commit.bind(harness.repo);
    harness.repo.commit = async (input) => {
      // The host's other screen closes the room just as the hand-over commits.
      harness.repo.commit = commit;
      await closeRoom({ code, principal: tv.principal }, harness.deps);
      return commit(input);
    };

    const result = await handKeeper({ code, principal: tv.principal, playerId: second.principal.playerId }, harness.deps);
    expect(result.ok).toBe(false);
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(first.principal.deviceId);
  });

  it("agrees on the later of two overlapping hand-overs, founder and room together (#272 review)", async () => {
    // Sam's whole hand-over lands while Mia's is mid-flight, so Mia's first
    // commit loses the seq race and goes again on the fresh run. Hers is last,
    // and it is hers in both places.
    const { harness, tv, code, runId, householdId, join } = await tvRoom();
    await join("First");
    const mia = await join("Mia");
    const sam = await join("Sam");
    const commit = harness.repo.commit.bind(harness.repo);
    let rival = false;
    harness.repo.commit = async (input) => {
      if (!rival) {
        rival = true;
        const theirs = await handKeeper({ code, principal: tv.principal, playerId: sam.principal.playerId }, harness.deps);
        expect(theirs.ok).toBe(true);
      }
      return commit(input);
    };

    const hers = await handKeeper({ code, principal: tv.principal, playerId: mia.principal.playerId }, harness.deps);
    expect(hers.ok).toBe(true);
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(mia.principal.deviceId);
    expect((await harness.repo.getState(runId))?.keeperPlayerId).toBe(mia.principal.playerId);
    expect(await linkAccount({ cognitoSub: "sub_sam", principal: sam.principal }, harness.deps)).toMatchObject({ ok: false });
    const kept = await linkAccount({ cognitoSub: "sub_mia", principal: mia.principal }, harness.deps);
    expect(kept.ok && kept.value.claimed).toBe(true);
  });

  it("keeps the first hand-over whole when an overlapping one then fails (#272 review)", async () => {
    // The owner's interleaving: A is in flight, B overlaps it and its commit
    // fails. With the founder in the run's own transaction there is no rollback
    // for B to apply over A: A lands in both places and B reports the failure.
    const { harness, tv, code, runId, householdId, join } = await tvRoom();
    await join("First");
    const mia = await join("Mia");
    const sam = await join("Sam");
    const commit = harness.repo.commit.bind(harness.repo);
    let rival = false;
    harness.repo.commit = async (input) => {
      if (!rival) {
        rival = true;
        const real = harness.repo.commit;
        harness.repo.commit = async () => false; // B's every commit fails
        const theirs = await handKeeper({ code, principal: tv.principal, playerId: sam.principal.playerId }, harness.deps);
        harness.repo.commit = real;
        expect(theirs).toMatchObject({ ok: false, error: { code: "STALE_SEQ" } });
      }
      return commit(input);
    };

    const hers = await handKeeper({ code, principal: tv.principal, playerId: mia.principal.playerId }, harness.deps);
    expect(hers.ok).toBe(true);
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(mia.principal.deviceId);
    expect((await harness.repo.getState(runId))?.keeperPlayerId).toBe(mia.principal.playerId);
  });

  it("can be tried again after a failure, and then lands", async () => {
    const { harness, tv, code, runId, householdId, join } = await tvRoom();
    await join("Mia");
    const second = await join("Sam");
    const commit = harness.repo.commit.bind(harness.repo);
    harness.repo.commit = async () => false;
    expect((await handKeeper({ code, principal: tv.principal, playerId: second.principal.playerId }, harness.deps)).ok).toBe(false);
    harness.repo.commit = commit;

    expect((await handKeeper({ code, principal: tv.principal, playerId: second.principal.playerId }, harness.deps)).ok).toBe(true);
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(second.principal.deviceId);
    expect((await harness.repo.getState(runId))?.keeperPlayerId).toBe(second.principal.playerId);
  });

  it("writes the founder again though the run already names the player (#272)", async () => {
    // A removal drops the founder but leaves the run's word; a repeat must mend it.
    const { harness, tv, code, householdId, join } = await tvRoom();
    await join("First");
    const mia = await join("Mia");
    await handKeeper({ code, principal: tv.principal, playerId: mia.principal.playerId }, harness.deps);
    await harness.repo.dropFounder(householdId, mia.principal.deviceId);
    expect((await handKeeper({ code, principal: tv.principal, playerId: mia.principal.playerId }, harness.deps)).ok).toBe(true);
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(mia.principal.deviceId);
  });

  it("refuses the hand-over when a Remove lands between the check and the commit (#272 review)", async () => {
    // The target was fine when the host tapped, then the host's other screen
    // took them out; the retried commit must see that, not hand them the game.
    const { harness, tv, code, runId, householdId, join } = await tvRoom();
    const first = await join("Mia");
    const target = await join("Sam");
    const commit = harness.repo.commit.bind(harness.repo);
    harness.repo.commit = async (input) => {
      harness.repo.commit = commit;
      const out = await removePlayer({ code, principal: tv.principal, playerId: target.principal.playerId }, harness.deps);
      expect(out.ok).toBe(true);
      return commit(input);
    };

    const result = await handKeeper({ code, principal: tv.principal, playerId: target.principal.playerId }, harness.deps);
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe(first.principal.deviceId);
    expect((await harness.repo.getState(runId))?.keeperPlayerId).toBeUndefined();
    expect(await linkAccount({ cognitoSub: "sub_sam", principal: target.principal }, harness.deps)).toMatchObject({ ok: false });
  });

  it("stops advertising the keeper when the host then takes them out (#272 review)", async () => {
    const { harness, tv, code, runId, householdId, join } = await tvRoom();
    await join("First");
    const mia = await join("Mia");
    await handKeeper({ code, principal: tv.principal, playerId: mia.principal.playerId }, harness.deps);
    expect((await harness.repo.getState(runId))?.keeperPlayerId).toBe(mia.principal.playerId);

    await removePlayer({ code, principal: tv.principal, playerId: mia.principal.playerId }, harness.deps);
    expect((await harness.repo.getState(runId))?.keeperPlayerId).toBeUndefined();
    // And their phone no longer keeps it.
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe("");
    expect(await linkAccount({ cognitoSub: "sub_mia", principal: mia.principal }, harness.deps)).toMatchObject({ ok: false });
  });

  it("drops the removed keeper's founding in the Remove's own commit (#272 review)", async () => {
    // Nothing after the commit is left to fail: break the separate drop and the
    // phone still stops being the founder with the room's word.
    const { harness, tv, code, runId, householdId, join } = await tvRoom();
    await join("First");
    const mia = await join("Mia");
    await handKeeper({ code, principal: tv.principal, playerId: mia.principal.playerId }, harness.deps);
    harness.repo.dropFounder = async () => {
      throw new Error("store down");
    };

    const out = await removePlayer({ code, principal: tv.principal, playerId: mia.principal.playerId }, harness.deps);
    expect(out.ok).toBe(true);
    expect((await harness.repo.getState(runId))?.keeperPlayerId).toBeUndefined();
    expect((await harness.repo.getState(runId))?.removed).toContain(mia.principal.playerId);
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe("");
  });

  it("drops the founding on a Remove retried after a hand-over lands mid-flight (#272 review)", async () => {
    // The Remove read the household while the founder was someone else, then
    // the hand-over to the same player committed first. The Remove's commit
    // loses the seq race and goes again, and on the retry it sees who founds.
    const { harness, tv, code, runId, householdId, join } = await tvRoom();
    await join("First");
    const mia = await join("Mia");
    // So only the Remove's own commit can have dropped it.
    harness.repo.dropFounder = async () => {
      throw new Error("store down");
    };
    const commit = harness.repo.commit.bind(harness.repo);
    harness.repo.commit = async (input) => {
      harness.repo.commit = commit;
      const handed = await handKeeper({ code, principal: tv.principal, playerId: mia.principal.playerId }, harness.deps);
      expect(handed.ok).toBe(true);
      return commit(input);
    };

    const out = await removePlayer({ code, principal: tv.principal, playerId: mia.principal.playerId }, harness.deps);
    expect(out.ok).toBe(true);
    const state = await harness.repo.getState(runId);
    expect(state?.removed).toContain(mia.principal.playerId);
    expect(state?.keeperPlayerId).toBeUndefined();
    expect((await harness.repo.getHousehold(householdId))?.founderDeviceId).toBe("");
    expect(await linkAccount({ cognitoSub: "sub_mia", principal: mia.principal }, harness.deps)).toMatchObject({ ok: false });
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
