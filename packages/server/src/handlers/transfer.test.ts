/**
 * Take your hero home (#251), through the handlers with the real engine: a
 * kid plays at a club, a grown-up there makes her a move code, her mum signs
 * in at home and redeems it, and she picks up where she left off on the same
 * phone. Then everything that has to say no.
 */

import { describe, expect, it } from "vitest";
import { applyIntent, awardXp, createRunState } from "@kad/shared";
import type { ClientIntent, RunState } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeHarness, type TestHarness } from "../test-support.ts";
import { addPlayer } from "./account.ts";
import { applyAction } from "./action.ts";
import { CODE_MISS_LIMIT } from "./code-guard.ts";
import type { HandlerResult } from "./deps.ts";
import { addProfile, createGroup, setProfileRetired, viewHousehold } from "./organizer.ts";
import { isOut } from "./remove.ts";
import { createRoom, joinRoom } from "./room.ts";
import { shareDevice } from "./shared-device.ts";
import { acceptTransfer, createTransferCode, TRANSFER_TTL_MS } from "./transfer.ts";

const realEngine: Engine = { applyIntent, createRunState };

const LEADER = { cognitoSub: "sub_leader", email: "leader@example.com" };
const MUM = { cognitoSub: "sub_mum", email: "mum@example.com" };
const EVE = { cognitoSub: "sub_eve", email: "eve@example.com" };

