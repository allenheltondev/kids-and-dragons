/**
 * Matchups (docs/matchups.md): the pure note composition, the caps, the
 * opinions, the exempt campaigns — and the two places the dice read them, a
 * fight's swing and a story check. With matchups off, both roll exactly what
 * they always did.
 */

import { describe, expect, it } from "vitest";

import {
  MATCHUP_DAMAGE_CAP,
  MATCHUP_ROLL_CAP,
  attackNotes,
  checkNotes,
  defendNotes,
  edgesAgainst,
  edgesForHero,
  fightHints,
  matchupTotal,
  matchupsOn,
} from "./matchups.js";
import { ATTACK_ID, beginEncounter, combatantById, currentActorId, performAction } from "./encounter.js";
import type { EncounterContext, EncounterEvent, EncounterSetup } from "./encounter.js";
import { parseBoard } from "./grid.js";
import { makeRng } from "./dice.js";
import type { Rng } from "./dice.js";
import { resolveEnemy, sceneCreatures, type Bestiary } from "./bestiary.js";
import { applyIntent, createRunState, type EngineContext } from "./engine.js";
import { APPEARANCE, makeChapter, makeItems, makeMap, makeRules } from "./test-fixtures.js";
import type { MatchupRules } from "./types/matchups.js";
import type { ResolvedCharacter } from "./types/domain.js";
import type { EnemySpec } from "./types/chapter.js";
import type { ClientIntent } from "./types/protocol.js";
import type { DiceRoll, RunState } from "./types/state.js";

const TABLE: MatchupRules = {
  traits: {
    thorny: { name: "Thorn-hided", icon: "thorn", text: "Spiky.", hint: "Thorny: Burst works well" },
    armored: { name: "Shell-hided", icon: "shield", text: "Hard.", hint: "Armored: Hit hard" },
  },
  checkTags: { sneak: { name: "Sneak", text: "Being quiet." } },
  edges: [
    { id: "burst_thorny", hero: { class: "starweaver" }, on: "attack", foe: "thorny", ability: "burst", roll: 2, damage: 1, text: "Burst sears thorns." },
    { id: "guard_thorny", hero: { class: "thornguard" }, on: "attack", foe: "thorny", roll: 2, damage: 1, text: "Thornguards know thorns." },
    { id: "unicorn_armored", hero: { species: "unicorn" }, on: "attack", foe: "armored", roll: -1, text: "A horn glances off a shell." },
    { id: "unicorn_thorny", hero: { species: "unicorn" }, on: "attack", foe: "thorny", roll: 2, text: "Thorns lean away from a unicorn." },
    { id: "pair_thorny", hero: { species: "unicorn", class: "thornguard" }, on: "attack", foe: "thorny", roll: 2, damage: 2, text: "A unicorn Thornguard walks through thorns." },
    { id: "bigfoot_hold", hero: { species: "bigfoot" }, on: "defend", foe: "armored", roll: -1, text: "Bigfoot holds the line." },
    { id: "unbreakable_fiery", hero: { class: "thornguard" }, on: "defend", foe: "thorny", ability: "unbreakable", roll: -1, text: "Unbreakable stands firm." },
    { id: "unicorn_sneak", hero: { species: "unicorn" }, on: "check", tag: "sneak", roll: -2, text: "Hooves are loud on stone." },
  ],
  opinion: { likedFoeRoll: -1, dislikedFoeRoll: 1, likedCheckRoll: 1, dislikedCheckRoll: -1 },
  exemptCampaigns: ["gemfall"],
};

const RULES = makeRules({ matchups: TABLE });

describe("matchupsOn", () => {
  it("is on unless the campaign is exempt, and off without a table", () => {
    expect(matchupsOn(RULES, "riftlight")).toBe(true);
    expect(matchupsOn(RULES, null)).toBe(true);
    expect(matchupsOn(RULES, "gemfall")).toBe(false);
    expect(matchupsOn(makeRules(), "riftlight")).toBe(false);
  });
});

