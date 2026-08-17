/**
 * Playtest mode — the cheats, and the lock on them.
 *
 * Two halves, and the second is the one that matters. The cheats themselves are
 * small: warp to a scene, load the next d20. The gate is what stops "warp the
 * party to the ending" from being one flipped boolean away from a stranger on
 * your daughter's screen, and it is tested here rather than trusted, because a
 * gate nobody exercises is a gate that quietly stopped working.
 */

import { describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "./engine.js";
import type { EngineContext, EngineResult } from "./engine.js";
import { DIE_MAX, DIE_MIN, loadDie, readDie } from "./playtest.js";
import { makeRng, rollD20 } from "./dice.js";
import type { ClientIntent } from "./types/protocol.js";
import type { RunState } from "./types/state.js";
import { APPEARANCE, makeChapter, makeItems, makeMap, makeRules } from "./test-fixtures.js";

const MAP = makeMap();

function ctx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    rules: makeRules(),
    items: makeItems(),
    chapter: makeChapter(),
    map: (id) => (id === MAP.id ? MAP : null),
    abilities: {},
    rng: makeRng("playtest"),
    now: "2026-08-16T12:00:00.000Z",
    householdId: "h_1",
    playtest: true,
    ...overrides,
  };
}

const CREATE_UNICORN: ClientIntent = {
  type: "CREATE_CHARACTER",
  name: "Sparklehoof",
  species: "unicorn",
  class: "songkeeper",
  stats: { might: 0, quick: 0, clever: 0, heart: 3 },
  appearance: APPEARANCE,
};

const CREATE_GRIFFIN: ClientIntent = {
  type: "CREATE_CHARACTER",
  name: "Windstep",
  species: "griffin",
  class: "duskrunner",
  stats: { might: 0, quick: 3, clever: 0, heart: 0 },
  appearance: APPEARANCE,
};

function walk(
  state: RunState,
  steps: { playerId: string; intent: ClientIntent }[],
  context: EngineContext,
): RunState {
  let current = state;
  for (const step of steps) {
    const result = applyIntent(current, step, context);
    if (result.error) {
      throw new Error(`${step.intent.type} rejected: ${result.error.code} ${result.error.message}`);
    }
    current = result.state;
  }
  return current;
}

/** A party in the fixture chapter, standing in its first scene. */
function inChapter(context = ctx()): RunState {
  return walk(
    createRunState({ runId: "r_pt", roomCode: "PLAY", mode: "travel", now: "2026-08-16T11:00:00.000Z" }),
    [
      { playerId: "p_1", intent: CREATE_UNICORN },
      { playerId: "p_2", intent: CREATE_GRIFFIN },
      { playerId: "p_1", intent: { type: "READY", ready: true } },
      { playerId: "p_2", intent: { type: "READY", ready: true } },
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
    ],
    context,
  );
}

function send(state: RunState, intent: ClientIntent, context = ctx()): EngineResult {
  return applyIntent(state, { playerId: "p_1", intent }, context);
}

