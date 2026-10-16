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
 */
const GEMFALL_FILES: Record<string, string> = {
  "campaigns/gemfall.json": "c3c679e0b5bb801c38acf7f09ce663e877aaa33120d8ed3f54bb307cb6148195",
  "chapters/gemfall-01.json": "e239da9d2b46d89b13a284919ece8f35a53849ae7731c6a55eeb7c1da6b346a7",
  "chapters/gemfall-02.json": "51f5be2011b5a08410aa884e119df268c3f4d5ce105fceefa149cad9bb3e6542",
  "chapters/gemfall-03a.json": "2d39d2f511ae9563ce57685f5ea11299173b318454d2c221a1867e979324ed47",
  "chapters/gemfall-03b.json": "a88689e8527efc74bc0fbf4717d59adbabf4578cd0bfb0772bd8223554fc1c0f",
  "chapters/gemfall-03c.json": "9d5f6492615742eb1975e7807b59f731aa9948a529b47497eb992fc83b38cd16",
  "chapters/gemfall-04a.json": "91fa67028e6dce2ae6666eef0bc074269b708e7ee9223f08429a75996ae4f02b",
  "chapters/gemfall-04b.json": "5cc15ff300b2cb4ba646e2f3fcf18223d152d571cf74d805ad3adce11538ecca",
  "chapters/gemfall-04c.json": "3a3d210646fae057ba7dc50fa5632c074b5972bada56e49d898456fba4272dea",
  "chapters/gemfall-05a.json": "3a269ca932ff831f494ee81a95eb861498976de072f3d6c00fbe28742c1ae766",
  "chapters/gemfall-05b.json": "b315080fdbd206f195aaa43ea036b6149328afae89c726cc2d74909562711d26",
  "chapters/gemfall-05c.json": "372e68d305983060148b1619ddcc578b0531186f43c39727a65b1730b2441366",
  // Re-pinned deliberately: `scene_whole_truth` (the seal and the titan) is
  // marked `priority: 1`. Presentation only — the endings, roads, setbacks and
  // saves below still match their pre-epic digests.
  "chapters/gemfall-06.json": "a93a12ce7bc28513f23e1b3c4e87e1a3fd985ad0683942fa609daf9daaf8a0fc",
  "chapters/gemfall-07h.json": "f46ccaf3911dee0608065fc8ef11101d6745147bf6a04af8bed2e13793a1483b",
  "chapters/gemfall-07l.json": "76dcd0f99a5420a1a8aef5fd54b1407f46c73b4aa1f64556cd7cd3e219141110",
  "chapters/gemfall-07r.json": "ba15d19d96fec0770d84c392449eacbc5346f40f0804cbbe025f58267a1d4a03",
  "chapters/gemfall-08.json": "110575586c0043667e7af2617d59d4986aa388800aff200efeff89603f379070",
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
