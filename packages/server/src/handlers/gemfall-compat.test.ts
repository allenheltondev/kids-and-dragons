/**
 * Gemfall, after the nonlinear-campaign epic (#191) — the integration gate's
 * regression (#203): "Gemfall still plays identically with legacy saves."
 *
 * Every issue of the epic pinned its own corner (ordered-campaigns.test.ts:
 * no journey on an ordered row or run or view, CHOOSE_EXIT and RIFT_ACTION
 * refused, Gemfall's fight numbers hashed against a pre-buff digest, no
 * environment in any shipped encounter). This file is the whole-campaign
 * answer, and it compares against the build *before* the epic rather than
 * against itself:
 *
 *   1. The files. Gemfall's sixteen chapters and its campaign file hash to the
 *      digests they had before the epic (its content has not changed since
 *      57c63ba8), load through the real loader, and are sound chapters.
 *   2. Every ending. Each of the 48 terminal scenes across the sixteen
 *      chapters is reached from its chapter's entry, and settled through the
 *      server from an attempt standing at the beat before: what the attempt
 *      row says afterwards is digested and compared with the digest the same
 *      probe produced on the pre-epic build.
 *   3. The roads. All three roads and all three pursuits, carried across
 *      eight evenings in new rooms by the attempt's `routeFlags` — the chapters
 *      CONTINUE picked and the rows it left, against the pre-epic digest.
 *   4. Setbacks. The setback limit fails the attempt; the next evening starts
 *      Gemfall again. Against the pre-epic digest.
 *   5. Saves. A row in the shape written before attempt ids existed carries
 *      on; a run saved mid-fight by the pre-epic build resumes and plays out
 *      exactly as that build played it; the repositories hand legacy rows
 *      back unchanged and write them back without a journey; the graph
 *      intents refuse a legacy row and write nothing.
 *
 * The probe that plays 2-4 (and that produced the pre-epic save) is
 * gemfall-compat-probe.ts, written against nothing the epic added so it runs
 * on both builds. To re-take the goldens after a *deliberate* Gemfall change:
 * run the probe on the old and new builds as described there, and say why in
 * the commit.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignMode, reachableScenes, validateChapter } from "@kad/shared";
import type { ClientIntent, RunState } from "@kad/shared";
import { loadContent } from "../content/loader.ts";
import type { CampaignProgressRecord } from "../store/repository.ts";
import { DynamoRepository } from "../store/dynamo-repository.ts";
import { T0 } from "../test-support.ts";
import { applyAction } from "./action.ts";
import {
  GEMFALL,
  evening,
  gemfallHousehold,
  playOn,
  playRoad,
  setbackToFailure,
  settleEveryEnding,
  summary,
  terminalScenes,
  type Save,
} from "./gemfall-compat-probe.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const content = await loadContent(path.join(ROOT, "content"));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface PreEpicSave {
  build: string;
  save: Save;
  resumed: unknown;
  digests: { endings: string; roads: string; setbacks: string; resumed: string };
}

/** Taken on the pre-epic build (57c63ba8) by gemfall-compat-probe.ts; see its header and the fixture's `$comment`. */
const PRE_EPIC = JSON.parse(
  readFileSync(new URL("../fixtures/gemfall-pre-epic-save.json", import.meta.url), "utf8"),
) as PreEpicSave;

// ---------------------------------------------------------------------------
// 1. The files
// ---------------------------------------------------------------------------

/**
 * SHA-256 of each Gemfall file (line endings normalized), as shipped before
 * the epic and unchanged since. The epic's rule is that Gemfall is never
 * edited; a change here is a Gemfall content change and needs its own issue.
 *
 * Re-pinned deliberately for the chapters' `priority` marks (the priority-scene
 * sweep): presentation only — the endings, roads, setbacks and saves below
 * still match their pre-epic digests.
 *
 * Re-pinned for gemfall-07h's Warden Clerk: its five checkpoint scenes cast the
 * one clerk as the single Skywarden faun figure, not the three-warden group
 * the stage now stands for `entities/skywardens`. Presentation only, like the
 * priority marks.
 */
