/**
 * The Gemfall compatibility probe (#203) — what gemfall-compat.test.ts plays.
 *
 * Kept apart from the test, and written against nothing newer than the build
 * *before* the nonlinear-campaign epic (#191: graph journeys, world state,
 * rifts, buffs, environmental combat) — room, join, seat, CONTINUE_CAMPAIGN,
 * PLAYTEST_GOTO, CHOOSE, the memory repository — so the very same file can be
 * run on that build. That is how the goldens in the test were taken: this
 * file and gemfall-compat-golden.test.ts were copied into a checkout of
 * 57c63ba8 (main just before #205, whose Gemfall content is byte-identical to
 * today's) and run there with
 *
 *   KAD_GEMFALL_GOLDEN=/tmp/golden.json npx vitest run packages/server/src/handlers/gemfall-compat-golden.test.ts
 *
 * which writes `goldens(content)` — and what that build produced is
 * packages/server/src/fixtures/gemfall-pre-epic-save.json, what today's build
 * must reproduce. "Gemfall plays identically" is then a comparison with the
 * old build, not with itself.
 *
 * Everything the probe reports is deterministic: the tables throw no dice
 * (each chapter is warped to its endings, or to its forks and then chosen
 * through), the one fight played is on dice keyed to the seq, room codes come
 * from the harness's seeded generator, and the two values that are random
 * per run — a run id, and the attempt id built from it — are left out of every
 * summary.
 */

import { createHash } from "node:crypto";
import {
  applyIntent,
  createRunState,
  currentActor,
  currentActorId,
  legalActions,
  legalMoves,
  makeRng,
  positionOf,
} from "@kad/shared";
import { lobbyCampaign } from "@kad/shared";
import type { ActionResponse, Chapter, Character, ClientIntent, RunState } from "@kad/shared";
import type { ContentStore } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import type { CampaignProgressRecord, RoomRecord, RunRecord } from "../store/repository.ts";
import { makeHarness, seedHousehold, T0 } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
export const GEMFALL = "gemfall";
const DAY = 24 * 60 * 60 * 1000;

/** A Gemfall household of one player, the dice keyed to the seq (as playthrough-driver.ts does). */
export async function gemfallHousehold(content: ContentStore) {
  const harness = makeHarness({ engine: realEngine, playtest: true, content });
  harness.deps.rng = (key) => makeRng(`gemfall-compat:${String(key).split(":").pop()}`);
  const seeded = await seedHousehold(harness, 1);
  const attempt = async () => harness.repo.getCampaignProgress(seeded.householdId, GEMFALL);
  return { harness, attempt, ...seeded };
}

export type GemfallHousehold = Awaited<ReturnType<typeof gemfallHousehold>>;

/**
 * One evening of Gemfall: a new room, the household's one player at the
 * table with the hero they already have (created on the first evening).
 */
export async function evening(h: GemfallHousehold) {
  const { harness } = h;
  harness.clock.advance(DAY);
  const created = await createRoom({ householdId: h.householdId, mode: "party", campaignId: GEMFALL }, harness.deps);
  if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
  const { code, runId } = created.value;
  const joined = await joinRoom({ code, principal: h.players[0]!.principal }, harness.deps);
  if (!joined.ok) throw new Error("join");
  const playerId = joined.value.playerId;
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const send = async (intent: ClientIntent) => applyAction({ runId, playerId, seq: (await state()).seq, intent }, harness.deps);
  const must = async (intent: ClientIntent) => {
    const response = await send(intent);
    if (!response.ok) {
      const s = await state();
      throw new Error(`${intent.type} refused in ${s.chapterId}/${s.sceneId}: ${JSON.stringify(response.error)}`);
    }
    return response;
  };
  const [hero] = await harness.repo.listCharacters(h.householdId);
  await must(
    hero
      ? { type: "SEAT_CHARACTER", characterId: hero.id }
      : {
          type: "CREATE_CHARACTER",
          name: "Pip",
          species: "unicorn",
          class: "thornguard",
          stats: { might: 1, quick: 1, clever: 0, heart: 1 },
        },
  );
  await must({ type: "READY", ready: true });
  return {
    code,
    runId,
    playerId,
    state,
    send,
    must,
    begin: async () => {
      // Once Gemfall is finished, Riftlight is open beside it and the lobby
      // asks which; replaying Gemfall is a vote for it.
      if (lobbyCampaign(await state()).contested) await must({ type: "VOTE_CAMPAIGN", campaignId: GEMFALL });
      await must({ type: "CONTINUE_CAMPAIGN", campaignId: GEMFALL });
      return (await state()).chapterId;
    },
    goto: async (sceneId: string) => must({ type: "PLAYTEST_GOTO", sceneId }),
    choose: async (choiceId: string) => must({ type: "CHOOSE", choiceId }),
  };
}

