import { describe, expect, it, vi } from "vitest";
import { makeHarness, type TestHarness } from "../test-support.ts";
import { addPlayer, adoptDevice, linkAccount } from "./account.ts";
import type { HandlerResult } from "./deps.ts";
import {
  acceptOrganizerInvite,
  addProfile,
  createGroup,
  createOrganizerInvite,
  INVITE_TTL_MS,
  listOwnedHouseholds,
  normalizeInviteCode,
  removeOrganizer,
  renameHousehold,
  renameProfile,
  setProfileRetired,
  viewHousehold,
} from "./organizer.ts";
import { applyAction } from "./action.ts";
import { joinRoom, createRoom } from "./room.ts";
import { listSharedPlayers, seatOnSharedDevice, shareDevice } from "./shared-device.ts";

const ANA = { cognitoSub: "sub_ana", email: "ana@example.com" };
const BEN = { cognitoSub: "sub_ben", email: "ben@example.com" };
const EVE = { cognitoSub: "sub_eve", email: "eve@example.com" };

function value<T>(result: HandlerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** Ana starts a group and Ben joins it with her code: the two-organizer table. */
async function twoOrganizers(harness: TestHarness) {
  const group = value(await createGroup({ ...ANA, displayName: "Thursday Dragon Club" }, harness.deps));
  const invite = value(await createOrganizerInvite({ ...ANA, householdId: group.id }, harness.deps));
  value(await acceptOrganizerInvite({ ...BEN, code: invite.code }, harness.deps));
  return group;
}

describe("a group is a household with more than one owner (#248)", () => {
  it("lets two organizers sign in to one group and add kids from several families", async () => {
    const harness = makeHarness();
    const group = await twoOrganizers(harness);

    value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    value(await addProfile({ ...BEN, householdId: group.id, displayName: "Gullet" }, harness.deps));
    const view = value(await viewHousehold({ ...BEN, householdId: group.id }, harness.deps));

    expect(view.displayName).toBe("Thursday Dragon Club");
    expect(view.players.map((p) => p.displayName).sort()).toEqual(["Gullet", "Posy"]);
    expect(view.owners).toEqual([
      { id: ANA.cognitoSub, email: ANA.email, you: false, founding: true },
      { id: BEN.cognitoSub, email: BEN.email, you: true, founding: false },
    ]);
    // Both see it, and neither sees anything else of the other's.
    expect(value(await listOwnedHouseholds(ANA, harness.deps)).households.map((h) => h.id)).toEqual([group.id]);
    expect(value(await listOwnedHouseholds(BEN, harness.deps))).toEqual({
      households: [{ id: group.id, displayName: "Thursday Dragon Club", players: 2 }],
    });
  });

  it("seats the group's kids on its tablet and runs a room with them", async () => {
    const harness = makeHarness();
    const group = await twoOrganizers(harness);
    value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    value(await addProfile({ ...BEN, householdId: group.id, displayName: "Gullet" }, harness.deps));

    // Ben, who did not start the group, sets up its tablet.
    const tablet = value(await shareDevice({ cognitoSub: BEN.cognitoSub }, harness.deps));
    expect(tablet.householdId).toBe(group.id);
    const shared = await harness.identity.resolveSharedDevice(tablet.sharedToken);
    if (!shared) throw new Error("tablet did not resolve");

    const faces = value(await listSharedPlayers(shared, harness.deps)).players;
    const posy = faces.find((f) => f.displayName === "Posy");
    const gullet = faces.find((f) => f.displayName === "Gullet");
    if (!posy || !gullet) throw new Error("missing faces");

    const room = value(await createRoom({ householdId: group.id, mode: "party" }, harness.deps));
    for (const kid of [posy, gullet]) {
      const seat = value(await seatOnSharedDevice({ shared, playerId: kid.id }, harness.deps));
      const joined = value(await joinRoom({ code: room.code, principal: seat, device: "tablet" }, harness.deps));
      expect(joined.playerId).toBe(kid.id);
    }
  });

  it("refuses an account that owns nothing here", async () => {
    const harness = makeHarness();
    const group = await twoOrganizers(harness);

    const view = await viewHousehold({ ...EVE, householdId: group.id }, harness.deps);
    expect(view).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const add = await addProfile({ ...EVE, householdId: group.id, displayName: "Rue" }, harness.deps);
    expect(add).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const invite = await createOrganizerInvite({ ...EVE, householdId: group.id }, harness.deps);
    expect(invite).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("renames the group, and keeps the name sensible", async () => {
    const harness = makeHarness();
    const group = await twoOrganizers(harness);
    const renamed = value(await renameHousehold({ ...BEN, householdId: group.id, displayName: "  Cousins  " }, harness.deps));
    expect(renamed.displayName).toBe("Cousins");
    expect((await harness.repo.getHousehold(group.id))?.ownerSub).toBe(ANA.cognitoSub);

    const blank = await renameHousehold({ ...BEN, householdId: group.id, displayName: " " }, harness.deps);
    expect(blank).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
  });
});

describe("profiles an organizer manages", () => {
  it("never puts two faces with one name on the picker", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    const twin = await addProfile({ ...ANA, householdId: group.id, displayName: "posy" }, harness.deps);
    expect(twin).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });

    const view = value(await addProfile({ ...ANA, householdId: group.id, displayName: "Ada" }, harness.deps));
    const ada = view.players.find((p) => p.displayName === "Ada");
    const clash = await renameProfile({ ...ANA, householdId: group.id, playerId: ada?.id, displayName: "Posy" }, harness.deps);
    expect(clash).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    const renamed = value(
      await renameProfile({ ...ANA, householdId: group.id, playerId: ada?.id, displayName: "Ada B" }, harness.deps),
    );
    expect(renamed.players.map((p) => p.displayName).sort()).toEqual(["Ada B", "Posy"]);
  });

  it("shows each profile's heroes, furthest-taken first", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    const view = value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    const posy = view.players[0];
    if (!posy) throw new Error("no profile");
    for (const [id, name, xp, level] of [["c_1", "Ember", 100, 1], ["c_2", "Sparklehoof", 900, 3]] as const) {
      await harness.repo.putCharacter({
        id,
        householdId: group.id,
        ownerPlayerId: posy.id,
        name,
        species: "unicorn",
        class: "songkeeper",
        appearance: { palette: "meadow", accent: "#7FD4C1" },
        committed: {
          level,
          xp,
          stats: { might: 1, quick: 2, clever: 2, heart: 4 },
          tier: "fledgling",
          unlockedActions: [],
          inventory: [],
        },
        questItems: [],
        souvenirs: [],
        createdAt: new Date(harness.clock.now()).toISOString(),
      });
    }
    const after = value(await viewHousehold({ ...ANA, householdId: group.id }, harness.deps));
    expect(after.players[0]?.heroes).toEqual([
      { id: "c_2", name: "Sparklehoof", species: "unicorn", class: "songkeeper", level: 3 },
      { id: "c_1", name: "Ember", species: "unicorn", class: "songkeeper", level: 1 },
    ]);
  });

  it("retires a kid off every picker and their phone, and brings them back", async () => {
    const harness = makeHarness();
    const group = await twoOrganizers(harness);
    const phone = await addPlayer({ householdId: group.id, displayName: "Posy" }, harness.deps);
    value(await addProfile({ ...ANA, householdId: group.id, displayName: "Gullet" }, harness.deps));
    const tablet = value(await shareDevice({ cognitoSub: ANA.cognitoSub }, harness.deps));
    const shared = await harness.identity.resolveSharedDevice(tablet.sharedToken);
    if (!shared) throw new Error("tablet did not resolve");

    const retired = value(
      await setProfileRetired({ ...BEN, householdId: group.id, playerId: phone.player.id, retired: true }, harness.deps),
    );
    expect(retired.players.find((p) => p.id === phone.player.id)?.retired).toBe(true);

    // Off the tablet, off the phone, off the "who is this phone?" picker.
    expect(value(await listSharedPlayers(shared, harness.deps)).players.map((p) => p.displayName)).toEqual(["Gullet"]);
    expect(await harness.identity.resolveDevice(phone.deviceToken)).toBeNull();
    const seat = await seatOnSharedDevice({ shared, playerId: phone.player.id }, harness.deps);
    expect(seat).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const signIn = value(await linkAccount({ cognitoSub: BEN.cognitoSub }, harness.deps));
    expect(signIn.players.map((p) => p.displayName)).toEqual(["Gullet"]);
    const adopt = await adoptDevice(
      { cognitoSub: BEN.cognitoSub, householdId: group.id, playerId: phone.player.id },
      harness.deps,
    );
    expect(adopt).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    // Their name is free while they are away.
    value(await seatOnSharedDevice({ shared, newPlayer: "Rue" }, harness.deps));

    const back = value(
      await setProfileRetired({ ...ANA, householdId: group.id, playerId: phone.player.id, retired: false }, harness.deps),
    );
    expect(back.players.find((p) => p.id === phone.player.id)?.retired).toBe(false);
    expect((await harness.repo.getPlayer(group.id, phone.player.id))?.retired).toBeUndefined();
    expect(value(await listSharedPlayers(shared, harness.deps)).players.map((p) => p.displayName).sort()).toEqual([
      "Gullet",
      "Posy",
      "Rue",
    ]);
  });

  it("takes a retired kid out of a room they are already sitting in", async () => {
    const harness = makeHarness();
    const group = await twoOrganizers(harness);
    value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    value(await addProfile({ ...ANA, householdId: group.id, displayName: "Gullet" }, harness.deps));
    const tablet = value(await shareDevice({ cognitoSub: ANA.cognitoSub }, harness.deps));
    const shared = await harness.identity.resolveSharedDevice(tablet.sharedToken);
    if (!shared) throw new Error("tablet did not resolve");
    const faces = value(await listSharedPlayers(shared, harness.deps)).players;
    const room = value(await createRoom({ householdId: group.id, mode: "party" }, harness.deps));
    const sessions: Record<string, string> = {};
    for (const face of faces) {
      const seat = value(await seatOnSharedDevice({ shared, playerId: face.id }, harness.deps));
      sessions[face.displayName] = value(
        await joinRoom({ code: room.code, principal: seat, device: "tablet" }, harness.deps),
      ).sessionToken;
    }
    const posy = faces.find((f) => f.displayName === "Posy");
    if (!posy) throw new Error("no Posy");

    // Posy is seated, with a live session, when an organizer retires her.
    expect(await harness.identity.resolveSession(sessions.Posy ?? "")).toMatchObject({ playerId: posy.id });
    value(await setProfileRetired({ ...BEN, householdId: group.id, playerId: posy.id, retired: true }, harness.deps));

    const state = await harness.repo.getState(room.runId);
    expect(state?.removed).toEqual([posy.id]);
    expect(state?.party.find((m) => m.playerId === posy.id)?.connected ?? false).toBe(false);
    // Her session is refused at the room boundary: no move, no way back in.
    const move = await applyAction(
      { runId: room.runId, playerId: posy.id, seq: state?.seq ?? 0, intent: { type: "READY", ready: true } },
      harness.deps,
    );
    expect(move.error?.code).toBe("FORBIDDEN");
    const back = await joinRoom(
      { code: room.code, principal: { deviceId: shared.deviceId, householdId: group.id, playerId: posy.id } },
      harness.deps,
    );
    expect(back).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    // Gullet plays on.
    expect(state?.removed).not.toContain(faces.find((f) => f.displayName === "Gullet")?.id);

    // Retiring again finds nothing left to do, and says so quietly.
    value(await setProfileRetired({ ...ANA, householdId: group.id, playerId: posy.id, retired: true }, harness.deps));
    expect((await harness.repo.getState(room.runId))?.seq).toBe(state?.seq);
  });

  it("will not bring a kid back onto a name somebody took meanwhile", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    const first = value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    const posy = first.players[0]?.id;
    value(await setProfileRetired({ ...ANA, householdId: group.id, playerId: posy, retired: true }, harness.deps));
    value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    const back = await setProfileRetired({ ...ANA, householdId: group.id, playerId: posy, retired: false }, harness.deps);
    expect(back).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
  });
});