describe("note composition", () => {
  it("an attack edge needs the hero, a foe trait and the ability it names", () => {
    const starweaver = { species: "kitsune" as const, class: "starweaver" as const };
    expect(attackNotes(RULES, starweaver, { traits: ["thorny"] }, "burst").map((n) => n.id)).toEqual(["burst_thorny"]);
    expect(attackNotes(RULES, starweaver, { traits: ["thorny"] }, ATTACK_ID)).toEqual([]);
    expect(attackNotes(RULES, starweaver, { traits: ["armored"] }, "burst")).toEqual([]);
    expect(attackNotes(RULES, starweaver, {}, "burst")).toEqual([]);
  });

  it("a pairing needs both species and class, and penalties come through negative", () => {
    const unicornGuard = { species: "unicorn" as const, class: "thornguard" as const };
    expect(attackNotes(RULES, unicornGuard, { traits: ["thorny"] }, ATTACK_ID).map((n) => n.id)).toEqual([
      "guard_thorny",
      "unicorn_thorny",
      "pair_thorny",
    ]);
    expect(attackNotes(RULES, { species: "unicorn", class: "songkeeper" }, { traits: ["thorny"] }, ATTACK_ID).map((n) => n.id)).toEqual(["unicorn_thorny"]);
    expect(attackNotes(RULES, unicornGuard, { traits: ["armored"] }, ATTACK_ID)).toEqual([
      { id: "unicorn_armored", text: "A horn glances off a shell.", roll: -1, damage: 0 },
    ]);
  });

  it("caps the total on one roll at 3 and on one hit at 2, however many edges stack", () => {
    const notes = attackNotes(RULES, { species: "unicorn", class: "thornguard" }, { traits: ["thorny"] }, ATTACK_ID);
    expect(notes.reduce((n, x) => n + x.roll, 0)).toBe(6);
    expect(matchupTotal(notes)).toEqual({ roll: MATCHUP_ROLL_CAP, damage: MATCHUP_DAMAGE_CAP });
    expect(matchupTotal([{ id: "a", text: "", roll: -5, damage: -4 }])).toEqual({ roll: -3, damage: -2 });
    expect(matchupTotal([])).toEqual({ roll: 0, damage: 0 });
  });

  it("defend notes flip the foe's roll into the hero's view, then add opinions", () => {
    const bigfoot = { species: "bigfoot" as const, class: "songkeeper" as const };
    expect(defendNotes(RULES, bigfoot, { traits: ["armored"], likes: ["bigfoot"], name: "Crab" })).toEqual([
      { id: "bigfoot_hold", text: "Bigfoot holds the line.", roll: 1, damage: 0 },
      { id: "opinion:liked", text: "The Crab likes you and holds back.", roll: 1, damage: 0 },
    ]);
    expect(defendNotes(RULES, bigfoot, { dislikes: ["bigfoot"], name: "Crab" })).toEqual([
      { id: "opinion:disliked", text: "The Crab does not like you and singles you out.", roll: -1, damage: 0 },
    ]);
  });

  it("a defend edge on an ability holds only for a hero who has it", () => {
    const guard = { species: "griffin" as const, class: "thornguard" as const };
    expect(defendNotes(RULES, guard, { traits: ["thorny"] })).toEqual([]);
    expect(defendNotes(RULES, { ...guard, abilities: ["attack", "unbreakable"] }, { traits: ["thorny"] }).map((n) => n.id)).toEqual(["unbreakable_fiery"]);
  });

  it("check notes read the scene's tags and its creatures' opinions, one of each opinion at most", () => {
    const unicorn = { species: "unicorn" as const, class: "songkeeper" as const };
    expect(checkNotes(RULES, unicorn, { tags: ["sneak"] })).toEqual([
      { id: "unicorn_sneak", text: "Hooves are loud on stone.", roll: -2, damage: 0 },
    ]);
    expect(checkNotes(RULES, unicorn, {})).toEqual([]);
    const notes = checkNotes(RULES, unicorn, {
      creatures: [
        { name: "Wolf", likes: ["unicorn"] },
        { name: "Other Wolf", likes: ["unicorn"] },
        { name: "Crab", dislikes: ["unicorn"] },
      ],
    });
    expect(notes).toEqual([
      { id: "opinion:liked", text: "The Wolf likes you.", roll: 1, damage: 0 },
      { id: "opinion:disliked", text: "The Crab does not trust you.", roll: -1, damage: 0 },
    ]);
    expect(checkNotes(RULES, { species: "griffin", class: "songkeeper" }, { creatures: [{ likes: ["unicorn"] }] })).toEqual([]);
  });

  it("returns nothing at all without a table", () => {
    const rules = makeRules();
    const hero = { species: "unicorn" as const, class: "thornguard" as const };
    expect(attackNotes(rules, hero, { traits: ["thorny"] }, ATTACK_ID)).toEqual([]);
    expect(defendNotes(rules, hero, { likes: ["unicorn"] })).toEqual([]);
    expect(checkNotes(rules, hero, { tags: ["sneak"] })).toEqual([]);
    expect(edgesForHero(rules, hero)).toEqual([]);
  });

  it("lists a hero's own edges and the edges against traits", () => {
    expect(edgesForHero(RULES, { species: "unicorn", class: "thornguard" }).map((e) => e.id)).toEqual([
      "guard_thorny",
      "unicorn_armored",
      "unicorn_thorny",
      "pair_thorny",
      "unbreakable_fiery",
      "unicorn_sneak",
    ]);
    expect(edgesAgainst(RULES, ["armored"]).map((e) => e.id)).toEqual(["unicorn_armored", "bigfoot_hold"]);
  });
});

