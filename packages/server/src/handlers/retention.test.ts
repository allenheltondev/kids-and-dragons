/**
 * Deleting and keeping (#252, architecture §4.5 "Deleting and keeping"),
 * through the organizer routes, the joins and the sweep.
 *
 * The store's half (every row under a household goes, the marks, the gates)
 * is the contract suite's (store/contract.test.ts). This is the game's half:
 * who may delete what, what another table's save keeps, and a hero
 * mid-adventure.
 */

import path from "node:path";
import { applyIntent, createRunState, FORGOTTEN_FINDER, makeRng, type Character, type ClientIntent, type RunState } from "@kad/shared";
import { describe, expect, it, vi } from "vitest";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { sweep } from "../lambda/sweep.ts";
import { makeHarness, type TestHarness } from "../test-support.ts";
import { createGuestHousehold, linkAccount } from "./account.ts";
import { applyAction } from "./action.ts";
import type { AccountDirectory, HandlerResult } from "./deps.ts";
import {
  acceptOrganizerInvite,
  addProfile,
  createGroup,
  createOrganizerInvite,
  deleteHousehold,
  deleteProfile,
  removeOrganizer,
  setHouseholdRetention,
  viewHousehold,
} from "./organizer.ts";
import { FORGOTTEN_NAME, forgetPlayer, scrubNames } from "./retention.ts";
import { createRoom, joinRoom } from "./room.ts";
import { setVisitors } from "./visitors.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };
const DAY = 24 * 60 * 60 * 1000;
const GEMFALL = "gemfall";