describe("reading a die value", () => {
  it("takes any face of the one die the game rolls", () => {
    expect(readDie(DIE_MIN)).toBe(1);
    expect(readDie(DIE_MAX)).toBe(20);
    expect(readDie(11)).toBe(11);
  });

  it("takes null as 'stop cheating'", () => {
    expect(readDie(null)).toBeNull();
  });

  it("refuses a face the die does not have, rather than clamping to one it does", () => {
    /*
     * Clamping would be worse than refusing. An author who typed 30 wants a
     * guaranteed hit; a silent clamp to 20 gives them one *and* teaches them
     * that 30 is a number the game understands, which it is not.
     */
    expect(readDie(0)).toBeNull();
    expect(readDie(21)).toBeNull();
    expect(readDie(-5)).toBeNull();
    expect(readDie(Number.NaN)).toBeNull();
    expect(readDie(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("floors a fraction onto a real face", () => {
    expect(readDie(12.9)).toBe(12);
  });
});

describe("a loaded die", () => {
  it("comes up on the face it was loaded with", () => {
    for (let die = DIE_MIN; die <= DIE_MAX; die += 1) {
      const loaded = loadDie(makeRng("whatever"), die);
      expect(rollD20(loaded.rng)).toBe(die);
    }
  });

  it("is spent by the first roll and honest after it", () => {
    /*
     * "The next roll", not "this intent" and not "until cleared". An author who
     * loads a 20 into a fight spends it on the first attack and the rest of the
     * round is real, which is the same thing a loaded die does at a table.
     */
    const honest = makeRng("seed");
    const loaded = loadDie(makeRng("seed"), 20);
    expect(rollD20(loaded.rng)).toBe(20);
    expect(loaded.spent()).toBe(true);

    // From the second draw on it is the run's own generator, undisturbed —
    // the wrapper must not have consumed a value on its way past.
    expect(rollD20(loaded.rng)).toBe(rollD20(honest));
    expect(rollD20(loaded.rng)).toBe(rollD20(honest));
  });

  it("reports itself unspent until something actually rolls", () => {
    const loaded = loadDie(makeRng("seed"), 7);
    expect(loaded.spent()).toBe(false);
  });
});

describe("jumping to a scene", () => {
  it("puts the run in the scene, with the scene's own narration and art", () => {
    const jumped = send(inChapter(), { type: "PLAYTEST_GOTO", sceneId: "scene_ridge" });
    expect(jumped.error).toBeUndefined();
    expect(jumped.state.sceneId).toBe("scene_ridge");
    expect(jumped.state.sceneType).toBe("choice_point");
    expect(jumped.state.narration).toBe("The ridge forks.");
  });

  it("runs the scene's `onEnter`, because otherwise it is not that scene", () => {
    /*
     * The whole argument for routing a jump through `enterSceneDraft` rather
     * than writing `sceneId` and moving on. `scene_shrine` grants a quest item
     * and sets a flag on arrival; an author who warped there and found neither
     * would be playtesting a scene the game never produces.
     */
    const jumped = send(inChapter(), { type: "PLAYTEST_GOTO", sceneId: "scene_shrine" });
    expect(jumped.state.flags["found_shrine"]).toBe(true);
    expect(jumped.state.party[0]?.character.questItems).toContain("rusted_key");
  });

  it("heals at a Rest scene, the same as walking in would", () => {
    const hurt = inChapter();
    const member = hurt.party[0];
    if (member) member.hp = 4;
    const jumped = send(hurt, { type: "PLAYTEST_GOTO", sceneId: "scene_camp" });
    // §6.1 — a Rest heals on arrival. The fixture's is 3.
    expect(jumped.state.party[0]?.hp).toBe(7);
  });

  it("announces the arrival so the TV moves with the phones", () => {
    const jumped = send(inChapter(), { type: "PLAYTEST_GOTO", sceneId: "scene_shrine" });
    expect(jumped.presentation).toMatchObject({ kind: "SCENE_ENTER", sceneId: "scene_shrine" });
  });

  it("refuses a scene the chapter does not have", () => {
    const jumped = send(inChapter(), { type: "PLAYTEST_GOTO", sceneId: "scene_nowhere" });
    expect(jumped.error?.code).toBe("NOT_FOUND");
    // An error leaves the run exactly where it was — the engine's own rule.
    expect(jumped.state.sceneId).toBe("scene_clearing");
  });

  it("clears a fight rather than carrying the board into the next scene", () => {
    /*
     * An encounter is the one thing on the run that outlives a scene change:
     * `settleEncounter` normally carries hit points back out of it. A board
     * left standing after a warp would leave the party fighting monsters
     * belonging to a scene they are no longer in.
     */
    const fighting = walk(
      inChapter(),
      [
        { playerId: "p_1", intent: { type: "PLAYTEST_GOTO", sceneId: "encounter_wisps" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
        { playerId: "p_2", intent: { type: "READY", ready: true } },
      ],
      ctx(),
    );
    expect(fighting.encounter).toBeTruthy();

    const away = send(fighting, { type: "PLAYTEST_GOTO", sceneId: "scene_ridge" });
    expect(away.state.encounter).toBeNull();
    expect(away.state.phase).toBe("scene");
  });

  it("un-readies everybody, so the next fight waits for them", () => {
    // An encounter puts the board up once everyone has readied. Three phones
    // still holding a ready from before the jump would start it before anybody
    // had looked up — which is the exact pause `doReady` exists to create.
    const ready = inChapter();
    for (const member of ready.party) member.ready = true;
    const jumped = send(ready, { type: "PLAYTEST_GOTO", sceneId: "encounter_wisps" });
    expect(jumped.state.party.every((m) => !m.ready)).toBe(true);
    expect(jumped.state.encounter).toBeFalsy();
  });

  it("leaves damage alone", () => {
    /*
     * Deliberate. An author checking whether the last fight is survivable at
     * half health wants the party they have; a jump that quietly topped
     * everybody up would answer a different question than the one asked.
     */
    const hurt = inChapter();
    const member = hurt.party[0];
    if (member) member.hp = 4;
    const jumped = send(hurt, { type: "PLAYTEST_GOTO", sceneId: "scene_ridge" });
    expect(jumped.state.party[0]?.hp).toBe(4);
  });

  it("carries damage out of a fight it interrupts", () => {
    /*
     * The half of "leaves damage alone" that the obvious test misses, and the
     * one that actually bites. Between scenes, `party[].hp` is where a hero's
     * hit points live and a jump cannot lose them. *During a fight* they live on
     * `encounter.combatants` instead, and `party[].hp` still holds what they
     * walked in with — `settleEncounter` is what copies them back, and it only
     * runs on a win or a loss.
     *
     * So a jump that dropped the board without copying first would hand back a
     * party healed to full, silently. An author who jumped out of a losing fight
     * to try the boss at half health would get a fresh party and be told
     * nothing — the exact opposite of what the jump promises, and unfalsifiable
     * from the screen.
     */
    const fighting = walk(
      inChapter(),
      [
        { playerId: "p_1", intent: { type: "PLAYTEST_GOTO", sceneId: "encounter_wisps" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
        { playerId: "p_2", intent: { type: "READY", ready: true } },
      ],
      ctx(),
    );

    const board = fighting.encounter;
    expect(board).toBeTruthy();
    if (!board) return;

    // Wound one hero on the board, leaving `party[].hp` untouched — which is
    // exactly the state a real fight in progress is in.
    const heroId = fighting.party[0]?.character.id;
    const walkedInWith = fighting.party[0]?.hp;
    expect(board.combatants.some((c) => c.id === heroId)).toBe(true);
    const wounded: RunState = {
      ...fighting,
      encounter: {
        ...board,
        combatants: board.combatants.map((c) => (c.id === heroId ? { ...c, hp: 2 } : c)),
      },
    };
    expect(wounded.party[0]?.hp).toBe(walkedInWith);

    const away = send(wounded, { type: "PLAYTEST_GOTO", sceneId: "scene_ridge" });
    expect(away.state.encounter).toBeNull();
    expect(away.state.party[0]?.hp).toBe(2);
  });
});

describe("loading the next roll", () => {
  /** Walks to the fixture's check scene, which rolls Quick against TN 12. */
  function atTheCheck(context = ctx()): RunState {
    return walk(
      inChapter(context),
      [{ playerId: "p_1", intent: { type: "PLAYTEST_GOTO", sceneId: "check_squeeze" } }],
      context,
    );
  }

  it("holds the die on the run until something rolls it", () => {
    const set = send(inChapter(), { type: "PLAYTEST_SET_DIE", die: 3 });
    expect(set.state.playtestDie).toBe(3);
  });

  /*
   * The fixture's check is `roller: "best"`, so the griffin rolls it — Quick 1
   * base, 3 at creation, 1 from the species passive, for +5 against TN 12. A
   * loaded 3 is an 8 and a loaded 20 is a 25, which is the whole point: both
   * branches on demand, from either end, without rerolling until the dice
   * cooperate.
   */
  const ROLLER = "p_2";

  it("decides the check it is loaded for", () => {
    const context = ctx();
    const loaded = walk(
      atTheCheck(context),
      [{ playerId: "p_1", intent: { type: "PLAYTEST_SET_DIE", die: 3 } }],
      context,
    );
    const rolled = applyIntent(loaded, { playerId: ROLLER, intent: { type: "ROLL" } }, context);

    expect(rolled.state.lastRoll?.die).toBe(3);
    expect(rolled.state.lastRoll?.result).toBe("failure");
    // The failure branch, which is the reason an author loads a 3 at all.
    expect(rolled.state.sceneId).toBe("scene_scratched");
  });

  it("produces the success branch just as readily", () => {
    const context = ctx();
    const loaded = walk(
      atTheCheck(context),
      [{ playerId: "p_1", intent: { type: "PLAYTEST_SET_DIE", die: 20 } }],
      context,
    );
    const rolled = applyIntent(loaded, { playerId: ROLLER, intent: { type: "ROLL" } }, context);
    expect(rolled.state.lastRoll?.die).toBe(20);
    expect(rolled.state.sceneId).toBe("scene_shrine");
  });

  it("is spent by the roll it decided", () => {
    const context = ctx();
    const loaded = walk(
      atTheCheck(context),
      [{ playerId: "p_1", intent: { type: "PLAYTEST_SET_DIE", die: 3 } }],
      context,
    );
    const rolled = applyIntent(loaded, { playerId: ROLLER, intent: { type: "ROLL" } }, context);
    expect(rolled.state.playtestDie).toBeNull();
  });

  it("survives an intent that rolls nothing", () => {
    // Loading a die and reaching the roll are two taps and often two devices.
    // A die that expired on the next tap would be unusable at a table.
    const context = ctx();
    const loaded = walk(
      inChapter(context),
      [
        { playerId: "p_1", intent: { type: "PLAYTEST_SET_DIE", die: 3 } },
        { playerId: "p_1", intent: { type: "PLAYTEST_GOTO", sceneId: "check_squeeze" } },
      ],
      context,
    );
    expect(loaded.playtestDie).toBe(3);
  });

  it("goes back to honest dice when cleared", () => {
    const context = ctx();
    const cleared = walk(
      atTheCheck(context),
      [
        { playerId: "p_1", intent: { type: "PLAYTEST_SET_DIE", die: 3 } },
        { playerId: "p_1", intent: { type: "PLAYTEST_SET_DIE", die: null } },
      ],
      context,
    );
    expect(cleared.playtestDie).toBeNull();

    const rolled = applyIntent(cleared, { playerId: ROLLER, intent: { type: "ROLL" } }, context);
    // Whatever the seeded generator says — the point is that it is not the 3.
    expect(rolled.state.lastRoll?.die).not.toBe(3);
  });

  it("refuses a face the die does not have without disturbing a loaded one", () => {
    const context = ctx();
    const nonsense = walk(
      inChapter(context),
      [{ playerId: "p_1", intent: { type: "PLAYTEST_SET_DIE", die: 40 } }],
      context,
    );
    expect(nonsense.playtestDie).toBeNull();
  });
});

describe("the gate", () => {
  const closed = ctx({ playtest: false });

  it("refuses a jump on a server that is not a playtest server", () => {
    const jumped = send(inChapter(), { type: "PLAYTEST_GOTO", sceneId: "scene_ending" }, closed);
    expect(jumped.error?.code).toBe("FORBIDDEN");
    expect(jumped.state.sceneId).toBe("scene_clearing");
  });

  it("refuses to load a die on one either", () => {
    const set = send(inChapter(), { type: "PLAYTEST_SET_DIE", die: 20 }, closed);
    expect(set.error?.code).toBe("FORBIDDEN");
    expect(set.state.playtestDie ?? null).toBeNull();
  });

  it("treats a missing flag as no, rather than as unset", () => {
    // `playtest` is optional on `EngineContext`, and every caller that forgets
    // it has to land on the safe answer.
    const unstated = ctx();
    delete unstated.playtest;
    expect(send(inChapter(), { type: "PLAYTEST_GOTO", sceneId: "scene_ending" }, unstated).error?.code).toBe(
      "FORBIDDEN",
    );
  });

  it("rolls honest dice on a die that somehow reached the state anyway", () => {
    /*
     * Defence in depth, and not hypothetical: `RunState` is persisted plain
     * JSON, and a run written by a dev server carries `playtestDie` into
     * whatever opens it next. The intent gate above cannot help there — only
     * refusing to *honour* the value can.
     */
    const smuggled = { ...inChapter(), playtestDie: 20 };
    const walked = walk(
      smuggled,
      [{ playerId: "p_1", intent: { type: "PLAYTEST_GOTO", sceneId: "check_squeeze" } }],
      ctx(),
    );
    const rolled = applyIntent(
      { ...walked, playtestDie: 20 },
      { playerId: "p_2", intent: { type: "ROLL" } },
      closed,
    );
    expect(rolled.state.lastRoll?.die).not.toBe(20);
    // And it is left alone rather than spent: a closed server does not get to
    // quietly consume state it refused to read.
    expect(rolled.state.playtestDie).toBe(20);
  });
});
