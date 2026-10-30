/**
 * Crews (architecture §4.5, "Crews"): a new group of players at the same TV
 * starts its own adventure, and the family's save is exactly where it was.
 */

import path from "node:path";
import { applyIntent, createRunState, makeRng, type ClientIntent, type RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { followCrew, MAX_CREWS, parseCrewChoice, switchCrew, CREW_NAMES } from "./crew.ts";
import { createRoom, joinRoom } from "./room.ts";
import { resumeGame, stopForToday } from "./save.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };
const GEMFALL = "gemfall";

async function household(players = 3) {
  const harness = makeHarness({ engine: realEngine, playtest: true, content });
  harness.deps.rng = (key) => makeRng(`crew:${String(key).split(":").pop()}`);
  return { harness, ...(await seedHousehold(harness, players)) };
}

type Household = Awaited<ReturnType<typeof household>>;

/** A Gemfall room the TV-like host (player 0's device) opened. */
async function room(h: Household) {
  const created = await createRoom(
    { householdId: h.householdId, mode: "party", campaignId: GEMFALL, hostDeviceId: h.players[0]!.principal.deviceId },
    h.harness.deps,
  );
  if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
  return created.value;
}

async function sit(h: Household, code: string, runId: string, seat: number) {
  const joined = await joinRoom({ code, principal: h.players[seat]!.principal }, h.harness.deps);
  if (!joined.ok) throw new Error(`join: ${JSON.stringify(joined)}`);
  const playerId = joined.value.playerId;
  const state = async (): Promise<RunState> => (await h.harness.repo.getState(runId))!;
  const must = async (intent: ClientIntent) => {
    const response = await applyAction({ runId, playerId, seq: (await state()).seq, intent }, h.harness.deps);
    if (!response.ok) throw new Error(`${intent.type}: ${JSON.stringify(response.error)}`);
    return response;
  };
  return { playerId, state, must };
}

const HERO = { species: "unicorn", class: "thornguard", stats: { might: 1, quick: 1, clever: 0, heart: 1 } } as const;

/** The family (player 1) begins Gemfall and stops for today: a save the first crew owns. */
async function familyStops(h: Household) {
  const created = await room(h);
  const kid = await sit(h, created.code, created.runId, 1);
  await kid.must({ type: "CREATE_CHARACTER", name: "Pip", ...HERO });
  await kid.must({ type: "READY", ready: true });
  await kid.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
  const stopped = await stopForToday({ code: created.code, principal: h.players[0]!.principal }, h.harness.deps);
  if (!stopped.ok) throw new Error(`stop: ${JSON.stringify(stopped)}`);
}

const host = (h: Household) => h.players[0]!.principal;

describe("a new crew at the same household", () => {
  it("hands connected phones a fresh lineup, keeps heroes and saves, and retries without clearing new heroes", async () => {
    const h = await household();
    await familyStops(h);
    const save = await h.harness.repo.getCampaignProgress(h.householdId, GEMFALL);
    const evening = await room(h);
    const kid = await sit(h, evening.code, evening.runId, 1);
    await kid.must({ type: "CREATE_CHARACTER", name: "Before", ...HERO });
    const before = await kid.state();
    const heroes = await h.harness.repo.listCharacters(h.householdId);
    const tap = { code: evening.code, principal: host(h), crew: "new" as const, request: "tap-friends-night" };
    expect((await switchCrew(tap, h.harness.deps)).ok).toBe(true);
    const fresh = await kid.state();
    expect(fresh.party).toEqual([]);
    expect(fresh.seats).toEqual(before.seats);
    expect(fresh.crewSetup).toBe(true);
    expect(await h.harness.repo.listCharacters(h.householdId)).toEqual(heroes);
    expect(await h.harness.repo.getCampaignProgress(h.householdId, GEMFALL)).toEqual(save);
    await kid.must({ type: "CREATE_CHARACTER", name: "After", ...HERO });
    expect((await switchCrew(tap, h.harness.deps)).ok).toBe(true);
    expect((await kid.state()).party.map(m => m.character.name)).toEqual(["After"]);
    await kid.must({ type: "READY", ready: true });
    await kid.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    expect((await kid.state()).crewSetup).toBeUndefined();
    expect(await h.harness.repo.getCampaignProgress(h.householdId, GEMFALL)).toEqual(save);
  });

  it("starts its own Gemfall from the beginning, and the family's save stays offered to the family", async () => {
    const h = await household();
    await familyStops(h);
    const familyAttempt = await h.harness.repo.getCampaignProgress(h.householdId, GEMFALL);
    expect(familyAttempt?.status).toBe("active");

    const evening = await room(h);
    const lobby = (await h.harness.repo.getState(evening.runId))!;
    expect(lobby.saved?.heroes).toEqual(["Pip"]);
    expect(lobby.crew).toBeUndefined();
    expect(lobby.crews).toBeUndefined();

    const started = await switchCrew({ code: evening.code, principal: host(h), crew: "new" }, h.harness.deps);
    expect(started.ok).toBe(true);
    const crew = started.ok ? started.value.crew! : "";
    const fresh = (await h.harness.repo.getState(evening.runId))!;
    expect(fresh.crew).toBe(crew);
    expect(fresh.crews).toEqual([{ id: crew, name: CREW_NAMES[0] }]);
    // Nothing of the family's: no save to pick up, and Gemfall from its first chapter.
    expect(fresh.saved).toBeUndefined();
    expect(fresh.campaign?.id).toBe(GEMFALL);
    expect(fresh.campaign?.next?.index).toBe(1);

    // A new kid makes a hero and begins: the crew's own attempt, the hero held by it.
    const newKid = await sit(h, evening.code, evening.runId, 2);
    await newKid.must({ type: "CREATE_CHARACTER", name: "Bo", ...HERO });
    await newKid.must({ type: "READY", ready: true });
    await newKid.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    const playing = await newKid.state();
    expect(playing.crew).toBe(crew);
    expect(playing.chapterInfo?.index).toBe(1);

    const crewAttempt = await h.harness.repo.getCampaignProgress(h.householdId, GEMFALL, crew);
    expect(crewAttempt).toMatchObject({ status: "active", crew });
    expect(crewAttempt?.attemptId).not.toBe(familyAttempt?.attemptId);
    expect(await h.harness.repo.getCampaignProgress(h.householdId, GEMFALL)).toEqual(familyAttempt);
    expect(await h.harness.repo.listCampaignProgress(h.householdId)).toEqual([familyAttempt]);
    expect(await h.harness.repo.listCampaignProgress(h.householdId, crew)).toEqual([crewAttempt]);

    const heroes = await h.harness.repo.listCharacters(h.householdId);
    expect(Object.fromEntries(heroes.map((c) => [c.name, c.provisional?.runId]))).toEqual({
      Pip: GEMFALL,
      Bo: `${GEMFALL}~${crew}`,
    });
  });

  it("switches back to the family, whose save is offered again", async () => {
    const h = await household();
    await familyStops(h);
    const evening = await room(h);
    const started = await switchCrew({ code: evening.code, principal: host(h), crew: "new" }, h.harness.deps);
    const crew = started.ok ? started.value.crew! : "";

    expect(await switchCrew({ code: evening.code, principal: host(h), crew: null }, h.harness.deps)).toMatchObject({
      ok: true,
      value: { crew: null },
    });
    const back = (await h.harness.repo.getState(evening.runId))!;
    expect(back.crew).toBeUndefined();
    expect(back.crewSetup).toBeUndefined();
    expect(back.saved?.heroes).toEqual(["Pip"]);
    // The crew is still there to come back to, another evening or now.
    expect(back.crews).toEqual([{ id: crew, name: CREW_NAMES[0] }]);
    expect(await switchCrew({ code: evening.code, principal: host(h), crew }, h.harness.deps)).toMatchObject({
      ok: true,
      value: { crew },
    });
  });

  it("only saves a stop under its own crew, and never retires another crew's", async () => {
    const h = await household();
    await familyStops(h);
    const evening = await room(h);
    const started = await switchCrew({ code: evening.code, principal: host(h), crew: "new" }, h.harness.deps);
    const crew = started.ok ? started.value.crew! : "";
    const newKid = await sit(h, evening.code, evening.runId, 2);
    await newKid.must({ type: "CREATE_CHARACTER", name: "Bo", ...HERO });
    await newKid.must({ type: "READY", ready: true });
    await newKid.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    expect((await stopForToday({ code: evening.code, principal: host(h) }, h.harness.deps)).ok).toBe(true);

    // Next evening opens on the first crew: the family's save, not the crew's.
    const next = await room(h);
    expect((await h.harness.repo.getState(next.runId))!.saved?.heroes).toEqual(["Pip"]);
    await switchCrew({ code: next.code, principal: host(h), crew }, h.harness.deps);
    expect((await h.harness.repo.getState(next.runId))!.saved?.heroes).toEqual(["Bo"]);
  });

  it("is the host's, between games only, and refuses a crew the household does not have", async () => {
    const h = await household();
    const evening = await room(h);
    expect(await switchCrew({ code: evening.code, principal: h.players[1]!.principal, crew: "new" }, h.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await switchCrew({ code: evening.code, principal: host(h), crew: "cw_nobody" }, h.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await h.harness.repo.listCrews(h.householdId)).toEqual([]);

    const kid = await sit(h, evening.code, evening.runId, 1);
    await kid.must({ type: "CREATE_CHARACTER", name: "Pip", ...HERO });
    await kid.must({ type: "READY", ready: true });
    await kid.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    expect(await switchCrew({ code: evening.code, principal: host(h), crew: "new" }, h.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL" },
    });
    expect(await h.harness.repo.listCrews(h.householdId)).toEqual([]);
  });

  it("waits for a TV's room to be somebody's", async () => {
    const h = await household();
    const created = await createRoom(
      { householdId: h.householdId, mode: "party", campaignId: GEMFALL, hostDeviceId: h.players[0]!.principal.deviceId, claimable: true },
      h.harness.deps,
    );
    if (!created.ok) throw new Error("room");
    expect(await switchCrew({ code: created.value.code, principal: host(h), crew: "new" }, h.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL" },
    });
  });

  it("keeps a bounded number of crews", async () => {
    const h = await household();
    const evening = await room(h);
    for (let i = 0; i < MAX_CREWS; i++) {
      expect((await switchCrew({ code: evening.code, principal: host(h), crew: "new" }, h.harness.deps)).ok).toBe(true);
    }
    expect(await switchCrew({ code: evening.code, principal: host(h), crew: "new" }, h.harness.deps)).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL" },
    });
    const names = (await h.harness.repo.listCrews(h.householdId)).map((c) => c.name);
    expect(new Set(names).size).toBe(MAX_CREWS);
  });
});

/** A crew (player 2's Bo) begins Gemfall and stops: next to the family's own save. */
async function crewStops(h: Household): Promise<string> {
  await familyStops(h);
  const evening = await room(h);
  const started = await switchCrew({ code: evening.code, principal: host(h), crew: "new" }, h.harness.deps);
  if (!started.ok) throw new Error("crew");
  const kid = await sit(h, evening.code, evening.runId, 2);
  await kid.must({ type: "CREATE_CHARACTER", name: "Bo", ...HERO });
  await kid.must({ type: "READY", ready: true });
  await kid.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
  if (!(await stopForToday({ code: evening.code, principal: host(h) }, h.harness.deps)).ok) throw new Error("stop");
  return started.value.crew!;
}

const heroId = async (h: Household, name: string) =>
  (await h.harness.repo.listCharacters(h.householdId)).find((c) => c.name === name)!.id;

describe("making a crew is safe to retry and to race", () => {
  const newCrew = (h: Household, code: string) => switchCrew({ code, principal: host(h), crew: "new" }, h.harness.deps);

  it("answers a retried request with the crew it already made", async () => {
    const h = await household();
    const evening = await room(h);
    const tap = { code: evening.code, principal: host(h), crew: "new" as const, request: "tap-0001-aaaa" };
    expect(await switchCrew(tap, h.harness.deps)).toMatchObject({ ok: true, value: { crew: "cw_1" } });
    // Switched away meanwhile: the retry still lands on the crew that tap made.
    await switchCrew({ code: evening.code, principal: host(h), crew: null }, h.harness.deps);
    expect(await switchCrew(tap, h.harness.deps)).toMatchObject({ ok: true, value: { crew: "cw_1" } });
    expect((await h.harness.repo.getState(evening.runId))!.crew).toBe("cw_1");
    expect((await h.harness.repo.listCrews(h.householdId)).map((c) => c.id)).toEqual(["cw_1"]);
  });

  it("makes a new crew for every fresh tap, even while an unused crew is chosen", async () => {
    const h = await household();
    const evening = await room(h);
    const tap = (request: string) =>
      switchCrew({ code: evening.code, principal: host(h), crew: "new", request }, h.harness.deps);
    expect(await tap("tap-0001-aaaa")).toMatchObject({ ok: true, value: { crew: "cw_1" } });
    expect(await tap("tap-0002-bbbb")).toMatchObject({ ok: true, value: { crew: "cw_2" } });
    // An existing crew nobody has played, chosen on purpose, then a new one.
    await switchCrew({ code: evening.code, principal: host(h), crew: "cw_1" }, h.harness.deps);
    expect(await tap("tap-0003-cccc")).toMatchObject({ ok: true, value: { crew: "cw_3" } });
    expect((await h.harness.repo.getState(evening.runId))!.crews?.map((c) => c.name)).toEqual(CREW_NAMES.slice(0, 3));
  });

  it("leaves no crew behind when the lobby change does not land", async () => {
    const h = await household();
    const evening = await room(h);
    h.harness.repo.commit = async () => false;
    expect(await newCrew(h, evening.code)).toMatchObject({ ok: false, error: { code: "STALE_SEQ" } });
    expect(await h.harness.repo.listCrews(h.householdId)).toEqual([]);
    expect((await h.harness.repo.getState(evening.runId))!.crew).toBeUndefined();
  });

  it("gives two rooms starting a crew at once a slot and a name each", async () => {
    const h = await household();
    const one = await room(h);
    const two = await createRoom(
      { householdId: h.householdId, mode: "party", campaignId: GEMFALL, hostDeviceId: h.players[1]!.principal.deviceId },
      h.harness.deps,
    );
    if (!two.ok) throw new Error("room");
    const [a, b] = await Promise.all([
      newCrew(h, one.code),
      switchCrew({ code: two.value.code, principal: h.players[1]!.principal, crew: "new" }, h.harness.deps),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const crews = await h.harness.repo.listCrews(h.householdId);
    expect(crews.map((c) => c.id).sort()).toEqual(["cw_1", "cw_2"]);
    expect(new Set(crews.map((c) => c.name)).size).toBe(2);
    const picked = [a.ok ? a.value.crew : null, b.ok ? b.value.crew : null].sort();
    expect(picked).toEqual(["cw_1", "cw_2"]);
  });

  it("keeps the crews a resumed save never knew about (review #571)", async () => {
    const h = await household();
    await familyStops(h);
    const evening = await room(h);
    await newCrew(h, evening.code);
    await switchCrew({ code: evening.code, principal: host(h), crew: null }, h.harness.deps);

    const kid = await sit(h, evening.code, evening.runId, 1);
    const resumed = await resumeGame({ runId: evening.runId, playerId: kid.playerId, householdId: h.householdId }, h.harness.deps);
    expect(resumed.ok).toBe(true);
    const playing = await kid.state();
    expect(playing.saved).toBeUndefined();
    expect(playing.chapterInfo?.index).toBe(1);
    expect(playing.crews).toEqual([{ id: "cw_1", name: CREW_NAMES[0] }]);
  });
});

describe("the lobby follows the kids", () => {
  it("switches to a returning crew the moment one of its heroes sits down", async () => {
    const h = await household();
    const crew = await crewStops(h);

    const next = await room(h);
    expect((await h.harness.repo.getState(next.runId))!.crew).toBeUndefined();
    const kid = await sit(h, next.code, next.runId, 2);
    await kid.must({ type: "SEAT_CHARACTER", characterId: await heroId(h, "Bo") });

    const lobby = await kid.state();
    expect(lobby.crew).toBe(crew);
    expect(lobby.saved?.heroes).toEqual(["Bo"]);
    // Nobody opened the Room panel: Keep going picks up the crew's own chapter.
    const resumed = await resumeGame({ runId: next.runId, playerId: kid.playerId, householdId: h.householdId }, h.harness.deps);
    expect(resumed.ok).toBe(true);
    const playing = await kid.state();
    expect(playing.crew).toBe(crew);
    expect(playing.chapterInfo?.index).toBe(1);
    expect(playing.party.map((m) => m.character.name)).toEqual(["Bo"]);
  });

  it("goes back to the first crew when the family's hero sits down", async () => {
    const h = await household();
    const crew = await crewStops(h);
    const next = await room(h);
    await switchCrew({ code: next.code, principal: host(h), crew }, h.harness.deps);

    const kid = await sit(h, next.code, next.runId, 1);
    await kid.must({ type: "SEAT_CHARACTER", characterId: await heroId(h, "Pip") });
    const lobby = await kid.state();
    expect(lobby.crew).toBeUndefined();
    expect(lobby.saved?.heroes).toEqual(["Pip"]);
  });

  it("stays put for a new hero, and for heroes of two crews, and then says who plays with whom", async () => {
    const h = await household(4);
    await crewStops(h);
    const next = await room(h);

    const fresh = await sit(h, next.code, next.runId, 3);
    await fresh.must({ type: "CREATE_CHARACTER", name: "Wren", ...HERO });
    expect((await fresh.state()).crew).toBeUndefined();

    const family = await sit(h, next.code, next.runId, 1);
    await family.must({ type: "SEAT_CHARACTER", characterId: await heroId(h, "Pip") });
    const visiting = await sit(h, next.code, next.runId, 2);
    await visiting.must({ type: "SEAT_CHARACTER", characterId: await heroId(h, "Bo") });
    expect((await visiting.state()).crew).toBeUndefined();

    for (const seat of [fresh, family, visiting]) await seat.must({ type: "READY", ready: true });
    const begin = await applyAction(
      { runId: next.runId, playerId: family.playerId, seq: (await family.state()).seq, intent: { type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL } },
      h.harness.deps,
    );
    expect(begin).toMatchObject({
      ok: false,
      error: {
        code: "HERO_BUSY",
        message: `Bo is playing with ${CREW_NAMES[0]}. A grown-up can switch crews in the Room panel.`,
      },
    });
  });

  it("reads nothing at a household that has never made a crew", async () => {
    const h = await household();
    await familyStops(h);
    const next = await room(h);
    const kid = await sit(h, next.code, next.runId, 1);
    await kid.must({ type: "SEAT_CHARACTER", characterId: await heroId(h, "Pip") });
    const lobby = await kid.state();
    expect(lobby.crew).toBeUndefined();
    expect(lobby.crews).toBeUndefined();

    let reads = 0;
    const get = h.harness.repo.getCharacter.bind(h.harness.repo);
    h.harness.repo.getCharacter = async (...args) => {
      reads++;
      return get(...args);
    };
    expect(await followCrew(lobby, h.householdId, GEMFALL, h.harness.deps)).toBe(lobby);
    expect(reads).toBe(0);
  });
});

describe("crew names and bodies", () => {
  it("reads only a crew id, null or new, and a tap id only with new", () => {
    expect(parseCrewChoice({ crew: null })).toEqual({ crew: null });
    expect(parseCrewChoice({ crew: "new" })).toEqual({ crew: "new" });
    expect(parseCrewChoice({ crew: "new", request: "0b9a6f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b" })).toEqual({
      crew: "new",
      request: "0b9a6f3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b",
    });
    expect(parseCrewChoice({ crew: "cw_1" })).toEqual({ crew: "cw_1" });
    expect(parseCrewChoice({ crew: "cw_1", request: "tap-0001-aaaa" })).toEqual({ crew: "cw_1" });
    expect(parseCrewChoice({})).toBeUndefined();
    expect(parseCrewChoice({ crew: "gemfall~x" })).toBeUndefined();
    expect(parseCrewChoice({ crew: "cw_a@b" })).toBeUndefined();
    expect(parseCrewChoice({ crew: "new", request: "short" })).toBeUndefined();
    expect(parseCrewChoice({ crew: "new", request: 42 })).toBeUndefined();
  });
});
