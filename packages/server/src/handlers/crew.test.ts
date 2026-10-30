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
import { followCrew, MAX_CREWS, nextCrewName, parseCrewChoice, switchCrew, CREW_NAMES } from "./crew.ts";
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
  it("names a crew with the first name nobody has, then counts", () => {
    expect(nextCrewName([])).toBe(CREW_NAMES[0]);
    expect(nextCrewName([CREW_NAMES[0]])).toBe(CREW_NAMES[1]);
    expect(nextCrewName([...CREW_NAMES])).toBe(`Crew ${CREW_NAMES.length + 2}`);
  });

  it("reads only a crew id, null or new", () => {
    expect(parseCrewChoice({ crew: null })).toBeNull();
    expect(parseCrewChoice({ crew: "new" })).toBe("new");
    expect(parseCrewChoice({ crew: "cw_ab12" })).toBe("cw_ab12");
    expect(parseCrewChoice({})).toBeUndefined();
    expect(parseCrewChoice({ crew: "gemfall~x" })).toBeUndefined();
    expect(parseCrewChoice({ crew: "cw_a@b" })).toBeUndefined();
  });
});
