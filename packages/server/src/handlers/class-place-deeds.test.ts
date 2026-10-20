/**
 * Switching class (#311) with deeds counting (#310), through the handlers and
 * the real engine: the two features meet wherever a switch happens in the
 * middle of a chapter that has already counted something.
 *
 *  - credits after a switch go to the class put on;
 *  - a class earned this chapter, taken off and put back on (A → B → A),
 *    comes back at the rank the chapter gave it, on the phone at once and on
 *    the board in the next fight;
 *  - the chapter's fold lands on the row the switch wrote: the class worn last,
 *    with every class's progress;
 *  - a failed campaign puts class, ranks and deeds back together;
 *  - a stat point spent after a switch keeps the class put on and its rank;
 *  - a rank-up line still on screen when its hero switches reads as it did.
 *
 * The fixture is one chapter with a Dojo and a Conservatory, a class-only
 * choice for Songkeepers, and two fights. Its ladders are short on purpose:
 * one story deed lands a Songkeeper's next rank, and ending one turn beside a
 * monster lands a Thornguard's.
 */

import {
  applyIntent,
  createRunState,
  currentActor,
  positionOf,
  type Campaign,
  type Chapter,
  type ClientIntent,
  type RulesContent,
  type RunState,
} from "@kad/shared";
import { describe, expect, it } from "vitest";
import { makeRules } from "../../../shared/src/test-fixtures.ts";
import type { Engine } from "../engine/port.ts";
import { makeContent, makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };
const CAMPAIGN = "class-deeds-fixture";

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

const chapter = {
  id: "class-deeds-01",
  campaignId: CAMPAIGN,
  index: 1,
  title: "Two Rooms and Two Fights",
  biome: "enchanted_woods",
  estimatedMinutes: 5,
  xpAward: 300,
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
      onVictory: { goto: "conservatory" },
      onDefeat: { goto: "conservatory" },
    },
    conservatory: {
      type: "story",
      narration: "The Conservatory.",
      classPlace: "songkeeper",
      choices: [{ id: "on", label: "Out to the arena", icon: "door", goto: "arena" }],
    },
    arena: {
      type: "encounter",
      map: "thicket",
      narration: "Another wolf.",
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

const campaign: Campaign = { id: CAMPAIGN, title: "Two Rooms", blurb: "", chapters: [chapter.id], setbackLimit: 1 };

/** Pip, a Songkeeper with a Thornguard rank from before tonight, at the start of the chapter. */
async function table(options: { unspentPoints?: number } = {}) {
  const harness = makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ rules: rules(), chapters: [chapter], campaigns: [campaign] }),
  });
  const { householdId, players } = await seedHousehold(harness, 1);
  const created = await createRoom({ householdId, mode: "party", campaignId: CAMPAIGN }, harness.deps);
  if (!created.ok) throw new Error(`room: ${JSON.stringify(created)}`);
  const { code, runId } = created.value;
  const joined = await joinRoom({ code, principal: players[0]!.principal }, harness.deps);
  if (!joined.ok) throw new Error("join");
  const state = async (): Promise<RunState> => (await harness.repo.getState(runId))!;
  const send = async (intent: ClientIntent) => applyAction({ runId, playerId: "p_1", seq: (await state()).seq, intent }, harness.deps);
  const must = async (intent: ClientIntent) => {
    const response = await send(intent);
    if (!response.ok) throw new Error(`${intent.type}: ${JSON.stringify(response.error)}`);
  };
  const pip = async () => (await state()).party[0]!.character;
  const row = async () => (await harness.repo.getCharacter(householdId, (await pip()).id))!;

  await must({
    type: "CREATE_CHARACTER",
    name: "Pip",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: { palette: "meadow", accent: "#7FD4C1" },
  });
  const stored = await row();
  stored.committed.mastery.thornguard = { rank: "apprentice", deeds: {} };
  if (options.unspentPoints) stored.committed.unspentPoints = options.unspentPoints;
  await harness.repo.putCharacter(stored);
  await must({ type: "READY", ready: true });
  await must({ type: "CONTINUE_CAMPAIGN", campaignId: CAMPAIGN });
  expect((await state()).sceneId).toBe("square");
  const atStart = await row();

  /**
   * Plays a fight out: Pip waits where she stands until the wolf comes to her,
   * ends one turn beside it (holding the line), then knocks it down.
   */
  const fight = async (): Promise<void> => {
    if ((await state()).prompt?.kind === "ready") await must({ type: "READY", ready: true });
    let heldTheLine = false;
    for (let guard = 0; guard < 60; guard++) {
      const now = await state();
      if (!now.encounter) return;
      const actor = currentActor(now.encounter);
      if (actor?.side !== "party") throw new Error(`stuck on ${JSON.stringify(actor)}`);
      const at = positionOf(now.encounter, actor.id)!;
      const foe = now.encounter.combatants.find((c) => c.side === "enemy" && !c.down);
      const there = foe ? positionOf(now.encounter, foe.id) : null;
      const beside = there !== null && Math.max(Math.abs(there.x - at.x), Math.abs(there.y - at.y)) <= 1;
      if (beside && heldTheLine && !now.encounter.actionTaken) {
        await must({ type: "COMBAT_ACTION", abilityId: "attack", targetId: foe!.id });
        continue;
      }
      if (beside) heldTheLine = true;
      await must({ type: "END_TURN" });
    }
    throw new Error("the fight did not end");
  };
  /** The actions Pip's fighter carries at the start of a fight. */
  const fighterActions = async (): Promise<string[]> => {
    if ((await state()).prompt?.kind === "ready") await must({ type: "READY", ready: true });
    const now = await state();
    const me = now.encounter?.combatants.find((c) => c.id === now.party[0]!.character.id);
    return [...(me?.actions ?? [])];
  };

  return { harness, state, send, must, pip, row, atStart, fight, fighterActions };
}

