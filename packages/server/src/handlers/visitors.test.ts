/**
 * Rooms open to visitors (#249): two households at one table, each playing its
 * own hero and keeping what it earned. Driven through the handlers with the
 * real engine, so the character writes are the ones a chapter really makes.
 */

import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, OPEN_ROOM_IDLE_MS } from "@kad/shared";
import type { ActionResponse, Chapter, ClientIntent, RunState, WorldMap } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeChapter, makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import type { DeviceIdentity } from "../identity.ts";
import { applyAction } from "./action.ts";
import { lockRoom } from "./host.ts";
import { removePlayer } from "./remove.ts";
import { createRoom, findRoom, joinRoom, watchRoom } from "./room.ts";
import { getState } from "./state.ts";
import { setVisitors } from "./visitors.ts";

const realEngine: Engine = { applyIntent, createRunState };

const OWNER = { cognitoSub: "sub-test", email: "owner@example.com" };
const STRANGER = { cognitoSub: "sub-somebody-else" };
const GATE = "location.visitor_gate";
const BIOME = "biome.enchanted_woods";

/** In at a gate, a rest where each hero is handed a draught, and out. */
function visitChapter(): Chapter {
  const base = makeChapter();
  return {
    ...base,
    xpAward: 300,
    entry: "scene_gate",
    scenes: {
      scene_gate: {
        type: "story",
        narration: "A gate in the hedge.",
        discovers: [GATE],
        choices: [{ id: "in", label: "Go in", icon: "arrow", goto: "scene_camp" }],
      },
      scene_camp: {
        type: "rest",
        narration: "A warm hollow.",
        // By player: the room's own hero, and the visitor's (`visitingHousehold`).
        onEnter: [
          { type: "grantItem", itemId: "sunbloom_draught", to: "p_1" },
          { type: "grantItem", itemId: "sunbloom_draught", to: "p_h_visit" },
        ],
        choices: [{ id: "on", label: "Onward", icon: "arrow", goto: "scene_end" }],
      },
      scene_end: { type: "story", narration: "Home again.", choices: [] },
    },
  };
}

const world = { places: { enchanted_woods: { id: BIOME } } } as unknown as WorldMap;

function hero(name: string): ClientIntent {
  return {
    type: "CREATE_CHARACTER",
    name,
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: { palette: "meadow", accent: "#7FD4C1" },
  };
}

/** A second household, with one player on a bound phone. */
async function visitingHousehold(harness: TestHarness, id = "h_visit"): Promise<DeviceIdentity> {
  await harness.repo.putHousehold({
    id,
    displayName: "Next door",
    ownerSub: null,
    guest: true,
    expiresAt: new Date(harness.clock.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(harness.clock.now()).toISOString(),
  } as never);
  const playerId = `p_${id}`;
  await harness.repo.putPlayer({ id: playerId, householdId: id, displayName: "Wren", color: "#E8A33D" });
  const { deviceId } = await harness.identity.issueDeviceToken({ householdId: id, playerId });
  return { deviceId, householdId: id, playerId };
}

/** Household h_test hosts on p_1's phone; its owner is signed in as `OWNER`. */
async function hostTable() {
  const harness = makeHarness({ engine: realEngine, content: makeContent({ chapters: [visitChapter()], world }) });
  const { householdId, players } = await seedHousehold(harness, 1);
  const host = players[0]!.principal;
  await harness.repo.putAccountPointer(OWNER.cognitoSub, householdId);
  const created = await createRoom({ householdId, mode: "travel", hostDeviceId: host.deviceId }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const joined = await joinRoom({ code, principal: host }, harness.deps);
  if (!joined.ok) throw new Error("host join");
  const visitor = await visitingHousehold(harness);
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const act = async (who: Pick<DeviceIdentity, "householdId" | "playerId">, intent: ClientIntent): Promise<ActionResponse> =>
    applyAction({ runId, playerId: who.playerId, seq: (await state()).seq, intent, principal: who }, harness.deps);
  return { harness, householdId, host, visitor, code, runId, state, act };
}

async function open(t: Awaited<ReturnType<typeof hostTable>>): Promise<string> {
  const opened = await setVisitors({ ...OWNER, code: t.code, open: true }, t.harness.deps);
  if (!opened.ok || !opened.value.visitorCode) throw new Error(`open: ${JSON.stringify(opened)}`);
  return opened.value.visitorCode;
}

describe("a closed room (#249)", () => {
  it("still refuses a phone from another household, exactly as before", async () => {
    const t = await hostTable();
    expect(await joinRoom({ code: t.code, principal: t.visitor }, t.harness.deps)).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "this device belongs to a different household" },
    });
    // A six-letter code names no room while the room is closed.
    expect(await findRoom(`${t.code}AB`, t.harness.deps)).toBeNull();
    expect((await t.state()).visitorCode).toBeUndefined();
  });

  it("does not close when idle: only an open room does", async () => {
    const t = await hostTable();
    t.harness.clock.advance(OPEN_ROOM_IDLE_MS * 2);
    expect(await joinRoom({ code: t.code, principal: t.host }, t.harness.deps)).toMatchObject({ ok: true });
    expect((await t.state()).closed).toBeUndefined();
  });
});

