/**
 * Deeds (#310, docs/class-mastery.md §6): what each counts, what never
 * counts, and — through the real engine, the shipped rules and the shipped
 * abilities — that every class reaches Master at a table of one and at a
 * table of four.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyIntent, createRunState, type EngineContext } from "./engine.js";
import {
  beginEncounter,
  combatantById,
  currentActor,
  currentActorId,
  endTurnWithEvents,
  legalActions,
  legalMoves,
  performAction,
  positionOf,
  type AbilityCatalog,
  type CombatAbility,
  type EncounterEvent,
  type EncounterState,
} from "./encounter.js";
import {
  actionCredits,
  addDeed,
  deedTargets,
  eventCredits,
  freshFightDeeds,
  heroDeedsOf,
  nextRankDeeds,
  rankEarned,
  rankUp,
  rankUpLine,
  runCounted,
  storyCredits,
  turnEndCredits,
} from "./deeds.js";
import { classOf, newCharacter, resolveCharacter } from "./character.js";
import { parseBoard, type Position } from "./grid.js";
import type { Rng } from "./dice.js";
import { makeRng } from "./dice.js";
import { DEED_IDS, DEED_OWNERS } from "./types/domain.js";
import type { ClassId, ClassRank, DeedId, ItemCatalog, RulesContent, SpeciesId, StatId } from "./types/domain.js";
import type { Chapter, EncounterMap, EnemySpec } from "./types/chapter.js";
import type { ClientIntent } from "./types/protocol.js";
import type { FightDeeds, HeroDeeds, RunState } from "./types/state.js";
import { APPEARANCE, makeCharacter } from "./test-fixtures.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(ROOT, "content", file), "utf8")) as T;

const RULES = read<RulesContent>("rules.json");
const ABILITIES = read<{ abilities: AbilityCatalog }>("abilities.json").abilities;
const ITEMS: ItemCatalog = {};
const ROADSIDE = read<EncounterMap>("maps/roadside.json");
const CLASSES: ClassId[] = ["thornguard", "duskrunner", "starweaver", "songkeeper"];

/** Every die lands on `die`. */
const ALWAYS = (die: number): Rng => ({ next: () => (die - 1) / 20 + 0.001 });
const fightCtx = (rng: Rng = ALWAYS(20)) => ({ rules: RULES, abilities: ABILITIES, rng });

const SKIRMISHER: EnemySpec = { id: "wolf", name: "Cinder Wolf", count: 1, hp: 6, guard: 11, quick: 3, steps: 5, attack: 3 };

function hero(id: string, klass: ClassId, rank: ClassRank = "master") {
  return resolveCharacter(
    makeCharacter({ id, name: id, class: klass, rank, species: "unicorn", stats: { might: 3, quick: 1, clever: 3, heart: 3 } }),
    RULES,
    ITEMS,
  );
}

/** A small open board with the party where it is put and wolves where they are put. */
function board(party: { id: string; klass: ClassId; at: Position; hp?: number; down?: boolean }[], wolves: { at: Position; hp?: number }[]): EncounterState {
  const state = beginEncounter(
    {
      board: parseBoard(Array.from({ length: 8 }, () => ".".repeat(10))),
      party: party.map((p) => ({
        character: hero(p.id, p.klass),
        at: p.at,
        ...(p.hp !== undefined ? { hp: p.hp } : {}),
        ...(p.down ? { down: true } : {}),
      })),
      enemies: wolves.map((w) => ({ spec: { ...SKIRMISHER, ...(w.hp !== undefined ? { hp: w.hp } : {}) }, at: w.at })),
    },
    fightCtx(),
  );
  return state;
}

/** Hands the clock to `id`, whoever has it now. */
function turnOf(state: EncounterState, id: string): EncounterState {
  let s = state;
  for (let i = 0; i < 20 && currentActorId(s) !== id; i++) s = endTurnWithEvents(s).state;
  if (currentActorId(s) !== id) throw new Error(`never ${id}'s turn`);
  // Fresh: nobody has walked anywhere, so no hit is a run-in unless a test says.
  return { ...s, stepsLeft: combatantById(s, id)!.steps, actionTaken: false };
}

/** `id` does `abilityId` and the action's credits come back. */
function act(state: EncounterState, id: string, abilityId: string, target: { targetId?: string; targetTile?: Position; targetTiles?: Position[] }, memo: FightDeeds = freshFightDeeds(), rng: Rng = ALWAYS(20)) {
  const before = turnOf(state, id);
  const result = performAction(before, fightCtx(rng), { abilityId, ...target });
  if (!result.ok) throw new Error(result.reason);
  const counted = actionCredits(
    memo,
    {
      actorId: id,
      abilityId,
      ability: (ABILITIES[abilityId] as CombatAbility | undefined) ?? null,
      targetIds: target.targetId ? [target.targetId] : [],
      targetTiles: target.targetTiles ?? (target.targetTile ? [target.targetTile] : []),
      before,
    },
    result.state,
    result.events,
  );
  return { state: result.state, events: result.events, ...counted };
}

const deedsOf = (credits: { deed: DeedId; heroId: string; count: number }[], heroId?: string) =>
  credits.filter((c) => heroId === undefined || c.heroId === heroId).map((c) => [c.deed, c.count]);

// ---------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------

