/**
 * Milestone kit pieces during play (#621, docs/camp.md §5.4): a tier reached at
 * a chapter's end writes its tent, and a distinction landed by a deed (at a
 * fight's end, or on a class's own choice) writes its decoration, to the
 * hero's stored kit the moment it lands, once; a failed campaign that puts
 * either back leaves the piece; and her phone is told on the live broadcast.
 *
 * Through the handlers and the real engine, on the class-deeds fixture's
 * shape: one story deed lands a Songkeeper's next rank, and ending a turn
 * beside the wolf lands a Thornguard's.
 */

import {
  applyIntent,
  createRunState,
  currentActor,
  emptyKit,
  MILESTONE_KIT_PIECES,
  positionOf,
  readKit,
  type Campaign,
  type Chapter,
  type ChannelMessage,
  type ClientIntent,
  type RulesContent,
  type RunState,
  type ServerMessage,
} from "@kad/shared";
import { afterEach, describe, expect, it } from "vitest";
import { makeCharacter, makeRules } from "../../../shared/src/test-fixtures.ts";
import type { Engine } from "../engine/port.ts";
import { makeContent, makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { claimMilestones, stepMilestones } from "./camp-milestones.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const CAMPAIGN = "milestone-fixture";

function rules(): RulesContent {
  const base = makeRules();
  const story = { withFriends: { class_story: 1 } };
  const hold = { withFriends: { hold_ground: 1 } };
  return {
    ...base,
    classes: {
      ...base.classes,
      songkeeper: { ...base.classes.songkeeper, deeds: { apprentice: story, expert: story, master: story } },
      thornguard: { ...base.classes.thornguard, deeds: { apprentice: hold, expert: hold, master: hold } },
    },
  } as RulesContent;
}

const wolf = { id: "wolf", name: "Wolf", count: 1, hp: 1, guard: 1, quick: 1, steps: 5, attack: 1 };

/** 2400 XP (1200 on a setback): a new hero finishes it Sworn either way (levels 4 to 6, the fixture's `tierLevels`). */
const chapter = {
  id: "milestones-01",
  campaignId: CAMPAIGN,
  index: 1,
  title: "A Song and a Wolf",
  biome: "enchanted_woods",
  estimatedMinutes: 5,
  xpAward: 2400,
  entry: "square",
  scenes: {
    square: {
      type: "story",
      narration: "A square with a door that hums.",
      choices: [
        { id: "sing", label: "Sing to the door", icon: "music", goto: "dojo", requiresClass: "songkeeper" },
        { id: "walk", label: "Walk on", icon: "door", goto: "dojo" },
      ],
    },
    dojo: {
      type: "story",
      narration: "The Dojo.",
      classPlace: "thornguard",
      choices: [
        { id: "on", label: "Out to the yard", icon: "door", goto: "yard" },
        { id: "rest", label: "Rest", icon: "campfire", goto: "camp" },
      ],
    },
    yard: {
      type: "encounter",
      map: "thicket",
      narration: "A wolf in the yard.",
      enemies: [wolf],
      onVictory: { goto: "camp" },
      onDefeat: { goto: "camp" },
    },
    camp: {
      type: "rest",
      narration: "A fire.",
      choices: [
        { id: "win", label: "Home", icon: "home", goto: "win_end" },
        { id: "lose", label: "Get lost", icon: "fog", goto: "lose_end" },
      ],
    },
    win_end: { type: "story", narration: "Home.", choices: [] },
    lose_end: { type: "story", narration: "Lost.", outcome: "setback", choices: [] },
  },
} as unknown as Chapter;

const campaign: Campaign = { id: CAMPAIGN, title: "A Song", blurb: "", chapters: [chapter.id], setbackLimit: 1 };

/** Pip, a new Songkeeper, at the start of the chapter, with every live message kept. */
async function table() {
  const harness = makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ rules: rules(), chapters: [chapter], campaigns: [campaign] }),
  });
  const { householdId, players } = await seedHousehold(harness, 1);
  const created = await createRoom({ householdId, mode: "party", campaignId: CAMPAIGN }, harness.deps);
  if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
  const { code, runId } = created.value;
  const received: (ChannelMessage & ServerMessage)[] = [];
  harness.channel.subscribe(code, (m) => received.push(m as ChannelMessage & ServerMessage));
  const joined = await joinRoom({ code, principal: players[0]!.principal }, harness.deps);
  if (!joined.ok) throw new Error("join");
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  /** Sends one intent and returns the `kitUnlocks` its broadcast carried. */
  const must = async (intent: ClientIntent) => {
    const before = received.length;
    const response = await applyAction({ runId, playerId: "p_1", seq: (await state()).seq, intent }, harness.deps);
    if (!response.ok) throw new Error(`${intent.type}: ${JSON.stringify(response.error)}`);
    return received.slice(before).flatMap((m) => m.kitUnlocks ?? []);
  };
  const pipId = async () => (await state()).party[0]!.character.id;
  const row = async () => (await harness.repo.getCharacter(householdId, await pipId()))!;

  await must({
    type: "CREATE_CHARACTER",
    name: "Pip",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: { palette: "meadow", accent: "#7FD4C1" },
  });
  await must({ type: "READY", ready: true });
  await must({ type: "CONTINUE_CAMPAIGN", campaignId: CAMPAIGN });
  expect((await state()).sceneId).toBe("square");

  /** Waits for the wolf, ends one turn beside it (holding the line), then knocks it down; the unlocks on the way. */
  const fight = async () => {
    const unlocks = [];
    if ((await state()).prompt?.kind === "ready") unlocks.push(...(await must({ type: "READY", ready: true })));
    let heldTheLine = false;
    for (let guard = 0; guard < 60; guard++) {
      const now = await state();
      if (!now.encounter) return unlocks;
      const actor = currentActor(now.encounter);
      if (actor?.side !== "party") throw new Error(`stuck on ${JSON.stringify(actor)}`);
      const at = positionOf(now.encounter, actor.id)!;
      const foe = now.encounter.combatants.find((c) => c.side === "enemy" && !c.down);
      const there = foe ? positionOf(now.encounter, foe.id) : null;
      const beside = there !== null && Math.max(Math.abs(there.x - at.x), Math.abs(there.y - at.y)) <= 1;
      if (beside && heldTheLine && !now.encounter.actionTaken) {
        unlocks.push(...(await must({ type: "COMBAT_ACTION", abilityId: "attack", targetId: foe!.id })));
        continue;
      }
      if (beside) heldTheLine = true;
      unlocks.push(...(await must({ type: "END_TURN" })));
    }
    throw new Error("the fight did not end");
  };

  return { harness, householdId, state, must, pipId, row, fight };
}