describe("opening a room to visitors (#249)", () => {
  it("needs a signed-in owner of the room's household", async () => {
    const t = await hostTable();
    expect(await setVisitors({ ...STRANGER, code: t.code, open: true }, t.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect((await t.state()).visitorCode).toBeUndefined();
    expect(await setVisitors({ ...OWNER, code: t.code, open: "yes" }, t.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL" },
    });
  });

  it("refuses a TV's room until a phone has settled it", async () => {
    const harness = makeHarness();
    const { householdId } = await seedHousehold(harness, 1);
    await harness.repo.putAccountPointer(OWNER.cognitoSub, householdId);
    const created = await createRoom({ householdId, mode: "party", claimable: true }, harness.deps);
    if (!created.ok) throw new Error("room");
    expect(await setVisitors({ ...OWNER, code: created.value.code, open: true }, harness.deps)).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL" },
    });
  });

  it("gives the room a longer code, which every screen in it is sent", async () => {
    const t = await hostTable();
    const visitorCode = await open(t);
    expect(visitorCode).toMatch(/^[A-Z]{6}$/);
    expect(visitorCode.startsWith(t.code)).toBe(true);
    expect((await t.state()).visitorCode).toBe(visitorCode);
    expect(await findRoom(visitorCode, t.harness.deps)).toMatchObject({ room: { code: t.code }, visitorCode });
    expect(await findRoom(visitorCode.toLowerCase(), t.harness.deps)).toMatchObject({ visitorCode });
    // The right room with the wrong last letters is no room at all.
    const wrong = t.code + (visitorCode.endsWith("AA") ? "BB" : "AA");
    expect(await findRoom(wrong, t.harness.deps)).toBeNull();
    // Opening twice changes nothing.
    const again = await setVisitors({ ...OWNER, code: t.code, open: true }, t.harness.deps);
    expect(again).toMatchObject({ ok: true, value: { visitorCode } });
  });

  it("lets a visitor in with the long code only, on a session for their own household", async () => {
    const t = await hostTable();
    const visitorCode = await open(t);
    expect(await joinRoom({ code: t.code, principal: t.visitor }, t.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    const joined = await joinRoom({ code: t.code, principal: t.visitor, visitorCode }, t.harness.deps);
    if (!joined.ok) throw new Error(joined.error.message);
    expect(joined.value.keeper).toBeUndefined();
    const session = await t.harness.identity.resolveSession(joined.value.sessionToken);
    expect(session).toMatchObject({ runId: t.runId, roomCode: t.code, householdId: "h_visit", playerId: t.visitor.playerId });
    expect((await t.state()).seats?.[t.visitor.playerId]).toMatchObject({ homeHouseholdId: "h_visit" });
    // The room's own household is unchanged by a visitor.
    expect((await t.state()).seats?.[t.host.playerId]?.homeHouseholdId).toBeUndefined();
  });

  it("turned off, lets no new visitor in and keeps the ones already playing", async () => {
    const t = await hostTable();
    const visitorCode = await open(t);
    await joinRoom({ code: t.code, principal: t.visitor, visitorCode }, t.harness.deps);
    const late = await visitingHousehold(t.harness, "h_late");

    const shut = await setVisitors({ ...OWNER, code: t.code, open: false }, t.harness.deps);
    expect(shut).toMatchObject({ ok: true });
    expect((await t.state()).visitorCode).toBeUndefined();
    expect(await findRoom(visitorCode, t.harness.deps)).toBeNull();
    expect(await joinRoom({ code: t.code, principal: late, visitorCode }, t.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    // A visitor on the roster comes back with the room's own code.
    expect(await joinRoom({ code: t.code, principal: t.visitor }, t.harness.deps)).toMatchObject({ ok: true });
    expect(await t.act(t.visitor, hero("Wren's Hero"))).toMatchObject({ ok: true });
  });

  it("closes when idle, well before the room's six hours", async () => {
    const t = await hostTable();
    const visitorCode = await open(t);
    t.harness.clock.advance(OPEN_ROOM_IDLE_MS - 1);
    // Still open a moment before, and a join is activity.
    expect(await t.act(t.host, hero("Pip"))).toMatchObject({ ok: true });
    t.harness.clock.advance(OPEN_ROOM_IDLE_MS);
    expect(await joinRoom({ code: t.code, principal: t.visitor, visitorCode }, t.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect((await t.state()).closed).toBe(true);
    // The code is free again, and nobody can act in the room.
    expect(await t.harness.repo.getRoom(t.code)).toBeNull();
    expect(await t.act(t.host, { type: "READY", ready: true })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("closes when idle on a state read or an action too", async () => {
    const t = await hostTable();
    await open(t);
    t.harness.clock.advance(OPEN_ROOM_IDLE_MS);
    expect(await t.act(t.host, hero("Pip"))).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await getState({ runId: t.runId }, t.harness.deps)).toMatchObject({ ok: true, value: { state: { closed: true } } });
    expect(await watchRoom({ code: t.code, deviceId: t.host.deviceId }, t.harness.deps)).toMatchObject({ ok: false });
  });

  it("lets the host take a visitor out", async () => {
    const t = await hostTable();
    const visitorCode = await open(t);
    await joinRoom({ code: t.code, principal: t.visitor, visitorCode }, t.harness.deps);
    await t.act(t.visitor, hero("Wren's Hero"));

    expect(
      await removePlayer({ code: t.code, principal: t.host, playerId: t.visitor.playerId }, t.harness.deps),
    ).toMatchObject({ ok: true });
    expect((await t.state()).removed).toEqual([t.visitor.playerId]);
    expect(await t.act(t.visitor, { type: "READY", ready: true })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await joinRoom({ code: t.code, principal: t.visitor, visitorCode }, t.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });

  it("refuses a session from another household that the room never seated", async () => {
    const t = await hostTable();
    await open(t);
    expect(await t.act(t.visitor, hero("Sneaky"))).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("still honours a lock: a locked open room lets no new visitor in", async () => {
    const t = await hostTable();
    const visitorCode = await open(t);
    await lockRoom({ code: t.code, principal: t.host, locked: true }, t.harness.deps);
    expect(await joinRoom({ code: t.code, principal: t.visitor, visitorCode }, t.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("two households, one chapter (#249)", () => {
  it("writes each hero's XP, items and finds back to its own household", async () => {
    const t = await hostTable();
    const visitorCode = await open(t);
    await joinRoom({ code: t.code, principal: t.visitor, visitorCode }, t.harness.deps);

    expect(await t.act(t.host, hero("Pip"))).toMatchObject({ ok: true });
    expect(await t.act(t.visitor, hero("Wren's Hero"))).toMatchObject({ ok: true });
    const visitorMember = (await t.state()).party.find((m) => m.playerId === t.visitor.playerId);
    expect(visitorMember?.homeHouseholdId).toBe("h_visit");
    expect((await t.state()).party.find((m) => m.playerId === t.host.playerId)?.homeHouseholdId).toBeUndefined();
    // Each hero is a row in its own household, and only there.
    const visitorHero = visitorMember!.character.id;
    expect(await t.harness.repo.getCharacter("h_visit", visitorHero)).toMatchObject({ householdId: "h_visit" });
    expect(await t.harness.repo.getCharacter(t.householdId, visitorHero)).toBeNull();

    await t.act(t.host, { type: "READY", ready: true });
    await t.act(t.visitor, { type: "READY", ready: true });
    expect(await t.act(t.host, { type: "START_CHAPTER", chapterId: "bramblewood-01" })).toMatchObject({ ok: true });

    const choose = async (choiceId: string) => {
      const prompt = (await t.state()).prompt;
      if (prompt?.kind !== "choice") throw new Error("expected a choice");
      const who = prompt.forPlayerIds[0] === t.visitor.playerId ? t.visitor : t.host;
      expect(await t.act(who, { type: "CHOOSE", choiceId })).toMatchObject({ ok: true });
    };
    await choose("in");
    expect((await t.state()).sceneType).toBe("rest");

    // No trades across households: the server refuses one either way round.
    const offer = await t.act(t.host, { type: "OFFER_ITEM", itemId: "sunbloom_draught", toPlayerId: t.visitor.playerId });
    expect(offer).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const back = await t.act(t.visitor, { type: "OFFER_ITEM", itemId: "sunbloom_draught", toPlayerId: t.host.playerId });
    expect(back).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    const week = (await t.harness.repo.getHousehold("h_visit"))?.expiresAt ?? "";
    t.harness.clock.advance(60_000);
    await choose("on");
    expect((await t.state()).phase).toBe("chapter_complete");
    // A finished chapter is play for the visiting guest household too.
    expect(((await t.harness.repo.getHousehold("h_visit"))?.expiresAt ?? "") > week).toBe(true);

    const visitorRow = await t.harness.repo.getCharacter("h_visit", visitorHero);
    const hostHero = (await t.state()).party.find((m) => m.playerId === t.host.playerId)!.character.id;
    const hostRow = await t.harness.repo.getCharacter(t.householdId, hostHero);
    for (const row of [visitorRow, hostRow]) {
      const progress = row?.provisional ?? row?.committed;
      expect(progress?.xp).toBeGreaterThan(0);
      expect(progress?.inventory.map((i) => i.itemId)).toContain("sunbloom_draught");
    }
    // Nothing of the visitor's leaked into the host's household.
    expect(await t.harness.repo.getCharacter(t.householdId, visitorHero)).toBeNull();

    // Both books have the gate: the room's, and the visitor's own, credited
    // to one of their own.
    const hostBook = await t.harness.repo.getFieldGuide(t.householdId);
    const visitorBook = await t.harness.repo.getFieldGuide("h_visit");
    expect(Object.keys(hostBook.entries)).toContain(GATE);
    expect(visitorBook.entries[GATE]).toMatchObject({ firstFoundBy: t.visitor.playerId, runId: t.runId });
  });
});
