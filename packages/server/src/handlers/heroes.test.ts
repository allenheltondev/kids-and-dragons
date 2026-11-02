/**
 * The hero picker's list (heroes.ts): what holds each hero, and what the room
 * asking would do with her, by the rules the seat itself is decided by.
 */

import path from "node:path";
import { applyIntent, createRunState, makeRng, type ClientIntent, type RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { CREW_NAMES, renameCrew, switchCrew } from "./crew.ts";
import { listHeroes } from "./heroes.ts";
import { createRoom, joinRoom } from "./room.ts";
import { stopForToday } from "./save.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };
const GEMFALL = "gemfall";
const TITLE = content.campaign(GEMFALL)!.title;
const HERO = { species: "unicorn", class: "thornguard", stats: { might: 1, quick: 1, clever: 0, heart: 1 } } as const;

async function household(players = 3) {
  const harness = makeHarness({ engine: realEngine, playtest: true, content });
  harness.deps.rng = (key) => makeRng(`heroes:${String(key).split(":").pop()}`);
  return { harness, ...(await seedHousehold(harness, players)) };
}
type Household = Awaited<ReturnType<typeof household>>;

const host = (h: Household) => h.players[0]!.principal;

async function room(h: Household) {
  const created = await createRoom(
    { householdId: h.householdId, mode: "party", campaignId: GEMFALL, hostDeviceId: host(h).deviceId },
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
  };
  return { playerId, state, must };
}

/** `seat`'s kid makes `name` and begins Gemfall, in a new crew when `crew`; the room is left playing. */
async function begins(h: Household, seat: number, name: string, crew = false) {
  const evening = await room(h);
  let made: string | undefined;
  if (crew) {
    const started = await switchCrew({ code: evening.code, principal: host(h), crew: "new" }, h.harness.deps);
    if (!started.ok) throw new Error("crew");
    made = started.value.crew!;
  }
  const kid = await sit(h, evening.code, evening.runId, seat);
  await kid.must({ type: "CREATE_CHARACTER", name, ...HERO });
  await kid.must({ type: "READY", ready: true });
  await kid.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
  return { ...evening, crew: made, kid };
}

const heroId = async (h: Household, name: string) =>
  (await h.harness.repo.listCharacters(h.householdId)).find((c) => c.name === name)!.id;

const list = async (h: Household, seat: number, runId?: string) => {
  const result = await listHeroes(
    { householdId: h.householdId, playerId: h.players[seat]!.principal.playerId, ...(runId ? { runId } : {}) },
    h.harness.deps,
  );
  if (!result.ok) throw new Error("list");
  return result.value;
};

describe("what holds each hero, as the picker shows it", () => {
  it("says nothing about a free hero", async () => {
    const h = await household();
    const evening = await room(h);
    const kid = await sit(h, evening.code, evening.runId, 1);
    await kid.must({ type: "CREATE_CHARACTER", name: "Wren", ...HERO });
    const next = await room(h);
    const found = await list(h, 1, next.runId);
    expect(found.heroes.map((hero) => hero.name)).toEqual(["Wren"]);
    expect(found.held).toBeUndefined();
  });

  it("names the other crew a hero is playing with, and that sitting her down moves an empty lobby to it", async () => {
    const h = await household();
    await begins(h, 2, "Bo", true);
    const next = await room(h);
    const found = await list(h, 2, next.runId);
    expect(found.held?.[await heroId(h, "Bo")]).toEqual({ campaign: TITLE, crew: CREW_NAMES[0], switches: true });
  });

  it("does not promise a switch when a hero of another crew is already seated", async () => {
    const h = await household(4);
    await begins(h, 1, "Pip");
    await begins(h, 2, "Bo", true);
    const next = await room(h);
    const family = await sit(h, next.code, next.runId, 1);
    await family.must({ type: "SEAT_CHARACTER", characterId: await heroId(h, "Pip") });
    const found = await list(h, 2, next.runId);
    expect(found.held?.[await heroId(h, "Bo")]).toEqual({ campaign: TITLE, crew: CREW_NAMES[0] });
  });

  it("says a hero of this room's crew is partway through, with no crew named", async () => {
    const h = await household();
    await begins(h, 1, "Pip");
    const next = await room(h);
    const found = await list(h, 1, next.runId);
    expect(found.held?.[await heroId(h, "Pip")]).toEqual({ campaign: TITLE });
  });

  it("says why a room playing a chapter cannot seat another crew's hero, in the seat's own words", async () => {
    const h = await household();
    await begins(h, 2, "Bo", true);
    const playing = await begins(h, 1, "Pip");
    const found = await list(h, 2, playing.runId);
    expect(found.held?.[await heroId(h, "Bo")]).toEqual({
      campaign: TITLE,
      crew: CREW_NAMES[0],
      blocked: `Bo is playing with ${CREW_NAMES[0]}. A grown-up can switch crews in the Room panel.`,
    });
  });

  it("calls the first crew by the name the household gave it", async () => {
    const h = await household();
    const family = await begins(h, 1, "Pip");
    expect((await renameCrew({ code: family.code, principal: host(h), crew: null, name: "The Kettle Crew" }, h.harness.deps)).ok).toBe(
      false, // not between games: the family is mid-chapter
    );
    const lobby = await room(h);
    await sit(h, lobby.code, lobby.runId, 2);
    expect((await renameCrew({ code: lobby.code, principal: host(h), crew: null, name: "The Kettle Crew" }, h.harness.deps)).ok).toBe(true);
    const crewRoom = await room(h);
    await switchCrew({ code: crewRoom.code, principal: host(h), crew: "new" }, h.harness.deps);
    const found = await list(h, 1, crewRoom.runId);
    expect(found.held?.[await heroId(h, "Pip")]?.crew).toBe("The Kettle Crew");
  });

  it("keeps saying a stopped game holds her, and names the adventure too", async () => {
    const h = await household();
    const family = await begins(h, 1, "Pip");
    expect((await stopForToday({ code: family.code, principal: host(h) }, h.harness.deps)).ok).toBe(true);
    const next = await room(h);
    const found = await list(h, 1, next.runId);
    const id = await heroId(h, "Pip");
    expect(found.saved?.[id]).toEqual({});
    expect(found.held?.[id]).toEqual({ campaign: TITLE });
  });

  it("answers without a room, as the journal asks", async () => {
    const h = await household();
    await begins(h, 2, "Bo", true);
    const found = await list(h, 2);
    expect(found.held?.[await heroId(h, "Bo")]).toEqual({ campaign: TITLE, crew: CREW_NAMES[0] });
  });
});
