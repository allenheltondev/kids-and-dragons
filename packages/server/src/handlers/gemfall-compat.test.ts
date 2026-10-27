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
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { campaignMode, migrateCharacter, reachableScenes, resolveCharacter, validateChapter } from "@kad/shared";
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
 *
 * Re-pinned for the `voiceGuide` rename (#347): each chapter's authors' voice
 * guide changed its key name and nothing else, and nothing at play time reads
 * it. The endings, roads, setbacks and saves below still match their pre-epic
 * digests.
 *
 * Re-pinned for the chapter 7 cohesion rewrite (#355): wording, labels and
 * check prompts only in 06, 07h, 07l and 07r (the opening states the goal and
 * the test, the masks are named where they first appear and seeded on 06's
 * spine). No scene, edge, flag, effect, stat or TN moved; the endings, roads,
 * setbacks and saves below still match their pre-epic digests.
 *
 * Re-pinned for gemfall-07l's `checkKind` marks (#354): four heart checks
 * whose prompts #355 made physical say `"doing"` for the pacing report.
 * Nothing at play time reads the field; the digests below are unchanged.
 *
 * Re-pinned for the chapter goals (#356): each chapter gained a `goal` and the
 * chapter-local `setFlag`s its steps watch. Those flags are no route set's, so
 * they die with the chapter, and none is set where the pinned mid-fight save
 * resumes (02's wolves to its plank bridge). The endings, roads, setbacks and
 * saves below still match their pre-epic digests.
 *
 * Re-pinned for the 03x cohesion fixes (#368): wording, labels, prompts, one
 * narration variant and `checkKind` marks only in 03a, 03b and 03c (each
 * opening states its goal and calls back Marda's rumor board, drakes, the
 * boggarts and the Hollow Gate are set up before they are used, old friends
 * are re-met, UK idioms are gone). No scene, edge, flag, effect, stat or TN
 * moved; the endings, roads, setbacks and saves below still match their
 * pre-epic digests.
 *
 * Re-pinned for true relative size (#362): gemfall-07r's four "Corbin and
 * Posy" scenes drop `"size": "very_large"`. That word meant "a bit over a
 * hero" when sizes were a compressed scale; with real heights it would stand
 * a burrowfolk carrying his little sister at two and a half meters. The figure
 * now stands at its own height (150 cm, manifest castFigures). Presentation
 * only: the endings, roads, setbacks and saves below are unchanged.
 *
 * Re-pinned for the stage 4 cohesion fixes (#368): wording, labels, prompts,
 * narration variants and `checkKind` only in 04a, 04b and 04c (each opening
 * states its goal, Sefa sends the party to the waystation, callbacks to 3A, 3B
 * and 3C, UK idioms out). No scene, edge, flag, effect, stat or TN moved; the
 * endings, roads, setbacks and saves below still match their pre-epic digests.
 *
 * Re-pinned for the chapter 5 cohesion fixes (#368): wording, labels, check
 * prompts, cast names and `checkKind` only in 05a, 05b and 05c (each opening
 * states its goal, 05b's eldest names the Skywardens and the grandmothers
 * before the vote and its soup woman is Marigold, not Hessa, UK idioms out).
 * No scene, edge, flag, effect, stat or TN moved; the endings, roads,
 * setbacks and saves below still match their pre-epic digests.
 *
 * Re-pinned for the 01 and 02 cohesion fixes (#368): wording, labels, check
 * prompts and one `checkKind` only. Each opening says its chapter's goal, 01
 * names the evening's plan and introduces the Empty Chair before using it, 02
 * names Hesper's caravan and has her say goodbye, and UK idioms became US
 * ("queue" stays, by the owner's ruling).
 * No scene, edge, flag, effect, stat or TN moved; the endings, roads,
 * setbacks and saves below still match their pre-epic digests.
 *
 * Re-pinned for 02's `check_reroute` (owner decision on #368): its stat went
 * from heart to quick, with a physical prompt, label and branch narration, so
 * turning the rush wagons is something the party does. That is a graph change,
 * but the probe warps past the check and never rolls it, so the endings,
 * roads, setbacks and saves below still match their pre-epic digests.
 *
 * Re-pinned for gemfall-06's cohesion fixes (#368): wording, labels, a check
 * prompt and narration variants only. The opening states the goal and names
 * Redspire, Hessa introduces the seal, the shut-out p1 says its fact plainly,
 * Pellam's record reads back the party's motive, road, ember, sprites, glade
 * and reading, and `check_doorstep` is a stand-your-ground check marked
 * `"doing"`. No scene, edge, flag, effect, stat or TN moved; the digests below
 * are unchanged.
 *
 * Re-pinned for gemfall-08's cohesion fixes (#368): wording, labels, check
 * prompts and narration variants only. The opening states the goal and each
 * pursuit's promise, every ending reads back motive, the soup tents and allies,
 * the wardens' post reads allies, Hessa and her masked singers arrive where
 * they are cast, the Keystone is named where it is lifted, "cult" is gone, and
 * `check_remains` walks the bones home, marked `"doing"`. No scene, edge, flag,
 * effect, stat or TN moved; the digests below are unchanged.
 *
 * Re-pinned for gemfall-08's setback reroutes, an owner decision on #368: an
 * ordinary failed roll no longer reaches a loss. A failed race, a lost fight
 * with the Keeper, a failed pry at the Keystone and a failed tether hold each
 * reroute at a cost (a stone taken, a scrape, time, a way closed); Last Ring
 * needs `clock_late` and Turned Back empty hands and a spent clock, each after
 * two failures, and Broken Tether a second, chosen try. A graph change, but no
 * terminal scene was added, removed or re-outcomed, so the endings, roads,
 * setbacks and saves below, re-taken by the probe, still match their pre-epic
 * digests.
 *
 * Re-pinned for gemfall-08's verdict replies, an owner decision on #368: each
 * answer to the Seal-Keeper's last question lands on a scene where it answers
 * back, then on `check_verdict` as before. Six scenes and their edges; no
 * terminal scene changed, and the digests below, re-taken by the probe, still
 * match.
 *
 * Re-pinned for "Last time..." (#357): the campaign file gained `lastTime`, one
 * line per route-set member and an opener, read by the shared screen before a
 * chapter's first scene. The engine and server never read it, and no chapter
 * file changed. The endings, roads, setbacks and saves below still match their
 * pre-epic digests.
 *
 * Re-pinned 2026-10-22 for gemfall-08's titan finale (the owner's playtest:
 * the ending was a menu pick, the titan barely appeared, and the chapter read
 * more than it played). The seal now cracks and the titan opens its eye and
 * asks its question before the choice (doing checks, the p1 still
 * `scene_seal_chamber`); each answer plays out in checks and scenes that land
 * it before its ending; the climb gains two doing checks, the Seal-Keeper's
 * road question an ash-map check, and the spine reads shorter. A graph change,
 * but every terminal scene keeps its id, file order, outcome and effects, and
 * the endings, roads, setbacks and saves below still match their digests.
 *
 * Re-pinned 2026-10-22 for Gemfall's prologue (docs/story-plates.md): the campaign file
 * gained `prologue`, four painted plates with the story told over them, shown once per
 * device before chapter 1's first scene. Only the campaign file changed (no chapter file,
 * scene, edge, flag, effect, stat or TN), and the engine and server never read the field.
 * The endings, roads, setbacks and saves below still match their digests.
 */
// Re-pinned for #384: fourteen commissioned cast figures replace role stand-ins;
// chapter edits change cast figures and remove obsolete size overrides only.
// Review follow-up also replaces four unnamed Keeper entries and the chapter-2 relay runner.
// The gameplay digests (endings, roads, setbacks and saves) remain unchanged.
// Re-pinned for the owner-requested Gemfall chapter paintings in PR #423:
// fifteen chapters gain only `plate` (art id + static opening narration), including
// every road and pursuit variant. Chapter 1 keeps its existing prologue. No scenes,
// goals, exits, effects, flags, stats or TNs change; gameplay digests are untouched.
// Re-pinned for the interactivity pass (this commit): every chapter gained a fight on
// the spine, story interactions (relay, memory, cooperate, play, balance, timing,
// tracking, sequence), whole-table and best-of rolls, class moments and item and
// coin rewards. Scenes and edges were added and some talking checks became
// interactions; no ending, road flag, setback or resumed save moved, and the
// ending, road, setback and resumed digests below still match.
// Re-pinned for PR #499 review: shared interactions cover alternate success
// routes in 03c, 05a and 08. No rewards, flags, checks or endings changed;
// the ending, road, setback and resumed-save digests remain pinned.
// Re-pinned for #497 chapter 03a/03b/03c fight backdrops: nine scene.art
// fields only. All gameplay content and gameplay digest constants are unchanged.
// Re-pinned for #497 chapter 04a/04b/04c fight backdrops: nine scene.art
// fields only. All gameplay content and gameplay digest constants are unchanged.
// Re-pinned for #497 chapter 05a/05b/05c fight backdrops: ten scene.art
// fields only. All gameplay content and gameplay digest constants are unchanged.
// Re-pinned for #497 chapter 07 pursuit fight art: nine scene.art fields only;
// all other chapter fields and gameplay digests remain unchanged.
// Re-pinned for #497 chapter 06 records-hall fight art: three scene.art
// fields only. All gameplay content and gameplay digest constants are unchanged.
// Re-pinned for #497 chapter 08 guard-crab fight art: three scene.art fields
// only; all other chapter fields and gameplay digest constants are unchanged.
// Re-pinned for the owner-authorized 03A/03B play-design wave: new hands-on
// approaches, preparation payoffs and shorter narration. Shipped check scenes,
// encounter numbers, terminal effects and route sets stay intact. The old/new
// probe matched endings, roads and setbacks; the fixed legacy-save play-on
// below remains unchanged. New complete-route/control tests cover the new graph.
// Re-pinned for the owner-authorized 03C/04C play-design wave: queue-job
// recovery, shared route/claim/signal work and road-crew wind help. All 21
// shipped checks, terminal effects and encounter numbers remain intact. Old/new
// probes matched endings, roads and setbacks, plus fresh-save play-on after
// normalizing hero ids. Fixed legacy-save and gameplay digests remain unchanged.
// Re-pinned for the owner-authorized Pride Roads / forest play-design wave.
// All 21 shipped roll scenes remain identical; before/after campaign probes
// preserve ending, road and setback digests and resumed fight behavior.
const GEMFALL_FILES: Record<string, string> = {
  "campaigns/gemfall.json": "7d2f26f62f10f83a316c4ee4eeae91a69bbda88908a34c5bf0cafd4dffe418ae",
  "chapters/gemfall-01.json": "67a4b9a4d8a8be313734b201acc02cd8a26a164f22f7b4df2330ef15fd74b8f8",
  "chapters/gemfall-02.json": "ab26cdedc0b4af9f0153e75829ba49220c40e323bf6d739309cdfc82c101911e",
  "chapters/gemfall-03a.json": "d6201dc9591b54b0c5c3cdb2b976e79320323b5a014f7dbca65e52c602f43f74",
  "chapters/gemfall-03b.json": "47fcd09e1e8976970e599324e6b8a0d49915b5963ddcb99e58a7c8e014333111",
  "chapters/gemfall-03c.json": "536fed5cd8c29e696f1857eb35addf13159f1791ad1e04a940ea3d5f567f8c00",
  "chapters/gemfall-04a.json": "14c8edd54d29064f06fb3039942d4e27bd18bf5c846c43e8cc43951b4570eea4",
  "chapters/gemfall-04b.json": "c38a1dc13c537f3ac036e744411e025dd50e6c44990d54ed3cae9b618fb0374c",
  "chapters/gemfall-04c.json": "cc7204b9456910cf495398d9fa5f901639edbf1d4ec9043517ca09c263838258",
  "chapters/gemfall-05a.json": "1d4dd137c4e28869a3efe90673d824bd9a7a586b56b263e7c9c309a8ecec4fc7",
  "chapters/gemfall-05b.json": "bdbfcc8598c34b9e6dd1d7816d0290f9940aa26ce146a0ccb3536e3fbb2e632d",
  "chapters/gemfall-05c.json": "190ba4ca072e7c95525dcef6dec60570a843e8818d91e7aa0bedb222d2448dda",
  "chapters/gemfall-06.json": "1321cd4e6c6946e15d0f7802f1dd80e5d020574b2026d9ce6e09098e22c52c99",
  "chapters/gemfall-07h.json": "1c90cbaf7f0fd268ebe0112a9ef568b844f5b84784612f3601a0eba8483af38e",
  "chapters/gemfall-07l.json": "a890db266b3d0624a33be91687b18b873dafb3c584fa845cd90942b5bb9db577",
  "chapters/gemfall-07r.json": "ea45e9c3b0b6d05e20a1329ecb2de52129e760b58aad5ee097c52ed158193626",
  "chapters/gemfall-08.json": "982f9a5a7650d213e659c38c6f13dbba12d6c4b3c6fbdac4d2ed11e2f7ee73b3",
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
