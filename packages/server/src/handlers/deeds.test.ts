/**
 * Deeds through the server (#310): the chapter's count folded into each
 * stored hero at completion, provisional while the campaign is in flight;
 * taken back with everything else when the campaign fails; kept when it
 * completes; and a class way at a rift written straight onto the hero.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyIntent,
  createRunState,
  newCharacter,
  resolveCharacter,
  type Campaign,
  type Chapter,
  type ClassId,
  type ClientIntent,
  type HeroDeeds,
  type RulesContent,
  type RunState,
} from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeChapter, makeRules } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, T0, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";
import { settleChapterCompletion } from "./progression.ts";

/** The fixture rules, with a short ladder for every class so a test can climb it. */
function deedRules(): RulesContent {
  const rules = makeRules();
  const ladder = {
    apprentice: { withFriends: { song_hearts: 4 } },
    expert: { withFriends: { song_hearts: 4 } },
    master: { withFriends: { song_hearts: 4, class_story: 1 } },
  };
  const classes = Object.fromEntries(
    Object.entries(rules.classes).map(([id, def]) => [
      id,
      {
        ...def,
        deeds: id === "songkeeper" ? ladder : {
          apprentice: { withFriends: { hold_ground: 2 } },
          expert: { withFriends: { hold_ground: 2 } },
          master: { withFriends: { hold_ground: 2, class_story: 1 } },
        },
      },
    ]),
  ) as RulesContent["classes"];
  return { ...rules, classes };
}

/** The Hollow Crown, two chapters long — or one, when its first chapter is its last. */
function campaignHarness(chapters = ["bramblewood-01", "bramblewood-02"]) {
  return makeHarness({
    content: makeContent({
      rules: deedRules(),
      chapters: [makeChapter(), { ...makeChapter(), id: "bramblewood-02", index: 2 }],
      campaigns: [{ id: "the-hollow-crown", title: "The Hollow Crown", blurb: "", chapters } as Campaign],
    }),
  });
}

/** A Songkeeper stored at `rank`, and a run completing chapter 1 with `counted` on it. */
async function completing(harness: TestHarness, rank: "none" | "apprentice", counted: HeroDeeds | undefined, outcome: "success" | "setback" = "success") {
  const { householdId, players } = await seedHousehold(harness, 1);
  const playerId = players[0]!.principal.playerId;
  const rules = harness.deps.content.rules();
  const items = harness.deps.content.items();
  const character = newCharacter({
    id: `c_${playerId}`,
    householdId,
    ownerPlayerId: playerId,
    name: "Pip",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 0, quick: 1, clever: 0, heart: 2 },
    appearance: { palette: "dawn", accent: "gold" },
    rules,
    now: new Date(T0).toISOString(),
  });
  character.committed.mastery.songkeeper = { rank, deeds: rank === "apprentice" ? { song_hearts: 1 } : {} };
  await harness.repo.putCharacter(character);
  const state = {
    runId: "r_1",
    campaignId: "the-hollow-crown",
    chapterId: "bramblewood-01",
    chapterOutcome: outcome,
    bonuses: [],
    xpEarned: 100,
    party: [{ character: resolveCharacter(character, rules, items), playerId, hp: 10, down: false, connected: true, ready: false }],
    ...(counted ? { deeds: { heroes: { [character.id]: counted } } } : {}),
  } as unknown as RunState;
  return { householdId, state, character };
}