describe("switching class while deeds are counting (#311 with #310)", () => {
  it("A → B → A: credits follow the class worn, and A comes back at the rank this chapter gave it", async () => {
    const t = await table();

    // A story deed lands Songkeeper Apprentice now, on the run only.
    await t.must({ type: "CHOOSE", choiceId: "sing" });
    expect(await t.pip()).toMatchObject({ class: "songkeeper", rank: "apprentice" });
    expect((await t.pip()).actions).toContain("soothe");
    expect((await t.row()).provisional?.mastery.songkeeper?.rank).toBe("none");

    // Put on the thorn bracer: its stored rank, nothing the Songkeeper earned.
    await t.must({ type: "SWITCH_CLASS", classId: "thornguard" });
    expect(await t.pip()).toMatchObject({ class: "thornguard", rank: "apprentice" });
    expect((await t.pip()).actions).not.toContain("soothe");

    // A fight as a Thornguard: holding the line credits the Thornguard ladder,
    // and the rank lands at the fight's end. The Songkeeper's count is untouched.
    await t.must({ type: "CHOOSE", choiceId: "on" });
    await t.fight();
    const afterYard = await t.state();
    const id = afterYard.party[0]!.character.id;
    expect(afterYard.deeds?.heroes[id]?.thornguard?.rank).toBe("expert");
    expect(afterYard.deeds?.heroes[id]?.songkeeper).toEqual({ rank: "apprentice", deeds: {} });
    expect(await t.pip()).toMatchObject({ class: "thornguard", rank: "expert" });

    // Back to the song bell: Apprentice, from this chapter, on the phone at once.
    expect(afterYard.sceneId).toBe("conservatory");
    await t.must({ type: "SWITCH_CLASS", classId: "songkeeper" });
    expect(await t.pip()).toMatchObject({ class: "songkeeper", rank: "apprentice" });
    expect((await t.pip()).actions).toContain("soothe");
    // ...and on the board in the next fight.
    await t.must({ type: "CHOOSE", choiceId: "on" });
    expect(await t.fighterActions()).toContain("soothe");
  });

  it("folds every class's progress into the row the switch wrote, wearing the class put on", async () => {
    const t = await table();
    await t.must({ type: "CHOOSE", choiceId: "sing" });
    await t.must({ type: "SWITCH_CLASS", classId: "thornguard" });
    await t.must({ type: "CHOOSE", choiceId: "on" });
    await t.fight();
    await t.must({ type: "KEEP_CLASS", classId: "songkeeper" });
    await t.must({ type: "PLAYTEST_GOTO", sceneId: "camp" });
    await t.must({ type: "CHOOSE", choiceId: "win" });

    const row = await t.row();
    // A one-chapter campaign: its completion commits.
    expect(row.provisional).toBeNull();
    expect(row.committed.class).toBe("thornguard");
    expect(row.committed.mastery.songkeeper?.rank).toBe("apprentice");
    expect(row.committed.mastery.thornguard?.rank).toBe("expert");
    expect(row.committed.stats).toEqual(t.atStart.committed.stats);
  });

  it("a failed campaign puts class, ranks and deeds back to how they stood when it began", async () => {
    const t = await table();
    await t.must({ type: "CHOOSE", choiceId: "sing" });
    await t.must({ type: "SWITCH_CLASS", classId: "thornguard" });
    await t.must({ type: "CHOOSE", choiceId: "on" });
    await t.fight();
    await t.must({ type: "KEEP_CLASS", classId: "songkeeper" });
    await t.must({ type: "PLAYTEST_GOTO", sceneId: "camp" });
    await t.must({ type: "CHOOSE", choiceId: "lose" });

    expect((await t.state()).campaign?.ended).toBe("failed");
    const row = await t.row();
    expect(row.provisional).toBeNull();
    expect(row.committed.class).toBe("songkeeper");
    expect(row.committed.mastery).toEqual(t.atStart.provisional!.mastery);
    // The phones see the revert too, and nothing on the run brings it back.
    expect(await t.pip()).toMatchObject({ class: "songkeeper" });
    expect((await t.pip()).rank).toBeUndefined();
    expect(await t.state()).not.toHaveProperty("deeds");
  });

  it("a stat point spent after a switch keeps the class put on and the rank this chapter gave it", async () => {
    const t = await table({ unspentPoints: 1 });
    await t.must({ type: "CHOOSE", choiceId: "walk" });
    await t.must({ type: "SWITCH_CLASS", classId: "thornguard" });
    await t.must({ type: "CHOOSE", choiceId: "on" });
    await t.fight();
    expect(await t.pip()).toMatchObject({ class: "thornguard", rank: "expert" });
    await t.must({ type: "KEEP_CLASS", classId: "songkeeper" });
    await t.must({ type: "PLAYTEST_GOTO", sceneId: "camp" });

    await t.must({ type: "SPEND_STAT_POINT", stat: "might" });
    expect(await t.pip()).toMatchObject({ class: "thornguard", rank: "expert" });
    expect((await t.row()).provisional?.class).toBe("thornguard");
  });

  it("a rank-up line still on screen reads the same after its hero switches", async () => {
    const t = await table();
    await t.must({ type: "CHOOSE", choiceId: "sing" });
    const before = (await t.state()).rankUps;
    expect(before?.sceneId).toBe("dojo");
    expect(before?.ups.map((u) => [u.class, u.rank, u.line])).toEqual([
      ["songkeeper", "apprentice", expect.stringMatching(/^Pip is a songkeeper Apprentice now!/i)],
    ]);

    await t.must({ type: "SWITCH_CLASS", classId: "thornguard" });
    expect((await t.state()).rankUps).toEqual(before);
  });
});
