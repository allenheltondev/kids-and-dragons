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

import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyIntent,
  beginEncounter,
  createRunState,
  currentActor,
  encounterOutcome,
  endTurn,
  legalActions,
  makeRng,
  moveTo,
  parseBoard,
  performAction,
  planEnemyTurn,
  resolveCharacter,
} from "@kad/shared";
import type {
  Campaign,
  ClientIntent,
  EncounterEvent,
  EncounterScene,
  EncounterState,
  EnemyPlacement,
  ResolvedCharacter,
  RunState,
} from "@kad/shared";
import { loadContent } from "../content/loader.ts";
import type { Engine } from "../engine/port.ts";
import type { CampaignProgressRecord, GameRepository } from "../store/repository.ts";
import { makeChapter, makeCharacter } from "../../../shared/src/test-fixtures.ts";
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
        // Temporary buffs (#200) are seeded only from a graph journey.
        expect(state).not.toHaveProperty("buffs");
        expect(state.encounter ?? {}).not.toHaveProperty("buffs");
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

    // Rift actions (#197) are a graph journey's too: an ordered campaign has
    // no rifts to act on, and the attempt row is left exactly as it was.
    const seq = (await harness.repo.getState(created.value.runId))!.seq;
    for (const action of ["discover", "open", "close", "stabilize", "redirect"] as const) {
      const acted = await send({ type: "RIFT_ACTION", action, edgeId: "to-orchard", visit: 1, to: "orchard", campaignId: "gemfall" });
      expect(acted).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
      expect(acted.ok ? "" : acted.error?.message).toContain("no map");
    }
    // …and naming a way (#199) changes nothing: the campaign is refused before any party is judged.
    const way = await send({ type: "RIFT_ACTION", action: "open", edgeId: "to-orchard", visit: 1, way: "attune", campaignId: "gemfall" });
    expect(way).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(way.ok ? "" : way.error?.message).toContain("no map");
    expect((await harness.repo.getState(created.value.runId))!.seq).toBe(seq);
    expect(await harness.repo.getCampaignProgress(householdId, "gemfall")).toEqual(attempt);
    expect(await harness.repo.getCampaignProgress(householdId, "gemfall")).not.toHaveProperty("journey");
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

  it("carries no world state (#198): no facts, no completion rules, nothing but the road", async () => {
    // World facts are a graph declaration's, written by its edges and node
    // completion rules. An ordered campaign has neither, so a run whose flags
    // happen to look like a world write settles exactly as any other.
    for (const id of ["gemfall", "the-hollow-crown"]) {
      expect(content.campaign(id)).not.toHaveProperty("graph");
      expect(content.graph(id)).toBeNull();
    }
    const harness = makeHarness({
      content: makeContent({ chapters: [makeChapter(), { ...makeChapter(), id: "beat-02", index: 2 }], campaigns: [CAMPAIGN] }),
    });
    const { householdId } = await seedHousehold(harness, 1);
    const finished = {
      runId: "r_1",
      campaignId: CAMPAIGN.id,
      chapterId: "bramblewood-01",
      sceneId: "scene_ending",
      chapterOutcome: "success",
      bonuses: [],
      xpEarned: 150,
      flags: { road_river: true, befriended_river_folk: true },
      party: [],
    } as unknown as Parameters<typeof settleChapterCompletion>[0];
    const settlement = await settleChapterCompletion(finished, harness.deps, householdId);
    expect(settlement.campaignProgress).not.toHaveProperty("journey");
    expect(settlement.campaignProgress?.routeFlags).toEqual({ road_river: true });
    expect(settlement.campaignView).not.toHaveProperty("journey");
  });
});

/*
 * Temporary buffs (#200) reach into the fight itself — Guard, attack rolls,
 * damage, steps — so "no change for ordered campaigns" is pinned at the level
 * of the numbers, not just the absence of a field: Gemfall heroes holding
 * real trinkets are resolved, and a real Gemfall fight is played on a fixed
 * seed, and the whole transcript is hashed. The golden digest was taken from
 * the build *before* buffs existed (this test uses nothing newer), so any
 * drift in item/trinket resolution or combat arithmetic fails here.
 */