function value<T>(result: HandlerResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/** A sign-in store that only records which sign-ins it was asked to delete (#524). */
function directory(): AccountDirectory & { deleted: string[] } {
  const deleted: string[] = [];
  return { deleted, deleteAccount: async (sub) => void deleted.push(sub) };
}

function harness(): TestHarness {
  const h = makeHarness({ engine: realEngine, playtest: true, content });
  h.deps.rng = (key) => makeRng(`retention:${String(key).split(":").pop()}`);
  return h;
}

/** A kept home with one kid on her own phone, owned by `sub_<id>`. */
async function homeOf(h: TestHarness, id: string, name: string) {
  await h.repo.putHousehold({ id, displayName: id, ownerSub: `sub_${id}`, guest: false, createdAt: new Date(h.clock.now()).toISOString() });
  await h.repo.putAccountPointer(`sub_${id}`, id);
  const playerId = `p_${id}`;
  await h.repo.putPlayer({ id: playerId, householdId: id, displayName: name, color: "#E8A33D" });
  const { deviceId } = await h.identity.issueDeviceToken({ householdId: id, playerId });
  return { deviceId, householdId: id, playerId, owner: { cognitoSub: `sub_${id}` } };
}

type Home = Awaited<ReturnType<typeof homeOf>>;

/** `visitor` at `table`'s room, open to visitors, each on a new hero. */
async function visit(h: TestHarness, table: Home, visitor: Home) {
  const created = value(
    await createRoom({ householdId: table.householdId, mode: "travel", hostDeviceId: table.deviceId, campaignId: GEMFALL }, h.deps),
  );
  value(await joinRoom({ code: created.code, principal: table }, h.deps));
  const opened = value(await setVisitors({ ...table.owner, code: created.code, open: true }, h.deps));
  value(await joinRoom({ code: created.code, principal: visitor, visitorCode: opened.visitorCode }, h.deps));
  const state = async (): Promise<RunState> => (await h.repo.getState(created.runId))!;
  const act = async (who: Home, intent: ClientIntent) =>
    applyAction({ runId: created.runId, playerId: who.playerId, seq: (await state()).seq, intent, principal: who }, h.deps);
  for (const who of [table, visitor]) {
    expect(
      await act(who, {
        type: "CREATE_CHARACTER",
        name: `Hero of ${who.householdId}`,
        species: "unicorn",
        class: "thornguard",
        stats: { might: 1, quick: 1, clever: 0, heart: 1 },
      }),
    ).toMatchObject({ ok: true });
  }
  return { ...created, state };
}

/** Her hero, claimed by `table`'s Gemfall attempt, which is still being played. */
async function midAdventure(h: TestHarness, kid: Home, table: string): Promise<Character> {
  const [hero] = (await h.repo.listCharacters(kid.householdId)).filter((c) => c.ownerPlayerId === kid.playerId);
  if (!hero) throw new Error("no hero");
  const claim = table === kid.householdId ? GEMFALL : `${GEMFALL}@${table}`;
  const claimed: Character = {
    ...hero,
    provisional: { ...hero.committed, runId: claim, xp: hero.committed.xp + 5 },
  } as Character;
  await h.repo.putCharacter(claimed);
  await h.repo.putCampaignProgress({
    householdId: table,
    campaignId: GEMFALL,
    status: "active",
    setbacks: 0,
    updatedAt: new Date(h.clock.now()).toISOString(),
  });
  return claimed;
}

describe("deleting a kid (#252)", () => {
  it("removes her from her home and takes her name out of the other tables she played at", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    const room = await visit(h, rue, ada);
    expect(await h.repo.listVisits(ada.playerId)).toEqual(["h_rue"]);
    const before = await room.state();
    expect(before.seats?.[ada.playerId]?.name).toBe("Ada");

    const view = value(await deleteProfile({ ...ada.owner, householdId: ada.householdId, playerId: ada.playerId }, h.deps));

    expect(view.players).toEqual([]);
    expect(await h.repo.listCharacters(ada.householdId)).toEqual([]);
    expect(await h.repo.getDevice(ada.householdId, ada.deviceId)).toBeNull();
    expect(await h.repo.listVisits(ada.playerId)).toEqual([]);
    // Rue's save is Rue's, and stays. It no longer names Ada.
    const after = await room.state();
    expect(after.seats?.[ada.playerId]).toBeUndefined();
    expect(after.party.map((m) => m.playerId)).toEqual([rue.playerId]);
    expect(after.removed).toContain(ada.playerId);
    expect(JSON.stringify(after)).not.toContain("Hero of h_ada");
    expect(after.seq).toBe(before.seq + 1);
    // Rue's own kid and hero are untouched.
    expect(await h.repo.getPlayer(rue.householdId, rue.playerId)).not.toBeNull();
    expect(await h.repo.listCharacters(rue.householdId)).toHaveLength(1);
  });

  it("wins over an adventure in flight: the table plays on without her", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    const room = await visit(h, rue, ada);
    const hero = await midAdventure(h, ada, rue.householdId);

    value(await deleteProfile({ ...ada.owner, householdId: ada.householdId, playerId: ada.playerId }, h.deps));

    expect(await h.repo.getCharacter(ada.householdId, hero.id)).toBeNull();
    expect(await h.repo.getPlayer(ada.householdId, ada.playerId)).toBeNull();
    // Rue's attempt is Rue's, and goes on.
    expect((await h.repo.getCampaignProgress(rue.householdId, GEMFALL))?.status).toBe("active");
    expect(JSON.stringify(await room.state())).not.toContain(hero.name);
  });

  it("takes her names out of the table's event log and its Field Guide", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    const room = await visit(h, rue, ada);
    await h.repo.recordDiscoveries(rue.householdId, [
      { canonId: "lore.a", playerId: ada.playerId },
      { canonId: "lore.b", playerId: rue.playerId },
    ]);
    await h.repo.recordDiscoveries(ada.householdId, [{ canonId: "lore.a", playerId: ada.playerId }]);
    const log = JSON.stringify(await h.repo.listEvents(room.runId, 0));
    expect(log).toContain("Hero of h_ada");
    const seqs = (await h.repo.listEvents(room.runId, 0)).map((e) => e.seq);

    value(await deleteProfile({ ...ada.owner, householdId: ada.householdId, playerId: ada.playerId }, h.deps));

    const events = await h.repo.listEvents(room.runId, 0);
    expect(JSON.stringify(events)).not.toContain("Hero of h_ada");
    expect(JSON.stringify(events)).not.toMatch(/"name":"Ada"/);
    // Rewritten in place: the same seqs, and one more for the forgetting.
    expect(events.map((e) => e.seq)).toEqual([...seqs, seqs[seqs.length - 1]! + 1]);
    expect(JSON.stringify(events)).toContain("Hero of h_rue");
    const book = await h.repo.getFieldGuide(rue.householdId);
    expect(book.entries["lore.a"]?.firstFoundBy).toBe(FORGOTTEN_FINDER);
    expect(book.entries["lore.b"]?.firstFoundBy).toBe(rue.playerId);
    // Her home's book is her home's: the entry stays, and names nobody.
    expect((await h.repo.getFieldGuide(ada.householdId)).entries["lore.a"]?.firstFoundBy).toBe(FORGOTTEN_FINDER);
  });

  it("finds a table from a campaign she finished there, with no visit written down (#283)", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    await h.repo.putCharacter({
      id: "c_ada",
      householdId: ada.householdId,
      ownerPlayerId: ada.playerId,
      name: "Sparklehoof",
      species: "unicorn",
      appearance: { palette: "meadow", accent: "#7FD4C1" },
      committed: {
        level: 2,
        xp: 30,
        stats: { might: 1, quick: 2, clever: 2, heart: 4 },
        tier: "fledgling",
        class: "songkeeper",
        mastery: {},
        inventory: [],
      },
      questItems: [],
      souvenirs: [],
      finished: [{ campaignId: GEMFALL, outcome: "success", at: new Date(h.clock.now()).toISOString(), table: rue.householdId }],
      createdAt: new Date(h.clock.now()).toISOString(),
    } as Character);
    await h.repo.recordDiscoveries(rue.householdId, [{ canonId: "lore.a", playerId: ada.playerId }]);
    expect(await h.repo.listVisits(ada.playerId)).toEqual([]);

    value(await deleteProfile({ ...ada.owner, householdId: ada.householdId, playerId: ada.playerId }, h.deps));

    expect((await h.repo.getFieldGuide(rue.householdId)).entries["lore.a"]?.firstFoundBy).toBe(FORGOTTEN_FINDER);
  });

  it("is only her household's owners' to do", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    const stranger = await deleteProfile({ ...rue.owner, householdId: ada.householdId, playerId: ada.playerId }, h.deps);
    expect(stranger).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    // Naming her through a household she does not live in finds nobody.
    const elsewhere = await deleteProfile({ ...rue.owner, householdId: rue.householdId, playerId: ada.playerId }, h.deps);
    expect(elsewhere).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await h.repo.getPlayer(ada.householdId, ada.playerId)).not.toBeNull();
  });

  it("turns her phone away from the room she was in", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    const room = await visit(h, rue, ada);
    value(await deleteProfile({ ...ada.owner, householdId: ada.householdId, playerId: ada.playerId }, h.deps));
    const again = await joinRoom({ code: room.code, principal: ada }, h.deps);
    expect(again.ok).toBe(false);
  });
});

