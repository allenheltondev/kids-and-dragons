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
// Re-pinned for the owner-authorized Outline / disclosure gameplay wave.
// Preserve all 29 shipped checks, disclosure flags, terminal effects and fight
// numbers. Old/new probes match ending, road and setback digests, plus resumed
// fight play after generated hero-id normalization. Fixed legacy save stays pinned.
// Re-pinned for the owner-authorized opening/onboarding play wave: shared
// introductions, checked mail bags and farm-work hedge payoffs. All 20 old
// checks, campaign commitments and terminal effects remain intact. Old/new
// content loaded through the real loader preserves campaign digests and fight
// play-on after generated hero-id normalization; fixed legacy save unchanged.
// Re-pinned for the owner-authorized Ashfall evidence/purpose wave. All seven
// legacy checks and terminal effects remain; new comparison, discussion and
// learned-call recovery preserve the original reveal and clock commitments.
// Old/new loader-based probes match campaign digests and normalized fight
// play-on. Fixed legacy save and gameplay digest constants remain unchanged.
// Re-pinned for the owner-authorized pursuit play wave: earned signal, market
// evidence and instrument activities. All 40 shipped checks, ending effects,
// trades and Walk exits remain. Old/new loader probes match campaign digests
// and normalized resumed fight play. Gameplay digest constants are unchanged.
// Re-pinned for the eighth-wave finale play changes: all 27 old check scenes
// remain identical. Four playable verdict/confrontation paths are additive
// alternatives; terminal outcomes and encounter definitions are preserved.
// Re-pinned for #534 review: remove automatic quiet-practice duplication.
// Successful/assisted practice now visits the unchanged legacy result scene;
// misses earn no practice. Legacy rolls and gameplay digests remain unchanged.
// Re-pinned for #535 completion: concise approach, explicit philosophy risks,
// and empty-handed shared restoration. All 27 shipped checks and terminal
// effects remain; campaign gameplay digest constants stay unchanged.
// Re-pinned for the owner-requested Gemfall pacing pass: routine activities
// become story or conversation. Original activities remain in resumeInteractions
// for saved prompts; endings, roads, setbacks and resumed-save digests stay pinned.
// Re-pinned for the PR #559 participation fix: fifteen casual conversations
// use story-turn choices; the three councils retain collective votes.
// Original archived activities and campaign gameplay digests remain unchanged.
// Re-pinned for the voice dialogue pass (#549): narration, prompt, variant and
// branch text only, turning reported speech into short quoted lines spoken by
// someone already on stage, then an American-vernacular pass over the new lines. No id, goto, effect, flag, condition, choice, cast
// or outcome changed; the endings, roads, setbacks and resumed-save digests
// below are unchanged.
// Re-pinned for the owner-requested American-vocabulary sweep: queue -> line,
// spectacles -> glasses, draught -> potion, Nan -> Nana, Great-Gran ->
// Great-Grandma, "hands round" -> "hands around" and the like, in text only,
// with "line soup" and "line camp" reworded for sense (soup for travelers in line).
// resumeInteractions keep their shipped words; gameplay digests are unchanged.
// Re-pinned for a prose pass on chapter 1 from family playtest feedback:
// gemfall-01 narration, labels, branch and variant text only (shorter, plainer,
// and continuity fixes at merge points). The nine legacy checks and
// resumeInteractions keep their shipped words; no scene, edge, flag, effect,
// stat or TN moved, and the gameplay digests are unchanged.
// Re-pinned for the prose pass on chapters 2 to 8 from family playtest feedback (#582): narration,
// labels, branch and variant text only, shorter and plainer with continuity fixed at merge points.
// The legacy checks and resumeInteractions keep their shipped words; no scene, edge, flag, effect,
// stat or TN moved, and the gameplay digests are unchanged.
// Re-pinned for the dialogue pass on gemfall-04b and gemfall-07r (#549): a few quoted lines in
// narration (a warden, a faun, a mire mimic, an echo) so the recorded voices have something to say.
// Narration text only; no scene, edge, flag, effect, stat or TN moved, and the gameplay digests are unchanged.
// Re-pinned for the owner-approved chapter 2 quality pass (gemfall-02): a graph change. The bridge beam
// (relay), the stuck wagon (timing) and the hedge brace (precision) become games that can miss, where
// they were cooperate or balance games no party could fail; sneaking past the cinder wolves becomes a
// timing game (`interaction_wolf_sneak`) whose miss reaches the existing wolf fight; one clever check
// (`check_signs_add_up`) joins the five tremor outcomes before `scene_corner_row`, and a party that
// passes it gets a scene with Marda (`rest_marda_inn_signs`, she pays 3 coins), and a party that misses it
// can still ask her (`rest_marda_inn_explains`). The goal is now a question to look into, and
// the opening, the jackalope scene and the wolf scene introduce the hedges, the sausage wagon and the
// sheeple. The endings, roads, setbacks and resumed-save digests below were not re-taken: they still
// match the pre-epic build, because each warps straight to a terminal scene or fork.
// Re-pinned for the owner-approved chapter 3c quality pass (gemfall-03c): a graph change. Five games no
// party could fail become games that can miss, so the ford's own stakes are real: the Brackens' cart
// (timing), the crew's brace in the surge (precision), the stuck wagon (precision) and the marker posts
// (relay) keep their authored costs, and holding the line against the red scarves is a timing game.
// The soup bowls pay a honeycake and the awning pays a two coin tip, where both results were identical.
// Their cues and narration describe the tap each game really asks for. The goal now asks why the charms
// ring, and the opening introduces them. No scene, edge, stat or TN
// moved; the endings, roads, setbacks and resumed-save digests below are unchanged.
// Re-pinned for the authored quay combat redesign (chapter 01), and the solo-safe
// bell-rope instruction exposed by its new dice sequence (chapter 05c).
// Ending, road, setback, resumed-save, and ordinary-fight goldens are unchanged.
// Chapter 02 is re-pinned for the opt-in wagon hold and mimic crossing missions.
// The campaign file is re-pinned for the crew's camp (#617, docs/camp.md §4.1, approved in §10):
// it gains `"growsCamp": true`, which only the camp's frame reads. No chapter changed, and no flag,
// XP, item, route or ending moved, so the gameplay digests below are unchanged.
// Chapter 1 is re-pinned for its first camp finds (#622, docs/camp.md §5.1, §5.3, §5.4; approved
// by the owner): interaction_quay_line gains a `findForKit` (the lamp ribbon) and
// interaction_lantern_pole a `findForCamp` (Hesper's wagon lantern), each an `onEnter` beside a
// sentence of narration naming the thing. A find changes no flag, XP, item or route, so the
// gameplay digests below are unchanged.
// Every chapter is re-pinned for indoor and outdoor rest scenes (#625, docs/camp.md §3.2, §10;
// re-taking the hashes for the camp is approved by the owner): each of Gemfall's rest scenes
// gains a required `"setting": "indoor"` or `"outdoor"`, which only the camp's presentation
// reads (the full camp outdoors, the camp packed down into the scene's picture indoors). No
// flag, XP, item, route, effect or ending moved, and the gameplay digests below are unchanged.
// Chapters 03a, 03b, 04a and 05b are re-pinned again where the rest scenes met main's marsh-road
// and switchback fight reworks (#647, #650): the hashes are the merged files, each fight rework as
// main shipped it plus the rest scenes' `setting`. The gameplay digests below are unchanged.
// Chapters 04c, 05a and 06 are re-pinned again where the rest scenes met main's foothill fight
// reworks (#653): the hashes are the merged files, each fight rework as main shipped it plus the
// rest scenes' `setting`. The gameplay digests below are unchanged.
// Chapters 01, 02 and 04b are re-pinned for the camp's friends (#626, docs/camp.md §4.4; re-taking
// the hashes for the camp is approved by the owner): each gains one befriending on its spine, a
// vote with "Come along" (a `befriend` effect) beside "Say goodbye", each landing on its own
// result scene before both go on to the scene that followed before. 01's harbor gull asks at dawn
// after the Empty Chair, 02's silver otter as the party leaves the mimic ditch, 04b's strawberry
// mosshorn at the gray edge after the herd. A befriend changes no flag, XP, item, route or
// ending, no shipped check or terminal scene moved, and the gameplay digests below are unchanged.
// Chapter 04b is re-pinned for the mosshorn's "come along" words (#626, approved by the owner):
// scene_mosshorn_along no longer promises the mosshorn will find the party in the Woods, which
// the Glade Stone ending ("no mosshorn comes near") contradicted; it will catch up someday. One
// narration string only: no scene, edge, flag, effect, stat or TN moved, and the gameplay
// digests below are unchanged.
const GEMFALL_FILES: Record<string, string> = {
  "campaigns/gemfall.json": "7042c8fa98760e9ded81d479d40e392bb56ecb9bf62ed70baf724ffa53b7a09a",
  "chapters/gemfall-01.json": "46c1b186b77488b5c059dab1fea98e7e52ef06a14f0b7900037052c046a6f8ca",
  "chapters/gemfall-02.json": "7038a91ac31f55b64db18eec8d2ae05587a61dc6c5c6623df0f493193ccd71d4",
  "chapters/gemfall-03a.json": "aa3f2e19a4db60409c4541eac8bc4277488f65f0789318b4a8556125cb5e5686",
  "chapters/gemfall-03b.json": "c7b75db3061e7df9ec1fa51bfc01cb60ee359cd6bbac6b4a9a881556b481b036",
  "chapters/gemfall-03c.json": "50ba95c1a4ac5f6c700abbc433b38b617b677799f6364818f90d0e03e8d9006b",
  "chapters/gemfall-04a.json": "42889a82ac23a08135bdb2a942792906e1d36a5b9308f93cb4400b4770124115",
  "chapters/gemfall-04b.json": "a1852d7992f982cc47a5f29297fc2d984d77a6c7a64bbaef2077d57ebea051a5",
  "chapters/gemfall-04c.json": "17b14d20611e8d1c7361c057625f9fd49ac253b0a7d7d4b01ef80d5a04ce73ae",
  "chapters/gemfall-05a.json": "bf36941e45e9064f050a1cc12ca06ff17454470212222d0d083ac32d5075a0bf",
  "chapters/gemfall-05b.json": "f0a16c181e23485c1c181ef91d758e5f4627bb769599cdbadc443b5a70c2bbf9",
  "chapters/gemfall-05c.json": "da75ade067bc5769638c58401e2dd4876c2704553cb1ba182761057ef87a853d",
  "chapters/gemfall-06.json": "b1e6c764a451e59ec39198bdffa87b0989977479682875bf5720e7f3dba360c7",
  "chapters/gemfall-07h.json": "5e247fbcfeaad63d3a3786189a551a30479dd898b256cc4d4a93235acb1753cc",
  "chapters/gemfall-07l.json": "469436e8d7737ff5784a8128ef3dcd4dd2a54e8a407bcb0eb2262348d9dc702e",
  "chapters/gemfall-07r.json": "6555ab01bd48cb40cd944cb91c5a65b841518058d708ac943f79cfb54a13e295",
  "chapters/gemfall-08.json": "d075f2163272dc3d29b89d0d12e937691d1fe12ea4cbf9eabd3406226f372612",
};

describe("Gemfall's reviewed files and legacy contracts", () => {
  it("every file matches its reviewed content digest", () => {
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