describe("Gemfall's numbers, with temporary buffs in the build (#200)", () => {
  /** The digest of the transcript below, as the pre-#200 build produced it. */
  const GOLDEN = "55d9cdf7dc65cb8c06bd6bdf73baebb44b33db03627036c722a7990c2f5f309d";

  const rules = content.rules();
  const items = content.items();
  const abilities = content.abilities();

  const HEROES = [
    makeCharacter({
      id: "c_thorn",
      name: "Bramble",
      species: "bigfoot",
      class: "thornguard",
      stats: { might: 3, quick: 1, clever: 0, heart: 1 },
      inventory: [{ itemId: "thistle_pin", kind: "trinket" }, { itemId: "hearthstone_bead", kind: "trinket" }],
    }),
    makeCharacter({
      id: "c_dusk",
      name: "Windstep",
      species: "griffin",
      class: "duskrunner",
      stats: { might: 0, quick: 3, clever: 1, heart: 1 },
      inventory: [{ itemId: "luckstone", kind: "trinket" }, { itemId: "quickfoot_lace", kind: "trinket" }],
    }),
    makeCharacter({
      id: "c_star",
      name: "Glimmer",
      species: "kitsune",
      class: "starweaver",
      stats: { might: 0, quick: 1, clever: 3, heart: 1 },
      inventory: [{ itemId: "owlfeather_clasp", kind: "trinket" }],
    }),
    makeCharacter({
      id: "c_song",
      name: "Sparklehoof",
      species: "unicorn",
      class: "songkeeper",
      stats: { might: 1, quick: 1, clever: 0, heart: 3 },
      inventory: [{ itemId: "songbird_ribbon", kind: "trinket" }, { itemId: "river_charm", kind: "trinket" }],
    }),
  ];

  /** One fight, both sides played by the monsters' own planner, every event kept. */
  function playFight(party: readonly ResolvedCharacter[], chapterId: string, sceneId: string, seed: string) {
    const scene = content.chapter(chapterId)!.scenes[sceneId] as EncounterScene;
    const map = content.map(scene.map)!;
    const ctx = { rules, abilities, rng: makeRng(seed) };
    const enemies: EnemyPlacement[] = [];
    for (const spec of scene.enemies) {
      for (let n = 0; n < spec.count; n++) enemies.push({ spec, at: map.enemySpawns[enemies.length]! });
    }
    let state: EncounterState = beginEncounter(
      {
        board: parseBoard(map.rows),
        party: party.map((character, i) => {
          // Luckstone charges from the bag, as engine.ts `startEncounter` counts them.
          const rerollOnes = character.inventory.reduce((n, entry) => {
            const passive = items[entry.itemId]?.passive;
            return passive?.type === "rerollOnes" ? n + passive.perEncounter : n;
          }, 0);
          return { character, at: map.partySpawns[i]!, ...(rerollOnes > 0 ? { rerollOnes } : {}) };
        }),
        enemies,
      },
      ctx,
    );
    const log: (readonly EncounterEvent[])[] = [];
    const at = (id: string) => {
      const actor = state.board.actors.find((a) => a.id === id)!;
      return { x: actor.x, y: actor.y };
    };
    for (let turn = 0; turn < 300 && encounterOutcome(state) === "ongoing"; turn++) {
      const actor = currentActor(state);
      if (!actor) break;
      const foes = state.combatants
        .filter((c) => c.side !== actor.side && state.board.actors.some((a) => a.id === c.id))
        .map((c) => ({ id: c.id, at: at(c.id), hp: c.hp, maxHp: c.maxHp, down: c.down }));
      const plan = planEnemyTurn({
        board: state.board,
        enemy: { id: actor.id, at: at(actor.id), steps: state.stepsLeft },
        party: foes,
      });
      if (plan.moveTo) {
        const moved = moveTo(state, plan.moveTo);
        if (moved.ok) {
          state = moved.state;
          log.push(moved.events);
        }
      }
      const attack = legalActions(state, ctx).find((a) => a.abilityId === "attack" && a.targets.length > 0);
      if (attack) {
        const swung = performAction(state, ctx, { abilityId: "attack", targetId: attack.targets[0]! });
        if (swung.ok) {
          state = swung.state;
          log.push(swung.events);
        }
      }
      if (encounterOutcome(state) === "ongoing") state = endTurn(state);
    }
    return { log, final: state, outcome: encounterOutcome(state) };
  }

  it("resolves trinket-holding heroes and plays a seeded Gemfall fight exactly as before", () => {
    const party = HEROES.map((hero) => resolveCharacter(hero, rules, items));
    const fights = [
      playFight(party, "gemfall-02", firstEncounter("gemfall-02"), "gemfall-golden-1"),
      playFight(party.slice(0, 2), "gemfall-03a", firstEncounter("gemfall-03a"), "gemfall-golden-2"),
    ];
    // The fights must be real ones, or the digest pins nothing.
    for (const fight of fights) {
      expect(fight.log.flat().some((event) => event.type === "roll")).toBe(true);
      expect(fight.final).not.toHaveProperty("buffs");
    }
    const digest = createHash("sha256").update(JSON.stringify({ party, fights })).digest("hex");
    expect(digest).toBe(GOLDEN);
  });

  /*
   * Environmental combat (#201) is opt-in per encounter scene, and a fight
   * whose scene declares no `environment` is handed straight to the base turn
   * hand-over. The digest above already pins the numbers; this pins the
   * reason: no shipped ordered chapter declares one, and a seeded Gemfall
   * fight never grows an environment, an escaped hero, or an environmental
   * beat.
   */
  it("has no environmental combat anywhere: no shipped ordered encounter declares one, and a fight never grows one (#201)", () => {
    for (const campaignId of ["gemfall", "the-hollow-crown"]) {
      const campaign = content.campaign(campaignId)!;
      for (const chapterId of campaign.chapters) {
        for (const scene of Object.values(content.chapter(chapterId)!.scenes)) {
          if (scene.type !== "encounter") continue;
          expect(scene).not.toHaveProperty("environment");
          expect(scene).not.toHaveProperty("onEscape");
          expect(scene).not.toHaveProperty("onTimeout");
        }
      }
    }
    const party = HEROES.map((hero) => resolveCharacter(hero, rules, items));
    const ENVIRONMENT_BEATS = ["hazard", "escaped", "freed", "captiveLost", "relocated", "riftClock", "surge"];
    for (const fight of [
      playFight(party, "gemfall-02", firstEncounter("gemfall-02"), "gemfall-golden-1"),
      playFight(party.slice(0, 2), "gemfall-03a", firstEncounter("gemfall-03a"), "gemfall-golden-2"),
    ]) {
      expect(fight.final).not.toHaveProperty("environment");
      expect(fight.final.combatants.some((c) => "escaped" in c)).toBe(false);
      expect(fight.log.flat().filter((e) => ENVIRONMENT_BEATS.includes(e.type))).toEqual([]);
      expect(["victory", "defeat"]).toContain(fight.outcome);
    }
  });

  function firstEncounter(chapterId: string): string {
    const scenes = content.chapter(chapterId)!.scenes;
    return Object.keys(scenes).find((id) => scenes[id]!.type === "encounter")!;
  }
});