describe("deleting a household (#252)", () => {
  it("is refused while another grown-up also runs it, and allowed once they are off", async () => {
    const h = harness();
    const ana = { cognitoSub: "sub_ana", email: "ana@example.com" };
    const ben = { cognitoSub: "sub_ben", email: "ben@example.com" };
    const group = value(await createGroup({ ...ana, displayName: "Club" }, h.deps));
    const invite = value(await createOrganizerInvite({ ...ana, householdId: group.id }, h.deps));
    value(await acceptOrganizerInvite({ ...ben, code: invite.code }, h.deps));

    for (const who of [ana, ben]) {
      const refused = await deleteHousehold({ ...who, householdId: group.id }, h.deps);
      expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    }
    expect(await h.repo.getHousehold(group.id)).not.toBeNull();

    value(await removeOrganizer({ ...ana, householdId: group.id, ownerId: ben.cognitoSub }, h.deps));
    const deleted = value(await deleteHousehold({ ...ana, householdId: group.id }, h.deps));
    expect(deleted).toEqual({ householdId: group.id, households: [] });
    expect(await h.repo.getHousehold(group.id)).toBeNull();
    expect(await h.repo.listHouseholdsForAccount(ana.cognitoSub)).toEqual([]);
  });

  it("deletes its saves and its own kids, and leaves a visiting kid's hero at her home", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    const room = await visit(h, rue, ada);

    value(await deleteHousehold({ ...rue.owner, householdId: rue.householdId }, h.deps));

    expect(await h.repo.getState(room.runId)).toBeNull();
    expect(await h.repo.getRoom(room.code)).toBeNull();
    expect(await h.repo.listCharacters(rue.householdId)).toEqual([]);
    // Ada's hero went home with everything it had; it never lived at Rue's.
    expect(await h.repo.listCharacters(ada.householdId)).toHaveLength(1);
    expect(await h.repo.getPlayer(ada.householdId, ada.playerId)).not.toBeNull();
  });

  it("takes its kids' names out of the tables they visited", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    const room = await visit(h, rue, ada);

    value(await deleteHousehold({ ...ada.owner, householdId: ada.householdId }, h.deps));

    const after = await room.state();
    expect(after.seats?.[ada.playerId]).toBeUndefined();
    expect(after.party.map((m) => m.playerId)).toEqual([rue.playerId]);
    expect(await h.repo.listVisits(ada.playerId)).toEqual([]);
  });

  it("goes through while one of its kids' heroes is mid-adventure at another table", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    const room = await visit(h, rue, ada);
    const hero = await midAdventure(h, ada, rue.householdId);

    value(await deleteHousehold({ ...ada.owner, householdId: ada.householdId }, h.deps));
    expect(await h.repo.getHousehold(ada.householdId)).toBeNull();
    expect(JSON.stringify(await room.state())).not.toContain(hero.name);
    expect(JSON.stringify(await h.repo.listEvents(room.runId, 0))).not.toContain(hero.name);
  });

  it("is not stopped by its own table's adventure, which goes with it", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    await visit(h, ada, rue);
    await midAdventure(h, ada, ada.householdId);
    // Rue is mid-adventure at Ada's table: the attempt goes, so Rue is free.
    const rueHero = await midAdventure(h, rue, ada.householdId);

    value(await deleteHousehold({ ...ada.owner, householdId: ada.householdId }, h.deps));
    expect(await h.repo.getCampaignProgress(ada.householdId, GEMFALL)).toBeNull();
    expect((await h.repo.getCharacter(rue.householdId, rueHero.id))?.provisional?.runId).toBe(`${GEMFALL}@${ada.householdId}`);
  });
});

