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
