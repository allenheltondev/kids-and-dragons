/**
 * Stop anytime, pick up where you left off (#259), through the handlers and
 * the shipped Gemfall: a chapter stopped midway in one room resumes in a new
 * room days later, on different devices, with nothing lost.
 */

import path from "node:path";
import { applyIntent, classPlaceWaitingOn, createRunState, keepClassIntent, makeRng, tableFull, type ChannelMessage, type ClientIntent, type RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { closeRoom } from "./host.ts";
import { leaveAdventure } from "./organizer.ts";
import { removePlayer } from "./remove.ts";
import { createRoom, joinRoom } from "./room.ts";
import { firstSentence, heroSaved, recapOf, releaseSavedHero, resumeGame, savedGame, stopForToday } from "./save.ts";
import { listHeroes } from "./heroes.ts";
import { viewHousehold } from "./organizer.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };
const GEMFALL = "gemfall";
const DAY = 24 * 60 * 60 * 1000;

async function household(players = 2) {
  const harness = makeHarness({ engine: realEngine, playtest: true, content });
  harness.deps.rng = (key) => makeRng(`save:${String(key).split(":").pop()}`);
  const seeded = await seedHousehold(harness, players);
  await harness.repo.putAccountPointer("sub-test", seeded.householdId);
  return { harness, ...seeded };
}

type Household = Awaited<ReturnType<typeof household>>;

/** A room for `campaignId`, opened by player `host`'s device. */
async function room(h: Household, campaignId: string | null = GEMFALL, host = 0) {
  const created = await createRoom(
    { householdId: h.householdId, mode: "party", campaignId, hostDeviceId: h.players[host]!.principal.deviceId },
    h.harness.deps,
  );
  if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
  return created.value;
}

/** Player `seat` (0-based) joins the open room, and can act in it. */
async function sit(h: Household, code: string, runId: string, seat: number) {
  const joined = await joinRoom({ code, principal: h.players[seat]!.principal }, h.harness.deps);
  if (!joined.ok) throw new Error(`join: ${JSON.stringify(joined)}`);
  const playerId = joined.value.playerId;
  const state = async (): Promise<RunState> => (await h.harness.repo.getState(runId))!;
  const send = async (intent: ClientIntent) =>
    applyAction({ runId, playerId, seq: (await state()).seq, intent }, h.harness.deps);
  const must = async (intent: ClientIntent) => {
    const response = await send(intent);
    if (!response.ok) throw new Error(`${intent.type}: ${JSON.stringify(response.error)}`);
    return response;
  };
  const resume = () => resumeGame({ runId, playerId, householdId: h.householdId }, h.harness.deps);
  return { code, runId, playerId, state, send, must, resume };
}

type Seat = Awaited<ReturnType<typeof sit>>;

const SPECS = [
  { name: "Pip", species: "unicorn", class: "thornguard", stats: { might: 1, quick: 1, clever: 0, heart: 1 } },
  { name: "Bo", species: "unicorn", class: "thornguard", stats: { might: 1, quick: 0, clever: 1, heart: 1 } },
] as const;

/** Both players make a hero in a fresh Gemfall room and begin chapter 1. */
async function evening(h: Household) {
  const created = await room(h);
  const one = await sit(h, created.code, created.runId, 0);
  const two = await sit(h, created.code, created.runId, 1);
  for (const [seat, spec] of [
    [one, SPECS[0]],
    [two, SPECS[1]],
  ] as const) {
    await seat.must({ type: "CREATE_CHARACTER", ...spec });
    await seat.must({ type: "READY", ready: true });
  }
  await one.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
  return { ...created, one, two };
}

/** The table makes its way a few scenes into the chapter. */
async function walkIn(seats: Seat[], steps = 3) {
  for (let i = 0; i < steps; i++) {
    const state = await seats[0]!.state();
    const prompt = state.prompt;
    const byPlayer = (playerId: string | undefined) => seats.find((s) => s.playerId === playerId) ?? seats[0]!;
    let seat = byPlayer(state.party[(state.storyTurn ?? 0) % state.party.length]?.playerId);
    let intent: ClientIntent = { type: "ADVANCE" };
    // Gemfall opens at the fitting stall (#312): a new hero keeps their class.
    const deciding = classPlaceWaitingOn(state)[0];
    if (deciding && state.classPlace) {
      seat = byPlayer(deciding.playerId);
      intent = keepClassIntent(state.classPlace, deciding);
    } else if (prompt?.kind === "choice") {
      if (prompt.forPlayerIds[0]) seat = byPlayer(prompt.forPlayerIds[0]);
      intent = { type: "CHOOSE", choiceId: prompt.options[0]!.id };
    } else if (prompt?.kind === "roll") {
      seat = byPlayer(state.party.find((m) => m.character.id === prompt.characterId)?.playerId);
      intent = { type: "ROLL" };
    }
    if (!(await seat.send(intent)).ok) break;
  }
}

describe("firstSentence", () => {
  it("takes the first sentence and nothing more", () => {
    expect(firstSentence("The bridge hums.  Bees drift by. Then more.")).toBe("The bridge hums.");
    expect(firstSentence("")).toBe("");
  });

  it("trims a long one at a word, to one breath", () => {
    const long = `A ${"very ".repeat(60)}long sentence.`;
    const line = firstSentence(long);
    expect(line.length).toBeLessThanOrEqual(143);
    expect(line.endsWith("...")).toBe(true);
    expect(line).not.toMatch(/ \.\.\.$/);
  });

  it("falls back to the chapter's name when a scene says nothing", () => {
    expect(recapOf({ narration: "", chapterInfo: { index: 2, title: "The Honey Bridge" } })).toBe(
      "You were in The Honey Bridge.",
    );
  });
});

describe("stopping for today (#259)", () => {
  it("saves the chapter, closes the room, frees the code, and keeps every claim", async () => {
    const h = await household();
    const e = await evening(h);
    await walkIn([e.one, e.two]);
    const before = await e.one.state();
    expect(before.phase).not.toBe("lobby");
    const heroesBefore = await h.harness.repo.listCharacters(h.householdId);
    expect(heroesBefore.map((c) => c.provisional?.runId)).toEqual([GEMFALL, GEMFALL]);

    const received: ChannelMessage[] = [];
    const unsubscribe = h.harness.channel.subscribe(e.code, (m) => received.push(m));
    const stopped = await stopForToday({ code: e.code, principal: h.players[0]!.principal }, h.harness.deps);
    unsubscribe();
    expect(stopped.ok).toBe(true);

    // Every screen is told, once, and the code is free for another family.
    expect(received.map((m) => m.kind)).toEqual(["patch"]);
    expect(await h.harness.repo.getRoom(e.code)).toBeNull();
    const state = await e.one.state();
    expect(state.closed).toBe(true);
    expect(state.stopped).toBe(true);
    // The game is exactly where it was.
    const { closed: _c, stopped: _s, ...kept } = state;
    expect({ ...kept, seq: 0, updatedAt: "" }).toEqual({ ...before, seq: 0, updatedAt: "" });
    const run = await h.harness.repo.getRun(e.runId);
    expect(run?.stoppedAt).toBeTypeOf("string");

    // Claims are kept on purpose: the heroes still hold Gemfall, gains and all.
    expect(await h.harness.repo.listCharacters(h.householdId)).toEqual(heroesBefore);
    expect((await h.harness.repo.getCampaignProgress(h.householdId, GEMFALL))?.status).toBe("active");
  });

  it("is the host's alone, and only once a chapter is under way", async () => {
    const h = await household();
    const created = await room(h);
    const one = await sit(h, created.code, created.runId, 0);
    await sit(h, created.code, created.runId, 1);

    // A lobby has nothing to save.
    const early = await stopForToday({ code: created.code, principal: h.players[0]!.principal }, h.harness.deps);
    expect(early).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(early.ok === false && early.error.message).toMatch(/nothing to save/i);

    await one.must({ type: "CREATE_CHARACTER", ...SPECS[0] });
    await one.must({ type: "READY", ready: true });
    await one.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });

    const other = await stopForToday({ code: created.code, principal: h.players[1]!.principal }, h.harness.deps);
    expect(other).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((await one.state()).closed).toBeUndefined();
    expect((await h.harness.repo.getRun(created.runId))?.stoppedAt).toBeUndefined();

    expect(await stopForToday({ code: created.code, principal: h.players[0]!.principal }, h.harness.deps)).toMatchObject({
      ok: true,
    });
    // And a second tap on a room that is gone is just a gone room.
    expect(await stopForToday({ code: created.code, principal: h.players[0]!.principal }, h.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("can stop at a rest scene, the natural place to", async () => {
    const h = await household();
    const e = await evening(h);
    const chapter = content.chapter((await e.one.state()).chapterId!)!;
    const rest = Object.entries(chapter.scenes).find(([, scene]) => scene.type === "rest");
    expect(rest, "chapter 1 has a rest waypoint").toBeDefined();
    await e.one.must({ type: "PLAYTEST_GOTO", sceneId: rest![0] });
    expect((await e.one.state()).sceneType).toBe("rest");
    expect(await stopForToday({ code: e.code, principal: h.players[0]!.principal }, h.harness.deps)).toMatchObject({
      ok: true,
    });
  });

  it("does not save when the host simply closes the room", async () => {
    const h = await household();
    const e = await evening(h);
    await closeRoom({ code: e.code, principal: h.players[0]!.principal }, h.harness.deps);
    expect(await savedGame(h.householdId, h.harness.deps)).toBeNull();
  });
});

describe("picking up where you left off (#259)", () => {
  /** Stopped on one evening, with a new room opened days later. */
  async function nextTime(days = 3) {
    const h = await household();
    const e = await evening(h);
    await walkIn([e.one, e.two]);
    const stoppedAt = await e.one.state();
    await stopForToday({ code: e.code, principal: h.players[0]!.principal }, h.harness.deps);
    h.harness.clock.advance(days * DAY);
    const created = await room(h, GEMFALL, 1);
    return { h, e, stoppedAt, created };
  }

  it("offers to keep going, with a recap, in the household's next room", async () => {
    const { h, stoppedAt, created } = await nextTime();
    const lobby = (await h.harness.repo.getState(created.runId))!;
    expect(lobby.phase).toBe("lobby");
    expect(lobby.saved).toEqual({
      campaignId: GEMFALL,
      campaignTitle: content.campaign(GEMFALL)!.title,
      chapter: stoppedAt.chapterInfo,
      recap: recapOf(stoppedAt),
      heroes: ["Pip", "Bo"],
      savedAt: expect.any(String),
    });
    expect(lobby.saved!.recap.length).toBeGreaterThan(0);
    expect(lobby.saved!.recap.length).toBeLessThanOrEqual(143);
  });

  it("lands the party back where it was, on different devices, with nothing lost", async () => {
    const { h, e, stoppedAt, created } = await nextTime();
    // Player 2 opened this room and Player 1 joins late, on another device:
    // a seat belongs to a player, never to a device.
    const two = await sit(h, created.code, created.runId, 1);
    const phone = await h.harness.identity.issueDeviceToken({ householdId: h.householdId, playerId: "p_1" });
    const one = await sit(
      { ...h, players: [{ principal: { deviceId: phone.deviceId, householdId: h.householdId, playerId: "p_1" }, deviceToken: phone.token }, h.players[1]!] },
      created.code,
      created.runId,
      0,
    );

    const resumed = await two.resume();
    expect(resumed.ok).toBe(true);
    const state = await two.state();
    const was = stoppedAt;
    // The chapter, scene, words, prompt, flags and purse are the old room's.
    for (const key of ["phase", "chapterId", "chapterInfo", "sceneId", "sceneType", "narration", "prompt", "flags", "coins", "xpEarned", "visited", "campaignId", "campaignAttemptId"] as const) {
      expect(state[key], key).toEqual(was[key]);
    }
    // The room is the new one.
    expect(state.runId).toBe(created.runId);
    expect(state.roomCode).toBe(created.code);
    expect(state.closed).toBeUndefined();
    expect(state.stopped).toBeUndefined();
    expect(state.saved).toBeUndefined();
    // Same heroes, hp and all, nobody ready by default.
    expect(state.party.map((m) => [m.playerId, m.character.name, m.hp])).toEqual(was.party.map((m) => [m.playerId, m.character.name, m.hp]));
    expect(state.party.every((m) => !m.ready)).toBe(true);
    // Both phones are in this room, and so both count as here.
    expect(state.party.map((m) => m.connected)).toEqual([true, true]);
    expect(one.playerId).toBe("p_1");

    // The save is spent: no later room offers it, and the old run is still the log of its evening.
    expect((await h.harness.repo.getRun(e.runId))?.stoppedAt).toBeUndefined();
    expect(await savedGame(h.householdId, h.harness.deps)).toBeNull();

    // And the game goes on from there.
    await walkIn([one, two], 2);
    expect((await two.state()).seq).toBeGreaterThan(state.seq);
  });

  it("brings back a player whose phone is not in the room yet as away, and welcomes them when it joins", async () => {
    const { h, created } = await nextTime();
    const two = await sit(h, created.code, created.runId, 1);
    expect(await two.resume()).toMatchObject({ ok: true });
    expect((await two.state()).party.map((m) => [m.playerId, m.connected])).toEqual([
      ["p_1", false],
      ["p_2", true],
    ]);
    await sit(h, created.code, created.runId, 0);
    expect((await two.state()).party.map((m) => m.connected)).toEqual([true, true]);
  });

  it("completes the chapter the way a chapter always does, against the same attempt", async () => {
    const { h, created } = await nextTime();
    const attemptBefore = await h.harness.repo.getCampaignProgress(h.householdId, GEMFALL);
    const two = await sit(h, created.code, created.runId, 1);
    await two.resume();
    const chapterId = (await two.state()).chapterId!;
    const chapter = content.chapter(chapterId)!;
    const [ending] = Object.entries(chapter.scenes).find(
      ([, s]) => "choices" in s && Array.isArray(s.choices) && s.choices.length === 0 && !("outcome" in s && s.outcome === "setback"),
    )!;
    await two.must({ type: "PLAYTEST_GOTO", sceneId: ending });
    expect((await two.state()).phase).toBe("chapter_complete");
    const attempt = await h.harness.repo.getCampaignProgress(h.householdId, GEMFALL);
    expect(attempt?.attemptId).toBe(attemptBefore?.attemptId);
    expect(attempt?.lastIndex).toBe(chapter.index);
  });

  it("is refused outside a lobby, with nothing saved, or by someone not in the room", async () => {
    const h = await household();
    const e = await evening(h);
    // Under way: already playing.
    expect(await e.one.resume()).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });

    const lobby = await room(h);
    const two = await sit(h, lobby.code, lobby.runId, 1);
    // Nothing is saved yet.
    expect(await two.resume()).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    // Not seated.
    const stranger = await resumeGame({ runId: lobby.runId, playerId: "p_9", householdId: h.householdId }, h.harness.deps);
    expect(stranger).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("is not offered once another room has finished that chapter", async () => {
    const h = await household();
    const e = await evening(h);
    await walkIn([e.one, e.two]);
    await stopForToday({ code: e.code, principal: h.players[0]!.principal }, h.harness.deps);
    expect((await savedGame(h.householdId, h.harness.deps))?.view.chapter.index).toBe(1);

    // The household plays chapter 1 afresh in a new room and finishes it.
    const again = await room(h);
    const one = await sit(h, again.code, again.runId, 0);
    const [pip] = (await h.harness.repo.listCharacters(h.householdId)).filter((c) => c.ownerPlayerId === "p_1");
    await one.must({ type: "SEAT_CHARACTER", characterId: pip!.id });
    await one.must({ type: "READY", ready: true });
    await one.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    const chapter = content.chapter((await one.state()).chapterId!)!;
    const [ending] = Object.entries(chapter.scenes).find(
      ([, s]) => "choices" in s && Array.isArray(s.choices) && s.choices.length === 0 && !("outcome" in s && s.outcome === "setback"),
    )!;
    await one.must({ type: "PLAYTEST_GOTO", sceneId: ending });

    expect(await savedGame(h.householdId, h.harness.deps)).toBeNull();
    const next = await room(h);
    expect((await h.harness.repo.getState(next.runId))?.saved).toBeUndefined();
    const two = await sit(h, next.code, next.runId, 1);
    expect(await two.resume()).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("leaves a hero out whose grown-up ended her adventure, and she can sit down like anyone", async () => {
    const { h, created } = await nextTime();
    const [pip] = (await h.harness.repo.listCharacters(h.householdId)).filter((c) => c.ownerPlayerId === "p_1");
    const left = await leaveAdventure({ cognitoSub: "sub-test", householdId: h.householdId, characterId: pip!.id }, h.harness.deps);
    expect(left.ok).toBe(true);

    const two = await sit(h, created.code, created.runId, 1);
    expect(await two.resume()).toMatchObject({ ok: true });
    expect((await two.state()).party.map((m) => m.character.name)).toEqual(["Bo"]);

    const one = await sit(h, created.code, created.runId, 0);
    await one.must({ type: "SEAT_CHARACTER", characterId: pip!.id });
    expect((await one.state()).party.map((m) => m.character.name).sort()).toEqual(["Bo", "Pip"]);
    expect((await h.harness.repo.getCharacter(h.householdId, pip!.id))?.provisional?.runId).toBe(GEMFALL);
  });

  it("takes in a hero already seated in the new room, and claims the adventure for her", async () => {
    const h = await household(3);
    const e = await evening(h);
    await walkIn([e.one, e.two]);
    await stopForToday({ code: e.code, principal: h.players[0]!.principal }, h.harness.deps);
    h.harness.clock.advance(3 * DAY);

    // Cy, a third player's hero, free and saved, sits down in the lobby.
    const [pip] = await h.harness.repo.listCharacters(h.householdId);
    await h.harness.repo.putCharacter({ ...pip!, id: "c_cy", name: "Cy", ownerPlayerId: "p_3", provisional: null, version: 1 });
    const created = await room(h, GEMFALL, 1);
    const two = await sit(h, created.code, created.runId, 1);
    const three = await sit(h, created.code, created.runId, 2);
    await three.must({ type: "SEAT_CHARACTER", characterId: "c_cy" });
    expect((await three.state()).phase).toBe("creation");

    expect(await two.resume()).toMatchObject({ ok: true });
    const state = await two.state();
    expect(state.party.map((m) => [m.character.name, m.connected])).toEqual([
      ["Pip", false],
      ["Bo", true],
      ["Cy", true],
    ]);
    const cy = (await h.harness.repo.getCharacter(h.householdId, "c_cy"))!;
    expect(cy.provisional?.runId).toBe(GEMFALL);
    expect(state.party.find((m) => m.character.name === "Cy")?.character.isProvisional).toBe(true);
  });

  it("leaves out a hero another adventure holds, rather than refuse the whole table", async () => {
    const h = await household(3);
    const e = await evening(h);
    await walkIn([e.one, e.two]);
    await stopForToday({ code: e.code, principal: h.players[0]!.principal }, h.harness.deps);
    h.harness.clock.advance(3 * DAY);

    const [pip] = await h.harness.repo.listCharacters(h.householdId);
    await h.harness.repo.putCampaignProgress({
      householdId: h.householdId,
      campaignId: "the-hollow-crown",
      status: "active",
      setbacks: 0,
      updatedAt: new Date(h.harness.clock.now()).toISOString(),
    });
    const held = { ...pip!, id: "c_cy", name: "Cy", ownerPlayerId: "p_3", provisional: { ...pip!.committed, runId: "the-hollow-crown" }, version: 1 };
    await h.harness.repo.putCharacter(held);
    const created = await room(h, GEMFALL, 1);
    const two = await sit(h, created.code, created.runId, 1);
    const three = await sit(h, created.code, created.runId, 2);
    await three.must({ type: "SEAT_CHARACTER", characterId: "c_cy" });

    expect(await two.resume()).toMatchObject({ ok: true });
    expect((await two.state()).party.map((m) => m.character.name)).toEqual(["Pip", "Bo"]);
    expect(await h.harness.repo.getCharacter(h.householdId, "c_cy")).toEqual(held);
  });

  it("never seats more than MAX_PARTY: the saved heroes first, then newcomers while a seat is open (#389)", async () => {
    // The audit's repro: two saved heroes, three more sat down in the lobby.
    const h = await household(5);
    const e = await evening(h);
    await walkIn([e.one, e.two]);
    await stopForToday({ code: e.code, principal: h.players[0]!.principal }, h.harness.deps);
    h.harness.clock.advance(3 * DAY);

    const [pip] = await h.harness.repo.listCharacters(h.householdId);
    const names = ["Cy", "Dee", "Eve"];
    for (const [i, name] of names.entries()) {
      const id = `c_${name.toLowerCase()}`;
      await h.harness.repo.putCharacter({ ...pip!, id, name, ownerPlayerId: `p_${i + 3}`, provisional: null, version: 1 });
    }
    const created = await room(h, GEMFALL, 1);
    const two = await sit(h, created.code, created.runId, 1);
    for (const [i, name] of names.entries()) {
      const seat = await sit(h, created.code, created.runId, i + 2);
      await seat.must({ type: "SEAT_CHARACTER", characterId: `c_${name.toLowerCase()}` });
    }

    expect(await two.resume()).toMatchObject({ ok: true });
    const state = await two.state();
    expect(state.party.map((m) => m.character.name)).toEqual(["Pip", "Bo", "Cy", "Dee"]);
    // Eve is left as she was: not in the game, her hero not claimed, her
    // phone still in the room (where it says the table is full).
    const eve = (await h.harness.repo.getCharacter(h.householdId, "c_eve"))!;
    expect(eve.provisional).toBeNull();
    expect(state.seats?.["p_5"]).toBeDefined();
    expect(tableFull(state, "p_5")).toBe(true);
  });

  it("seats four of a save stopped with five heroes, the ones here first, and keeps the fifth's claim (#389)", async () => {
    // A save from before the cap: a resume seated five, then the table stopped.
    const h = await household(5);
    const e = await evening(h);
    await walkIn([e.one, e.two]);
    await stopForToday({ code: e.code, principal: h.players[0]!.principal }, h.harness.deps);
    const saved = (await h.harness.repo.getState(e.runId))!;
    const bo = saved.party[1]!;
    const boRow = (await h.harness.repo.getCharacter(h.householdId, bo.character.id))!;
    const extra = ["Cy", "Dee", "Eve"].map((name, i) => ({ name, id: `c_${name.toLowerCase()}`, playerId: `p_${i + 3}` }));
    for (const x of extra) {
      await h.harness.repo.putCharacter({ ...boRow, id: x.id, name: x.name, ownerPlayerId: x.playerId, version: 1 });
    }
    await h.harness.repo.putState({
      ...saved,
      party: [
        ...saved.party,
        ...extra.map((x) => ({ ...bo, playerId: x.playerId, character: { ...bo.character, id: x.id, name: x.name, ownerPlayerId: x.playerId } })),
      ],
    });
    h.harness.clock.advance(DAY);

    // Bo and Eve are here today; Pip, Cy and Dee are not.
    const created = await room(h, GEMFALL, 1);
    const two = await sit(h, created.code, created.runId, 1);
    await sit(h, created.code, created.runId, 4);
    expect(await two.resume()).toMatchObject({ ok: true });
    const state = await two.state();
    // Here first (Bo, Eve), then the saved order (Pip, Cy), and in saved order at the table.
    expect(state.party.map((m) => m.character.name)).toEqual(["Pip", "Bo", "Cy", "Eve"]);
    expect(state.party.filter((m) => m.connected).map((m) => m.character.name)).toEqual(["Bo", "Eve"]);
    // Dee keeps everything: still held by this adventure, and can sit back down.
    const dee = (await h.harness.repo.getCharacter(h.householdId, "c_dee"))!;
    expect(dee.provisional).toEqual(boRow.provisional);
    expect(tableFull(state, "p_4")).toBe(true);
  });

  it("brings somebody the saved game's host took out back still out, holding no seat (#389)", async () => {
    const h = await household(3);
    const created = await room(h);
    const one = await sit(h, created.code, created.runId, 0);
    const two = await sit(h, created.code, created.runId, 1);
    const three = await sit(h, created.code, created.runId, 2);
    for (const [seat, spec] of [
      [one, SPECS[0]],
      [two, SPECS[1]],
      [three, { ...SPECS[1], name: "Cy" }],
    ] as const) {
      await seat.must({ type: "CREATE_CHARACTER", ...spec });
      await seat.must({ type: "READY", ready: true });
    }
    await one.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    await walkIn([one, two, three]);
    expect((await removePlayer({ code: created.code, principal: h.players[0]!.principal, playerId: "p_3" }, h.harness.deps)).ok).toBe(true);
    await stopForToday({ code: created.code, principal: h.players[0]!.principal }, h.harness.deps);
    h.harness.clock.advance(DAY);

    const again = await room(h);
    const back = await sit(h, again.code, again.runId, 0);
    expect(await back.resume()).toMatchObject({ ok: true });
    const state = await back.state();
    expect(state.removed).toEqual(["p_3"]);
    expect(state.party.find((m) => m.playerId === "p_3")).toMatchObject({ connected: false });
  });

  it("keeps only the newest stop of a campaign", async () => {
    const h = await household();
    const first = await evening(h);
    await walkIn([first.one, first.two]);
    await stopForToday({ code: first.code, principal: h.players[0]!.principal }, h.harness.deps);

    h.harness.clock.advance(DAY);
    const second = await room(h);
    const one = await sit(h, second.code, second.runId, 0);
    await sit(h, second.code, second.runId, 1);
    expect(await one.resume()).toMatchObject({ ok: true });
    await walkIn([one], 2);
    h.harness.clock.advance(60 * 60 * 1000);
    const again = await stopForToday({ code: second.code, principal: h.players[0]!.principal }, h.harness.deps);
    expect(again, JSON.stringify(again)).toMatchObject({ ok: true });

    const runs = (await h.harness.repo.listRuns(h.householdId)).filter((r) => r.stoppedAt !== undefined);
    expect(runs.map((r) => r.id)).toEqual([second.runId]);
  });
});

describe("letting a saved hero go (#259)", () => {
  async function stopped() {
    const h = await household();
    const e = await evening(h);
    await walkIn([e.one, e.two]);
    await stopForToday({ code: e.code, principal: h.players[0]!.principal }, h.harness.deps);
    const [pip] = (await h.harness.repo.listCharacters(h.householdId)).filter((c) => c.ownerPlayerId === "p_1");
    const host = h.players[0]!.principal;
    return { h, e, pip: pip!, host };
  }

  it("says where a hero is saved, on her own screen and the organizer's", async () => {
    const { h, pip } = await stopped();
    expect(await heroSaved(pip, h.harness.deps)).toEqual({ at: null });
    const heroes = await listHeroes({ householdId: h.householdId, playerId: "p_1" }, h.harness.deps);
    expect(heroes.ok && heroes.value.saved).toEqual({ [pip.id]: {} });
    const view = await viewHousehold({ cognitoSub: "sub-test", householdId: h.householdId }, h.harness.deps);
    expect(view.ok && view.value.players[0]!.heroes[0]).toMatchObject({ name: "Pip", saved: {} });
  });

  it("names the table when she is saved at someone else's", async () => {
    const { h, pip, host } = await stopped();
    await h.harness.repo.putHousehold({ id: "h_ada", displayName: "Ada's", ownerSub: null, guest: false, createdAt: "2026-07-04T18:00:00.000Z" });
    const visiting = { ...pip, householdId: "h_ada", provisional: { ...pip.provisional!, runId: `${GEMFALL}@${h.householdId}` } };
    await h.harness.repo.putCharacter(visiting);
    expect(await heroSaved(visiting, h.harness.deps)).toEqual({ at: "Test household" });

    // The stopped table's host lets her go, from her own home.
    const left = await releaseSavedHero(
      { deviceId: host.deviceId, householdId: h.householdId, characterId: pip.id, homeHouseholdId: "h_ada" },
      h.harness.deps,
    );
    expect(left).toMatchObject({ ok: true, value: { left: `${GEMFALL}@${h.householdId}` } });
    expect((await h.harness.repo.getCharacter("h_ada", pip.id))?.provisional).toBeNull();
  });

  it("is the stopped table's host's alone, for a hero its stopped game holds", async () => {
    const { h, pip, host } = await stopped();
    const asGuest = { deviceId: h.players[1]!.principal.deviceId, householdId: h.householdId, characterId: pip.id };
    expect(await releaseSavedHero(asGuest, h.harness.deps)).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect((await h.harness.repo.getCharacter(h.householdId, pip.id))?.provisional?.runId).toBe(GEMFALL);

    // A hero the game never held cannot be let go by its host.
    await h.harness.repo.putCharacter({ ...pip, id: "c_other", name: "Other", provisional: { ...pip.provisional!, runId: "the-hollow-crown" } });
    expect(
      await releaseSavedHero({ deviceId: host.deviceId, householdId: h.householdId, characterId: "c_other" }, h.harness.deps),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await releaseSavedHero({ deviceId: host.deviceId, householdId: h.householdId, characterId: "c_nobody" }, h.harness.deps),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("frees her at once, drops her gains, and a resume leaves her out until she rejoins as she is", async () => {
    const { h, pip, host } = await stopped();
    const released = await releaseSavedHero(
      { deviceId: host.deviceId, householdId: h.householdId, characterId: pip.id },
      h.harness.deps,
    );
    expect(released).toMatchObject({ ok: true, value: { left: GEMFALL } });
    const free = (await h.harness.repo.getCharacter(h.householdId, pip.id))!;
    expect(free.provisional).toBeNull();
    expect(free.committed).toEqual(pip.committed);
    expect(await heroSaved(free, h.harness.deps)).toBeNull();

    h.harness.clock.advance(3 * DAY);
    const created = await room(h, GEMFALL, 1);
    const two = await sit(h, created.code, created.runId, 1);
    expect(await two.resume()).toMatchObject({ ok: true });
    expect((await two.state()).party.map((m) => m.character.name)).toEqual(["Bo"]);

    const one = await sit(h, created.code, created.runId, 0);
    await one.must({ type: "SEAT_CHARACTER", characterId: pip.id });
    expect((await h.harness.repo.getCharacter(h.householdId, pip.id))?.provisional?.runId).toBe(GEMFALL);
  });

  it("stays releasable by the original host after a resume into a room opened for no campaign, and a second stop", async () => {
    const { h, e, pip, host } = await stopped();
    h.harness.clock.advance(3 * DAY);
    // Opened by the other device, for no campaign at all.
    const created = await room(h, null, 1);
    expect((await h.harness.repo.getRun(created.runId))?.campaignId).toBeNull();
    const two = await sit(h, created.code, created.runId, 1);
    await sit(h, created.code, created.runId, 0);
    expect(await two.resume()).toMatchObject({ ok: true });
    // The room's record now names the campaign it is playing.
    expect((await h.harness.repo.getRun(created.runId))?.campaignId).toBe(GEMFALL);

    // Stopped again by the resumed room's host; the first save is long spent.
    h.harness.clock.advance(60 * 60 * 1000);
    expect(
      await stopForToday({ code: created.code, principal: h.players[1]!.principal }, h.harness.deps),
    ).toMatchObject({ ok: true });
    const stops = (await h.harness.repo.listRuns(h.householdId)).filter((r) => r.stoppedAt !== undefined);
    expect(stops.map((r) => r.id)).toEqual([created.runId]);
    expect(stops[0]!.id).not.toBe(e.runId);

    // The device that stopped it this time lets her go; the original host cannot.
    expect(
      await releaseSavedHero({ deviceId: host.deviceId, householdId: h.householdId, characterId: pip.id }, h.harness.deps),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await releaseSavedHero(
        { deviceId: h.players[1]!.principal.deviceId, householdId: h.householdId, characterId: pip.id },
        h.harness.deps,
      ),
    ).toMatchObject({ ok: true, value: { left: GEMFALL } });
  });

  it("supersedes an older save of the same campaign even when the newer room was opened for none", async () => {
    const { h, e } = await stopped();
    h.harness.clock.advance(3 * DAY);
    const created = await room(h, null, 1);
    const two = await sit(h, created.code, created.runId, 1);
    await two.resume();
    // Un-spend the first save to prove the stop clears it by the state's campaign.
    const first = (await h.harness.repo.getRun(e.runId))!;
    await h.harness.repo.putRun({ ...first, stoppedAt: "2026-07-01T00:00:00.000Z", stoppedBy: "d_old" });
    h.harness.clock.advance(60 * 60 * 1000);
    await stopForToday({ code: created.code, principal: h.players[1]!.principal }, h.harness.deps);
    expect((await h.harness.repo.getRun(e.runId))?.stoppedAt).toBeUndefined();
    expect((await h.harness.repo.getRun(created.runId))?.stoppedAt).toBeTypeOf("string");
  });
});