describe("retention (#252, #524)", () => {
  it("keeps a kid a year by default, takes only the windows offered, and has no 'until deleted'", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    expect(value(await viewHousehold({ ...ada.owner, householdId: ada.householdId }, h.deps)).retentionDays).toBe(365);
    for (const odd of [7, null, "forever", undefined]) {
      const refused = await setHouseholdRetention({ ...ada.owner, householdId: ada.householdId, retentionDays: odd }, h.deps);
      expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    }
    const set = value(await setHouseholdRetention({ ...ada.owner, householdId: ada.householdId, retentionDays: 30 }, h.deps));
    expect(set.retentionDays).toBe(30);
    expect(await h.repo.getHousehold(ada.householdId)).toMatchObject({ retentionDays: 30 });
  });

  it("forgets a kid a year after she last played when nobody chose a window", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const home = value(await createRoom({ householdId: ada.householdId, mode: "party" }, h.deps));
    value(await joinRoom({ code: home.code, principal: ada }, h.deps));

    h.clock.advance(364 * DAY);
    expect((await sweep(h.repo, () => h.clock.now())).idle.deleted).toEqual([]);
    h.clock.advance(2 * DAY);
    expect((await sweep(h.repo, () => h.clock.now())).idle.deleted).toEqual([ada.playerId]);
    expect(await h.repo.getPlayer(ada.householdId, ada.playerId)).toBeNull();
  });

  it("counts a kid an owner added and nobody played as from when she was added", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const view = value(await addProfile({ ...ada.owner, householdId: ada.householdId, displayName: "Bo" }, h.deps));
    const bo = view.players.find((p) => p.displayName === "Bo")!;

    h.clock.advance(366 * DAY);
    const swept = await sweep(h.repo, () => h.clock.now());
    expect(swept.idle.deleted).toEqual([bo.id]);
    // Ada was never on the clock in this fixture (no play, no window set), so the household stays.
    expect(swept.idle.households).toEqual([]);
    expect(await h.repo.getHousehold(ada.householdId)).not.toBeNull();
  });

  it("puts a guest household's kids on the clock the moment it is kept", async () => {
    const h = harness();
    const guest = await createGuestHousehold({ displayName: "Allen" }, h.deps);
    const claimed = value(await linkAccount({ cognitoSub: "sub_allen", principal: guest.principal }, h.deps));
    expect(claimed.claimed).toBe(true);

    h.clock.advance(366 * DAY);
    const accounts = directory();
    const swept = await sweep(h.repo, () => h.clock.now(), accounts);
    expect(swept.idle.deleted).toEqual([guest.principal.playerId]);
    // Its only kid gone, the household goes too, and its owner had no other.
    expect(swept.idle.households).toEqual([guest.household.id]);
    expect(await h.repo.getHousehold(guest.household.id)).toBeNull();
    expect(accounts.deleted).toEqual(["sub_allen"]);
  });

  it("deletes a kept household its last kid leaves, and only the sign-ins with nothing else", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    // Ada's grown-up also runs a second group, which keeps their sign-in.
    await h.repo.putHousehold({ id: "h_club", displayName: "Club", ownerSub: ada.owner.cognitoSub, guest: false, createdAt: new Date(h.clock.now()).toISOString() });
    await h.repo.putAccountPointer(ada.owner.cognitoSub, "h_club");
    for (const home of [ada, rue]) {
      value(await setHouseholdRetention({ ...home.owner, householdId: home.householdId, retentionDays: 30 }, h.deps));
    }

    h.clock.advance(31 * DAY);
    const accounts = directory();
    const swept = await sweep(h.repo, () => h.clock.now(), accounts);
    expect([...swept.idle.deleted].sort()).toEqual([ada.playerId, rue.playerId].sort());
    expect([...swept.idle.households].sort()).toEqual([ada.householdId, rue.householdId].sort());
    expect(await h.repo.getHousehold(ada.householdId)).toBeNull();
    expect(await h.repo.getHousehold(rue.householdId)).toBeNull();
    expect(await h.repo.getHousehold("h_club")).not.toBeNull();
    expect(await h.repo.listHouseholdsForAccount(ada.owner.cognitoSub)).toEqual(["h_club"]);
    expect(accounts.deleted).toEqual([rue.owner.cognitoSub]);
    expect(swept.idle.accounts).toBe(1);
  });

  it("deletes the household but keeps going when a sign-in cannot be deleted", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    value(await setHouseholdRetention({ ...ada.owner, householdId: ada.householdId, retentionDays: 30 }, h.deps));
    h.clock.advance(31 * DAY);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = { deleteAccount: vi.fn(async () => Promise.reject(new Error("throttled"))) };
    const swept = await sweep(h.repo, () => h.clock.now(), failing);
    expect(swept.idle.households).toEqual([ada.householdId]);
    expect(swept.idle.accounts).toBe(0);
    expect(swept.idle.failed).toEqual([]);
    expect(failing.deleteAccount).toHaveBeenCalledWith(ada.owner.cognitoSub);
    error.mockRestore();
  });

  it("never deletes a sign-in when an owner deletes a household themselves", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    value(await deleteHousehold({ ...ada.owner, householdId: ada.householdId }, h.deps));
    const accounts = directory();
    await sweep(h.repo, () => h.clock.now(), accounts);
    expect(accounts.deleted).toEqual([]);
  });

  it("forgets a kid who has not played for the window, and spares one who has", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    await h.repo.putPlayer({ id: "p_bo", householdId: ada.householdId, displayName: "Bo", color: "#7FD4C1" });
    const room = await visit(h, rue, ada);
    value(await setHouseholdRetention({ ...ada.owner, householdId: ada.householdId, retentionDays: 30 }, h.deps));

    // Twenty days on, Bo plays at home; Ada does not.
    h.clock.advance(20 * DAY);
    const home = value(await createRoom({ householdId: ada.householdId, mode: "party" }, h.deps));
    const { deviceId } = await h.identity.issueDeviceToken({ householdId: ada.householdId, playerId: "p_bo" });
    value(await joinRoom({ code: home.code, principal: { deviceId, householdId: ada.householdId, playerId: "p_bo" } }, h.deps));

    h.clock.advance(15 * DAY);
    const swept = await sweep(h.repo, () => h.clock.now());
    expect(swept.idle.deleted).toEqual([ada.playerId]);
    expect(await h.repo.getPlayer(ada.householdId, ada.playerId)).toBeNull();
    expect(await h.repo.listCharacters(ada.householdId)).toEqual([]);
    expect((await room.state()).seats?.[ada.playerId]).toBeUndefined();
    expect(await h.repo.getPlayer(ada.householdId, "p_bo")).not.toBeNull();

    // Bo is still here, so Ada going did not take the household.
    expect(swept.idle.households).toEqual([]);
    expect(await h.repo.getHousehold(ada.householdId)).not.toBeNull();

    // There is no window that keeps Bo forever (#524): the longest is a year.
    value(await setHouseholdRetention({ ...ada.owner, householdId: ada.householdId, retentionDays: 365 }, h.deps));
    h.clock.advance(400 * DAY);
    const later = await sweep(h.repo, () => h.clock.now());
    expect(later.idle.deleted).toContain("p_bo");
    expect(later.idle.households).toContain(ada.householdId);
  });

  it("re-reads the household's window rather than trust the index", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    value(await setHouseholdRetention({ ...ada.owner, householdId: ada.householdId, retentionDays: 30 }, h.deps));
    // Lengthened behind the index's back (an older build, a hand edit).
    const household = (await h.repo.getHousehold(ada.householdId))!;
    await h.repo.putHousehold({ ...household, retentionDays: 365 });

    h.clock.advance(31 * DAY);
    const swept = await sweep(h.repo, () => h.clock.now());
    expect(swept.idle).toMatchObject({ deleted: [], kept: [ada.playerId] });
    expect(await h.repo.getPlayer(ada.householdId, ada.playerId)).not.toBeNull();
    h.clock.advance(335 * DAY);
    expect((await sweep(h.repo, () => h.clock.now())).idle.deleted).toEqual([ada.playerId]);
  });
});

