/**
 * Ordered campaigns, after graph journeys arrived (#194) — the regression the
 * epic's first rule asks for: Gemfall and the Hollow Crown play, save and
 * settle exactly as they did before.
 *
 * The journey runtime is opt-in by `Campaign.graph` and branches out of the
 * ordered path at three places (CONTINUE_CAMPAIGN, chapter start, chapter
 * settlement) plus one new intent. These pin that none of that leaks: no
 * ordered attempt row gains a `journey`, no ordered run gains a
 * `journeyVisit`, no ordered view gains a `journey`, CONTINUE still picks the
 * beat after `lastIndex` on the road `routeFlags` names, and the new intent
 * refuses an ordered campaign without touching it. The rest of Gemfall's
 * behaviour — every beat, fork, setback and ending — is held by
 * gemfall-playthrough.test.ts, routing.test.ts and progression.test.ts, which
 * run unchanged.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { Campaign, ClientIntent, RunState } from "@kad/shared";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import type { CampaignProgressRecord, GameRepository } from "../store/repository.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, T0 } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { playCampaign } from "./playthrough-driver.ts";
import { campaignView, settleChapterCompletion } from "./progression.ts";
import { createRoom, joinRoom } from "./room.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const realEngine: Engine = { applyIntent, createRunState };

/** Every key an ordered campaign view had before #194. */
const ORDERED_VIEW_KEYS = ["blurb", "chapters", "id", "next", "title"];

describe("the shipped ordered campaigns", () => {
  for (const id of ["gemfall", "the-hollow-crown"]) {
    it(`${id} has no graph, and its view carries no journey`, () => {
      const campaign = content.campaign(id)!;
      expect(campaign).toBeTruthy();
      expect(content.graph(id)).toBeNull();
      // Rift lifecycles (#196) live on graph edges and a graph journey's
      // `rifts`; an ordered campaign has neither, so nothing of them applies.
      expect(JSON.stringify(campaign)).not.toContain('"rift":');
      const deps = makeHarness({ content }).deps;
      const fresh = campaignView(campaign, null, deps);
      expect(Object.keys(fresh).sort()).toEqual(ORDERED_VIEW_KEYS);
      expect(fresh.next?.index).toBe(1);
      const midway: CampaignProgressRecord = {
        householdId: "h_test",
        campaignId: id,
        status: "active",
        setbacks: 1,
        lastIndex: 1,
        routeFlags: { route_rush: true },
        version: 3,
        updatedAt: new Date(T0).toISOString(),
      };
      expect(Object.keys(campaignView(campaign, midway, deps)).sort()).toEqual(ORDERED_VIEW_KEYS);
      // The beat after the last finished — or beat 1 again past the end (the
      // Hollow Crown is one beat long) — exactly as `expectedIndex` always said.
      const index = campaign.chapters.length > 1 ? 2 : 1;
      const expected = content.chapterAt(id, index, midway.routeFlags!)!;
      expect(campaignView(campaign, midway, deps).next).toEqual({ index, title: expected.title });
    });
  }
});