describe("a distinction writes its decoration when it lands (#621)", () => {
  it("on a class's own choice, and after a fight: once each, on the row, and on the broadcast", async () => {
    const t = await table();
    const id = await t.pipId();

    // A story deed lands Songkeeper Apprentice now, on the run only; the kit has it on the row already.
    const sung = await t.must({ type: "CHOOSE", choiceId: "sing" });
    expect(sung).toEqual([{ characterId: id, pieceId: "deco_songkeeper_apprentice", kind: "decoration" }]);
    let row = await t.row();
    expect(row.provisional?.mastery.songkeeper?.rank).toBe("none");
    expect(row.kit?.unlocked["deco_songkeeper_apprentice"]).toEqual({ from: "milestone", at: expect.any(String) });
    const afterSong = row.kit!.revision;

    // Switching class moves her standing but earns nothing: nothing is written or said.
    expect(await t.must({ type: "SWITCH_CLASS", classId: "thornguard" })).toEqual([]);
    expect((await t.row()).kit!.revision).toBe(afterSong);

    // Thornguard Apprentice lands at the fight's end, holding the line.
    await t.must({ type: "CHOOSE", choiceId: "on" });
    const fought = await t.fight();
    expect(fought).toEqual([{ characterId: id, pieceId: "deco_thornguard_apprentice", kind: "decoration" }]);
    row = await t.row();
    expect(row.provisional?.mastery.thornguard?.rank ?? "none").toBe("none");
    expect(row.kit?.unlocked["deco_thornguard_apprentice"]).toMatchObject({ from: "milestone" });
    expect(row.kit!.revision).toBe(afterSong + 1);

    // Repeating grants nothing new: steps that keep the ranks write and say nothing.
    expect(await t.must({ type: "PLAYTEST_GOTO", sceneId: "dojo" })).toEqual([]);
    expect(await t.must({ type: "PLAYTEST_GOTO", sceneId: "camp" })).toEqual([]);
    expect((await t.row()).kit!.revision).toBe(afterSong + 1);
  });
});