// ---------------------------------------------------------------------------
// In a fight
// ---------------------------------------------------------------------------

const ALWAYS_HIT: Rng = { next: () => 0.999 };

function hero(id: string, overrides: Partial<ResolvedCharacter> = {}): ResolvedCharacter {
  return {
    id,
    ownerPlayerId: "p_1",
    unspentPoints: 0,
    spendableStats: ["might", "quick", "clever", "heart"],
    committedLevel: 1,
    name: id,
    species: "unicorn",
    class: "thornguard",
    appearance: APPEARANCE,
    level: 1,
    xp: 0,
    tier: "fledgling",
    stats: { might: 3, quick: 9, clever: 1, heart: 1 },
    maxHp: 10,
    steps: 4,
    guard: 10,
    attackStat: "might",
    actions: [],
    worldAbility: "mend",
    inventory: [],
    questItems: [],
    souvenirs: [],
    isProvisional: false,
    ...overrides,
  };
}

function bramble(overrides: Partial<EnemySpec> = {}): EnemySpec {
  return { id: "bramble", name: "Bramble", count: 1, hp: 20, guard: 11, quick: 0, steps: 4, attack: 3, traits: ["thorny"], ...overrides };
}

function fight(enemy: EnemySpec = bramble(), character: ResolvedCharacter = hero("c_hero")): EncounterSetup {
  return {
    board: parseBoard(["........", "........", "........"]),
    party: [{ character, at: { x: 1, y: 1 } }],
    enemies: [{ spec: enemy, at: { x: 2, y: 1 } }],
  };
}

function ctx(rng: Rng, matchups?: MatchupRules): EncounterContext {
  return { rules: RULES, abilities: {}, rng, ...(matchups ? { matchups } : {}) };
}

function swing(setup: EncounterSetup, context: EncounterContext) {
  const state = beginEncounter(setup, context);
  const actor = currentActorId(state)!;
  const target = state.combatants.find((c) => c.side !== combatantById(state, actor)!.side)!.id;
  const result = performAction(state, context, { abilityId: ATTACK_ID, targetId: target });
  if (!result.ok) throw new Error(result.reason);
  return { start: state, ...result };
}