describe("a chapter's deeds, folded at completion", () => {
  it("land on the stored hero provisionally, reach the phones on the same patch, and leave the run", async () => {
    const harness = campaignHarness();
    const counted: HeroDeeds = { class: "songkeeper", rank: "apprentice", deeds: { song_hearts: 3 } };
    const { householdId, state } = await completing(harness, "none", counted);

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    const written = settlement.characters[0]!.character;
    expect(written.provisional?.mastery.songkeeper).toEqual({ rank: "apprentice", deeds: { song_hearts: 3 } });
    expect(written.committed.mastery.songkeeper).toEqual({ rank: "none", deeds: {} });
    expect(state.party[0]!.character).toMatchObject({ rank: "apprentice", deeds: { song_hearts: 3 } });
    expect(state.party[0]!.character.actions).toContain("soothe");
    expect(state).not.toHaveProperty("deeds");
  });

  it("are taken back when the campaign fails, to how the class stood when it began", async () => {
    const harness = campaignHarness();
    const { householdId, state } = await completing(harness, "apprentice", { class: "songkeeper", rank: "expert", deeds: { song_hearts: 2 } }, "setback");
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: "the-hollow-crown",
      status: "active",
      setbacks: 2,
      updatedAt: new Date(T0).toISOString(),
    });

    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    expect(settlement.campaignProgress).toMatchObject({ status: "failed" });
    const failed = settlement.characters[0]!.character;
    expect(failed.provisional).toBeNull();
    expect(failed.committed.mastery.songkeeper).toEqual({ rank: "apprentice", deeds: { song_hearts: 1 } });
    // The phones see the revert now, and nothing on the run can put it back.
    expect(state.party[0]!.character).toMatchObject({ rank: "apprentice", deeds: { song_hearts: 1 } });
    expect(state.party[0]!.character.actions).not.toContain("chorus");
    expect(state).not.toHaveProperty("deeds");
  });

  it("are kept when the campaign completes", async () => {
    const harness = campaignHarness(["bramblewood-01"]);
    const { householdId, state } = await completing(harness, "none", { class: "songkeeper", rank: "apprentice", deeds: {} });
    const settlement = await settleChapterCompletion(state, harness.deps, householdId);
    expect(settlement.campaignProgress).toMatchObject({ status: "complete" });
    expect(settlement.characters[0]!.character.committed.mastery.songkeeper).toEqual({ rank: "apprentice", deeds: {} });
  });

  it("change nothing when nothing was counted", async () => {
    const harness = campaignHarness();
    const { householdId, state, character } = await completing(harness, "none", undefined);
    const settlement = await settleChapterCompletion(state, harness.deps, householdId);
    expect(settlement.characters[0]!.character.provisional?.mastery).toEqual(character.committed.mastery);
  });
});

// ---------------------------------------------------------------------------
// A class way at a rift (#199)
// ---------------------------------------------------------------------------

const realEngine: Engine = { applyIntent, createRunState };

function sealed(): Campaign {
  return JSON.parse(
    readFileSync(new URL("../../../shared/src/fixtures/rift-classes.campaign.json", import.meta.url), "utf8"),
  ) as Campaign;
}

