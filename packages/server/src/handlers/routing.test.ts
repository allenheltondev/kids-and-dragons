/**
 * Routed beats, across the evenings a campaign actually takes.
 *
 * Two facts are being pinned here, and they are the same fact seen from the
 * two ends of a week:
 *
 *   1. **The road survives going home.** A campaign is 4-8 chapters spread
 *      over weeks (spec §8.1) and every evening is a fresh run whose `flags`
 *      start empty. A road chosen at the end of chapter 2 has to be readable
 *      at the start of chapter 3 in a different room on a different night, so
 *      it lives on the campaign attempt, not on the run.
 *   2. **The server picks the chapter.** A routed beat is several chapter
 *      files sharing an index. The client sends an id; the id is not the
 *      authority. Whatever arrives, the party enters the chapter their flags
 *      select or they enter nothing (architecture §4.1).
 */

import { describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { Campaign, Chapter, ClientIntent } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { Engine } from "../engine/port.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, T0, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { settleChapterCompletion } from "./progression.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };

const RIVER = "road_river";
const WILD = "road_wild";

/** A member of beat 2, differing only in which road leads to it. */
function variant(id: string, flag: string): Chapter {
  const base = makeChapter();
  return {
    ...base,
    id,
    index: 2,
    title: `Beat two by the ${flag}`,
    route: { set: "north_road", flag },
  };
}

const CAMPAIGN: Campaign = {
  id: "the-hollow-crown",
  title: "The Hollow Crown",
  blurb: "Two roads north.",
  chapters: ["bramblewood-01", "river-02", "wild-02"],
  routeSets: { north_road: [RIVER, WILD] },
};

function routedContent() {
  return makeContent({
    chapters: [makeChapter(), variant("river-02", RIVER), variant("wild-02", WILD)],
    campaigns: [CAMPAIGN],
  });
}

const APPEARANCE = { palette: "meadow", accent: "#7FD4C1" };

function creation(): ClientIntent {
  return {
    type: "CREATE_CHARACTER",
    name: "Pip",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: APPEARANCE,
  };
}

/**
 * A party sitting in the lobby, ready, one tap short of starting a chapter —
 * the state every evening of a campaign opens in.
 */
async function readyParty(harness: TestHarness, householdId: string, principal: DeviceIdentity) {
  const created = await createRoom({ householdId, mode: "party" }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const joined = await joinRoom({ code, principal }, harness.deps);
  if (!joined.ok) throw new Error("join");

  const send = async (intent: ClientIntent) => {
    const seq = (await harness.repo.getState(runId))?.seq ?? 0;
    return applyAction({ runId, playerId: joined.value.playerId, seq, intent }, harness.deps);
  };
  await send(creation());
  await send({ type: "READY", ready: true });
  return { runId, send };
}

describe("the server owns the road", () => {
  it("refuses a chapter the party's flags did not select", async () => {
    /*
     * The review finding this exists for: chapter start resolved the literal
     * `chapterId` off the intent, so a client could ask for the river variant
     * while the party carried the wild flag and be given the river.
     */
    const harness = makeHarness({ engine: realEngine, content: routedContent() });
    const { householdId, players } = await seedHousehold(harness, 1);
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: CAMPAIGN.id,
      status: "active",
      setbacks: 0,
      routeFlags: { [WILD]: true },
      version: 1,
      updatedAt: new Date(T0).toISOString(),
    });

    const { runId, send } = await readyParty(harness, householdId, players[0]!.principal);
    const response = await send({ type: "START_CHAPTER", chapterId: "river-02" });

    expect(response.ok).toBe(false);
    expect(response.ok ? null : response.error?.code).toBe("ILLEGAL");
    expect(response.ok ? "" : response.error?.message).toContain("wild-02");
    // Refused, not half-applied: no chapter was entered.
    expect((await harness.repo.getState(runId))?.chapterId).toBeNull();
  });

  it("lets the party start the chapter their road does select", async () => {
    const harness = makeHarness({ engine: realEngine, content: routedContent() });
    const { householdId, players } = await seedHousehold(harness, 1);
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: CAMPAIGN.id,
      status: "active",
      setbacks: 0,
      routeFlags: { [WILD]: true },
      version: 1,
      updatedAt: new Date(T0).toISOString(),
    });

    const { runId, send } = await readyParty(harness, householdId, players[0]!.principal);
    const response = await send({ type: "START_CHAPTER", chapterId: "wild-02" });

    expect(response.ok, JSON.stringify(response.ok ? null : response.error)).toBe(true);
    expect((await harness.repo.getState(runId))?.chapterId).toBe("wild-02");
  });

  it("stops a party at a fork they have never chosen at", async () => {
    // No attempt row at all: nobody has finished a chapter of this campaign,
    // so there is no road. Better a message than a country picked by sort
    // order (shared/routes.ts).
    const harness = makeHarness({ engine: realEngine, content: routedContent() });
    const { householdId, players } = await seedHousehold(harness, 1);

    const { send } = await readyParty(harness, householdId, players[0]!.principal);
    const response = await send({ type: "START_CHAPTER", chapterId: "wild-02" });

    expect(response.ok).toBe(false);
    expect(response.ok ? "" : response.error?.message).toContain("has not taken one");
  });

  it("leaves an unrouted beat exactly as it was", async () => {
    // Every chapter authored before routing existed. One file at the index, so
    // the check is a tautology — and has to stay one.
    const harness = makeHarness({ engine: realEngine, content: routedContent() });
    const { householdId, players } = await seedHousehold(harness, 1);

    const { runId, send } = await readyParty(harness, householdId, players[0]!.principal);
    const response = await send({ type: "START_CHAPTER", chapterId: "bramblewood-01" });

    expect(response.ok, JSON.stringify(response.ok ? null : response.error)).toBe(true);
    expect((await harness.repo.getState(runId))?.chapterId).toBe("bramblewood-01");
  });
});

