/**
 * One game at a time per hero (#282, architecture §4.5, "One game at a time
 * per hero: the claim"), through the handlers and the shipped campaigns.
 *
 * The store's half (conditional writes, the races) is the contract suite's
 * (store/contract.test.ts). This is the game's half: every path that seats a
 * hero asks her claim first, a refused start writes nothing, and the
 * adventure that holds her keeps everything it gave her.
 */

import path from "node:path";
import { applyIntent, createRunState, makeRng, type Character, type ClientIntent, type RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import { makeHarness, seedHousehold, T0 } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { leaveAdventure, viewHousehold } from "./organizer.ts";
import { createRoom, joinRoom } from "./room.ts";
import { setVisitors } from "./visitors.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };
const GEMFALL = "gemfall";
const HOLLOW = "the-hollow-crown";
const DAY = 24 * 60 * 60 * 1000;
const OWNER = { cognitoSub: "sub-test" };

async function household(players = 1) {
  const harness = makeHarness({ engine: realEngine, playtest: true, content });
  harness.deps.rng = (key) => makeRng(`hero-claim:${String(key).split(":").pop()}`);
  const seeded = await seedHousehold(harness, players);
  await harness.repo.putAccountPointer(OWNER.cognitoSub, seeded.householdId);
  return { harness, ...seeded };
}

type Household = Awaited<ReturnType<typeof household>>;

/** A new room for `campaignId`, with player `seat` (0-based) joined. */
async function table(h: Household, campaignId: string, seat = 0) {
  h.harness.clock.advance(DAY);
  const created = await createRoom({ householdId: h.householdId, mode: "party", campaignId }, h.harness.deps);
  if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
  return sit(h, created.value.code, created.value.runId, seat);
}

/** Player `seat` joins the open room `code`. */
async function sit(h: Household, code: string, runId: string, seat: number) {
  const joined = await joinRoom({ code, principal: h.players[seat]!.principal }, h.harness.deps);
  if (!joined.ok) throw new Error("join");
  const playerId = joined.value.playerId;
  const state = async (): Promise<RunState> => (await h.harness.repo.getState(runId))!;
  const send = async (intent: ClientIntent) =>
    applyAction({ runId, playerId, seq: (await state()).seq, intent }, h.harness.deps);
  const must = async (intent: ClientIntent) => {
    const response = await send(intent);
    if (!response.ok) throw new Error(`${intent.type}: ${JSON.stringify(response.error)}`);
    return response;
  };
  return { code, runId, playerId, state, send, must };
}

/** The first success ending of the chapter the room is in. */
function successEnding(chapterId: string): string {
  const chapter = content.chapter(chapterId)!;
  const [id] = Object.entries(chapter.scenes).find(
    ([, scene]) =>
      "choices" in scene && Array.isArray(scene.choices) && scene.choices.length === 0 &&
      !("outcome" in scene && scene.outcome === "setback") &&
      !("endsCampaign" in scene && scene.endsCampaign === true),
  )!;
  return id;
}

/** Pip, made at a Gemfall table that then plays chapter 1 to its end. */
async function pipInGemfall(h: Household) {
  const t = await table(h, GEMFALL);
  await t.must({
    type: "CREATE_CHARACTER",
    name: "Pip",
    species: "unicorn",
    class: "thornguard",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  });
  await t.must({ type: "READY", ready: true });
  await t.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
  await t.must({ type: "PLAYTEST_GOTO", sceneId: successEnding((await t.state()).chapterId!) });
  const [pip] = await h.harness.repo.listCharacters(h.householdId);
  return pip!;
}

describe("one game at a time per hero (#282)", () => {
  it("a hero in Gemfall cannot start the Hollow Crown, and Gemfall keeps everything it gave her", async () => {
    const h = await household();
    const pip = await pipInGemfall(h);
    expect(pip.provisional?.runId).toBe(GEMFALL);
    expect(pip.provisional!.xp).toBeGreaterThan(0);

    // Same household, another campaign: the lobby seats her (which of this
    // table's campaigns is next is not decided yet), the start refuses her.
    const hollow = await table(h, HOLLOW);
    await hollow.must({ type: "SEAT_CHARACTER", characterId: pip.id });
    await hollow.must({ type: "READY", ready: true });
    // Two campaigns on offer (Gemfall is part-way), so the table votes first.
    await hollow.must({ type: "VOTE_CAMPAIGN", campaignId: HOLLOW });
    const before = (await hollow.state()).seq;
    const refused = await hollow.send({ type: "CONTINUE_CAMPAIGN", campaignId: HOLLOW });
    expect(refused.ok).toBe(false);
    expect(refused.error).toEqual({ code: "HERO_BUSY", message: "Pip is in the middle of another adventure" });
    // Nothing written: no seq burned, no attempt begun, and Pip as she was.
    expect((await hollow.state()).seq).toBe(before);
    expect((await hollow.state()).chapterId).toBeNull();
    expect(await h.harness.repo.getCampaignProgress(h.householdId, HOLLOW)).toBeNull();
    expect(await h.harness.repo.getCharacter(h.householdId, pip.id)).toEqual(pip);

    // The next Gemfall evening picks her up where she was, and adds to it.
    const next = await table(h, GEMFALL);
    await next.must({ type: "SEAT_CHARACTER", characterId: pip.id });
    await next.must({ type: "READY", ready: true });
    await next.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    expect(content.chapter((await next.state()).chapterId!)!.index).toBe(2);
    await next.must({ type: "PLAYTEST_GOTO", sceneId: successEnding((await next.state()).chapterId!) });
    const later = (await h.harness.repo.getCharacter(h.householdId, pip.id))!;
    expect(later.provisional?.runId).toBe(GEMFALL);
    expect(later.provisional!.xp).toBeGreaterThan(pip.provisional!.xp);
    expect(later.committed).toEqual(pip.committed);
    expect(later.version).toBeGreaterThan(pip.version!);
  });

  it("a table she is visiting holds her until its adventure ends, then she is free", async () => {
    const h = await household();
    const pip = await pipInGemfall(h);
    // Rue's household is playing Gemfall with her (#249 seats a visitor there):
    // her claim names Rue's table.
    const atRues: Character = { ...pip, provisional: { ...pip.provisional!, runId: `${GEMFALL}@h_rue`, xp: 999 } };
    await h.harness.repo.putCharacter(atRues);
    const rue = { householdId: "h_rue", campaignId: GEMFALL, setbacks: 0, version: 4, updatedAt: new Date(T0).toISOString() };
    await h.harness.repo.putCampaignProgress({ ...rue, status: "active" });

    const home = await table(h, GEMFALL);
    const refused = await home.send({ type: "SEAT_CHARACTER", characterId: pip.id });
    expect(refused.error?.code).toBe("HERO_BUSY");
    expect((await home.state()).party).toEqual([]);

    // Rue's Gemfall is over: her gains there were settled or discarded with
    // it, so home reclaims her, from committed, conditioned on that claim.
    await h.harness.repo.putCampaignProgress({ ...rue, status: "complete" });
    await home.must({ type: "SEAT_CHARACTER", characterId: pip.id });
    await home.must({ type: "READY", ready: true });
    await home.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    const reclaimed = (await h.harness.repo.getCharacter(h.householdId, pip.id))!;
    expect(reclaimed.provisional).toMatchObject({ runId: GEMFALL, xp: pip.committed.xp });
  });

  it("joining a chapter under way claims her in the seat's own commit, or refuses her", async () => {
    const h = await household(3);
    await pipInGemfall(h);
    const playing = await table(h, GEMFALL);
    const [pip] = await h.harness.repo.listCharacters(h.householdId);
    await playing.must({ type: "SEAT_CHARACTER", characterId: pip!.id });
    await playing.must({ type: "READY", ready: true });
    await playing.must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
    expect((await playing.state()).phase).toBe("scene");

    // Player 2's hero, saved and free, joins mid-chapter.
    const bo: Character = { ...pip!, id: "c_bo", name: "Bo", ownerPlayerId: "p_2", provisional: null, version: 3 };
    await h.harness.repo.putCharacter(bo);
    const late = await sit(h, playing.code, playing.runId, 1);
    await late.must({ type: "SEAT_CHARACTER", characterId: "c_bo" });
    const seated = (await h.harness.repo.getCharacter(h.householdId, "c_bo"))!;
    expect(seated.provisional?.runId).toBe(GEMFALL);
    expect(seated.version).toBe(4);
    expect((await late.state()).party.find((m) => m.character.id === "c_bo")?.character.isProvisional).toBe(true);

    // A hero the Hollow Crown holds cannot join Gemfall mid-chapter.
    await h.harness.repo.putCampaignProgress({
      householdId: h.householdId,
      campaignId: HOLLOW,
      status: "active",
      setbacks: 0,
      updatedAt: new Date(T0).toISOString(),
    });
    const held: Character = {
      ...bo,
      id: "c_cy",
      name: "Cy",
      ownerPlayerId: "p_3",
      provisional: { ...bo.committed, runId: HOLLOW },
    };
    await h.harness.repo.putCharacter(held);
    const other = await sit(h, playing.code, playing.runId, 2);
    const refused = await other.send({ type: "SEAT_CHARACTER", characterId: "c_cy" });
    expect(refused.error).toEqual({ code: "HERO_BUSY", message: "Cy is in the middle of another adventure" });
    expect(await h.harness.repo.getCharacter(h.householdId, "c_cy")).toEqual(held);
    expect((await other.state()).party.map((m) => m.character.id)).not.toContain("c_cy");
  });

  it("her grown-up can end the adventure: its gains go, and another table may seat her", async () => {
    const h = await household();
    const pip = await pipInGemfall(h);

    const view = await viewHousehold({ ...OWNER, householdId: h.householdId }, h.harness.deps);
    expect(view.ok && view.value.players[0]!.heroes[0]).toMatchObject({ name: "Pip", adventure: "Gemfall" });

    const left = await leaveAdventure({ ...OWNER, householdId: h.householdId, characterId: pip.id }, h.harness.deps);
    expect(left.ok && left.value.players[0]!.heroes[0]).not.toHaveProperty("adventure");
    const free = (await h.harness.repo.getCharacter(h.householdId, pip.id))!;
    expect(free.provisional).toBeNull();
    expect(free.committed).toEqual(pip.committed);

    const hollow = await table(h, HOLLOW);
    await hollow.must({ type: "SEAT_CHARACTER", characterId: pip.id });
    await hollow.must({ type: "READY", ready: true });
    await hollow.must({ type: "VOTE_CAMPAIGN", campaignId: HOLLOW });
    await hollow.must({ type: "CONTINUE_CAMPAIGN", campaignId: HOLLOW });
    expect((await h.harness.repo.getCharacter(h.householdId, pip.id))!.provisional?.runId).toBe(HOLLOW);

    // Somebody else's grown-up cannot.
    const stranger = await leaveAdventure(
      { cognitoSub: "sub_other", householdId: h.householdId, characterId: pip.id },
      h.harness.deps,
    );
    expect(stranger.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Visiting tables (#249): one hero, several households
// ---------------------------------------------------------------------------

/** A household with one player on a bound phone. */
async function homeOf(harness: Household["harness"], id: string, name: string) {
  await harness.repo.putHousehold({
    id,
    displayName: id,
    ownerSub: null,
    guest: false,
    createdAt: new Date(harness.clock.now()).toISOString(),
  });
  const playerId = `p_${id}`;
  await harness.repo.putPlayer({ id: playerId, householdId: id, displayName: name, color: "#E8A33D" });
  const { deviceId } = await harness.identity.issueDeviceToken({ householdId: id, playerId });
  return { deviceId, householdId: id, playerId };
}

/**
 * A table in household `id` playing `campaignId`, open to visitors, with its
 * own kid seated on a new hero and `visitor` joined on the long code.
 */
async function visitedTable(
  harness: Household["harness"],
  id: string,
  campaignId: string,
  visitor: Awaited<ReturnType<typeof homeOf>>,
) {
  const host = await homeOf(harness, id, `Host ${id}`);
  const owner = { cognitoSub: `sub_${id}` };
  await harness.repo.putAccountPointer(owner.cognitoSub, id);
  const created = await createRoom({ householdId: id, mode: "travel", hostDeviceId: host.deviceId, campaignId }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  if (!(await joinRoom({ code, principal: host }, harness.deps)).ok) throw new Error("host join");
  const opened = await setVisitors({ ...owner, code, open: true }, harness.deps);
  if (!opened.ok || !opened.value.visitorCode) throw new Error("open");
  const joined = await joinRoom({ code, principal: visitor, visitorCode: opened.value.visitorCode }, harness.deps);
  if (!joined.ok) throw new Error(`visitor join: ${JSON.stringify(joined)}`);
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const act = (who: typeof host, intent: ClientIntent) =>
    state().then((s) => applyAction({ runId, playerId: who.playerId, seq: s.seq, intent, principal: who }, harness.deps));
  expect(
    await act(host, {
      type: "CREATE_CHARACTER",
      name: `Kid ${id}`,
      species: "unicorn",
      class: "thornguard",
      stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    }),
  ).toMatchObject({ ok: true });
  await act(host, { type: "READY", ready: true });
  return { host, code, runId, state, act };
}

describe("one hero, tables in several households (#282, #249)", () => {
  it("only one table claims her, even two tables on the same campaign, and the winner keeps every gain", async () => {
    const harness = makeHarness({ engine: realEngine, playtest: true, content });
    harness.deps.rng = (key) => makeRng(`hero-claim:${String(key).split(":").pop()}`);
    const ada = await homeOf(harness, "h_ada", "Ada");
    const sparkle: Character = {
      id: "c_sparkle",
      householdId: "h_ada",
      ownerPlayerId: ada.playerId,
      name: "Sparklehoof",
      species: "unicorn",
      class: "songkeeper",
      appearance: { palette: "meadow", accent: "#7FD4C1" },
      committed: {
        level: 1,
        xp: 0,
        stats: { might: 1, quick: 1, clever: 1, heart: 2 },
        tier: "fledgling",
        unlockedActions: [],
        inventory: [],
        unspentPoints: 0,
      },
      provisional: null,
      questItems: [],
      souvenirs: [],
      createdAt: new Date(T0).toISOString(),
    };
    await harness.repo.putCharacter(sparkle);
    const read = async () => (await harness.repo.getCharacter("h_ada", sparkle.id))!;

    // Rue's and the club's tables both play Gemfall, and Ada visits both.
    const rues = await visitedTable(harness, "h_rue", GEMFALL, ada);
    const club = await visitedTable(harness, "h_club", GEMFALL, ada);
    // Free, so both lobbies seat her: neither has started an adventure yet.
    for (const t of [rues, club]) {
      expect(await t.act(ada, { type: "SEAT_CHARACTER", characterId: sparkle.id })).toMatchObject({ ok: true });
      await t.act(ada, { type: "READY", ready: true });
    }

    // Rue's table starts first and claims her, for Rue's table.
    expect(await rues.act(rues.host, { type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL })).toMatchObject({ ok: true });
    expect((await read()).provisional?.runId).toBe(`${GEMFALL}@h_rue`);

    // The club's Gemfall is the same campaign at another table: refused.
    const clubSeq = (await club.state()).seq;
    expect(await club.act(club.host, { type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL })).toEqual({
      ok: false,
      seq: clubSeq,
      error: { code: "HERO_BUSY", message: "Sparklehoof is in the middle of another adventure" },
    });
    expect((await club.state()).seq).toBe(clubSeq);
    expect(await harness.repo.getCampaignProgress("h_club", GEMFALL)).toBeNull();

    // Rue's table plays chapter 1 to its end: the gains go to Ada's home row.
    await rues.act(rues.host, { type: "PLAYTEST_GOTO", sceneId: successEnding((await rues.state()).chapterId!) });
    const won = await read();
    expect(won.provisional).toMatchObject({ runId: `${GEMFALL}@h_rue` });
    expect(won.provisional!.xp).toBeGreaterThan(0);
    expect(won.committed).toEqual(sparkle.committed);
    expect(await harness.repo.getCharacter("h_rue", sparkle.id)).toBeNull();

    // Another campaign at a third table is refused at the seat, and so is
    // her own home's Gemfall: the claim names Rue's table, not the campaign.
    const castle = await visitedTable(harness, "h_castle", HOLLOW, ada);
    expect((await castle.act(ada, { type: "SEAT_CHARACTER", characterId: sparkle.id })).error?.code).toBe("HERO_BUSY");
    const created = await createRoom({ householdId: "h_ada", mode: "party", campaignId: GEMFALL }, harness.deps);
    if (!created.ok) throw new Error("home room");
    if (!(await joinRoom({ code: created.value.code, principal: ada }, harness.deps)).ok) throw new Error("home join");
    const homeSeat = await applyAction(
      {
        runId: created.value.runId,
        playerId: ada.playerId,
        seq: (await harness.repo.getState(created.value.runId))!.seq,
        intent: { type: "SEAT_CHARACTER", characterId: sparkle.id },
      },
      harness.deps,
    );
    expect(homeSeat.error?.code).toBe("HERO_BUSY");

    // Nothing any refusal did touched her row.
    expect(await read()).toEqual(won);
  });
});