function value<T>(result: HandlerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** A room in `householdId` with the given phones seated, and a way to act in it. */
async function room(harness: TestHarness, householdId: string, principal: Parameters<typeof joinRoom>[0]["principal"]) {
  const created = value(await createRoom({ householdId, mode: "travel" }, harness.deps));
  const joined = value(await joinRoom({ code: created.code, principal }, harness.deps));
  const state = async (): Promise<RunState> => (await harness.repo.getState(created.runId))!;
  const send = async (intent: ClientIntent) =>
    applyAction({ runId: created.runId, playerId: joined.playerId, seq: (await state()).seq, intent }, harness.deps);
  return { ...created, state, send };
}

/** The club, with Ada on her own phone and a hero she has played to level 3. */
async function adaAtTheClub() {
  const harness = makeHarness({ engine: realEngine });
  const club = value(await createGroup({ ...LEADER, displayName: "Dragon Club" }, harness.deps));
  const ada = await addPlayer({ householdId: club.id, displayName: "Ada" }, harness.deps);
  value(await addProfile({ ...LEADER, householdId: club.id, displayName: "Bo" }, harness.deps));

  const evening = await room(harness, club.id, ada.principal);
  const made = await evening.send({
    type: "CREATE_CHARACTER",
    name: "Sparklehoof",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: { palette: "meadow", accent: "#7FD4C1" },
  });
  expect(made.ok).toBe(true);
  // Three levels of chapters, folded the way a chapter's end folds them.
  const [hero] = await harness.repo.listCharacters(club.id);
  if (!hero) throw new Error("no hero");
  let levelled = hero;
  while (levelled.committed.level < 3) levelled = awardXp(levelled, harness.deps.content.rules(), 25).character;
  await harness.repo.putCharacter(levelled);
  await harness.repo.recordDiscoveries(club.id, [{ canonId: "moth", playerId: ada.player.id, runId: evening.runId }]);

  return { harness, club, ada, hero: levelled, evening };
}

describe("taking a hero home (#251)", () => {
  it("moves a level 3 hero into a new home, where she carries on, and is gone from the club", async () => {
    const { harness, club, ada, evening } = await adaAtTheClub();
    const code = value(await createTransferCode({ ...LEADER, householdId: club.id, playerId: ada.player.id }, harness.deps));
    expect(code).toMatchObject({ playerId: ada.player.id, displayName: "Ada" });
    expect(code.code).toMatch(/^[A-Z]{10}$/);

    // Her mum has never signed in before: she has no household at all.
    const moved = value(await acceptTransfer({ ...MUM, code: code.code }, harness.deps));
    expect(moved).toMatchObject({ playerId: ada.player.id, displayName: "Ada", heroes: 1 });
    expect(moved.household).toMatchObject({ displayName: "Ada's household", players: 1 });
    const home = moved.household.id;

    // Gone from the club. Bo, and the club's save, stay.
    const left = value(await viewHousehold({ ...LEADER, householdId: club.id }, harness.deps));
    expect(left.players.map((p) => p.displayName)).toEqual(["Bo"]);
    expect(await harness.repo.listCharacters(club.id)).toEqual([]);
    expect(await harness.repo.getRun(evening.runId)).toMatchObject({ householdId: club.id });
    // She was still seated in the club's room; she is out of it now.
    expect(await isOut(await evening.state(), ada.player.id, club.id, harness.repo)).toBe(true);

    // Her phone, holding the token it was given at the club, is still her.
    const phone = await harness.identity.resolveDevice(ada.deviceToken);
    expect(phone).toMatchObject({ householdId: home, playerId: ada.player.id });

    // She opens a game at home and seats the same hero, at level 3.
    const tonight = await room(harness, home, phone!);
    const [hero] = await harness.repo.listCharacters(home);
    expect(hero).toMatchObject({ name: "Sparklehoof", householdId: home, committed: { level: 3 } });
    expect((await tonight.send({ type: "SEAT_CHARACTER", characterId: hero!.id })).ok).toBe(true);
    expect((await tonight.state()).party[0]?.character).toMatchObject({ name: "Sparklehoof", level: 3 });
    expect(Object.keys((await harness.repo.getFieldGuide(home)).entries)).toEqual(["moth"]);
  });

  it("works once", async () => {
    const { harness, club, ada } = await adaAtTheClub();
    const code = value(await createTransferCode({ ...LEADER, householdId: club.id, playerId: ada.player.id }, harness.deps));
    value(await acceptTransfer({ ...MUM, code: code.code }, harness.deps));
    const again = await acceptTransfer({ ...EVE, code: code.code }, harness.deps);
    expect(again).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await harness.repo.listHouseholdsForAccount(EVE.cognitoSub)).toEqual([]);
  });

  it("goes dead after a day", async () => {
    const { harness, club, ada } = await adaAtTheClub();
    const code = value(await createTransferCode({ ...LEADER, householdId: club.id, playerId: ada.player.id }, harness.deps));
    harness.clock.advance(TRANSFER_TTL_MS + 1);
    expect(await acceptTransfer({ ...MUM, code: code.code }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await harness.repo.getPlayer(club.id, ada.player.id)).not.toBeNull();
  });

  it("is made only by an owner of her home, and counts wrong codes against the account", async () => {
    const { harness, club, ada } = await adaAtTheClub();
    expect(await createTransferCode({ ...EVE, householdId: club.id, playerId: ada.player.id }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });

    const code = value(await createTransferCode({ ...LEADER, householdId: club.id, playerId: ada.player.id }, harness.deps));
    for (let i = 0; i < CODE_MISS_LIMIT; i++) {
      const letter = (n: number) => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(n) % 24];
      const miss = await acceptTransfer({ ...EVE, code: `WRONGCOD${letter(i)}${letter(i / 24)}` }, harness.deps);
      expect(miss).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
    // Even the right code is refused now, so guessing cannot find it.
    expect(await acceptTransfer({ ...EVE, code: code.code }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    // Somebody else's misses are not hers.
    value(await acceptTransfer({ ...MUM, code: code.code }, harness.deps));
  });

  it("moves her into a home the redeemer already owns, and only one they own", async () => {
    const { harness, club, ada } = await adaAtTheClub();
    const home = value(await createGroup({ ...MUM, displayName: "Our house" }, harness.deps));
    value(await addProfile({ ...MUM, householdId: home.id, displayName: "Rue" }, harness.deps));
    const code = value(await createTransferCode({ ...LEADER, householdId: club.id, playerId: ada.player.id }, harness.deps));

    expect(await acceptTransfer({ ...EVE, code: code.code, householdId: home.id }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await acceptTransfer({ ...LEADER, code: code.code, householdId: club.id }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL" },
    });

    const moved = value(await acceptTransfer({ ...MUM, code: code.code, householdId: home.id }, harness.deps));
    expect(moved.household).toEqual({ id: home.id, displayName: "Our house", players: 2 });
    expect(await harness.repo.listHouseholdsForAccount(MUM.cognitoSub)).toEqual([home.id]);
    const view = value(await viewHousehold({ ...MUM, householdId: home.id }, harness.deps));
    expect(view.players.find((p) => p.displayName === "Ada")?.heroes).toMatchObject([{ name: "Sparklehoof", level: 3 }]);
  });

  it("will not put two kids with one name on a picker", async () => {
    const { harness, club, ada } = await adaAtTheClub();
    const home = value(await createGroup({ ...MUM, displayName: "Our house" }, harness.deps));
    value(await addProfile({ ...MUM, householdId: home.id, displayName: "ada" }, harness.deps));
    const code = value(await createTransferCode({ ...LEADER, householdId: club.id, playerId: ada.player.id }, harness.deps));
    expect(await acceptTransfer({ ...MUM, code: code.code, householdId: home.id }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL", message: expect.stringMatching(/already here/) },
    });
    // The code still works, into a new home.
    value(await acceptTransfer({ ...MUM, code: code.code }, harness.deps));
  });

  it("refuses to move a hero in the middle of an adventure", async () => {
    const { harness, club, ada, hero } = await adaAtTheClub();
    const code = value(await createTransferCode({ ...LEADER, householdId: club.id, playerId: ada.player.id }, harness.deps));

    // The club starts a campaign and she is in it: her gains are provisional.
    await harness.repo.putCharacter({ ...hero, provisional: { ...hero.committed, runId: "gemfall" } });
    await harness.repo.putCampaignProgress({
      householdId: club.id,
      campaignId: "gemfall",
      status: "active",
      setbacks: 0,
      updatedAt: new Date(harness.clock.now()).toISOString(),
    });
    const busy = { ok: false, error: { code: "ILLEGAL", message: expect.stringMatching(/middle of an adventure/) } };
    expect(await createTransferCode({ ...LEADER, householdId: club.id, playerId: ada.player.id }, harness.deps)).toMatchObject(busy);
    expect(await acceptTransfer({ ...MUM, code: code.code }, harness.deps)).toMatchObject(busy);
    expect(await harness.repo.getPlayer(club.id, ada.player.id)).not.toBeNull();

    // The campaign ends, and she can go.
    await harness.repo.putCampaignProgress({
      householdId: club.id,
      campaignId: "gemfall",
      status: "complete",
      setbacks: 0,
      updatedAt: new Date(harness.clock.now()).toISOString(),
    });
    value(await acceptTransfer({ ...MUM, code: code.code }, harness.deps));
  });

  it("leaves the club's tablet behind, and brings a kid who was taken off the list back onto one", async () => {
    const { harness, club, ada } = await adaAtTheClub();
    const tablet = value(await shareDevice({ cognitoSub: LEADER.cognitoSub }, harness.deps));
    value(await setProfileRetired({ ...LEADER, householdId: club.id, playerId: ada.player.id, retired: true }, harness.deps));
    const code = value(await createTransferCode({ ...LEADER, householdId: club.id, playerId: ada.player.id }, harness.deps));

    const moved = value(await acceptTransfer({ ...MUM, code: code.code }, harness.deps));
    expect(await harness.identity.resolveSharedDevice(tablet.sharedToken)).toMatchObject({ householdId: club.id });
    expect((await harness.repo.getPlayer(moved.household.id, ada.player.id))?.retired).toBeUndefined();
    // Retiring revoked her phone, and a revoked phone does not come back by moving.
    expect(await harness.identity.resolveDevice(ada.deviceToken)).toBeNull();
    expect(await harness.repo.listDevices(moved.household.id)).toEqual([]);
  });
});
