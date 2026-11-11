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
 *   1. The files. Gemfall's sixteen chapters and its campaign file play as
 *      they were pinned (their play shape hashes to its pin; see section 1
 *      below), load through the real loader, and are sound chapters.
 *   2. Every ending. Each of the 47 terminal scenes across the sixteen
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
 *
 * Re-taken deliberately for the damage rule (a hit's damage comes off its
 * attack roll: a graze, a solid hit or a critical, where it was a flat 3):
 * the `resumed` play-on and its digest only, by playing the same pre-epic
 * save on the new build. The fight still ends where it did, on the same
 * scene with the same hero down; the beats moved, by their damage numbers and
 * the target and tier each roll now carries. The endings, roads and setbacks
 * throw no dice and still match the pre-epic build.
 *
 * Re-pinned for #497's remaining location and interaction paintings;
 * only art, presentation and option icon fields changed. Gameplay comparisons
 * against origin/main and the pre-epic digests are unchanged.
 *
 * Re-pinned for #497's chapter 01/02 presentation art: scene backdrops,
 * interaction props, tracking covers and memory option icons only. The
 * gameplay digests below continue to match the pre-epic build.
 *
 * Re-pinned for the campaign's epilogues: the campaign file gains
 * `epilogues` (painted plates shown after each ending of gemfall-08, client
 * presentation only, read by nothing the engine or server does). No chapter
 * changed, and the gameplay digests below continue to match the pre-epic
 * build.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignMode, canonicalJson, migrateCharacter, playShape, reachableScenes, resolveCharacter, validateChapter } from "@kad/shared";
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

/**
 * The gameplay digests today's build is held to: the pre-epic build's, except
 * where the owner changed Gemfall's graph on purpose. Each re-take comes from
 * gemfall-compat-golden.test.ts run on the commit that made the change, and
 * says why.
 *
 * - `endings`: owner decision on #368 (decision 3). 05c's early crab defeat
 *   reroutes, at a cost, instead of ending the chapter, so `end_rolled_down`
 *   is gone and Gemfall has 47 endings, not 48.
 * - Owner decision on #368 (decision 5) moved 05b's young gatherer before
 *   the elders' vote. The digests were re-taken on that commit and none moved:
 *   no ending, road carry, setback or save passes through her scenes.
 */
const DIGESTS: PreEpicSave["digests"] = {
  ...PRE_EPIC.digests,
  endings: "cac9edbcfc299b099b655802a23ebac6909d84dd788c6d832c8d2cf5e4740da6",
};

// ---------------------------------------------------------------------------
// 1. The files
// ---------------------------------------------------------------------------

/**
 * Gemfall's play pins: for each of its files, a hash of the file with what is
 * only shown or said taken out (`playShape`, packages/shared/src/play-shape.ts).
 * Scene ids, exits, checks, effects, flags, gates, fights and interactions'
 * rules are in it. Narration, labels, art, the cast on stage and the voice the
 * words are read in are not, so a reworded line, a new painting or a retuned
 * voice moves nothing here.
 *
 * It replaced a hash of every byte of every file. That one was re-taken 58
 * times in ten weeks, mostly for art and prose, each time with a note appended
 * at this spot, which is why every branch that touched Gemfall collided in
 * this file. The gameplay digests below never moved for those.
 *
 * What the pins catch that the digests below do not: the digests warp each
 * chapter to its endings, so a changed check, gate or effect in the middle of
 * a chapter moves none of them. It moves a pin.
 *
 * After a deliberate change to how Gemfall plays: `npm run content:pin`, and
 * say why in the commit. The pins are one line per file in the fixture, so two
 * branches that change different chapters do not collide there.
 */
const PINS = (
  JSON.parse(readFileSync(new URL("../fixtures/gemfall-play-pins.json", import.meta.url), "utf8")) as { files: Record<string, string> }
).files;

const playDigest = (text: string) => createHash("sha256").update(canonicalJson(playShape(JSON.parse(text)))).digest("hex");

describe("Gemfall's reviewed files and legacy contracts", () => {
  it("every file plays as it was pinned (npm run content:pin re-takes a deliberate change)", () => {
    const actual = Object.fromEntries(
      Object.keys(PINS).map((file) => [file, playDigest(readFileSync(path.join(ROOT, "content", file), "utf8"))]),
    );
    const moved = Object.keys(PINS).filter((file) => actual[file] !== PINS[file]);
    expect(
      moved,
      `How these Gemfall files play has changed: ${moved.join(", ")}. If that is deliberate, run npm run content:pin and say why in the commit.`,
    ).toEqual([]);
  });

  it("pins the campaign file and every chapter it lists, and nothing else", () => {
    const campaign = content.campaign(GEMFALL)!;
    expect(Object.keys(PINS).sort()).toEqual(["campaigns/gemfall.json", ...campaign.chapters.map((id) => `chapters/${id}.json`)].sort());
  });

  it("all sixteen chapters load through the real loader, are sound, and the campaign is still ordered", () => {
    const campaign = content.campaign(GEMFALL)!;
    expect(campaign.chapters).toHaveLength(16);
    expect(Object.keys(PINS).filter((f) => f.startsWith("chapters/"))).toEqual(
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
  it("each of the 47 endings is reachable from its chapter's entry", () => {
    let count = 0;
    for (const id of content.campaign(GEMFALL)!.chapters) {
      const chapter = content.chapter(id)!;
      const reachable = reachableScenes(chapter);
      for (const ending of terminalScenes(chapter)) {
        expect(reachable.has(ending.sceneId), `${id}/${ending.sceneId}`).toBe(true);
        count++;
      }
    }
    expect(count).toBe(47);
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
    expect(rows).toHaveLength(47);
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
    expect(digest(rows)).toBe(DIGESTS.endings);
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
    expect(digest(roads)).toBe(DIGESTS.roads);
  });

  it("setbacks fail the attempt at the campaign's limit, and the next evening starts again, as before", { timeout: 60_000 }, async () => {
    const log = (await setbackToFailure(content)) as { chapterId?: string; next?: string; attempt: ReturnType<typeof summary> }[];
    const limit = content.campaign(GEMFALL)!.setbackLimit!;
    const failed = log.find((e) => e.attempt?.status === "failed")!;
    expect(failed.attempt).toMatchObject({ status: "failed", setbacks: limit });
    expect(log.filter((e) => e.chapterId).map((e) => e.attempt!.setbacks)).toEqual([0, 0, 1, 2, 3, 4]);
    expect(log.at(-1)).toMatchObject({ next: "gemfall-01", attempt: { status: "active", setbacks: 0, lastIndex: 0 } });
    expect(digest(log)).toBe(DIGESTS.setbacks);
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
    // The hero as the pre-epic build stored it (character v1, unlockedActions
    // and class on the row), read the way any deploy reads an old row:
    // migrated, then written back at today's version. It keeps its moves.
    for (const character of save.characters) {
      const migrated = migrateCharacter(character, 1);
      expect(resolveCharacter(migrated, content.rules(), content.items()).actions).toEqual(["brace", "mending_light"]);
      await repo.putCharacter(migrated);
    }
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
    expect(digest(now)).toBe(DIGESTS.resumed);
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