describe("Gemfall, played with the journey runtime in the build", () => {
  it("continues beat by beat on its road, and never writes a journey or stamps a visit", { timeout: 60_000 }, async () => {
    const evenings: { attempt: CampaignProgressRecord | null; runs: RunState[] }[] = [];
    let store: { repo: GameRepository; householdId: string } | null = null;
    const run = await playCampaign(content, 5, {
      label: "ordered-regression",
      beforeEvening: async ({ repo, householdId }) => {
        store = { repo, householdId };
        const runs = await Promise.all(
          (await repo.listRuns(householdId)).map(async (r) => (await repo.getState(r.id))!),
        );
        evenings.push({ attempt: await repo.getCampaignProgress(householdId, "gemfall"), runs });
      },
    });
    expect(["complete", "failed"]).toContain(run.status);
    expect(evenings).toHaveLength(run.chapters.length);

    evenings.forEach(({ attempt, runs }, evening) => {
      // CONTINUE_CAMPAIGN's ordered rule, re-derived here from the row it read:
      // the beat after the last one finished, on the road the attempt carries.
      const index = attempt && attempt.status === "active" ? (attempt.lastIndex ?? 0) + 1 : 1;
      const expected = content.chapterAt("gemfall", index, attempt?.routeFlags ?? {});
      expect(run.chapters[evening], `evening ${evening}`).toBe(expected?.id);
      expect(content.chapter(run.chapters[evening]!)?.index).toBe(evening + 1);

      if (attempt) expect(attempt).not.toHaveProperty("journey");
      for (const state of runs) {
        expect(state).not.toHaveProperty("journeyVisit");
        expect(state.campaign ?? {}).not.toHaveProperty("journey");
        for (const option of state.campaignOptions ?? []) expect(option).not.toHaveProperty("journey");
      }
    });

    const { repo, householdId } = store!;
    const settled = (await repo.getCampaignProgress(householdId, "gemfall"))!;
    expect(settled).not.toHaveProperty("journey");
    expect(settled.status).toBe(run.status);
    expect(settled.lastIndex).toBe(run.chapters.length);
    expect(settled.routeFlags).toEqual(run.routeFlags);
  });

  it("refuses CHOOSE_EXIT for an ordered campaign, and moves nothing", async () => {
    const harness = makeHarness({ engine: realEngine, content });
    const { householdId, players } = await seedHousehold(harness, 1);
    const attempt: CampaignProgressRecord = {
      householdId,
      campaignId: "gemfall",
      status: "active",
      setbacks: 0,
      lastIndex: 2,
      routeFlags: {},
      attemptId: "attempt-1",
      version: 4,
      updatedAt: new Date(T0).toISOString(),
    };
    await harness.repo.putCampaignProgress(attempt);
    const created = await createRoom({ householdId, mode: "party", campaignId: "gemfall" }, harness.deps);
    if (!created.ok) throw new Error("room");
    const joined = await joinRoom({ code: created.value.code, principal: players[0]!.principal }, harness.deps);
    if (!joined.ok) throw new Error("join");
    const send = async (intent: ClientIntent) =>
      applyAction(
        {
          runId: created.value.runId,
          playerId: joined.value.playerId,
          seq: (await harness.repo.getState(created.value.runId))!.seq,
          intent,
        },
        harness.deps,
      );

    const refused = await send({ type: "CHOOSE_EXIT", edgeId: "to-orchard", visit: 1, campaignId: "gemfall" });
    expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(refused.ok ? "" : refused.error?.message).toContain("no map");
    expect(await harness.repo.getCampaignProgress(householdId, "gemfall")).toEqual(attempt);
  });
});

describe("ordered settlement writes no journey", () => {
  const CAMPAIGN: Campaign = {
    id: "the-hollow-crown",
    title: "The Hollow Crown",
    blurb: "Two roads north.",
    chapters: ["bramblewood-01", "beat-02"],
    routeSets: { north_road: ["road_river", "road_wild"] },
  };

  it("records the beat and the road exactly as before", async () => {
    const harness = makeHarness({
      content: makeContent({ chapters: [makeChapter(), { ...makeChapter(), id: "beat-02", index: 2 }], campaigns: [CAMPAIGN] }),
    });
    const { householdId } = await seedHousehold(harness, 1);
    const finished = {
      runId: "r_1",
      campaignId: CAMPAIGN.id,
      chapterId: "bramblewood-01",
      sceneId: "scene_ending",
      chapterOutcome: "setback",
      bonuses: [],
      xpEarned: 150,
      flags: { road_wild: true, found_shrine: true },
      party: [],
    } as unknown as Parameters<typeof settleChapterCompletion>[0];
    const settlement = await settleChapterCompletion(finished, harness.deps, householdId);
    expect(settlement.stale).toBeUndefined();
    expect(settlement.replay).toBeUndefined();
    expect(settlement.campaignProgress).not.toHaveProperty("journey");
    expect(settlement.campaignProgress).toMatchObject({
      status: "active",
      setbacks: 1,
      lastIndex: 1,
      routeFlags: { road_wild: true },
    });
    expect(Object.keys(settlement.campaignView!).sort()).toEqual(ORDERED_VIEW_KEYS);
  });
});