describe("the road survives the drive home", () => {
  it("seeds a brand-new run's flags from the campaign attempt", async () => {
    /*
     * The review finding this exists for: chapter start cleared `flags` to
     * `{}`, so the road chosen at the end of chapter 2 was gone before chapter
     * 3 — which is played in a different room, on a different evening, from a
     * run that has never seen it.
     */
    const harness = makeHarness({ engine: realEngine, content: routedContent() });
    const { householdId, players } = await seedHousehold(harness, 1);
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: CAMPAIGN.id,
      status: "active",
      setbacks: 0,
      routeFlags: { [WILD]: true },
      version: 1,
      updatedAt: new Date(T0).toISOString(),
    });

    const { runId, send } = await readyParty(harness, householdId, players[0]!.principal);
    await send({ type: "START_CHAPTER", chapterId: "wild-02" });

    // The flag a chapter's `requiresFlag` choices and its ending read.
    expect((await harness.repo.getState(runId))?.flags[WILD]).toBe(true);
  });

  it("seeds nothing from a finished attempt, so a replay chooses again", async () => {
    const harness = makeHarness({ engine: realEngine, content: routedContent() });
    const { householdId, players } = await seedHousehold(harness, 1);
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: CAMPAIGN.id,
      status: "complete",
      setbacks: 0,
      routeFlags: { [WILD]: true },
      version: 1,
      updatedAt: new Date(T0).toISOString(),
    });

    const { send } = await readyParty(harness, householdId, players[0]!.principal);
    const response = await send({ type: "START_CHAPTER", chapterId: "wild-02" });

    expect(response.ok).toBe(false);
    expect(response.ok ? "" : response.error?.message).toContain("has not taken one");
  });
});

describe("what a completed chapter writes down", () => {
  async function settle(flags: Record<string, boolean>) {
    const harness = makeHarness({ content: routedContent() });
    const { householdId } = await seedHousehold(harness, 1);
    const state = {
      runId: "r_1",
      campaignId: CAMPAIGN.id,
      chapterId: "bramblewood-01",
      chapterOutcome: "success",
      bonuses: [],
      xpEarned: 0,
      flags,
      party: [],
    } as unknown as Parameters<typeof settleChapterCompletion>[0];
    return settleChapterCompletion(state, harness.deps, householdId);
  }

  it("carries the road the party took", async () => {
    const settlement = await settle({ [RIVER]: true });
    expect(settlement.campaignProgress?.routeFlags).toEqual({ [RIVER]: true });
  });

  it("does not carry a chapter's own flags", async () => {
    // The opened door and the paid objective are facts about a chapter and die
    // with it. Only what the campaign declares in `routeSets` is durable.
    const settlement = await settle({ [RIVER]: true, opened_the_shrine: true });
    expect(settlement.campaignProgress?.routeFlags).toEqual({ [RIVER]: true });
  });

  it("adds to the roads already taken rather than replacing them", async () => {
    // Gemfall picks a road at one beat and a pursuit at another; the second
    // choice must not erase the first.
    const harness = makeHarness({
      content: makeContent({
        chapters: [makeChapter()],
        campaigns: [
          { ...CAMPAIGN, routeSets: { north_road: [RIVER, WILD], pursuit: ["chasing_the_thief"] } },
        ],
      }),
    });
    const { householdId } = await seedHousehold(harness, 1);
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: CAMPAIGN.id,
      status: "active",
      setbacks: 0,
      routeFlags: { [RIVER]: true },
      version: 1,
      updatedAt: new Date(T0).toISOString(),
    });

    const state = {
      runId: "r_1",
      campaignId: CAMPAIGN.id,
      chapterId: "bramblewood-01",
      chapterOutcome: "success",
      bonuses: [],
      xpEarned: 0,
      flags: { chasing_the_thief: true },
      party: [],
    } as unknown as Parameters<typeof settleChapterCompletion>[0];
    const settlement = await settleChapterCompletion(state, harness.deps, householdId);

    expect(settlement.campaignProgress?.routeFlags).toEqual({
      [RIVER]: true,
      chasing_the_thief: true,
    });
  });
});