const GEMFALL_FILES: Record<string, string> = {
  "campaigns/gemfall.json": "c3c679e0b5bb801c38acf7f09ce663e877aaa33120d8ed3f54bb307cb6148195",
  "chapters/gemfall-01.json": "98d74a1ee1c482e467c39b125b8343f5c42b8b88b4ab89c4abcdd73b96bb8927",
  "chapters/gemfall-02.json": "3ee767c21520412d014aa7020f9d5e65b77c017127c5fc66ac3a491332988dbe",
  "chapters/gemfall-03a.json": "e5f5c5457b2a30ebff755eaaad865838777b54f1ab8ad75a06175f937b86bdce",
  "chapters/gemfall-03b.json": "15b6e6f67d49d243c8087d8b89d9b790f0c4eb43acd6551bd6851ab76cd0355a",
  "chapters/gemfall-03c.json": "663f600a04b388393a320ad72ef93409ec78b54e4d2ced22e66eea89960b1724",
  "chapters/gemfall-04a.json": "b249c5dba1d053f346513ada2391f893a731497c8c6acbf13a768e9b9e763e5c",
  "chapters/gemfall-04b.json": "0f97c7c581bf062378f8e5705ac4a943d14c56307128b353b1e5144e12f778e2",
  "chapters/gemfall-04c.json": "734023a0b4c4ef34f8872d95701fcc54ee1e3e89a7d739fdf86f9e85ec1fee57",
  "chapters/gemfall-05a.json": "ddc3a53b4844ce4c6d11725ec73793acb1279b0336d92b1980af01b1cd746989",
  "chapters/gemfall-05b.json": "b43f4c349a88c3f5b40d32c6b4e9ae2a3cb8c9db6f89bfad2d8e1b84a5ff7f85",
  "chapters/gemfall-05c.json": "e2715f5d43d9f0c51c714ab274f0497821e4677a3028ea1ecfe497a188c0d475",
  "chapters/gemfall-06.json": "e59c654289034be27ba303a81c8515223e063201c6e02ce2c68ca4421cfec0fd",
  "chapters/gemfall-07h.json": "881955f20f510af10f3515089ef0a04934a72f9d7f8a1deb6e15e4371da077c3",
  "chapters/gemfall-07l.json": "49afe8e98c99b4a833002f93148e65790b80c5faf435b74780c89e6e2c722635",
  "chapters/gemfall-07r.json": "56389c6b60fb44cca02bf60f95438efd3dbf4660beec50272093cafb72f19134",
  "chapters/gemfall-08.json": "984336426f0039e3c331f9a5334ef0a50ae71400ee53e852784c7def44c79e2c",
};