/** What the probe needs of a room: its run, and intents sent from the one seat. */
export interface Table {
  state(): Promise<RunState>;
  send(intent: ClientIntent): Promise<ActionResponse>;
  must(intent: ClientIntent): Promise<ActionResponse>;
}

/** The scenes a chapter can end on (no way on), with the outcome each settles as. */
export function terminalScenes(chapter: Chapter): { sceneId: string; outcome: "success" | "setback"; endsCampaign: boolean }[] {
  return Object.entries(chapter.scenes)
    .filter(([, scene]) => "choices" in scene && Array.isArray(scene.choices) && scene.choices.length === 0)
    .map(([sceneId, scene]) => ({
      sceneId,
      outcome: "outcome" in scene && scene.outcome === "setback" ? "setback" : "success",
      endsCampaign: "endsCampaign" in scene && scene.endsCampaign === true,
    }));
}

/** The one road/pursuit flag (if any) that selects a routed chapter. */
export function selectingFlags(chapter: Chapter): Record<string, boolean> {
  return chapter.route ? { [chapter.route.flag]: true } : {};
}

/**
 * An attempt row as the test reports it: what the server decided, without the
 * two per-run random values (`attemptId`, which embeds the run id) and the
 * write counter (`version`), and with the row's key set — a key that
 * appeared (a `journey`, say) is a change.
 */
export function summary(row: CampaignProgressRecord | null) {
  if (!row) return null;
  // `story` (#358) is the Story page's record, read by nothing at play time:
  // the gameplay the digests hold is everything else on the row.
  const { attemptId: _attemptId, version: _version, updatedAt: _updatedAt, story: _story, ...rest } = row;
  return { ...rest, keys: Object.keys(row).filter((k) => k !== "attemptId" && k !== "version" && k !== "story").sort() };
}

/**
 * Every ending of every Gemfall chapter, settled through the server: the
 * attempt row is put at the beat before the chapter, on the road that selects
 * it (in the shape rows had before attempt ids existed), a room continues the
 * campaign — which must start exactly this chapter — and the chapter is
 * warped to the ending. What the row says afterwards is the settlement.
 */
export async function settleEveryEnding(content: ContentStore) {
  const campaign = content.campaign(GEMFALL)!;
  const rows: unknown[] = [];
  const h = await gemfallHousehold(content);
  for (const chapterId of campaign.chapters) {
    const chapter = content.chapter(chapterId)!;
    for (const ending of terminalScenes(chapter)) {
      await h.harness.repo.putCampaignProgress({
        householdId: h.householdId,
        campaignId: GEMFALL,
        status: "active",
        setbacks: 0,
        lastIndex: chapter.index - 1,
        routeFlags: selectingFlags(chapter),
        coins: 0,
        updatedAt: new Date(T0).toISOString(),
      });
      const t = await evening(h);
      const started = await t.begin();
      await t.goto(ending.sceneId);
      const s = await t.state();
      rows.push({
        chapterId,
        sceneId: ending.sceneId,
        started,
        phase: s.phase,
        outcome: s.chapterOutcome ?? null,
        xpEarned: s.xpEarned,
        attempt: summary(await h.attempt()),
      });
    }
  }
  return rows;
}

/**
 * A whole campaign on one road and one pursuit, an evening per chapter, from
 * nothing: the road chosen at chapter 2's rumour board and the pursuit at
 * chapter 6's question, each through the real choice (so the real effect sets
 * the flag), every other chapter warped to its first success ending. What is
 * recorded is which chapter each evening's CONTINUE started and the row after
 * it settled — the carry rule, beat by beat.
 */