describe("the shipped ladder", () => {
  it("gives every class all three ranks, with only deeds the game counts and the class can do", () => {
    for (const id of CLASSES) {
      const deeds = RULES.classes[id].deeds!;
      for (const rank of ["apprentice", "expert", "master"] as const) {
        const req = deeds[rank]!;
        for (const deed of deedTargets(req).keys()) {
          expect(DEED_IDS).toContain(deed);
          expect([null, id]).toContain(DEED_OWNERS[deed]);
        }
      }
      // Rule 5: Master includes a story deed, on every track.
      for (const track of [deeds.master!.withFriends, deeds.master!.alone ?? deeds.master!.withFriends]) {
        expect(track.class_story).toBe(1);
      }
    }
  });

  it("is earnable alone: every rank has a track nothing in it needs a friend for", () => {
    const needsAFriend: DeedId[] = ["brace_friend", "shove_off_friend", "glimmer_made", "tangle_guard"];
    for (const id of CLASSES) {
      for (const req of Object.values(RULES.classes[id].deeds!)) {
        const tracks = [req.withFriends, ...(req.alone ? [req.alone] : [])];
        expect(tracks.some((t) => Object.keys(t).every((d) => !needsAFriend.includes(d as DeedId))), id).toBe(true);
      }
    }
  });
});