describe("Gemfall's files are the files that shipped before the epic", () => {
  it("every one hashes to its pre-epic digest", () => {
    const actual = Object.fromEntries(
      Object.keys(GEMFALL_FILES).map((file) => {
        const text = readFileSync(path.join(ROOT, "content", file), "utf8").replace(/\r\n/g, "\n");
        return [file, createHash("sha256").update(text).digest("hex")];
      }),
    );
    expect(actual).toEqual(GEMFALL_FILES);
  });

  it("all sixteen chapters load through the real loader, are sound, and the campaign is still ordered", () => {
    const campaign = content.campaign(GEMFALL)!;
    expect(campaign.chapters).toHaveLength(16);
    expect(Object.keys(GEMFALL_FILES).filter((f) => f.startsWith("chapters/"))).toEqual(
      campaign.chapters.map((id) => `chapters/${id}.json`).sort(),
    );
    expect(campaignMode(campaign)).toBe("ordered");
    expect(content.graph(GEMFALL)).toBeNull();
    for (const id of campaign.chapters) {
      const chapter = content.chapter(id);
      expect(chapter, id).not.toBeNull();
      expect(validateChapter(chapter!, content.items()), id).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2-4. Endings, roads, setbacks — against the pre-epic build
// ---------------------------------------------------------------------------

describe("Gemfall settles every ending as it did before the epic", () => {
  it("each of the 48 endings is reachable from its chapter's entry", () => {
    let count = 0;
    for (const id of content.campaign(GEMFALL)!.chapters) {
      const chapter = content.chapter(id)!;
      const reachable = reachableScenes(chapter);
      for (const ending of terminalScenes(chapter)) {
        expect(reachable.has(ending.sceneId), `${id}/${ending.sceneId}`).toBe(true);
        count++;
      }
    }
    expect(count).toBe(48);
  });

  it("each ending, settled through the server, leaves the attempt exactly as the pre-epic build left it", { timeout: 60_000 }, async () => {
    const rows = (await settleEveryEnding(content)) as {
      chapterId: string;
      sceneId: string;
      started: string;
      phase: string;
      outcome: string;
      attempt: ReturnType<typeof summary>;
    }[];
    expect(rows).toHaveLength(48);
    for (const row of rows) {
      const chapter = content.chapter(row.chapterId)!;
      const ending = terminalScenes(chapter).find((e) => e.sceneId === row.sceneId)!;
      const where = `${row.chapterId}/${row.sceneId}`;
      // The rule, spelled out: CONTINUE starts the beat the row points at on
      // the road it carries; the ending settles its outcome; a setback counts;
      // the last beat or an early ending completes; nothing graph-shaped appears.
      expect(row.started, where).toBe(row.chapterId);
      expect(row.phase, where).toBe("chapter_complete");
      expect(row.outcome, where).toBe(ending.outcome);
      expect(row.attempt, where).toMatchObject({
        lastIndex: chapter.index,
        setbacks: ending.outcome === "setback" ? 1 : 0,
        status: chapter.index === 8 || ending.endsCampaign ? "complete" : "active",
      });
      expect(row.attempt!.keys, where).not.toContain("journey");
    }
    expect(digest(rows)).toBe(PRE_EPIC.digests.endings);
  });

  it("all three roads and all three pursuits carry across eight evenings, as before", { timeout: 60_000 }, async () => {
    const roads = [
      await playRoad(content, "east", "restore"),
      await playRoad(content, "north", "leash"),
      await playRoad(content, "west", "hoard"),
    ] as { chapterId: string; attempt: ReturnType<typeof summary> }[][];
    const played = roads.map((road) => road.map((evening) => evening.chapterId));
    expect(played).toEqual([
      ["gemfall-01", "gemfall-02", "gemfall-03a", "gemfall-04a", "gemfall-05a", "gemfall-06", "gemfall-07r", "gemfall-08"],
      ["gemfall-01", "gemfall-02", "gemfall-03c", "gemfall-04c", "gemfall-05c", "gemfall-06", "gemfall-07l", "gemfall-08"],
      ["gemfall-01", "gemfall-02", "gemfall-03b", "gemfall-04b", "gemfall-05b", "gemfall-06", "gemfall-07h", "gemfall-08"],
    ]);
    const carried = [
      ["route_river", "pursuit_restore"],
      ["route_rush", "pursuit_leash"],
      ["route_wild", "pursuit_hoard"],
    ];
    roads.forEach((road, i) => {
      const [roadFlag, pursuitFlag] = carried[i]!;
      // From the evening after the fork on, every row carries the road; from
      // chapter 6 on, the pursuit beside it.
      for (const evening of road.slice(1)) expect(evening.attempt!.routeFlags, evening.chapterId).toHaveProperty(roadFlag!, true);
      for (const evening of road.slice(5)) expect(evening.attempt!.routeFlags, evening.chapterId).toHaveProperty(pursuitFlag!, true);
      expect(road.at(-1)!.attempt).toMatchObject({ status: "complete", lastIndex: 8, setbacks: 0 });
      for (const evening of road) expect(evening.attempt!.keys).not.toContain("journey");
    });
    expect(digest(roads)).toBe(PRE_EPIC.digests.roads);
  });

  it("setbacks fail the attempt at the campaign's limit, and the next evening starts again, as before", { timeout: 60_000 }, async () => {
    const log = (await setbackToFailure(content)) as { chapterId?: string; next?: string; attempt: ReturnType<typeof summary> }[];
    const limit = content.campaign(GEMFALL)!.setbackLimit!;
    const failed = log.find((e) => e.attempt?.status === "failed")!;
    expect(failed.attempt).toMatchObject({ status: "failed", setbacks: limit });
    expect(log.filter((e) => e.chapterId).map((e) => e.attempt!.setbacks)).toEqual([0, 0, 1, 2, 3, 4]);
    expect(log.at(-1)).toMatchObject({ next: "gemfall-01", attempt: { status: "active", setbacks: 0, lastIndex: 0 } });
    expect(digest(log)).toBe(PRE_EPIC.digests.setbacks);
  });
});

// ---------------------------------------------------------------------------
// 5. Saves
// ---------------------------------------------------------------------------

/** An attempt row as written before attempt ids, row versions, purses or journeys existed. */
const legacyRow = (householdId: string): CampaignProgressRecord => ({
  householdId,
  campaignId: GEMFALL,
  status: "active",
  setbacks: 1,
  lastIndex: 3,
  routeFlags: { route_wild: true, crossed_dry: true },
  updatedAt: new Date(T0).toISOString(),
});

describe("Gemfall saves from before the epic", () => {
  it("a row in the oldest shape continues: the next beat on its road, settled without a journey", async () => {
    const h = await gemfallHousehold(content);
    await h.harness.repo.putCampaignProgress(legacyRow(h.householdId));
    const t = await evening(h);
    expect((await t.state()).campaign).not.toHaveProperty("journey");
    expect(await t.begin()).toBe("gemfall-04b");
    const run = await t.state();
    expect(run.flags).toMatchObject({ route_wild: true, crossed_dry: true });
    expect(run).not.toHaveProperty("journeyVisit");
    expect(run).not.toHaveProperty("buffs");
    await t.goto("ending_marked_present");
    const settled = (await h.attempt())!;
    expect(settled).toMatchObject({
      status: "active",
      setbacks: 1,
      lastIndex: 4,
      routeFlags: { route_wild: true, crossed_dry: true },
      // The purse arrived after this row was written: the backfill fills it (routing.test.ts).
      coins: content.campaign(GEMFALL)!.purseBackfill!.coins,
    });
    expect(settled).not.toHaveProperty("journey");
    // And the evening after, the beat after that.
    expect(await (await evening(h)).begin()).toBe("gemfall-05b");
  });

  it("a run saved mid-fight by the pre-epic build resumes, and plays out exactly as that build played it", async () => {
    const { save, resumed } = PRE_EPIC;
    // The save is the old shape: nothing the epic added is on it.
    expect(save.state.phase).toBe("encounter");
    for (const key of ["journeyVisit", "buffs"]) expect(save.state).not.toHaveProperty(key);
    for (const key of ["buffs", "environment"]) expect(save.state.encounter).not.toHaveProperty(key);
    expect(save.state.encounter!.combatants.some((c) => "escaped" in c)).toBe(false);
    expect(save.attempt).not.toHaveProperty("journey");

    const h = await gemfallHousehold(content);
    h.harness.clock.set(save.clock);
    const repo = h.harness.repo;
    for (const character of save.characters) await repo.putCharacter(character);
    await repo.putCampaignProgress(save.attempt);
    await repo.putRun(save.run);
    expect(await repo.putRoomIfAbsent(save.room)).toBe(true);
    await repo.putState(save.state);

    const playerId = save.state.party[0]!.playerId;
    const state = async (): Promise<RunState> => (await repo.getState(save.run.id))!;
    const send = async (intent: ClientIntent) =>
      applyAction({ runId: save.run.id, playerId, seq: (await state()).seq, intent }, h.harness.deps);
    const must = async (intent: ClientIntent) => {
      const response = await send(intent);
      expect(response.ok, `${intent.type}: ${JSON.stringify(response.error)}`).toBe(true);
      return response;
    };
    const table = { state, send, must };

    // The pre-epic build's own continuation, step for step (`playOn`).
    const now = await playOn(h, table, save.run.id, content);
    const afterFight = now.fight;
    expect(now).toEqual(resumed);
    expect(digest(now)).toBe(PRE_EPIC.digests.resumed);
    expect(afterFight.phase).not.toBe("encounter");
    // Nothing the epic added was grown on the way.
    expect(await state()).not.toHaveProperty("journeyVisit");
    expect(await state()).not.toHaveProperty("buffs");
    expect(await h.attempt()).not.toHaveProperty("journey");
  });

  it("the memory repository hands legacy rows back unchanged, and commits one under the legacy version", async () => {
    const h = await gemfallHousehold(content);
    const repo = h.harness.repo;
    const oldest = legacyRow(h.householdId);
    const preEpic = { ...PRE_EPIC.save.attempt, householdId: h.householdId };
    await repo.putCampaignProgress(oldest);
    expect(await repo.getCampaignProgress(h.householdId, GEMFALL)).toEqual(oldest);
    expect(await repo.listCampaignProgress(h.householdId)).toEqual([oldest]);

    // A row with no `version` is version 0 to the optimistic lock (as it always was).
    const t = await evening(h);
    const run = await t.state();
    const advanced: CampaignProgressRecord = { ...oldest, lastIndex: 4, version: 1 };
    expect(
      await repo.commit({
        runId: run.runId,
        expectedSeq: run.seq,
        state: { ...run, seq: run.seq + 1 },
        event: { runId: run.runId, seq: run.seq + 1, patch: [], at: new Date(T0).toISOString() },
        campaignProgress: advanced,
        campaignProgressExpectedVersion: 0,
      }),
    ).toBe(true);
    expect(await repo.getCampaignProgress(h.householdId, GEMFALL)).toEqual(advanced);

    await repo.putCampaignProgress(preEpic);
    expect(await repo.getCampaignProgress(h.householdId, GEMFALL)).toEqual(preEpic);
  });

  describe("the DynamoDB repository", () => {
    afterEach(() => vi.restoreAllMocks());
    const client = new DynamoDBClient({ region: "us-east-1", credentials: { accessKeyId: "test", secretAccessKey: "test" } });

    it("reads legacy rows back exactly as stored, and writes one back whole under the legacy-safe condition", async () => {
      const send = vi.fn();
      vi.spyOn(DynamoDBDocumentClient, "from").mockReturnValue({ send } as unknown as DynamoDBDocumentClient);
      const repo = new DynamoRepository({ tableName: "kad-test", client });
      for (const row of [legacyRow("h_1"), { ...PRE_EPIC.save.attempt, householdId: "h_1" }]) {
        send.mockResolvedValueOnce({ Item: { data: structuredClone(row) } });
        const read = await repo.getCampaignProgress("h_1", GEMFALL);
        expect(read).toEqual(row);
        expect(read).not.toHaveProperty("journey");
      }

      send.mockResolvedValueOnce({});
      const advanced = { ...legacyRow("h_1"), lastIndex: 4, version: 1 };
      const state = { ...PRE_EPIC.save.state, runId: "r_1", seq: 1 };
      await repo.commit({
        runId: "r_1",
        expectedSeq: 0,
        state,
        event: { runId: "r_1", seq: 1, patch: [], at: new Date(T0).toISOString() },
        campaignProgress: advanced,
        campaignProgressExpectedVersion: 0,
      });
      const items = send.mock.calls.at(-1)?.[0].input.TransactItems as { Put?: { Item: { SK: string; data: unknown }; ConditionExpression: string } }[];
      const put = items.find((item) => item.Put?.Item.SK === `CAMPAIGN#${GEMFALL}`)!.Put!;
      expect(put.Item.data).toEqual(advanced);
      expect(put.ConditionExpression).toBe("attribute_exists(PK) AND (attribute_not_exists(#d.#version) OR #d.#version = :expectedVersion)");
    });
  });

  it("the graph intents refuse a legacy row and write nothing (ordered-campaigns.test.ts holds the current shape)", async () => {
    const h = await gemfallHousehold(content);
    const row = legacyRow(h.householdId);
    await h.harness.repo.putCampaignProgress(row);
    const t = await evening(h);
    const seq = (await t.state()).seq;
    for (const intent of [
      { type: "CHOOSE_EXIT", edgeId: "shelf-rift", visit: 1, campaignId: GEMFALL },
      { type: "RIFT_ACTION", action: "open", edgeId: "origin-seal", way: "attune", visit: 1, campaignId: GEMFALL },
    ] as ClientIntent[]) {
      const refused = await t.send(intent);
      expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
      expect(refused.ok ? "" : refused.error?.message).toContain("no map");
    }
    expect((await t.state()).seq).toBe(seq);
    expect(await h.attempt()).toEqual(row);
  });
});