export async function playRoad(content: ContentStore, road: "east" | "north" | "west", pursuit: "restore" | "hoard" | "leash") {
  const campaign = content.campaign(GEMFALL)!;
  const h = await gemfallHousehold(content);
  const log: unknown[] = [];
  for (let night = 0; night < campaign.chapters.length; night++) {
    const t = await evening(h);
    const chapterId = await t.begin();
    if (!chapterId) break;
    const chapter = content.chapter(chapterId)!;
    if (chapter.index === 2) {
      await t.goto("choice_rumour_board");
      await t.choose(road);
    } else {
      if (chapter.index === 6) {
        await t.goto("scene_what_for");
        await t.choose(pursuit);
      }
      const end = terminalScenes(chapter).find((e) => e.outcome === "success" && !e.endsCampaign)
        ?? terminalScenes(chapter).find((e) => e.outcome === "success")!;
      await t.goto(end.sceneId);
    }
    const row = await h.attempt();
    log.push({ chapterId, attempt: summary(row) });
    if (row?.status !== "active") break;
  }
  return log;
}

/**
 * Setbacks until the campaign's limit fails the attempt, and the evening
 * after: a failed attempt is history, so CONTINUE starts Gemfall again.
 */
export async function setbackToFailure(content: ContentStore) {
  const h = await gemfallHousehold(content);
  const log: unknown[] = [];
  for (let night = 0; night < 12; night++) {
    const t = await evening(h);
    const chapterId = await t.begin();
    const chapter = content.chapter(chapterId!)!;
    if (chapter.index === 2) {
      await t.goto("choice_rumour_board");
      await t.choose("east");
    } else {
      const ends = terminalScenes(chapter);
      await t.goto((ends.find((e) => e.outcome === "setback") ?? ends[0]!).sceneId);
    }
    const row = await h.attempt();
    log.push({ chapterId, attempt: summary(row) });
    if (row?.status === "failed") {
      const after = await evening(h);
      log.push({ next: await after.begin(), attempt: summary(await h.attempt()) });
      break;
    }
  }
  return log;
}

/**
 * Plays the fight under way to its end with a plain policy (swing at an
 * adjacent enemy, else walk toward the nearest, else end the turn) and
 * returns how many intents it took. Used on a run restored from a save.
 */
export async function fightToTheEnd(t: Table, content: ContentStore) {
  for (let step = 0; step < 2000; step++) {
    const s = await t.state();
    const encounter = s.encounter;
    if (s.phase !== "encounter" || !encounter) return step;
    const actorId = currentActorId(encounter);
    const holder = encounter.combatants.find((c) => c.id === actorId);
    const actor = currentActor(encounter);
    if (holder?.side === "party" && !actor) {
      await t.must({ type: "END_TURN" });
      continue;
    }
    if (!actor || actor.side !== "party") {
      await t.must({ type: "ADVANCE" });
      continue;
    }
    const ctx = { rules: content.rules(), abilities: content.abilities(), rng: makeRng("legal-actions") };
    const foes = encounter.combatants.filter((c) => c.side !== "party" && !c.down).map((c) => c.id);
    const attack = legalActions(encounter, ctx).find((a) => a.abilityId === "attack" && a.targets.some((x) => foes.includes(x)));
    if (attack && !encounter.actionTaken) {
      const response = await t.send({ type: "COMBAT_ACTION", abilityId: "attack", targetId: attack.targets.find((x) => foes.includes(x))! });
      if (response.ok) continue;
    }
    const goals = foes.map((id) => positionOf(encounter, id)).filter((p) => p !== null);
    const moves = legalMoves(encounter);
    if (moves.length && goals.length && encounter.stepsLeft > 0 && !encounter.actionTaken) {
      const distance = (p: { x: number; y: number }) => Math.min(...goals.map((g) => Math.abs(g.x - p.x) + Math.abs(g.y - p.y)));
      const here = positionOf(encounter, actor.id)!;
      const best = [...moves].sort((a, b) => distance(a) - distance(b))[0]!;
      if (distance(best) < distance(here)) {
        await t.must({ type: "MOVE", to: { x: best.x, y: best.y } });
        continue;
      }
    }
    await t.must({ type: "END_TURN" });
  }
  throw new Error("the fight never ended");
}