async function riftTable(classes: ClassId[]) {
  const campaign = sealed();
  const chapters: Chapter[] = campaign.chapters.map((id, i) => ({ ...makeChapter(), id, campaignId: campaign.id, index: i + 1, title: id }));
  const harness = makeHarness({ engine: realEngine, playtest: true, content: makeContent({ rules: deedRules(), chapters, campaigns: [campaign] }) });
  const seeded = await seedHousehold(harness, classes.length);
  const created = await createRoom({ householdId: seeded.householdId, mode: "party", campaignId: campaign.id }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const seats: string[] = [];
  for (const i of classes.keys()) {
    const joined = await joinRoom({ code, principal: seeded.players[i]!.principal }, harness.deps);
    if (!joined.ok) throw new Error("join");
    seats.push(joined.value.playerId);
  }
  const state = async () => (await harness.repo.getState(runId))!;
  const send = async (intent: ClientIntent, seat = 0) =>
    applyAction({ runId, playerId: seats[seat]!, seq: (await state()).seq, intent }, harness.deps);
  const must = async (intent: ClientIntent, seat = 0) => {
    const response = await send(intent, seat);
    expect(response.ok, `${intent.type}: ${JSON.stringify(response.ok ? null : response.error)}`).toBe(true);
  };
  for (const [seat, cls] of classes.entries()) {
    await must({ type: "CREATE_CHARACTER", name: ["Pip", "Wren"][seat]!, species: "unicorn", class: cls, stats: { might: 1, quick: 1, clever: 0, heart: 1 } }, seat);
  }
  const everyone = async (intent: ClientIntent) => {
    for (const seat of seats.keys()) await must(intent, seat);
  };
  await everyone({ type: "READY", ready: true });
  const visit = async () => ((await state()).campaign?.journey?.visit ?? 0);
  const play = async () => {
    await must({ type: "CONTINUE_CAMPAIGN" });
    await must({ type: "PLAYTEST_GOTO", sceneId: "scene_ending" });
  };
  // Camp played, walked to the sealed rift, the gate played: choosing a way on.
  await play();
  await must({ type: "CHOOSE_EXIT", edgeId: "camp-to-gate", visit: await visit() });
  await must({ type: "ADVANCE" });
  await everyone({ type: "READY", ready: true });
  await play();
  const hero = async (seat: number) => {
    const id = (await state()).party[seat]!.character.id;
    return (await harness.repo.getCharacter(seeded.householdId, id))!;
  };
  return { harness, state, send, visit, hero, householdId: seeded.householdId };
}

describe("a class way at a rift is that class's story deed", () => {
  it("lands a Master it completes on the hero who wears the class, in the rift action's commit, and nobody else", async () => {
    const t = await riftTable(["thornguard", "songkeeper"]);
    // The Thornguard is an Expert one story deed short of Master.
    const tg = await t.hero(0);
    tg.provisional!.mastery.thornguard = { rank: "expert", deeds: { hold_ground: 2 } };
    await t.harness.repo.putCharacter(tg);
    const sk = await t.hero(1);
    sk.provisional!.mastery.songkeeper = { rank: "expert", deeds: { song_hearts: 4 } };
    await t.harness.repo.putCharacter(sk);

    const opened = await t.send({ type: "RIFT_ACTION", action: "open", edgeId: "veil-rift", way: "force", visit: await t.visit() });
    expect(opened.ok).toBe(true);

    const after = await t.hero(0);
    expect(after.provisional?.mastery.thornguard).toEqual({ rank: "master", deeds: {} });
    expect(after.committed.mastery.thornguard).toEqual({ rank: "none", deeds: {} });
    // The Songkeeper did not take the Thornguard's way.
    expect((await t.hero(1)).provisional?.mastery.songkeeper).toEqual({ rank: "expert", deeds: { song_hearts: 4 } });
    const state = await t.state();
    expect(state.party[0]!.character).toMatchObject({ rank: "master" });
    expect(state.rankUps?.ups.map((u) => [u.class, u.rank])).toEqual([["thornguard", "master"]]);
  });

  it("writes nothing for a hero whose next rank does not want a story deed", async () => {
    const t = await riftTable(["thornguard"]);
    const before = await t.hero(0);
    expect((await t.send({ type: "RIFT_ACTION", action: "open", edgeId: "veil-rift", way: "force", visit: await t.visit() })).ok).toBe(true);
    const after = await t.hero(0);
    expect(after.provisional?.mastery).toEqual(before.provisional?.mastery);
    expect(after.version).toBe(before.version);
  });
});

describe("a hero re-resolved mid-chapter", () => {
  it("keeps the rank this chapter earned her when she spends a stat point at a rest", async () => {
    const harness = campaignHarness();
    const { householdId, state, character } = await completing(harness, "none", { class: "songkeeper", rank: "apprentice", deeds: { song_hearts: 2 } });
    const playerId = state.party[0]!.playerId;
    character.committed.unspentPoints = 1;
    await harness.repo.putCharacter(character);
    Object.assign(state, { roomCode: "ABCD", seq: 0, phase: "scene", sceneId: "scene_camp", sceneType: "rest", chapterOutcome: null, updatedAt: new Date(T0).toISOString() });
    await harness.repo.putRun({ id: state.runId, householdId, roomCode: "ABCD", campaignId: null, status: "active", createdAt: new Date(T0).toISOString() });
    await harness.repo.putState(state);

    const response = await applyAction(
      { runId: state.runId, playerId, seq: 0, intent: { type: "SPEND_STAT_POINT", stat: "heart" }, principal: { householdId, playerId } },
      harness.deps,
    );

    expect(response.ok).toBe(true);
    const after = (await harness.repo.getState(state.runId))!;
    expect(after.party[0]!.character).toMatchObject({ rank: "apprentice", deeds: { song_hearts: 2 }, unspentPoints: 0 });
    expect(after.party[0]!.character.actions).toContain("soothe");
    // The row learns of the rank only when the chapter is folded.
    expect((await harness.repo.getCharacter(householdId, character.id))!.committed.mastery.songkeeper).toEqual({ rank: "none", deeds: {} });
  });
});