describe("the event log expires (#524)", () => {
  it("drops each event 30 days after it is written, keeps the save, and a forget's rewrite keeps the date", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    const rue = await homeOf(h, "h_rue", "Rue");
    const room = await visit(h, rue, ada);
    const before = await room.state();
    expect((await h.repo.listEvents(room.runId, 0)).length).toBeGreaterThan(0);

    // Day 20: deleting Ada rewrites the old events and commits a new one.
    h.clock.advance(20 * DAY);
    value(await deleteProfile({ ...ada.owner, householdId: ada.householdId, playerId: ada.playerId }, h.deps));

    // Day 31: the events from day 0 are gone, rewritten or not; day 20's is not.
    h.clock.advance(11 * DAY);
    const left = await h.repo.listEvents(room.runId, 0);
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((e) => e.seq > before.seq)).toBe(true);

    // Day 61: none left, and the saved game is untouched.
    h.clock.advance(30 * DAY);
    expect(await h.repo.listEvents(room.runId, 0)).toEqual([]);
    expect((await room.state()).seq).toBeGreaterThan(before.seq);
  });
});

describe("forgetPlayer", () => {
  const kid = { playerId: "p_1", nicknames: ["Ada"], heroes: ["Sparklehoof"] };

  it("keeps a hero in a party past the lobby, as somebody nobody can name", () => {
    const state = {
      phase: "scene",
      sceneId: "sparklehoof-gate",
      narration: "Sparklehoof and Pip reach the gate. Sparklehoofish is not a word.",
      party: [
        { playerId: "p_1", connected: true, ready: true, character: { name: "Sparklehoof" } },
        { playerId: "p_2", connected: true, ready: true, character: { name: "Pip" } },
      ],
      seats: { p_1: { name: "Ada", color: "#fff", device: "phone" }, p_2: { name: "Bo", color: "#000", device: "phone" } },
    } as unknown as RunState;
    const out = forgetPlayer(state, kid)!;
    expect(out.party[0]).toMatchObject({ playerId: "p_1", connected: false, character: { name: FORGOTTEN_NAME } });
    expect(out.party[1]?.character.name).toBe("Pip");
    expect(out.seats).toEqual({ p_2: { name: "Bo", color: "#000", device: "phone" } });
    expect(out.removed).toEqual(["p_1"]);
    expect(out.narration).toBe(`${FORGOTTEN_NAME} and Pip reach the gate. Sparklehoofish is not a word.`);
    // An id is never rewritten, whatever it shares with her names.
    expect(out.sceneId).toBe("sparklehoof-gate");
    expect(forgetPlayer(out, kid)).toBeNull();
  });

  it("takes the keeper role a host handed her out of the save (#272)", () => {
    const state = {
      phase: "scene",
      party: [{ playerId: "p_1", connected: true, ready: true, character: { name: "Sparklehoof" } }],
      seats: { p_1: { name: "Ada", color: "#fff", device: "phone" } },
      keeperPlayerId: "p_1",
    } as unknown as RunState;
    const out = forgetPlayer(state, kid)!;
    expect(out).not.toHaveProperty("keeperPlayerId");
    // Somebody else's stays.
    expect(forgetPlayer({ ...state, keeperPlayerId: "p_2" } as RunState, kid)).toHaveProperty("keeperPlayerId", "p_2");
  });

  it("leaves a save that never had her alone", () => {
    const state = { phase: "lobby", party: [], narration: "Hello" } as unknown as RunState;
    expect(forgetPlayer(state, kid)).toBeNull();
  });

  it("takes a nickname out of name fields only", () => {
    const names = { heroes: [], nicknames: ["Max"] };
    expect(scrubNames({ name: "Max", narration: "Max power!" }, names)).toEqual({ name: FORGOTTEN_NAME, narration: "Max power!" });
  });
});