// --- a save from the middle of a fight, and what happens after it ---------------

/**
 * Plays a household to the hero's first turn in chapter 2's first fight —
 * the board up, the monsters' opening moves made, the moment a phone is most
 * likely to drop — and returns every record that evening left in the store.
 * On the pre-epic build this *is* the legacy save the fixture holds.
 */
export async function takeSave(content: ContentStore) {
  const h = await gemfallHousehold(content);
  const first = await evening(h);
  await first.begin();
  await first.goto("rest_northbound");
  const t = await evening(h);
  await t.begin();
  const chapter = content.chapter((await t.state()).chapterId!)!;
  const fight = Object.keys(chapter.scenes).find((id) => chapter.scenes[id]!.type === "encounter")!;
  await t.goto(fight);
  await t.must({ type: "READY", ready: true });
  for (let i = 0; i < 40; i++) {
    const s = await t.state();
    if (s.phase !== "encounter" || !s.encounter) throw new Error(`left the fight: ${s.phase}`);
    const actor = currentActor(s.encounter);
    if (actor && actor.side === "party") break;
    await t.must({ type: "ADVANCE" });
  }
  const repo = h.harness.repo;
  const save = JSON.parse(
    JSON.stringify({
      state: await repo.getState(t.runId),
      run: await repo.getRun(t.runId),
      room: await repo.getRoom(t.code),
      characters: await repo.listCharacters(h.householdId),
      attempt: await h.attempt(),
      clock: h.harness.clock.now(),
    }),
  ) as Save;
  return { h, t, save };
}

/** Every record one evening leaves in the store — what `takeSave` returns and the fixture holds. */
export interface Save {
  state: RunState;
  run: RunRecord;
  room: RoomRecord;
  characters: Character[];
  attempt: CampaignProgressRecord;
  clock: number;
}

/**
 * What happens after the save: the fight played on by `fightToTheEnd` (on
 * dice keyed to the seq) and the chapter warped to its first success ending.
 * Reported with every beat the table was shown and the row it settled.
 */
export async function playOn(h: GemfallHousehold, t: Table, runId: string, content: ContentStore) {
  const fromSeq = (await t.state()).seq;
  const intents = await fightToTheEnd(t, content);
  const afterFight = await t.state();
  const beats = (await h.harness.repo.listEvents(runId, fromSeq)).map((e) => e.presentation ?? null);
  const chapter = content.chapter(afterFight.chapterId!)!;
  const end = terminalScenes(chapter).find((e) => e.outcome === "success")!;
  await t.must({ type: "PLAYTEST_GOTO", sceneId: end.sceneId });
  return {
    intents,
    fight: {
      phase: afterFight.phase,
      sceneId: afterFight.sceneId,
      party: afterFight.party.map((m) => ({ id: m.character.id, hp: m.hp, down: m.down })),
      flags: afterFight.flags,
    },
    beats,
    settled: summary(await h.attempt()),
    xpEarned: (await t.state()).xpEarned,
  };
}

/**
 * Everything the compatibility test compares, as one document: the digests
 * of the four results, the tables themselves (for a readable diff when a
 * digest moves), the mid-fight save and what played out after it. Run on a
 * build, this is that build's answer; gemfall-compat.test.ts writes it when
 * `KAD_GEMFALL_GOLDEN` names a file.
 */
export async function goldens(content: ContentStore) {
  const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const endings = await settleEveryEnding(content);
  const roads = [
    await playRoad(content, "east", "restore"),
    await playRoad(content, "north", "leash"),
    await playRoad(content, "west", "hoard"),
  ];
  const setbacks = await setbackToFailure(content);
  const { h, t, save } = await takeSave(content);
  const resumed = await playOn(h, t, t.runId, content);
  return {
    digests: { endings: digest(endings), roads: digest(roads), setbacks: digest(setbacks), resumed: digest(resumed) },
    endings,
    roads,
    setbacks,
    save,
    resumed,
  };
}