describe("a tier writes its tent when it lands (#621)", () => {
  it("at the chapter's end, once", async () => {
    const t = await table();
    const id = await t.pipId();
    await t.must({ type: "CHOOSE", choiceId: "walk" });
    await t.must({ type: "PLAYTEST_GOTO", sceneId: "camp" });
    const finished = await t.must({ type: "CHOOSE", choiceId: "win" });

    expect(finished).toEqual([{ characterId: id, pieceId: "sworn", kind: "tent" }]);
    const row = await t.row();
    expect(row.committed.tier).toBe("sworn");
    expect(row.kit?.unlocked["sworn"]).toEqual({ from: "milestone", at: expect.any(String) });
    // A painted tier is remembered by its tent; only an unpainted one needs `highestTier`.
    expect(row.kit).not.toHaveProperty("highestTier");
    const revision = row.kit!.revision;

    // Back to the lobby: the tier stands, and nothing is written or said again.
    expect(await t.must({ type: "ADVANCE" })).toEqual([]);
    expect((await t.row()).kit!.revision).toBe(revision);
  });
});

describe("a failed campaign keeps the pieces (#621, §13.1)", () => {
  it("through the real settle path: the tier and the ranks go back, their tent and decorations stay", async () => {
    const t = await table();
    await t.must({ type: "CHOOSE", choiceId: "sing" });
    await t.must({ type: "SWITCH_CLASS", classId: "thornguard" });
    await t.must({ type: "CHOOSE", choiceId: "on" });
    await t.fight();
    await t.must({ type: "PLAYTEST_GOTO", sceneId: "camp" });
    // The setback that fails the campaign is also the completion that reaches Sworn.
    await t.must({ type: "CHOOSE", choiceId: "lose" });

    expect((await t.state()).campaign?.ended).toBe("failed");
    const row = await t.row();
    expect(row.provisional).toBeNull();
    expect(row.committed.tier).toBe("fledgling");
    expect(row.committed.mastery.songkeeper?.rank ?? "none").toBe("none");
    expect(row.committed.mastery.thornguard?.rank ?? "none").toBe("none");
    const kept = ["deco_songkeeper_apprentice", "deco_thornguard_apprentice", "sworn"];
    for (const piece of kept) expect(row.kit?.unlocked[piece], piece).toMatchObject({ from: "milestone" });
    expect(row.kit).not.toHaveProperty("highestTier");
    // And reading her kit, which is what every screen does, keeps them too.
    expect(Object.keys(readKit(row).unlocked)).toEqual(expect.arrayContaining(kept));
  });
});

describe("an unpainted tier (#621, spec §8.1)", () => {
  afterEach(() => {
    delete MILESTONE_KIT_PIECES.tiers.ascendant;
  });

  it("is remembered when it lands, and grants its tent once its catalog entry exists, even after a revert", async () => {
    const harness = makeHarness({ content: makeContent({ rules: rules() }) });
    const { householdId } = await seedHousehold(harness, 1);
    // The fixture's ladder stops at level 10, so the climb is written straight onto her.
    const hero = { ...makeCharacter({ id: "c_ada", level: 10 }), householdId };
    hero.committed.tier = "mythic";
    hero.provisional = { ...structuredClone(hero.committed), tier: "ascendant", runId: "r_1" };
    await harness.repo.putCharacter(hero);
    // What the run shows of her, before the chapter's end and after.
    const seen = (tier: string) => ({
      playerId: "p_1",
      character: { id: hero.id, tier, class: "songkeeper" },
      hp: 10,
      down: false,
      connected: true,
      ready: false,
    });
    const steps = stepMilestones(
      { party: [seen("mythic")] } as unknown as RunState,
      { party: [seen("ascendant")] } as unknown as RunState,
    );
    expect(steps).toHaveLength(1);

    // No tent for Ascendant yet, so nothing to announce; but the climb is written.
    expect(await claimMilestones(steps, { run: { id: "r_1", householdId } }, harness.deps)).toEqual([]);
    const stored = (await harness.repo.getCharacter(householdId, hero.id))!;
    expect(stored.kit?.highestTier).toBe("ascendant");
    expect(stored.kit?.unlocked["mythic"]).toMatchObject({ from: "milestone" });

    // A failed campaign puts her back to Mythic.
    const reverted = { ...stored, provisional: null };
    expect(Object.keys(readKit(reverted).unlocked)).not.toContain("ascendant");

    // Then Ascendant's art and catalog entry ship: her next read has its tent.
    MILESTONE_KIT_PIECES.tiers.ascendant = "ascendant";
    expect(readKit(reverted).unlocked["ascendant"]).toEqual({ from: "milestone" });
    // A hero who never climbed that far does not.
    expect(readKit({ ...reverted, kit: { ...emptyKit(), highestTier: "mythic" } }).unlocked).not.toHaveProperty("ascendant");
  });
});