describe("ranks", () => {
  const tg = RULES.classes.thornguard;

  it("counts only what the next rank asks for, capped at the most any track asks", () => {
    const start: HeroDeeds = { class: "thornguard", rank: "none", deeds: {} };
    expect(addDeed(start, tg, "shove", 1)).toBe(start); // an Expert deed, not yet
    expect(addDeed(start, tg, "song_hearts", 5)).toBe(start); // another class's
    const braced = addDeed(addDeed(addDeed(start, tg, "brace_friend", 1), tg, "brace_friend", 1), tg, "brace_friend", 1);
    expect(braced.deeds).toEqual({ brace_friend: tg.deeds!.apprentice!.withFriends.brace_friend });
    expect(addDeed({ class: "thornguard", rank: "master", deeds: {} }, tg, "class_story", 1).deeds).toEqual({});
  });

  it("lands one rank when either track is done, and starts the count again", () => {
    const alone: HeroDeeds = { class: "thornguard", rank: "none", deeds: { hold_ground: 4 } };
    expect(rankEarned(tg.deeds!.apprentice!, alone.deeds)).toBe(true);
    expect(rankUp(alone, tg)).toEqual({ class: "thornguard", rank: "apprentice", deeds: {} });
    expect(rankUp({ class: "thornguard", rank: "none", deeds: { hold_ground: 1, brace_friend: 1 } }, tg)).toBeNull();
    expect(rankUp({ class: "thornguard", rank: "master", deeds: {} }, tg)).toBeNull();
    expect(nextRankDeeds(tg, "master")).toBeNull();
  });

  it("says so in one line, and a Duskrunner's crow says the rest", () => {
    expect(rankUpLine("Mira", tg, "apprentice", "c_1")).toEqual({
      characterId: "c_1",
      class: "thornguard",
      rank: "apprentice",
      line: "Mira is a Thornguard Apprentice now! New move: Shove.",
    });
    const crow = rankUpLine("Pip", RULES.classes.duskrunner, "expert", "c_2");
    expect(crow.line).toBe("Pip is a Duskrunner Expert now! New move: Twin Step.");
    expect(crow.crow).toMatch(/Don't mess with us/);
    expect(crow.crow).not.toMatch(/—/);
  });
});

// ---------------------------------------------------------------------------
// What each deed counts
// ---------------------------------------------------------------------------

describe("the Songkeeper's hearts", () => {
  it("counts the hearts a song actually gives back, on anyone, the Songkeeper included", () => {
    const s = board([{ id: "sk", klass: "songkeeper", at: { x: 1, y: 1 }, hp: 5 }, { id: "tg", klass: "thornguard", at: { x: 2, y: 1 }, hp: 9 }], [{ at: { x: 9, y: 7 } }]);
    expect(deedsOf(act(s, "sk", "soothe", { targetId: "sk" }).credits)).toEqual([["song_hearts", 3]]);
    // Rally heals 2, but the Thornguard is only 1 short: 1 heart.
    expect(deedsOf(act(s, "sk", "rally", { targetId: "tg" }).credits)).toEqual([["song_hearts", 1]]);
    // Chorus: 2 on the Songkeeper, 1 on the Thornguard.
    expect(deedsOf(act(s, "sk", "chorus", {}).credits)).toEqual([["song_hearts", 3]]);
  });

  it("counts nothing for healing at full health", () => {
    const s = board([{ id: "sk", klass: "songkeeper", at: { x: 1, y: 1 } }, { id: "tg", klass: "thornguard", at: { x: 2, y: 1 } }], [{ at: { x: 9, y: 7 } }]);
    expect(deedsOf(act(s, "sk", "chorus", {}).credits)).toEqual([]);
  });

  it("counts lifting a knocked-down friend as 3", () => {
    const s = board([{ id: "sk", klass: "songkeeper", at: { x: 1, y: 1 } }, { id: "tg", klass: "thornguard", at: { x: 5, y: 5 }, hp: 0, down: true }], [{ at: { x: 9, y: 7 } }]);
    expect(deedsOf(act(s, "sk", "rally", { targetId: "tg" }).credits)).toEqual([["song_hearts", 3]]);
  });

  it("does not count Help Up, a species heal or another class's healing", () => {
    const down = board([{ id: "sk", klass: "songkeeper", at: { x: 1, y: 1 } }, { id: "tg", klass: "thornguard", at: { x: 2, y: 1 }, hp: 0, down: true }], [{ at: { x: 9, y: 7 } }]);
    expect(deedsOf(act(down, "sk", "help_up", { targetId: "tg" }).credits)).toEqual([]);
    const hurt = board([{ id: "sk", klass: "songkeeper", at: { x: 1, y: 1 } }, { id: "tg", klass: "thornguard", at: { x: 2, y: 1 }, hp: 4 }], [{ at: { x: 9, y: 7 } }]);
    const withMending = { ...hurt, combatants: hurt.combatants.map((c) => (c.id === "sk" ? { ...c, actions: [...c.actions, "mending_light"] } : c)) };
    expect(deedsOf(act(withMending, "sk", "mending_light", { targetId: "tg" }).credits)).toEqual([]);
  });
});

describe("the Thornguard's deeds", () => {
  it("counts a Brace taking a hit meant for a friend, not the Brace being made", () => {
    let s = board([{ id: "tg", klass: "thornguard", at: { x: 1, y: 1 } }, { id: "sk", klass: "songkeeper", at: { x: 2, y: 1 } }], [{ at: { x: 3, y: 1 } }]);
    const braced = act(s, "tg", "brace", { targetId: "sk" });
    expect(deedsOf(braced.credits)).toEqual([]);
    s = turnOf(braced.state, "wolf#1");
    const swing = performAction(s, fightCtx(ALWAYS(20)), { abilityId: "attack", targetId: "sk" });
    if (!swing.ok) throw new Error(swing.reason);
    const counted = eventCredits(braced.memo, swing.state, swing.events);
    expect(deedsOf(counted.credits)).toEqual([["brace_friend", 1]]);
  });

  it("counts a Shove, and a Shove off a hurt friend", () => {
    const s = board([{ id: "tg", klass: "thornguard", at: { x: 1, y: 1 } }, { id: "sk", klass: "songkeeper", at: { x: 2, y: 2 }, hp: 6 }], [{ at: { x: 2, y: 1 } }]);
    expect(deedsOf(act(s, "tg", "shove", { targetId: "wolf#1" }).credits)).toEqual([["shove", 1], ["shove_off_friend", 1]]);
    const unhurt = board([{ id: "tg", klass: "thornguard", at: { x: 1, y: 1 } }, { id: "sk", klass: "songkeeper", at: { x: 2, y: 2 } }], [{ at: { x: 2, y: 1 } }]);
    expect(deedsOf(act(unhurt, "tg", "shove", { targetId: "wolf#1" }).credits)).toEqual([["shove", 1]]);
  });

  it("counts a Bramble Wall once per fight", () => {
    const s = board([{ id: "tg", klass: "thornguard", at: { x: 1, y: 1 } }], [{ at: { x: 9, y: 7 } }]);
    const tiles = [{ x: 4, y: 4 }, { x: 4, y: 5 }];
    const first = act(s, "tg", "bramble_wall", { targetTiles: tiles });
    expect(deedsOf(first.credits)).toEqual([["bramble_wall_fight", 1]]);
    const again = act(first.state, "tg", "bramble_wall", { targetTiles: [{ x: 6, y: 4 }, { x: 6, y: 5 }] }, first.memo);
    expect(deedsOf(again.credits)).toEqual([]);
  });

  it("counts holding the line: a turn ended on your feet beside a monster", () => {
    const s = board([{ id: "tg", klass: "thornguard", at: { x: 1, y: 1 } }], [{ at: { x: 2, y: 2 } }]);
    expect(deedsOf(turnEndCredits(s, "tg"))).toEqual([["hold_ground", 1]]);
    const apart = board([{ id: "tg", klass: "thornguard", at: { x: 1, y: 1 } }], [{ at: { x: 3, y: 1 } }]);
    expect(turnEndCredits(apart, "tg")).toEqual([]);
    const down = board([{ id: "tg", klass: "thornguard", at: { x: 1, y: 1 }, hp: 0, down: true }], [{ at: { x: 2, y: 1 } }]);
    expect(turnEndCredits(down, "tg")).toEqual([]);
  });
});

describe("the Duskrunner's deeds", () => {
  it("counts a hit on each monster the hero has not hit yet this fight, whoever else did", () => {
    const s = board([{ id: "dr", klass: "duskrunner", at: { x: 1, y: 1 } }, { id: "sw", klass: "starweaver", at: { x: 1, y: 3 } }], [{ at: { x: 2, y: 1 }, hp: 20 }, { at: { x: 2, y: 2 }, hp: 20 }]);
    // A Burst catches both first; the Duskrunner still has both to find.
    const burst = act(s, "sw", "burst", { targetTile: { x: 2, y: 1 } });
    const first = act(burst.state, "dr", "attack", { targetId: "wolf#1" }, burst.memo);
    expect(deedsOf(first.credits, "dr")).toEqual([["new_target", 1]]);
    const again = act(first.state, "dr", "attack", { targetId: "wolf#1" }, first.memo);
    expect(deedsOf(again.credits, "dr")).toEqual([]);
    const other = act(again.state, "dr", "attack", { targetId: "wolf#2" }, again.memo);
    expect(deedsOf(other.credits, "dr")).toEqual([["new_target", 1]]);
    const missed = act(s, "dr", "attack", { targetId: "wolf#1" }, freshFightDeeds(), ALWAYS(1));
    expect(deedsOf(missed.credits)).toEqual([]);
  });

  it("counts a monster missing because of Vanish", () => {
    const s = board([{ id: "dr", klass: "duskrunner", at: { x: 1, y: 1 } }], [{ at: { x: 2, y: 1 } }]);
    const vanished = act(s, "dr", "vanish", {});
    const swing = performAction(turnOf(vanished.state, "wolf#1"), fightCtx(), { abilityId: "attack", targetId: "dr" });
    if (!swing.ok) throw new Error(swing.reason);
    expect(deedsOf(eventCredits(vanished.memo, swing.state, swing.events).credits)).toEqual([["vanish_miss", 1]]);
  });

  it("counts Twin Step finishing a monster", () => {
    const s = board([{ id: "dr", klass: "duskrunner", at: { x: 1, y: 1 } }], [{ at: { x: 2, y: 1 }, hp: 3 }]);
    const credits = act(s, "dr", "twin_step", { targetId: "wolf#1" }).credits;
    expect(deedsOf(credits.filter((c) => c.deed === "twin_step_finish"))).toEqual([["twin_step_finish", 1]]);
  });
});

describe("the Starweaver's deeds", () => {
  it("counts the monsters caught in one Burst, hit or not", () => {
    const s = board([{ id: "sw", klass: "starweaver", at: { x: 1, y: 1 } }], [{ at: { x: 4, y: 4 } }, { at: { x: 5, y: 4 } }, { at: { x: 5, y: 5 } }]);
    const missed = act(s, "sw", "burst", { targetTile: { x: 4, y: 4 } }, freshFightDeeds(), ALWAYS(1));
    expect(deedsOf(missed.credits)).toEqual([["burst_two", 1], ["burst_three", 1]]);
  });

  it("counts a Glimmered friend's roll that hits, once, and forgets a miss", () => {
    const s = board([{ id: "sw", klass: "starweaver", at: { x: 1, y: 1 } }, { id: "tg", klass: "thornguard", at: { x: 3, y: 1 } }], [{ at: { x: 4, y: 1 }, hp: 20 }]);
    const glimmered = act(s, "sw", "glimmer", { targetId: "tg" });
    expect(glimmered.memo.glimmers).toEqual({ tg: "sw" });
    const hit = act(glimmered.state, "tg", "attack", { targetId: "wolf#1" }, glimmered.memo);
    expect(deedsOf(hit.credits, "sw")).toEqual([["glimmer_made", 1]]);
    expect(hit.memo.glimmers).toEqual({});
    const miss = act(glimmered.state, "tg", "attack", { targetId: "wolf#1" }, glimmered.memo, ALWAYS(1));
    expect(deedsOf(miss.credits, "sw")).toEqual([]);
    expect(miss.memo.glimmers).toEqual({});
  });

  it("counts Tanglelight, and Tanglelight on a monster about to reach a friend", () => {
    const near = board([{ id: "sw", klass: "starweaver", at: { x: 0, y: 0 } }, { id: "tg", klass: "thornguard", at: { x: 2, y: 4 } }], [{ at: { x: 6, y: 4 } }]);
    expect(deedsOf(act(near, "sw", "tanglelight", { targetId: "wolf#1" }).credits)).toEqual([["tanglelight", 1], ["tangle_guard", 1]]);
    const far = board([{ id: "sw", klass: "starweaver", at: { x: 0, y: 0 } }], [{ at: { x: 6, y: 4 } }]);
    expect(deedsOf(act(far, "sw", "tanglelight", { targetId: "wolf#1" }).credits)).toEqual([["tanglelight", 1]]);
  });
});

describe("nothing rewards being hurt or knocked down", () => {
  it("credits no deed for a hero taking damage or going down", () => {
    for (const klass of CLASSES) {
      const s = board([{ id: "h", klass, at: { x: 1, y: 1 } }], [{ at: { x: 2, y: 1 } }]);
      const hurt: EncounterEvent[] = [{ type: "damage", actorId: "h", amount: 3, hp: 7 }, { type: "damage", actorId: "h", amount: 7, hp: 0 }, { type: "down", actorId: "h" }];
      expect(eventCredits(freshFightDeeds(), s, hurt).credits).toEqual([]);
    }
  });
});

describe("story deeds", () => {
  it("credits every seated hero wearing a class the choice or way asks for", () => {
    const heroes = [
      { id: "a", class: "thornguard" as const },
      { id: "b", class: "starweaver" as const },
      { id: "c", class: "thornguard" as const },
    ];
    expect(deedsOf(storyCredits(heroes, "thornguard"))).toEqual([["class_story", 1], ["class_story", 1]]);
    expect(storyCredits(heroes, ["starweaver", "songkeeper"]).map((c) => c.heroId)).toEqual(["b"]);
    expect(storyCredits(heroes, undefined)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Through the engine: every class to Master, alone and at a table of four
// ---------------------------------------------------------------------------

const SPECIES: Record<ClassId, SpeciesId> = { thornguard: "dragonling", duskrunner: "griffin", starweaver: "kitsune", songkeeper: "unicorn" };
const STAT: Record<ClassId, StatId> = { thornguard: "might", duskrunner: "quick", starweaver: "clever", songkeeper: "heart" };

/** The camp between fights: one ordinary way back to the road, and one for each class. */
function trainingChapter(wolves: number): Chapter {
  return {
    id: "deeds-training",
    campaignId: "deeds-campaign",
    index: 1,
    title: "The Long Road",
    biome: "enchanted_woods",
    estimatedMinutes: 40,
    xpAward: 100,
    entry: "camp",
    scenes: {
      camp: {
        type: "rest",
        narration: "A fire, and the road beyond it.",
        heal: 99,
        choices: [
          { id: "road", label: "Back to the road", icon: "arrow", goto: "fight" },
          ...CLASSES.map((klass) => ({ id: `${klass}_way`, label: `The ${klass} way`, icon: "star", requiresClass: klass, goto: "fight" })),
        ],
      },
      fight: {
        type: "encounter",
        map: ROADSIDE.id,
        narration: "Wolves on the road.",
        enemies: [{ ...SKIRMISHER, count: wolves }],
        onVictory: { goto: "camp" },
        onDefeat: { goto: "camp", narration: "They run off with the supper." },
      },
    },
    voiceGuide: { tone: "warm", vocabulary: "age-8", forbidden: ["death"] },
  } as Chapter;
}

function engineCtx(chapter: Chapter, seed: string): EngineContext {
  return {
    rules: RULES,
    items: ITEMS,
    chapter,
    map: (id) => (id === ROADSIDE.id ? ROADSIDE : null),
    abilities: ABILITIES,
    rng: makeRng(seed),
    now: "2026-10-19T12:00:00.000Z",
    householdId: "h_1",
  };
}

function must(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext): RunState {
  const result = applyIntent(state, { playerId, intent }, ctx);
  if (result.error) throw new Error(`${intent.type}: ${result.error.code} ${result.error.message}`);
  return result.state;
}

/** Each step of a hero's next rank still to do. */
function wants(state: RunState, heroId: string, deed: DeedId): boolean {
  const member = state.party.find((m) => m.character.id === heroId)!;
  const hero = runCounted(state.deeds, heroId, member.character.class) ?? heroDeedsOf(member.character);
  const req = nextRankDeeds(RULES.classes[hero.class], hero.rank);
  const target = req ? deedTargets(req).get(deed) : undefined;
  return target !== undefined && (hero.deeds[deed] ?? 0) < target;
}

const chebyshev = (a: Position, b: Position) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const manhattan = (a: Position, b: Position) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/**
 * What a hero who knows their next deed does with the action: the move it
 * needs when the fight offers the moment, else a plain swing. A table of kids
 * plays no better than this, and usually no worse.
 */
function pickAction(state: RunState, heroId: string): Extract<ClientIntent, { type: "COMBAT_ACTION" }> | null {
  const enc = state.encounter!;
  const offered = legalActions(enc, fightCtx());
  const find = (id: string) => offered.find((a) => a.abilityId === id);
  const me = positionOf(enc, heroId)!;
  const foes = enc.combatants.filter((c) => c.side === "enemy" && !c.down);
  const friends = enc.combatants.filter((c) => c.side === "party" && c.id !== heroId && !c.escaped);
  const nextToFoe = (p: Position) => foes.some((f) => chebyshev(positionOf(enc, f.id)!, p) <= 1);
  const any = (deeds: DeedId[]) => deeds.some((d) => wants(state, heroId, d));

  const songs = ["rally", "soothe", "chorus"];
  if (any(["song_hearts"])) {
    const allies = enc.combatants.filter((c) => c.side === "party" && !c.escaped);
    const downed = allies.find((c) => c.down);
    if (downed && find("rally")?.targets.includes(downed.id)) return { type: "COMBAT_ACTION", abilityId: "rally", targetId: downed.id };
    const hurt = allies.filter((c) => !c.down && c.maxHp - c.hp >= 2).sort((a, b) => a.hp - a.maxHp - (b.hp - b.maxHp));
    if (hurt.length >= 2 && find("chorus")) return { type: "COMBAT_ACTION", abilityId: "chorus" };
    for (const id of songs.slice(0, 2).reverse()) {
      const song = find(id);
      const who = hurt.find((c) => song?.targets.includes(c.id));
      if (song && who) return { type: "COMBAT_ACTION", abilityId: id, targetId: who.id };
    }
  }
  if (any(["brace_friend"])) {
    const brace = find("brace");
    const who = friends.find((f) => !f.down && brace?.targets.includes(f.id) && nextToFoe(positionOf(enc, f.id)!));
    if (brace && who) return { type: "COMBAT_ACTION", abilityId: "brace", targetId: who.id };
  }
  if (any(["shove", "shove_off_friend"])) {
    const shove = find("shove");
    if (shove && shove.targets.length > 0) {
      const offHurt = shove.targets.find((t) => friends.some((f) => (f.down || f.hp < f.maxHp) && chebyshev(positionOf(enc, f.id)!, positionOf(enc, t)!) <= 1));
      if (offHurt || wants(state, heroId, "shove")) return { type: "COMBAT_ACTION", abilityId: "shove", targetId: offHurt ?? shove.targets[0]! };
    }
  }
  if (any(["bramble_wall_fight"]) && !state.deeds?.fight?.walled.includes(heroId)) {
    const wall = find("bramble_wall");
    if (wall && wall.tiles.length >= 2) return { type: "COMBAT_ACTION", abilityId: "bramble_wall", targetTiles: wall.tiles.slice(0, 2) };
  }
  if (any(["vanish_miss"]) && !combatantById(enc, heroId)!.evade && foes.some((f) => manhattan(positionOf(enc, f.id)!, me) <= f.steps + 1)) {
    if (find("vanish")) return { type: "COMBAT_ACTION", abilityId: "vanish" };
  }
  if (any(["twin_step_finish"])) {
    const twin = find("twin_step");
    const weak = twin?.targets.find((t) => combatantById(enc, t)!.hp <= 3);
    if (twin && weak) return { type: "COMBAT_ACTION", abilityId: "twin_step", targetId: weak };
  }
  if (any(["glimmer_made"])) {
    const glimmer = find("glimmer");
    const who = friends.find((f) => !f.down && glimmer?.targets.includes(f.id) && nextToFoe(positionOf(enc, f.id)!) && !state.deeds?.fight?.glimmers[f.id]);
    if (glimmer && who) return { type: "COMBAT_ACTION", abilityId: "glimmer", targetId: who.id };
  }
  if (any(["tangle_guard", "tanglelight"])) {
    const tangle = find("tanglelight");
    const threat = tangle?.targets.find((t) => {
      const foe = combatantById(enc, t)!;
      return !foe.rooted && friends.some((f) => !f.down && manhattan(positionOf(enc, t)!, positionOf(enc, f.id)!) <= foe.steps + 1);
    });
    const pick = threat ?? (wants(state, heroId, "tanglelight") ? tangle?.targets.find((t) => !combatantById(enc, t)!.rooted) : undefined);
    if (tangle && pick) return { type: "COMBAT_ACTION", abilityId: "tanglelight", targetId: pick };
  }
  const burst = find("burst");
  if (burst && burst.tiles.length > 0) {
    const caught = (t: Position) => foes.filter((f) => {
      const at = positionOf(enc, f.id)!;
      return at.x >= t.x && at.x < t.x + 2 && at.y >= t.y && at.y < t.y + 2;
    }).length;
    const best = [...burst.tiles].sort((a, b) => caught(b) - caught(a))[0]!;
    if (caught(best) >= 2 || (caught(best) >= 1 && !find("attack")?.targets.length)) return { type: "COMBAT_ACTION", abilityId: "burst", targetTile: best };
  }
  const attack = find("attack");
  if (attack && attack.targets.length > 0) {
    const weakest = [...attack.targets].sort((a, b) => combatantById(enc, a)!.hp - combatantById(enc, b)!.hp)[0]!;
    return { type: "COMBAT_ACTION", abilityId: "attack", targetId: weakest };
  }
  return null;
}

/** The hero whose turn it is takes it: maybe a step toward the wolves, an action, and the end of the turn. */
function takeTurn(state: RunState, ctx: EngineContext): RunState {
  const enc = state.encounter!;
  const actor = currentActor(enc);
  if (!actor || actor.side !== "party") return must(state, state.party[0]!.playerId, { type: "ADVANCE" }, ctx);
  const member = state.party.find((m) => m.character.id === actor.id)!;
  let s = state;
  let action = pickAction(s, actor.id);
  const steps = legalMoves(enc);
  // A Thornguard stands in front whatever it means to do; anybody else walks
  // only when there is nothing better to do from here.
  const closeIn = actor.attackStat === "might" || !action || action.abilityId === "burst" || action.abilityId === "attack";
  if (closeIn && steps.length > 0 && !enc.actionTaken) {
    const foes = enc.combatants.filter((c) => c.side === "enemy" && !c.down).map((c) => positionOf(enc, c.id)!);
    const near = (p: Position) => Math.min(...foes.map((f) => chebyshev(f, p)));
    // A caster keeps a step back; everybody else closes in.
    const ideal = actor.attackStat === "clever" ? 3 : 1;
    const here = positionOf(enc, actor.id)!;
    const best = [...steps].sort((a, b) => Math.abs(near(a) - ideal) - Math.abs(near(b) - ideal))[0]!;
    if (Math.abs(near(best) - ideal) < Math.abs(near(here) - ideal)) {
      s = must(s, member.playerId, { type: "MOVE", to: { x: best.x, y: best.y } }, ctx);
      if (!s.encounter || currentActorId(s.encounter) !== actor.id) return s;
      action = pickAction(s, actor.id);
    }
  }
  if (action && !s.encounter!.actionTaken) {
    s = must(s, member.playerId, action, ctx);
    if (!s.encounter || currentActorId(s.encounter) !== actor.id) return s;
  }
  return must(s, member.playerId, { type: "END_TURN" }, ctx);
}

interface Climb {
  /** By hero: the fight each rank landed after (story deeds land between fights, after the fight before). */
  ranks: Record<string, Partial<Record<ClassRank, number>>>;
  fights: number;
  /** The run's rank-up lines, in order. */
  lines: string[];
}

/** Plays fights until every hero is a Master, or `limit` fights pass. */
function climb(classes: ClassId[], seed: string, limit = 80): Climb {
  const chapter = trainingChapter(classes.length === 1 ? 2 : 3);
  const ctx = engineCtx(chapter, seed);
  let s = createRunState({ runId: "r_deeds", roomCode: "DEED", mode: "travel", now: "2026-10-19T11:00:00.000Z" });
  classes.forEach((klass, i) => {
    s = must(s, `p_${i}`, {
      type: "CREATE_CHARACTER",
      name: `Hero${i}`,
      species: SPECIES[klass],
      class: klass,
      stats: { might: 0, quick: 0, clever: 0, heart: 0, [STAT[klass]]: RULES.creationPoints },
      appearance: APPEARANCE,
    }, ctx);
  });
  for (const m of s.party) s = must(s, m.playerId, { type: "READY", ready: true }, ctx);
  s = must(s, s.party[0]!.playerId, { type: "START_CHAPTER", chapterId: chapter.id }, ctx);

  const out: Climb = { ranks: {}, fights: 0, lines: [] };
  const rankOf = (st: RunState, id: string) => st.party.find((m) => m.character.id === id)!.character.rank ?? "none";
  const note = (st: RunState) => {
    for (const m of st.party) {
      const rank = rankOf(st, m.character.id);
      const seen = (out.ranks[m.character.id] ??= {});
      if (rank !== "none" && seen[rank] === undefined) seen[rank] = out.fights;
    }
    for (const up of st.rankUps?.ups ?? []) if (!out.lines.includes(up.line)) out.lines.push(up.line, ...(up.crow ? [up.crow] : []));
  };
  const allMasters = (st: RunState) => st.party.every((m) => m.character.rank === "master");

  while (out.fights < limit && !allMasters(s)) {
    // At camp: the class way for anybody whose next rank wants a story deed.
    const prompt = s.prompt;
    if (prompt?.kind !== "choice") throw new Error(`expected the camp's choice, got ${JSON.stringify(prompt)}`);
    const way = s.party.find((m) => wants(s, m.character.id, "class_story") && prompt.options.some((o) => o.id === `${m.character.class}_way`));
    s = must(s, s.party[0]!.playerId, { type: "CHOOSE", choiceId: way ? `${way.character.class}_way` : "road" }, ctx);
    note(s);
    for (const m of s.party) s = must(s, m.playerId, { type: "READY", ready: true }, ctx);
    for (let guard = 0; guard < 400 && s.encounter; guard++) s = takeTurn(s, ctx);
    if (s.encounter) throw new Error("a fight never ended");
    out.fights += 1;
    note(s);
  }
  return out;
}

const SEEDS = ["deeds-1", "deeds-2", "deeds-3", "deeds-4", "deeds-5"];

describe("every class reaches Master through the engine", () => {
  for (const klass of CLASSES) {
    it(`a ${klass} at a table of one`, { timeout: 60_000 }, () => {
      for (const seed of SEEDS) {
        const run = climb([klass], seed);
        const ranks = run.ranks["c_" + "0"] ?? Object.values(run.ranks)[0]!;
        expect(ranks.master, `${klass} ${seed}: ${JSON.stringify(run.ranks)}`).toBeDefined();
        // Apprentice in one or two chapters' worth of fights (about one each).
        expect(ranks.apprentice!, `${klass} ${seed}`).toBeLessThanOrEqual(3);
      }
    });
  }

  it("all four classes at a table of four", { timeout: 60_000 }, () => {
    for (const seed of SEEDS) {
      const run = climb(CLASSES, seed);
      const heroes = Object.values(run.ranks);
      expect(heroes, `${seed}: ${JSON.stringify(run.ranks)}`).toHaveLength(4);
      for (const ranks of heroes) {
        expect(ranks.master, `${seed}: ${JSON.stringify(run.ranks)}`).toBeDefined();
        expect(ranks.apprentice!, `${seed}: ${JSON.stringify(run.ranks)}`).toBeLessThanOrEqual(3);
      }
      // Every rank said so, in one line each, and the crows had their say.
      expect(run.lines.filter((l) => / now!/.test(l))).toHaveLength(12);
      expect(run.lines.filter((l) => /Don't mess with us/.test(l))).toHaveLength(3);
    }
  });

  it("reports the climb (KAD_DEED_REPORT=<file>)", { timeout: 120_000 }, () => {
    if (!process.env.KAD_DEED_REPORT) return;
    const rows: string[] = [];
    for (const table of [...CLASSES.map((c) => [c]), CLASSES]) {
      const per: Record<string, number[][]> = {};
      for (const seed of [...SEEDS, "deeds-6", "deeds-7", "deeds-8", "deeds-9", "deeds-10"]) {
        const run = climb(table, seed);
        for (const [id, ranks] of Object.entries(run.ranks)) {
          (per[id] ??= []).push([ranks.apprentice ?? -1, ranks.expert ?? -1, ranks.master ?? -1]);
        }
      }
      for (const [id, runs] of Object.entries(per)) {
        const klass = table[Number(id.replace(/\D/g, "")) % table.length] ?? table[0];
        const med = (i: number) => [...runs.map((r) => r[i]!)].sort((a, b) => a - b)[Math.floor(runs.length / 2)];
        const max = (i: number) => Math.max(...runs.map((r) => r[i]!));
        rows.push(`table of ${table.length} ${klass}: apprentice ${med(0)} (max ${max(0)}), expert ${med(1)} (max ${max(1)}), master ${med(2)} (max ${max(2)})`);
      }
    }
    writeFileSync(process.env.KAD_DEED_REPORT, rows.join("\n") + "\n");
  });
});

// ---------------------------------------------------------------------------
// Only the worn class, and switching keeps progress
// ---------------------------------------------------------------------------

describe("only the worn class counts", () => {
  it("leaves every other class's rank and progress alone, whatever the hero does", () => {
    // A Thornguard who has been a Songkeeper: her songkeeper progress waits.
    const stored = makeCharacter({ id: "c_0", class: "thornguard", rank: "none" });
    stored.committed.mastery.songkeeper = { rank: "apprentice", deeds: { song_hearts: 4 } };
    const resolved = resolveCharacter(stored, RULES, ITEMS);
    let hero = heroDeedsOf(resolved);
    for (const deed of DEED_IDS) hero = addDeed(hero, RULES.classes.thornguard, deed, 5);
    expect(hero.class).toBe("thornguard");
    expect(Object.keys(hero.deeds).sort()).toEqual(["brace_friend", "hold_ground"]);
    expect(stored.committed.mastery.songkeeper).toEqual({ rank: "apprentice", deeds: { song_hearts: 4 } });
  });

  it("counts a song for nobody but a hero wearing the bell", () => {
    // The same heal, by a hero whose worn class is not the Songkeeper.
    const s = board([{ id: "sk", klass: "songkeeper", at: { x: 1, y: 1 }, hp: 5 }], [{ at: { x: 9, y: 7 } }]);
    const credit = act(s, "sk", "soothe", { targetId: "sk" }).credits;
    const thornguard = addDeed({ class: "thornguard", rank: "none", deeds: {} }, RULES.classes.thornguard, credit[0]!.deed, credit[0]!.count);
    expect(thornguard.deeds).toEqual({});
  });

  it("switching away and back picks the class up exactly where it was left", () => {
    // #311 builds the switch; the stored shape is what has to keep it.
    const c = newCharacter({
      id: "c_s",
      householdId: "h_1",
      ownerPlayerId: "p_1",
      name: "Wren",
      species: "unicorn",
      class: "songkeeper",
      stats: { might: 0, quick: 0, clever: 0, heart: 3 },
      appearance: APPEARANCE,
      rules: RULES,
      now: "2026-10-19T00:00:00.000Z",
    });
    c.committed.mastery.songkeeper = { rank: "apprentice", deeds: { song_hearts: 9 } };
    const away = { ...c, committed: { ...c.committed, class: "thornguard" as const } };
    away.committed.mastery = { ...away.committed.mastery, thornguard: { rank: "none", deeds: { brace_friend: 1 } } };
    expect(resolveCharacter(away, RULES, ITEMS)).toMatchObject({ class: "thornguard", deeds: { brace_friend: 1 } });
    expect(resolveCharacter(away, RULES, ITEMS).rank).toBeUndefined();
    const back = { ...away, committed: { ...away.committed, class: "songkeeper" as const } };
    expect(classOf(back)).toBe("songkeeper");
    expect(resolveCharacter(back, RULES, ITEMS)).toMatchObject({ rank: "apprentice", deeds: { song_hearts: 9 } });
    expect(back.committed.mastery.thornguard).toEqual({ rank: "none", deeds: { brace_friend: 1 } });
  });
});

// ---------------------------------------------------------------------------
// When a rank lands
// ---------------------------------------------------------------------------

/** A Songkeeper alone at camp, `deeds` short of her next rank, hurt. */
function songkeeperAtCamp(rank: ClassRank, deeds: Record<string, number>, seed = "landing") {
  const chapter = trainingChapter(2);
  const ctx = engineCtx(chapter, seed);
  let s = createRunState({ runId: "r_land", roomCode: "LAND", mode: "travel", now: "2026-10-19T11:00:00.000Z" });
  s = must(s, "p_0", { type: "CREATE_CHARACTER", name: "Wren", species: "unicorn", class: "songkeeper", stats: { might: 0, quick: 0, clever: 0, heart: 3 }, appearance: APPEARANCE }, ctx);
  s = must(s, "p_0", { type: "READY", ready: true }, ctx);
  s = must(s, "p_0", { type: "START_CHAPTER", chapterId: chapter.id }, ctx);
  const member = s.party[0]!;
  const ranked = resolveCharacter(
    { ...makeCharacter({ id: member.character.id, name: "Wren", class: "songkeeper", rank }), committed: { ...makeCharacter({ class: "songkeeper", rank }).committed, mastery: { songkeeper: { rank, deeds } } } },
    RULES,
    ITEMS,
  );
  s = { ...s, party: [{ ...member, character: { ...ranked, ownerPlayerId: member.character.ownerPlayerId }, hp: 4 }] };
  return { s, ctx, id: member.character.id };
}

describe("a rank lands at the end of the fight, and its move is there from the next", () => {
  it("counts live, lands when the fight ends, says so on the next scene, and arms the next fight", () => {
    let { s, ctx, id } = songkeeperAtCamp("none", { song_hearts: 3 });
    s = must(s, "p_0", { type: "CHOOSE", choiceId: "road" }, ctx);
    s = must(s, "p_0", { type: "READY", ready: true }, ctx);
    expect(currentActorId(s.encounter!)).toBe(id);
    s = must(s, "p_0", { type: "COMBAT_ACTION", abilityId: "rally", targetId: id }, ctx);

    // Counted at once; not landed until the fight is over.
    expect(s.deeds?.heroes[id]).toEqual({ songkeeper: { rank: "none", deeds: { song_hearts: 4 } } });
    expect(s.party[0]!.character.rank).toBeUndefined();
    expect(combatantById(s.encounter!, id)!.actions).not.toContain("soothe");

    for (let guard = 0; guard < 400 && s.encounter; guard++) s = takeTurn(s, ctx);
    expect(s.encounter).toBeNull();
    expect(s.party[0]!.character).toMatchObject({ rank: "apprentice" });
    expect(s.party[0]!.character.actions).toContain("soothe");
    expect(s.deeds).toEqual({ heroes: { [id]: { songkeeper: { rank: "apprentice", deeds: {} } } } });
    expect(s.rankUps).toEqual({
      sceneId: "camp",
      ups: [{ characterId: id, class: "songkeeper", rank: "apprentice", line: "Wren is a Songkeeper Apprentice now! New move: Soothe." }],
    });

    s = must(s, "p_0", { type: "CHOOSE", choiceId: "road" }, ctx);
    expect(s).not.toHaveProperty("rankUps");
    s = must(s, "p_0", { type: "READY", ready: true }, ctx);
    expect(combatantById(s.encounter!, id)!.actions).toContain("soothe");
  });

  it("lands a rank a class-only choice completes right away, ready for the next fight", () => {
    let { s, ctx, id } = songkeeperAtCamp("expert", { song_hearts: 25 });
    s = must(s, "p_0", { type: "CHOOSE", choiceId: "songkeeper_way" }, ctx);
    expect(s.party[0]!.character).toMatchObject({ rank: "master" });
    expect(s.party[0]!.character.actions).toContain("encore");
    expect(s.rankUps?.ups.map((u) => u.rank)).toEqual(["master"]);
    expect(s.rankUps?.sceneId).toBe("fight");
    s = must(s, "p_0", { type: "READY", ready: true }, ctx);
    expect(combatantById(s.encounter!, id)!.actions).toContain("encore");
  });

  it("keeps a hero re-resolved mid-chapter in the rank the chapter earned her", () => {
    let { s, ctx, id } = songkeeperAtCamp("none", {});
    s = { ...s, deeds: { heroes: { [id]: { songkeeper: { rank: "apprentice", deeds: { song_hearts: 2 } } } } } };
    s = must(s, "p_0", { type: "CHOOSE", choiceId: "road" }, ctx);
    expect(s.party[0]!.character).toMatchObject({ rank: "apprentice", deeds: { song_hearts: 2 } });
    expect(s.party[0]!.character.actions).toContain("soothe");
  });

  it("keeps what a class earned this chapter when the hero changes class mid-chapter (#311)", () => {
    let { s, ctx, id } = songkeeperAtCamp("none", {});
    s = { ...s, deeds: { heroes: { [id]: { songkeeper: { rank: "none", deeds: { song_hearts: 3 } } } } } };
    // She puts on the thorn bracer: her snapshot is re-resolved as a Thornguard.
    const thornguard = resolveCharacter(makeCharacter({ id, name: "Wren", class: "thornguard" }), RULES, ITEMS);
    s = { ...s, party: [{ ...s.party[0]!, character: { ...thornguard, ownerPlayerId: s.party[0]!.character.ownerPlayerId } }] };
    s = must(s, "p_0", { type: "CHOOSE", choiceId: "road" }, ctx);
    s = must(s, "p_0", { type: "READY", ready: true }, ctx);
    for (let guard = 0; guard < 400 && s.encounter; guard++) s = takeTurn(s, ctx);
    // The Songkeeper's three hearts wait to be folded; the Thornguard counts on her own.
    expect(s.deeds?.heroes[id]?.songkeeper).toEqual({ rank: "none", deeds: { song_hearts: 3 } });
    expect(Object.keys(s.deeds?.heroes[id]?.thornguard?.deeds ?? {}).every((d) => ["brace_friend", "hold_ground"].includes(d))).toBe(true);
    expect(s.deeds?.heroes[id]?.thornguard).toBeDefined();
  });

  it("forgets the chapter's deeds when the party is back in the lobby (the server folded them)", () => {
    let { s, ctx, id } = songkeeperAtCamp("none", {});
    s = { ...s, deeds: { heroes: { [id]: { songkeeper: { rank: "apprentice", deeds: {} } } } }, phase: "chapter_complete" };
    s = must(s, "p_0", { type: "ADVANCE" }, ctx);
    expect(s.phase).toBe("lobby");
    expect(s).not.toHaveProperty("deeds");
  });
});