describe("matchups in a fight", () => {
  it("a thorny foe gives a unicorn Thornguard the edge, capped, and says so beside the roll", () => {
    const { events, state, start } = swing(fight(), ctx(ALWAYS_HIT, TABLE));
    expect(combatantById(start, "c_hero")).toMatchObject({ species: "unicorn", class: "thornguard" });
    expect(combatantById(start, "bramble#1")).toMatchObject({ traits: ["thorny"], likes: [], dislikes: [] });

    const matchups = events.filter((e): e is Extract<EncounterEvent, { type: "matchup" }> => e.type === "matchup");
    expect(matchups.map((e) => e.id)).toEqual(["guard_thorny", "unicorn_thorny", "pair_thorny"]);
    expect(matchups[0]).toEqual({ type: "matchup", actorId: "c_hero", targetId: "bramble#1", id: "guard_thorny", text: "Thornguards know thorns.", roll: 2, damage: 1 });
    // Next to the roll: every matchup beat comes just before it.
    const rollAt = events.findIndex((e) => e.type === "roll");
    expect(events.slice(rollAt - 3, rollAt).every((e) => e.type === "matchup")).toBe(true);

    const roll = events[rollAt] as Extract<EncounterEvent, { type: "roll" }>;
    expect(roll.roll.mod).toBe(3);
    expect(roll.roll.matchup?.amount).toBe(3);
    expect(roll.roll.total).toBe(20 + 3 + 3);

    const plain = swing(fight(), ctx(ALWAYS_HIT));
    const plainHurt = 20 - combatantById(plain.state, "bramble#1")!.hp;
    expect(20 - combatantById(state, "bramble#1")!.hp).toBe(plainHurt + 2);
  });

  it("a bad matchup is a worse roll, never a lock: the swing still happens and can still land", () => {
    const { events } = swing(fight(bramble({ traits: ["armored"] })), ctx(ALWAYS_HIT, TABLE));
    const roll = events.find((e) => e.type === "roll") as Extract<EncounterEvent, { type: "roll" }>;
    expect(roll.roll.matchup?.amount).toBe(-1);
    expect(roll.roll.result).toBe("hit");
    expect(events.some((e) => e.type === "damage")).toBe(true);
  });

  it("a foe that likes the hero swings lower at them", () => {
    // The foe acts first: a slow hero, a quick foe.
    const setup = fight(bramble({ traits: [], likes: ["unicorn"], quick: 9 }), hero("c_hero", { stats: { might: 3, quick: 0, clever: 1, heart: 1 } }));
    const { events } = swing(setup, ctx(ALWAYS_HIT, TABLE));
    const note = events.find((e) => e.type === "matchup");
    expect(note).toMatchObject({ actorId: "bramble#1", targetId: "c_hero", id: "opinion:liked", roll: 1 });
    const roll = events.find((e) => e.type === "roll") as Extract<EncounterEvent, { type: "roll" }>;
    expect(roll.roll.matchup?.amount).toBe(-1);
    expect(roll.roll.total).toBe(20 + 3 - 1);
  });

  it("without ctx.matchups a seeded fight is what it always was: no keys, no beats, same dice", () => {
    const traitless = bramble({ traits: undefined });
    delete (traitless as { traits?: unknown }).traits;
    for (const seed of ["a", "b", "c", "d"]) {
      const withTraits = swing(fight(), ctx(makeRng(seed)));
      const without = swing(fight(traitless), ctx(makeRng(seed)));
      expect(withTraits.state).toEqual(without.state);
      expect(withTraits.events).toEqual(without.events);
      const json = JSON.stringify([withTraits.state, withTraits.events]);
      for (const key of ['"species"', '"class"', '"traits"', '"likes"', '"dislikes"', '"matchup"']) expect(json).not.toContain(key);
    }
  });

  it("an empty table changes nothing but the keys the fight carries", () => {
    const empty: MatchupRules = { ...TABLE, edges: [] };
    for (const seed of ["a", "b"]) {
      const on = swing(fight(), ctx(makeRng(seed), empty));
      const off = swing(fight(), ctx(makeRng(seed)));
      expect(on.events).toEqual(off.events);
      expect(on.state.combatants.map((c) => c.hp)).toEqual(off.state.combatants.map((c) => c.hp));
    }
  });

  it("fightHints names the traits in the fight and who they favor, strongest first", () => {
    const state = beginEncounter(fight(bramble({ traits: ["armored", "thorny"], likes: ["unicorn"] })), ctx(ALWAYS_HIT, TABLE));
    const hints = fightHints(RULES, state);
    expect(hints.map((h) => h.id)).toEqual(["trait:thorny", "trait:armored", "opinion:liked:Bramble"]);
    expect(hints[0]).toMatchObject({ text: "Thorny: Burst works well", good: ["c_hero"], bad: [] });
    expect(hints[1]).toMatchObject({ good: [], bad: ["c_hero"] });
    // A fight begun without matchups (an exempt campaign) carries no traits, so no chips.
    expect(fightHints(RULES, beginEncounter(fight(), ctx(ALWAYS_HIT)))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The bestiary
// ---------------------------------------------------------------------------

const BESTIARY: Bestiary = {
  creatures: {
    cinder_wolf: {
      canon_id: "creature.cinder_wolf", name: "Cinder Wolf", art: "enemies/cinder_wolf", band: "skirmisher",
      hp: 6, guard: 11, quick: 3, steps: 5, attack: 3, xp: 5, usualCount: 3,
      traits: ["thorny"], likes: ["unicorn"],
    },
    glassback_crab: {
      canon_id: "creature.glassback_crab", name: "Glassback Crab", art: "enemies/glassback_crab", band: "brute",
      hp: 14, guard: 12, quick: 1, steps: 3, attack: 4, xp: 12, usualCount: 2,
    },
  },
};

describe("the bestiary's traits and opinions", () => {
  it("resolveEnemy copies them unless the chapter authored its own, and adds nothing when canon has none", () => {
    expect(resolveEnemy({ id: "w", creature: "cinder_wolf" }, BESTIARY).spec).toMatchObject({ traits: ["thorny"], likes: ["unicorn"] });
    expect(resolveEnemy({ id: "w", creature: "cinder_wolf", traits: ["armored"] }, BESTIARY).spec?.traits).toEqual(["armored"]);
    const crab = resolveEnemy({ id: "c", creature: "glassback_crab" }, BESTIARY).spec!;
    expect(crab).not.toHaveProperty("traits");
    expect(crab).not.toHaveProperty("likes");
  });

  it("sceneCreatures finds a scene's creatures by canon id and by cast figure, once each", () => {
    expect(
      sceneCreatures({ discovers: ["creature.cinder_wolf", "place.nowhere"], cast: [{ figure: "entities/cinder_wolf" }, { figure: "entities/glassback_crab" }, { figure: "cast/pellam" }] }, BESTIARY),
    ).toEqual([
      { name: "Cinder Wolf", likes: ["unicorn"], dislikes: [] },
      { name: "Glassback Crab", likes: [], dislikes: [] },
    ]);
    expect(sceneCreatures({ discovers: ["creature.cinder_wolf"] }, null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A tagged check, through the engine
// ---------------------------------------------------------------------------

const MAP = makeMap();

function taggedChapter() {
  const chapter = makeChapter();
  const check = chapter.scenes["check_squeeze"]!;
  if (check.type !== "check") throw new Error("fixture moved");
  check.tags = ["sneak"];
  check.cast = [{ figure: "entities/cinder_wolf" }];
  return chapter;
}

function engineCtx(rng: string, matchups?: MatchupRules): EngineContext {
  return {
    rules: RULES,
    items: makeItems(),
    chapter: taggedChapter(),
    map: (id) => (id === MAP.id ? MAP : null),
    abilities: {},
    rng: makeRng(rng),
    now: "2026-07-28T12:00:00.000Z",
    householdId: "h_1",
    playtest: true,
    ...(matchups ? { matchups, bestiary: BESTIARY } : {}),
  };
}

function must(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext): RunState {
  const result = applyIntent(state, { playerId, intent }, ctx);
  if (result.error) throw new Error(`${intent.type}: ${result.error.code} ${result.error.message}`);
  return result.state;
}

function rollTheCheck(rng: string, matchups?: MatchupRules): DiceRoll {
  const ctx = () => engineCtx(rng, matchups);
  let state = createRunState({ runId: "r_1", roomCode: "ABCD", mode: "travel", now: "2026-07-28T11:00:00.000Z" });
  state = must(state, "p_1", { type: "CREATE_CHARACTER", name: "Pip", species: "unicorn", class: "songkeeper", stats: { might: 1, quick: 1, clever: 0, heart: 1 }, appearance: APPEARANCE }, ctx());
  state = must(state, "p_1", { type: "READY", ready: true }, ctx());
  state = must(state, "p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" }, ctx());
  state = must(state, "p_1", { type: "PLAYTEST_GOTO", sceneId: "check_squeeze" }, ctx());
  state = must(state, "p_1", { type: "ROLL" }, ctx());
  return state.lastRoll!;
}

describe("a tagged check", () => {
  it("moves the roll by the tag's edge and the watching creature's opinion, and shows both on the roll", () => {
    const plain = rollTheCheck("tagged");
    const matched = rollTheCheck("tagged", TABLE);
    expect(plain).not.toHaveProperty("matchup");
    expect(matched.die).toBe(plain.die);
    expect(matched.mod).toBe(plain.mod);
    expect(matched.matchup).toEqual({
      amount: -1,
      notes: [
        { id: "unicorn_sneak", text: "Hooves are loud on stone.", roll: -2, damage: 0 },
        { id: "opinion:liked", text: "The Cinder Wolf likes you.", roll: 1, damage: 0 },
      ],
    });
    expect(matched.total).toBe(plain.total - 1);
  });
});
