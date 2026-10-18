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
import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { sweep } from "../lambda/sweep.ts";
import { makeHarness, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import type { HandlerResult } from "./deps.ts";
import {
  acceptOrganizerInvite,
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

describe("retention (#252)", () => {
  it("keeps everybody until an owner says otherwise, and takes only the windows offered", async () => {
    const h = harness();
    const ada = await homeOf(h, "h_ada", "Ada");
    expect(value(await viewHousehold({ ...ada.owner, householdId: ada.householdId }, h.deps)).retentionDays).toBeNull();
    const odd = await setHouseholdRetention({ ...ada.owner, householdId: ada.householdId, retentionDays: 7 }, h.deps);
    expect(odd).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    const set = value(await setHouseholdRetention({ ...ada.owner, householdId: ada.householdId, retentionDays: 30 }, h.deps));
    expect(set.retentionDays).toBe(30);
    const back = value(await setHouseholdRetention({ ...ada.owner, householdId: ada.householdId, retentionDays: null }, h.deps));
    expect(back.retentionDays).toBeNull();
    expect(await h.repo.getHousehold(ada.householdId)).not.toHaveProperty("retentionDays");
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

    // A household that keeps everybody again takes Bo out of the sweep.
    value(await setHouseholdRetention({ ...ada.owner, householdId: ada.householdId, retentionDays: null }, h.deps));
    h.clock.advance(400 * DAY);
    expect((await sweep(h.repo, () => h.clock.now())).idle.deleted).toEqual([]);
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

  it("leaves a save that never had her alone", () => {
    const state = { phase: "lobby", party: [], narration: "Hello" } as unknown as RunState;
    expect(forgetPlayer(state, kid)).toBeNull();
  });

  it("takes a nickname out of name fields only", () => {
    const names = { heroes: [], nicknames: ["Max"] };
    expect(scrubNames({ name: "Max", narration: "Max power!" }, names)).toEqual({ name: FORGOTTEN_NAME, narration: "Max power!" });
  });
});
