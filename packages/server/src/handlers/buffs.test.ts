/**
 * Temporary buffs (#200), played through the real server.
 *
 * The Humming Spring (shared fixtures/rift-buffs.campaign.json) with the
 * fixture chapter behind every node — the world-state.test.ts harness, bent
 * to this fixture. Every chapter has the fixture's wisp fight and its rest
 * camp, so a test can walk into a fight, out of it, and to an ending.
 *
 * What is pinned is the persistence half of the contract: a buff granted on
 * the journey is held on the household's attempt row, seeded into each
 * chapter run from that row (and only from it — a restarted visit never
 * inherits what an abandoned run spent), carried into the fight, spent by
 * it, read back on completion in the same commit as the rest of the journey,
 * shown on the lobby, and never written to a character row. A completion
 * settled twice spends and grants nothing twice.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { Campaign, Chapter, ClientIntent } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { Engine } from "../engine/port.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, type TestHarness, keepGoing } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { settleChapterCompletion } from "./progression.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const CAMPAIGN_ID = "rift-buffs-sampler";

function spring(): Campaign {
  return JSON.parse(
    readFileSync(new URL("../../../shared/src/fixtures/rift-buffs.campaign.json", import.meta.url), "utf8"),
  ) as Campaign;
}

function springChapters(campaign: Campaign): Chapter[] {
  return campaign.chapters.map((id, i) => ({
    ...makeChapter(),
    id,
    campaignId: campaign.id,
    index: i + 1,
    title: `Title of ${id}`,
  }));
}

const CREATION: ClientIntent = {
  type: "CREATE_CHARACTER",
  name: "Pip",
  species: "unicorn",
  class: "songkeeper",
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
};

async function household() {
  const campaign = spring();
  const harness = makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ chapters: springChapters(campaign), campaigns: [campaign] }),
  });
  const seeded = await seedHousehold(harness, 2);
  const attempt = async () => harness.repo.getCampaignProgress(seeded.householdId, CAMPAIGN_ID);
  return { harness, attempt, ...seeded };
}

/** A room opened for the Humming Spring, with one ready hero — one evening. */
async function room(harness: TestHarness, householdId: string, principal: DeviceIdentity) {
  const created = await createRoom({ householdId, mode: "party", campaignId: CAMPAIGN_ID }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const joined = await joinRoom({ code, principal }, harness.deps);
  if (!joined.ok) throw new Error("join");
  const send = async (intent: ClientIntent) => {
    // The TV's "Keep going" for heroes new to the adventure (crew.ts): these tests are about what follows.
    if (intent.type === "CONTINUE_CAMPAIGN") await keepGoing(harness, runId, intent.campaignId);
    const seq = (await harness.repo.getState(runId))?.seq ?? 0;
    return applyAction({ runId, playerId: joined.value.playerId, seq, intent }, harness.deps);
  };
  const must = async (intent: ClientIntent) => {
    const response = await send(intent);
    expect(response.ok, `${intent.type}: ${JSON.stringify(response.ok ? null : response.error)}`).toBe(true);
    return response;
  };
  const state = async () => (await harness.repo.getState(runId))!;
  await must(CREATION);
  await must({ type: "READY", ready: true });
  return {
    state,
    must,
    view: async () => (await state()).campaign ?? (await state()).campaignOptions?.[0],
    /** Begins the journey's next chapter. */
    begin: async () => {
      await must({ type: "CONTINUE_CAMPAIGN" });
    },
    /** Into the chapter's wisp fight (the ready-up answered). */
    fight: async () => {
      await must({ type: "PLAYTEST_GOTO", sceneId: "encounter_wisps" });
      await must({ type: "READY", ready: true });
    },
    finish: async (sceneId = "scene_ending") => must({ type: "PLAYTEST_GOTO", sceneId }),
    /** From the completion screen: take an exit, back to the lobby, everyone ready. */
    exit: async (edgeId: string) => {
      const visit = (await state()).campaign?.journey?.visit ?? 0;
      await must({ type: "CHOOSE_EXIT", edgeId, visit });
      await must({ type: "ADVANCE" });
      await must({ type: "READY", ready: true });
    },
  };
}

const ids = (list: readonly { id: string }[] | undefined) => (list ?? []).map((b) => b.id);

/** Plays camp, crosses to the spring, plays it: the party holds three buffs. */
async function toTheSpring(a: Awaited<ReturnType<typeof room>>) {
  await a.begin();
  await a.finish();
  await a.exit("camp-to-spring");
  await a.begin();
  await a.finish();
}

describe("temporary buffs on the household's attempt", () => {
  it("are granted on the journey, stored on the attempt, shown on the lobby, and seeded into the next run", async () => {
    const { harness, householdId, players, attempt } = await household();
    const a = await room(harness, householdId, players[0]!.principal);
    expect((await a.view())?.journey).not.toHaveProperty("buffs");

    await a.begin();
    expect((await a.state()).buffs).toEqual([]);
    await a.finish();
    await a.exit("camp-to-spring");
    expect(ids((await attempt())?.journey?.buffs)).toEqual(["fleet-step"]);

    await a.begin();
    expect(ids((await a.state()).buffs)).toEqual(["fleet-step"]);
    expect((await a.state()).buffs![0]).toMatchObject({ label: "Fleet Step", kind: "move", amount: 1, target: "party" });
    await a.finish();
    expect(ids((await attempt())?.journey?.buffs)).toEqual(["fleet-step", "rift-shield", "rift-surge"]);
    expect(ids((await a.view())?.journey?.buffs)).toEqual(["fleet-step", "rift-shield", "rift-surge"]);
  });

  it("go into the fight, survive a reload mid-fight, are spent by it, and the rest is read back on completion", async () => {
    const { harness, householdId, players, attempt } = await household();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheSpring(a);
    await a.exit("spring-to-den");
    expect(ids((await attempt())?.journey?.buffs)).toEqual(["fleet-step", "rift-shield", "rift-surge", "rift-fury", "rift-fray"]);

    await a.begin();
    await a.fight();
    const fighting = await a.state();
    const hero = fighting.party[0]!.character.id;
    expect(fighting.encounter?.buffs?.map((b) => [b.id, b.heroId, b.amount])).toEqual([
      ["fleet-step", hero, 1],
      ["rift-shield", hero, 1],
      ["rift-surge", hero, 1],
      ["rift-fury", hero, 2],
      ["rift-fray", hero, -1],
    ]);
    // The run is stored per seq: a phone that reloads gets the same fight back.
    const reloaded = (await harness.repo.getState(fighting.runId))!;
    expect(reloaded.encounter?.buffs).toEqual(fighting.encounter?.buffs);

    // Out of the fight (a playtest jump ends it like any other way out).
    await a.finish("scene_camp");
    expect((await a.state()).buffs?.map((b) => [b.id, b.encountersLeft])).toEqual([["rift-shield", 1]]);
    // The journey has not moved yet: the run is the chapter's business.
    expect(ids((await attempt())?.journey?.buffs)).toHaveLength(5);

    await a.finish();
    expect((await attempt())?.journey?.buffs).toEqual([
      { id: "rift-shield", stacks: 1, encountersLeft: 1, grantedAt: { node: "spring", visit: 1 } },
    ]);
  });

  it("a visit started again is seeded from the journey, never from what another run spent", async () => {
    const { harness, householdId, players, attempt } = await household();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheSpring(a);
    await a.exit("spring-to-den");
    // Room A plays into the den's fight and out of it: its run has spent.
    await a.begin();
    await a.fight();
    await a.finish("scene_camp");
    expect(ids((await a.state()).buffs)).toEqual(["rift-shield"]);

    // Room B starts the same visit: the journey's buffs, whole, not A's leftovers.
    const b = await room(harness, householdId, players[1]!.principal);
    await b.begin();
    expect(ids((await b.state()).buffs)).toEqual(["fleet-step", "rift-shield", "rift-surge", "rift-fury", "rift-fray"]);

    // A finishes first; B's completion of the same visit is a repeat and settles nothing.
    await a.finish();
    const settled = (await attempt())!;
    expect(ids(settled.journey?.buffs)).toEqual(["rift-shield"]);
    await b.finish();
    expect(await attempt()).toEqual(settled);
    // Settling A's finished run again is a repeat too.
    const again = await settleChapterCompletion(await a.state(), harness.deps, householdId);
    expect(again.stale).toBe(true);
    expect(await attempt()).toEqual(settled);
  });

  it("never touch the character row: a buffed hero's stored stats are what they were", async () => {
    const { harness, householdId, players } = await household();
    const a = await room(harness, householdId, players[0]!.principal);
    await toTheSpring(a);
    await a.exit("spring-to-den");
    await a.begin();
    const id = (await a.state()).party[0]!.character.id;
    const before = (await harness.repo.getCharacter(householdId, id))!;
    await a.fight();
    await a.finish("scene_camp");
    await a.finish();
    const after = (await harness.repo.getCharacter(householdId, id))!;
    expect(JSON.stringify(after)).not.toContain('"buffs"');
    expect(JSON.stringify(after)).not.toContain("rift-shield");
    expect((after.provisional ?? after.committed).stats).toEqual((before.provisional ?? before.committed).stats);
    expect(after.committed).toEqual(before.committed);
  });
});