describe("organizer invites", () => {
  it("are spent by the first grown-up to use one", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    const invite = value(await createOrganizerInvite({ ...ANA, householdId: group.id }, harness.deps));
    expect(invite.code).toMatch(/^[A-Z]{10}$/);

    // Pasted the way it is shown, with a dash and in lower case.
    const typed = `${invite.code.slice(0, 5).toLowerCase()}-${invite.code.slice(5)}`;
    value(await acceptOrganizerInvite({ ...BEN, code: typed }, harness.deps));
    const again = await acceptOrganizerInvite({ ...EVE, code: invite.code }, harness.deps);
    expect(again).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await harness.repo.listHouseholdsForAccount(EVE.cognitoSub)).toEqual([]);
  });

  it("keep working when the write that redeems one fails", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    const invite = value(await createOrganizerInvite({ ...ANA, householdId: group.id }, harness.deps));

    // The redemption's one write fails on its way to the store.
    const redeem = vi.spyOn(harness.repo, "redeemOrganizerInvite").mockRejectedValueOnce(new Error("throttled"));
    await expect(acceptOrganizerInvite({ ...BEN, code: invite.code }, harness.deps)).rejects.toThrow("throttled");
    expect(await harness.repo.listHouseholdsForAccount(BEN.cognitoSub)).toEqual([]);

    // Ben taps Join again with the same code, and he is in.
    value(await acceptOrganizerInvite({ ...BEN, code: invite.code }, harness.deps));
    expect(redeem).toHaveBeenCalledTimes(2);
    expect(await harness.repo.listHouseholdsForAccount(BEN.cognitoSub)).toEqual([group.id]);
  });

  it("go dead after three days", async () => {
    const harness = makeHarness();
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    const invite = value(await createOrganizerInvite({ ...ANA, householdId: group.id }, harness.deps));
    harness.clock.advance(INVITE_TTL_MS + 1);
    const late = await acceptOrganizerInvite({ ...BEN, code: invite.code }, harness.deps);
    expect(late).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("put a group beside the account's own family, and the sign-in asks which", async () => {
    const harness = makeHarness();
    // Ben's own family: a first sign-in makes it, and binds his phone to it.
    const family = value(await linkAccount(BEN, harness.deps));
    const group = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));
    value(await addProfile({ ...ANA, householdId: group.id, displayName: "Posy" }, harness.deps));
    const invite = value(await createOrganizerInvite({ ...ANA, householdId: group.id }, harness.deps));
    value(await acceptOrganizerInvite({ ...BEN, code: invite.code }, harness.deps));

    const picked = value(await linkAccount({ ...BEN, householdId: group.id, preferExisting: true }, harness.deps));
    expect(picked.householdId).toBe(group.id);
    expect(picked.players.map((p) => p.displayName)).toEqual(["Posy"]);
    expect(picked.deviceBound).toBe(false);
    expect(picked.households.map((h) => h.id).sort()).toEqual([family.householdId, group.id].sort());

    // A household he does not own cannot be picked.
    const elsewhere = value(await createGroup({ ...EVE, displayName: "Eve's" }, harness.deps));
    const refused = await linkAccount({ ...BEN, householdId: elsewhere.id }, harness.deps);
    expect(refused).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("make a tablet ask which household it is for once there are two", async () => {
    const harness = makeHarness();
    value(await createGroup({ ...ANA, displayName: "Family" }, harness.deps));
    const club = value(await createGroup({ ...ANA, displayName: "Club" }, harness.deps));

    const unsure = await shareDevice({ cognitoSub: ANA.cognitoSub }, harness.deps);
    expect(unsure).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    const tablet = value(await shareDevice({ cognitoSub: ANA.cognitoSub, householdId: club.id }, harness.deps));
    expect(tablet.householdId).toBe(club.id);
    const foreign = await shareDevice({ cognitoSub: BEN.cognitoSub, householdId: club.id }, harness.deps);
    expect(foreign).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("count wrong codes against the account", async () => {
    const harness = makeHarness();
    for (let i = 0; i < 40; i++) {
      const miss = await acceptOrganizerInvite({ ...EVE, code: "ZZZZZZZZZZ" }, harness.deps);
      expect(miss).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
    const slowed = await acceptOrganizerInvite({ ...EVE, code: "ZZZZZZZZZZ" }, harness.deps);
    expect(slowed).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("normalize what was typed", () => {
    expect(normalizeInviteCode(" abcde-fghjk ")).toBe("ABCDEFGHJK");
  });
});

describe("taking an organizer off", () => {
  it("lets a co-organizer leave, or be taken off, but never the founding owner", async () => {
    const harness = makeHarness();
    const group = await twoOrganizers(harness);

    const founder = await removeOrganizer({ ...BEN, householdId: group.id, ownerId: ANA.cognitoSub }, harness.deps);
    expect(founder).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });

    expect(value(await removeOrganizer({ ...BEN, householdId: group.id, ownerId: BEN.cognitoSub }, harness.deps))).toEqual(
      { householdId: group.id, left: true },
    );
    expect(await harness.repo.listHouseholdsForAccount(BEN.cognitoSub)).toEqual([]);
    const gone = await viewHousehold({ ...BEN, householdId: group.id }, harness.deps);
    expect(gone).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    // Back with a new code, then taken off by the founder.
    const invite = value(await createOrganizerInvite({ ...ANA, householdId: group.id }, harness.deps));
    value(await acceptOrganizerInvite({ ...BEN, code: invite.code }, harness.deps));
    value(await removeOrganizer({ ...ANA, householdId: group.id, ownerId: BEN.cognitoSub }, harness.deps));
    expect(value(await viewHousehold({ ...ANA, householdId: group.id }, harness.deps)).owners.map((o) => o.id)).toEqual([
      ANA.cognitoSub,
    ]);
  });

  it("lists a founding owner from before #248, who has no owner row", async () => {
    const harness = makeHarness();
    // A family kept the old way: ownerSub and a pointer, nothing else.
    await harness.repo.putHousehold({
      id: "h_old",
      displayName: "Old family",
      ownerSub: ANA.cognitoSub,
      guest: false,
      createdAt: new Date(harness.clock.now()).toISOString(),
    });
    await harness.repo.putAccountPointer(ANA.cognitoSub, "h_old");
    const invite = value(await createOrganizerInvite({ ...ANA, householdId: "h_old" }, harness.deps));
    value(await acceptOrganizerInvite({ ...BEN, code: invite.code }, harness.deps));

    // Ben looks first: Ana is listed from `ownerSub`, without an email.
    const view = value(await viewHousehold({ ...BEN, householdId: "h_old" }, harness.deps));
    expect(view.owners).toEqual([
      { id: ANA.cognitoSub, you: false, founding: true },
      { id: BEN.cognitoSub, email: BEN.email, you: true, founding: false },
    ]);
    // Once Ana has looked, she has a row with her email.
    value(await viewHousehold({ ...ANA, householdId: "h_old" }, harness.deps));
    const after = value(await viewHousehold({ ...BEN, householdId: "h_old" }, harness.deps));
    expect(after.owners[0]).toEqual({ id: ANA.cognitoSub, email: ANA.email, you: false, founding: true });
  });
});
