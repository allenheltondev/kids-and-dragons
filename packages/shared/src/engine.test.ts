import { describe, expect, it } from "vitest";

import {
  applyEffects,
  applyIntent,
  createRunState,
  currentChoices,
  enterScene,
  isPartyDown,
  storyTurnHolder,
  SPOTLIGHT_BEAT,
} from "./engine.js";
import { combatTurnAway, readyWithoutAway, swapOwnerAway, voteWaitsOnlyOnAway } from "./away.js";
import type { EngineContext, EngineResult } from "./engine.js";
import {
  currentActor,
  currentActorId,
  legalActions,
  legalItemTargets,
  legalMoves,
  type LegalAction,
} from "./encounter.js";
import { planEnemyTurn } from "./enemy-ai.js";
import { PLAYER_COLORS } from "./player-colors.js";
import { makeRng } from "./dice.js";
import type { Rng } from "./dice.js";
import type { ClientIntent } from "./types/protocol.js";
import { INVENTORY_SLOTS, MAX_PARTY } from "./types/domain.js";
import { TABLE_FULL_MESSAGE } from "./seats.js";
import type { RunState } from "./types/state.js";
import type { Character } from "./types/domain.js";
import { newCharacter } from "./character.js";
import type { Chapter, ChapterObjective, ChapterOutcome, Scene, StoryScene } from "./types/chapter.js";
import { APPEARANCE, makeChapter,
  makeMap, makeItems, makeRules } from "./test-fixtures.js";

const rules = makeRules();
const items = makeItems();

/** A rigged die, for tests about branches rather than about randomness. */
function fixedRng(die: number): Rng {
  return { next: () => (die - 1) / 20 + 0.001 };
}

function ctx(overrides: Partial<EngineContext> = {}): EngineContext {
  return {
    rules,
    items,
    chapter: makeChapter(),
    // The board the fixture chapter's encounter runs on. Without it the engine
    // has nowhere to put anybody and refuses the fight (NOT_FOUND) — which is
    // the check working, since a deployed bundle whose maps went missing should
    // say so rather than invent terrain.
    map: (id) => (id === MAP.id ? MAP : null),
    abilities: {},
    rng: makeRng("test"),
    now: "2026-07-28T12:00:00.000Z",
    householdId: "h_1",
    ...overrides,
  };
}

const MAP = makeMap();

/**
 * The fixture chapter with a second way out of the shrine. Its shrine beat has
 * only one ("Take the path east"), which is not a decision and so does not
 * move the story turn — a test about the marker going round needs two.
 */
function chapterWithForkedShrine(): Chapter {
  const chapter = makeChapter();
  const shrine = chapter.scenes["scene_shrine"] as StoryScene;
  shrine.choices = [
    ...shrine.choices,
    { id: "west", label: "Take the path west", icon: "arrow", goto: "encounter_wisps" },
  ];
  return chapter;
}

/**
 * Plays a fight to its end, the party attacking whatever it can reach.
 *
 * The chapter-walk tests used to get past the encounter for free: the engine
 * handed out an automatic victory (the `TODO(chapter-4)` placeholder), so
 * "readied up" and "won" were the same event. Now a fight is a fight, and a test
 * that wants to see what is on the other side of it has to have one.
 *
 * Deliberately not clever — it takes the first legal attack each turn and ends
 * the turn. Combat *rules* are `encounter.test.ts`'s job; this only needs to
 * reach the far side.
 */
function fightToTheEnd(state: RunState, context: EngineContext): RunState {
  let current = state;
  for (let guard = 0; guard < 400; guard++) {
    const encounter = current.encounter;
    if (!encounter) return current;

    const actor = currentActor(encounter);
    if (!actor) return current;
    const member = current.party.find((m) => m.character.id === actor.id);
    if (!member) return current;

    const combatContext = {
      rules: context.rules,
      abilities: context.abilities ?? {},
      rng: context.rng,
    };
    const steps: ClientIntent[] = [];

    /*
     * The party walks in with `planEnemyTurn`, which is not a joke: its input is
     * a board, an acting figure and a list of targets, and it never asks which
     * side anybody is on. Pointing it the other way gives "walk at the nearest
     * one you can reach and hit it", which is exactly what a test needs to get
     * across a 10-tile board — and it means this helper cannot drift away from
     * the movement rules the real fight uses.
     */
    const at = encounter.board.actors.find((a) => a.id === actor.id);
    if (at) {
      const plan = planEnemyTurn({
        board: encounter.board,
        enemy: { id: actor.id, at: { x: at.x, y: at.y }, steps: actor.steps },
        party: encounter.combatants
          .filter((c) => c.side === "enemy")
          .map((c) => {
            const spot = encounter.board.actors.find((a) => a.id === c.id);
            return {
              id: c.id,
              at: { x: spot?.x ?? 0, y: spot?.y ?? 0 },
              hp: c.hp,
              maxHp: c.maxHp,
              down: c.down,
            };
          }),
      });
      if (plan.moveTo) steps.push({ type: "MOVE", to: plan.moveTo } as ClientIntent);
    }

    for (const intent of steps) {
      const moved = applyIntent(current, { playerId: member.playerId, intent }, context);
      if (moved.error) break;
      current = moved.state;
    }

    // Whatever is now in reach. `legalActions` is the authority on that, so the
    // helper cannot swing at something the real game would refuse.
    const after = current.encounter;
    const attack = after
      ? legalActions(after, combatContext).find((a: LegalAction) => a.targets.length > 0)
      : undefined;

    const finish: ClientIntent[] = attack
      ? [{ type: "COMBAT_ACTION", abilityId: attack.abilityId, targetId: attack.targets[0]! } as ClientIntent]
      : [{ type: "END_TURN" } as ClientIntent];

    for (const intent of finish) {
      const result = applyIntent(current, { playerId: member.playerId, intent }, context);
      if (result.error) return current;
      current = result.state;
      if (!current.encounter) return current;
    }
    // An action with no steps left ends the turn by itself (engine.ts
    // `finishTurnIfSpent`); one with steps left still has to be handed on.
    if (attack && current.encounter && currentActorId(current.encounter) === actor.id) {
      const result = applyIntent(
        current,
        { playerId: member.playerId, intent: { type: "END_TURN" } },
        context,
      );
      if (result.error) return current;
      current = result.state;
    }
  }
  return current;
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

function newRun(): RunState {
  return createRunState({
    runId: "r_88c",
    roomCode: "ABCD",
    mode: "travel",
    now: "2026-07-28T11:00:00.000Z",
  });
}

/** Applies intents in order, asserting each one was accepted. */
function walk(
  state: RunState,
  steps: { playerId: string; intent: ClientIntent }[],
  context: EngineContext,
): EngineResult {
  let result: EngineResult = { state };
  for (const raw of steps) {
    /*
     * A Story choice belongs to whoever holds the story turn (spec §6.1), and
     * these walks are about what lies past the choice, not who makes it — so
     * a scripted CHOOSE on a turn-held prompt is made by the holder, and a
     * scripted ROLL by the nominated roller (the beat's owner). The turn rule
     * itself is "story turns" below, which never goes through here.
     */
    const prompt = result.state.prompt;
    const step =
      raw.intent.type === "CHOOSE" && prompt?.kind === "choice" && !prompt.vote && prompt.forPlayerIds.length === 1
        ? { ...raw, playerId: prompt.forPlayerIds[0] as string }
        : raw.intent.type === "ROLL" && prompt?.kind === "roll" && !prompt.group
          ? { ...raw, playerId: result.state.party.find((m) => m.character.id === prompt.characterId)?.playerId ?? raw.playerId }
          : raw;
    result = applyIntent(result.state, step, context);
    if (result.error) {
      throw new Error(`${step.intent.type} rejected: ${result.error.code} ${result.error.message}`);
    }
    /*
     * A fight that has started gets played out here rather than in every test
     * that happens to walk past one.
     *
     * These walks used to cross the encounter for free — the engine handed out
     * an automatic victory (the `TODO(chapter-4)` placeholder), so readying up
     * and winning were one event. Now they are not, and a test about the *rest*
     * scene on the far side should not have to spell out sixteen combat turns
     * to get there. Combat's own rules are `encounter.test.ts`'s subject.
     */
    if (result.state.encounter) {
      result = { ...result, state: fightToTheEnd(result.state, context) };
    }
  }
  return result;
}

/**
 * Two characters, both ready — the state a chapter can actually start from.
 * The server enforces the readiness the lobby UI shows, so a fixture that
 * skips it is a fixture that cannot start a chapter.
 */
function seatedParty(context = ctx()): RunState {
  return walk(
    newRun(),
    [
      { playerId: "p_1", intent: CREATE_UNICORN },
      { playerId: "p_2", intent: CREATE_GRIFFIN },
      { playerId: "p_1", intent: { type: "READY", ready: true } },
      { playerId: "p_2", intent: { type: "READY", ready: true } },
    ],
    context,
  ).state;
}

/** Seated but not ready, for the tests that are about seating itself. */
function seatedPartyNotReady(context = ctx()): RunState {
  return walk(
    newRun(),
    [
      { playerId: "p_1", intent: CREATE_UNICORN },
      { playerId: "p_2", intent: CREATE_GRIFFIN },
    ],
    context,
  ).state;
}

/*
 * Boundaries and tie-breaks — the cases either side of a comparison, which the
 * tests above reach only from one direction.
 *
 * Each of these was found by flipping one operator in `engine.ts` and watching
 * the whole suite stay green. That is the shape of a rule nobody is holding:
 * "the party is full at four" is tested with three, "the best roller" with a
 * clear winner, "a heal lifts you" with a heal that heals. The far side of each
 * comparison is where the off-by-one lives.
 */
describe("the edges of the rules", () => {
  it("fills the party at exactly MAX_PARTY, not one past it", () => {
    // Four is the table (spec §2.1 — a family, not a raid). The check is
    // `>= MAX_PARTY`, so only the fifth join can tell it from `> MAX_PARTY`.
    let state = newRun();
    for (let i = 1; i <= MAX_PARTY; i++) {
      const result = applyIntent(
        state,
        { playerId: `p_${i}`, intent: { ...CREATE_UNICORN, name: `Hero ${i}` } },
        ctx(),
      );
      expect(result.error, `player ${i} should fit`).toBeUndefined();
      state = result.state;
    }
    expect(state.party).toHaveLength(MAX_PARTY);

    const overflow = applyIntent(
      state,
      { playerId: "p_5", intent: { ...CREATE_UNICORN, name: "One Too Many" } },
      ctx(),
    );
    expect(overflow.error?.code).toBe("ILLEGAL");
    expect(overflow.state.party).toHaveLength(MAX_PARTY);
  });

  it("frees the seat of somebody the host took out, and fights with the table that is left (#389)", () => {
    const context = ctx({ rng: fixedRng(20) });
    let state = newRun();
    for (let i = 1; i <= MAX_PARTY; i++) {
      state = applyIntent(state, { playerId: `p_${i}`, intent: { ...CREATE_UNICORN, name: `Hero ${i}` } }, context).state;
    }
    // Taken out the way remove.ts does it: still in `party`, away, on `removed`.
    state = {
      ...state,
      removed: ["p_4"],
      party: state.party.map((m) => (m.playerId === "p_4" ? { ...m, connected: false, ready: false } : m)),
    };

    const joined = applyIntent(state, { playerId: "p_5", intent: { ...CREATE_UNICORN, name: "Hero 5" } }, context);
    expect(joined.error).toBeUndefined();
    expect(joined.state.party).toHaveLength(MAX_PARTY + 1);

    const sixth = applyIntent(joined.state, { playerId: "p_6", intent: { ...CREATE_UNICORN, name: "Hero 6" } }, context);
    expect(sixth.error).toEqual({ code: "ILLEGAL", message: TABLE_FULL_MESSAGE });

    // Five in `party` and four spawn tiles: the fight places the four still in the game.
    let fight = walk(
      joined.state,
      [
        ...["p_1", "p_2", "p_3", "p_5"].map((playerId) => ({ playerId, intent: { type: "READY", ready: true } as ClientIntent })),
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
      ],
      context,
    ).state;
    fight = enterScene(fight, "encounter_wisps", context).state;
    for (const playerId of ["p_1", "p_2", "p_3", "p_5"]) {
      fight = applyIntent(fight, { playerId, intent: { type: "READY", ready: true } }, context).state;
    }
    expect(fight.encounter).not.toBeNull();
    const placed = fight.encounter!.combatants.filter((c) => c.side === "party").map((c) => c.name);
    expect(placed).toEqual(["Hero 1", "Hero 2", "Hero 3", "Hero 5"]);
  });

  it("gives and takes the table's items among the seated, never somebody taken out (#389)", () => {
    const context = ctx();
    let state = newRun();
    for (let i = 1; i <= MAX_PARTY; i++) {
      state = applyIntent(state, { playerId: `p_${i}`, intent: { ...CREATE_UNICORN, name: `Hero ${i}` } }, context).state;
    }
    // p_1 is first in `party` and taken out; p_5 sat down in the seat it freed.
    state = {
      ...state,
      removed: ["p_1"],
      party: state.party.map((m) => (m.playerId === "p_1" ? { ...m, connected: false } : m)),
    };
    state = applyIntent(state, { playerId: "p_5", intent: { ...CREATE_UNICORN, name: "Hero 5" } }, context).state;
    const bag = (s: RunState, playerId: string) =>
      s.party.find((m) => m.playerId === playerId)!.character.inventory.map((e) => e.itemId);

    const granted = applyEffects(state, [{ type: "grantItem", itemId: "river_charm", to: "party" }], context);
    expect(bag(granted, "p_1")).not.toContain("river_charm");
    expect(bag(granted, "p_2")).toContain("river_charm");

    // A removed hero's bag neither opens a gate nor pays for one.
    const theirs = applyEffects(state, [{ type: "grantItem", itemId: "river_charm", to: "p_1" }], context);
    const chapter = makeChapter();
    const shrine = chapter.scenes["scene_shrine"] as StoryScene;
    shrine.choices = [...shrine.choices, { id: "charm", label: "Use the charm", icon: "star", goto: "scene_camp", requiresItem: "river_charm" }];
    const at = (s: RunState) => currentChoices({ ...s, sceneId: "scene_shrine" }, chapter).map((c) => c.id);
    expect(at(theirs)).not.toContain("charm");
    expect(at(granted)).toContain("charm");
    const taken = applyEffects(theirs, [{ type: "takeItem", itemId: "river_charm" }], context);
    expect(bag(taken, "p_1")).toContain("river_charm");
  });

  /** A one-scene chapter, so the check prompt can be reached in one step. */
  function chapterOf(entry: Scene & { type: "check" }): Chapter {
    return { ...makeChapter(), entry: "only", scenes: { only: entry } } as Chapter;
  }

  /** Ready the party, override its state, then walk into `chapter`. */
  function enter(chapter: Chapter, patch: (state: RunState) => RunState): RunState {
    const ready = patch(seatedParty());
    const result = applyIntent(
      ready,
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: chapter.id } },
      ctx({ chapter }),
    );
    if (result.error) throw new Error(`START_CHAPTER rejected: ${result.error.message}`);
    return result.state;
  }

  it("gives a party grant to somebody with room, not to the first full bag", () => {
    /*
     * `preferredHolder` exists to answer "who gets it" without a prompt, and
     * its whole content is "the first character with room". Handing it to a
     * full bag is not a crash — it falls through to the swap prompt — so it
     * reads as working while asking a child to drop something to make room
     * that the player beside her already had.
     */
    const seated = seatedPartyNotReady();
    const stuffed: RunState = {
      ...seated,
      party: seated.party.map((m, i) =>
        i === 0
          ? {
              ...m,
              character: {
                ...m.character,
                inventory: Array.from({ length: INVENTORY_SLOTS }, () => ({
                  itemId: "pebble",
                  kind: "trinket" as const,
                })),
              },
            }
          : m,
      ),
    };

    const after = applyEffects(stuffed, [{ type: "grantItem", itemId: "acorn", to: "party" }], ctx());

    expect(after.party[0]!.character.inventory).toHaveLength(INVENTORY_SLOTS);
    expect(after.party[1]!.character.inventory.map((e) => e.itemId)).toContain("acorn");
  });

  it("does not lift a knocked-down character on a heal that heals nothing", () => {
    /*
     * `hp === 0` and `down` are two spellings of one fact (`damage` sets them
     * together), and a heal of nothing must not split them — a figure standing
     * at 0 HP is a state no other rule knows how to read. The existing lift
     * test heals for 3, which lands on the same side of `hp > 0` either way.
     */
    const seated = seatedPartyNotReady();
    const floored: RunState = {
      ...seated,
      party: seated.party.map((m, i) => (i === 0 ? { ...m, hp: 0, down: true } : m)),
    };

    const nothing = applyEffects(floored, [{ type: "heal", amount: 0 }], ctx());
    expect(nothing.party[0]!.hp).toBe(0);
    expect(nothing.party[0]!.down).toBe(true);

    // And the lift still happens when there is something to lift with.
    expect(applyEffects(floored, [{ type: "heal", amount: 3 }], ctx()).party[0]!.down).toBe(false);
  });

  it("nominates the first of two equally good rollers, every time", () => {
    /*
     * Determinism, not fairness. Every device replays this to decide who is
     * being asked, so "whoever the reduce happened to keep" has to be a rule
     * rather than an accident — `>` keeps the first of a tie, `>=` would keep
     * the last, and both look right until two characters have the same stat.
     */
    const check = chapterOf({
      type: "check",
      stat: "clever",
      tn: 12,
      prompt: "Read the runes",
      roller: "best",
      onSuccess: { goto: "only" },
      onFailure: { goto: "only" },
    } as unknown as Scene & { type: "check" });

    const level = (state: RunState): RunState => ({
      ...state,
      party: state.party.map((m) => ({
        ...m,
        character: { ...m.character, stats: { might: 2, quick: 2, clever: 3, heart: 3 } },
      })),
    });

    const forward = enter(check, level);
    const backward = enter(check, (s) => {
      const l = level(s);
      return { ...l, party: [...l.party].reverse() };
    });

    const rollerOf = (state: RunState): string | undefined =>
      state.prompt?.kind === "roll" ? state.prompt.characterId : undefined;

    // The answer follows party order, and party order alone.
    expect(rollerOf(forward)).toBe(forward.party[0]!.character.id);
    expect(rollerOf(backward)).toBe(backward.party[0]!.character.id);
    expect(rollerOf(forward)).not.toBe(rollerOf(backward));
  });

  it("does not call an empty party wiped", () => {
    // `isPartyDown` is `every()`, which is true of nothing at all — so the
    // length guard is the whole rule. Without it a lobby with no characters
    // yet reads as a party that has just been knocked down.
    expect(isPartyDown({ ...newRun(), party: [] })).toBe(false);
    expect(isPartyDown(seatedPartyNotReady())).toBe(false);

    const allDown = seatedPartyNotReady();
    expect(
      isPartyDown({ ...allDown, party: allDown.party.map((m) => ({ ...m, hp: 0, down: true })) }),
    ).toBe(true);
  });
});

describe("createRunState", () => {
  it("starts in the lobby with nothing decided", () => {
    const state = newRun();
    expect(state).toMatchObject({
      phase: "lobby",
      seq: 0,
      party: [],
      prompt: null,
      sceneId: null,
      xpEarned: 0,
    });
  });
});

describe("CREATE_CHARACTER", () => {
  it("refuses a blocked hero name with a kid-friendly sentence, and seats nobody", () => {
    const result = applyIntent(
      newRun(),
      { playerId: "p_1", intent: { ...CREATE_UNICORN, name: "Poopface" } },
      ctx(),
    );
    expect(result.error).toMatchObject({ code: "ILLEGAL", message: "Hmm, let's pick another one!" });
    expect(result.state.party).toHaveLength(0);
  });

  it("seats a resolved character at full HP", () => {
    const state = seatedParty();
    expect(state.phase).toBe("creation");
    expect(state.party).toHaveLength(2);
    const unicorn = state.party[0]!;
    expect(unicorn.character.name).toBe("Sparklehoof");
    expect(unicorn.character.stats.heart).toBe(5); // 1 base + 3 assigned + 1 species
    expect(unicorn.hp).toBe(unicorn.character.maxHp);
    expect(unicorn.down).toBe(false);
  });

  it("assigns each character its own colors, whatever the phone sent", () => {
    // Both intents send the same APPEARANCE; the table picks instead, and
    // never the same pair twice.
    const state = seatedParty();
    const [first, second] = state.party.map((member) => member.character.appearance);
    expect(first?.accent).not.toBe(second?.accent);
    for (const appearance of [first, second]) {
      expect(PLAYER_COLORS.map((colors) => colors.accent)).toContain(appearance?.accent);
    }
  });

  it("hands the persistence layer the unresolved character", () => {
    /*
     * `state.party` holds the *resolved* view, whose stats already include the
     * species passive. Storing that as `committed` and resolving again applies
     * the passive twice — a unicorn permanently a point of Heart up, with
     * nothing on screen to say so. So the engine publishes the real character
     * beside the state, and this is the assertion that keeps them apart.
     */
    const result = applyIntent(newRun(), { playerId: "p_1", intent: CREATE_UNICORN }, ctx());

    expect(result.created?.committed.stats.heart).toBe(4); // 1 base + 3 assigned
    expect(result.state.party[0]?.character.stats.heart).toBe(5); // + 1 species
  });

  it("gives characters from different runs different ids", () => {
    // `c_<playerId>` alone repeats for every character a player ever makes, so
    // a second hero in a later campaign collided with the first: the store
    // skipped the write, and chapter completion swapped the old one back in.
    const first = applyIntent(newRun(), { playerId: "p_1", intent: CREATE_UNICORN }, ctx());
    const second = applyIntent(
      { ...newRun(), runId: "r_2" },
      { playerId: "p_1", intent: CREATE_UNICORN },
      ctx(),
    );

    expect(first.created?.id).not.toBe(second.created?.id);
  });

  it("refuses a starting level above the party's own tier floor", () => {
    /*
     * `startingLevel` arrives from a phone and buys levels, actions and stat
     * points outright (spec §8.4). `newCharacter` only knows the tier floors
     * the rules define, so without this check a hand-written client in a
     * level-1 party could ask for 10 and be seated at Mythic.
     */
    const result = applyIntent(
      seatedParty(),
      { playerId: "p_3", intent: { ...CREATE_GRIFFIN, startingLevel: 10 } as ClientIntent },
      ctx(),
    );

    expect(result.error?.code).toBe("ILLEGAL");
    expect(result.error?.message).toMatch(/tier floor/);
  });

  it("allows joining at level 1 alongside a level-1 party", () => {
    const result = applyIntent(
      seatedParty(),
      { playerId: "p_3", intent: { ...CREATE_GRIFFIN, startingLevel: 1 } as ClientIntent },
      ctx(),
    );

    expect(result.error).toBeUndefined();
    expect(result.created?.committed.level).toBe(1);
  });

  it("caps the join tier on committed progress, not gains still in flight", () => {
    /*
     * Found in review. The effective level includes a campaign's provisional
     * gains, so a party that had *just* crossed into Sworn mid-campaign would
     * let a newcomer join at 4 — written straight into their own committed
     * snapshot. The campaign then fails, the veterans revert to 3, and the
     * newcomer keeps a tier nobody actually earned.
     */
    const state = seatedParty();
    // The party has reached Sworn, but only provisionally.
    for (const member of state.party) {
      member.character = { ...member.character, level: 4, committedLevel: 1 };
    }

    const result = applyIntent(
      state,
      { playerId: "p_3", intent: { ...CREATE_GRIFFIN, startingLevel: 4 } as ClientIntent },
      ctx(),
    );

    expect(result.error?.code).toBe("ILLEGAL");
    expect(result.error?.message).toMatch(/tier floor/);
  });

  it("returns ILLEGAL instead of throwing on a bad creation payload", () => {
    const result = applyIntent(
      newRun(),
      {
        playerId: "p_1",
        intent: { ...CREATE_UNICORN, stats: { might: 9, quick: 0, clever: 0, heart: 0 } } as ClientIntent,
      },
      ctx(),
    );
    expect(result.error).toMatchObject({ code: "ILLEGAL" });
    expect(result.error?.message).toMatch(/exactly 3 creation points/);
    expect(result.state.party).toHaveLength(0);
  });

  it("refuses a second character for the same player", () => {
    const state = seatedParty();
    const result = applyIntent(state, { playerId: "p_1", intent: CREATE_GRIFFIN }, ctx());
    expect(result.error?.code).toBe("ILLEGAL");
  });
});

describe("SEAT_CHARACTER (spec §5: a character is reused across campaigns)", () => {
  /** A hero this player made in an earlier run, as the household stores it. */
  function savedHero(overrides: Partial<Character> = {}): Character {
    return {
      ...newCharacter({
        id: "c_r_old_p_1",
        householdId: "h_1",
        ownerPlayerId: "p_1",
        name: "Sparklehoof",
        species: "unicorn",
        class: "songkeeper",
        stats: { might: 0, quick: 0, clever: 0, heart: 3 },
        appearance: APPEARANCE,
        startingLevel: 4,
        rules,
        now: "2026-07-01T12:00:00.000Z",
      }),
      ...overrides,
    };
  }

  const seat = (characterId = "c_r_old_p_1"): ClientIntent => ({ type: "SEAT_CHARACTER", characterId });

  it("seats the saved hero as they are, at full HP, and writes nothing", () => {
    const hero = savedHero();
    const result = applyIntent(newRun(), { playerId: "p_1", intent: seat() }, ctx({ savedCharacter: hero }));

    expect(result.error).toBeUndefined();
    expect(result.state.phase).toBe("creation");
    const member = result.state.party[0]!;
    expect(member.playerId).toBe("p_1");
    expect(member.character.id).toBe(hero.id);
    // Their level came with them — the whole point of bringing them.
    expect(member.character.level).toBe(4);
    expect(member.hp).toBe(member.character.maxHp);
    // The row already exists; a create here would be a second copy.
    expect(result.created).toBeUndefined();
  });

  it("refuses a hero that is not in this household", () => {
    const result = applyIntent(newRun(), { playerId: "p_1", intent: seat() }, ctx({ savedCharacter: null }));
    expect(result.error?.code).toBe("NOT_FOUND");

    const elsewhere = applyIntent(
      newRun(),
      { playerId: "p_1", intent: seat() },
      ctx({ savedCharacter: savedHero({ householdId: "h_other" }) }),
    );
    expect(elsewhere.error?.code).toBe("NOT_FOUND");
  });

  it("refuses somebody else's hero", () => {
    const result = applyIntent(newRun(), { playerId: "p_2", intent: seat() }, ctx({ savedCharacter: savedHero() }));
    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("refuses a second seat, and a hero who is already at the table", () => {
    const context = ctx({ savedCharacter: savedHero() });
    const seated = applyIntent(newRun(), { playerId: "p_1", intent: seat() }, context).state;

    const again = applyIntent(seated, { playerId: "p_1", intent: seat() }, context);
    expect(again.error?.code).toBe("ILLEGAL");

    // Same row, a different seat: one hero cannot be at the table twice.
    const twice = applyIntent(
      seated,
      { playerId: "p_2", intent: seat() },
      ctx({ savedCharacter: savedHero({ ownerPlayerId: "p_2" }) }),
    );
    expect(twice.error?.code).toBe("ILLEGAL");
  });

  it("refuses a seat at a full table", () => {
    let state = newRun();
    for (let i = 0; i < MAX_PARTY; i++) {
      state = applyIntent(state, { playerId: `p_x${i}`, intent: CREATE_UNICORN }, ctx()).state;
    }
    const result = applyIntent(state, { playerId: "p_1", intent: seat() }, ctx({ savedCharacter: savedHero() }));
    expect(result.error?.code).toBe("ILLEGAL");
  });
});

describe("errors, never throws", () => {
  it("rejects a stale intent", () => {
    const state = seatedParty();
    const result = applyIntent(state, { playerId: "p_1", intent: { type: "ROLL" }, seq: 0 }, ctx());
    expect(result.error?.code).toBe("STALE_SEQ");
    expect(result.state).toBe(state);
  });

  it("rejects a choice when nothing is waiting on one", () => {
    const result = applyIntent(
      seatedParty(),
      { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
      ctx(),
    );
    expect(result.error?.code).toBe("ILLEGAL");
  });

  it("rejects a chapter that isn't loaded", () => {
    const result = applyIntent(
      seatedParty(),
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "frostpeak-09" } },
      ctx(),
    );
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("leaves the state untouched when an intent is rejected", () => {
    const state = seatedParty();
    const before = JSON.parse(JSON.stringify(state)) as RunState;
    applyIntent(state, { playerId: "p_9", intent: { type: "READY", ready: true } }, ctx());
    expect(state).toEqual(before);
  });

  it("bumps seq only on success", () => {
    const state = seatedParty();
    const ok = applyIntent(state, { playerId: "p_1", intent: { type: "READY", ready: true } }, ctx());
    expect(ok.state.seq).toBe(state.seq + 1);
    const bad = applyIntent(state, { playerId: "p_9", intent: { type: "READY", ready: true } }, ctx());
    expect(bad.state.seq).toBe(state.seq);
  });
});

describe("START_CHAPTER", () => {
  it("enters the entry scene and opens its choice prompt", () => {
    const context = ctx();
    const result = applyIntent(
      seatedParty(context),
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
      context,
    );
    expect(result.error).toBeUndefined();
    expect(result.presentation).toEqual({
      kind: "SCENE_ENTER",
      sceneId: "scene_clearing",
      art: "bg/bramblewood/clearing",
    });
    expect(result.state).toMatchObject({
      phase: "scene",
      chapterId: "bramblewood-01",
      // The name and number the table knows it by, for the shared screen.
      chapterInfo: { index: 1, title: "The Rustling Path" },
      campaignId: "the-hollow-crown",
      sceneId: "scene_clearing",
      sceneType: "story",
      narration: "A wall of thorns twice your height.",
      art: "bg/bramblewood/clearing",
    });
    expect(result.state.prompt).toMatchObject({ kind: "choice", vote: false });
  });

  it("refuses to start with nobody in the party", () => {
    const result = applyIntent(
      newRun(),
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
      ctx(),
    );
    expect(result.error?.code).toBe("ILLEGAL");
  });
});

describe("species gating at the prompt (architecture §5)", () => {
  const started = (context: EngineContext, party: { playerId: string; intent: ClientIntent }[]) =>
    walk(
      newRun(),
      [
        ...party,
        // The server requires the readiness the lobby shows before it starts.
        ...party.map((seat) => ({
          playerId: seat.playerId,
          intent: { type: "READY", ready: true } as ClientIntent,
        })),
        { playerId: party[0]!.playerId, intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
      ],
      context,
    ).state;

  it("hides the flying choice from an all-unicorn party", () => {
    const context = ctx();
    const state = started(context, [{ playerId: "p_1", intent: CREATE_UNICORN }]);
    const prompt = state.prompt;
    expect(prompt?.kind).toBe("choice");
    if (prompt?.kind !== "choice") return;
    expect(prompt.options.map((o) => o.id)).toEqual(["squeeze"]);
    expect(currentChoices(state, makeChapter()).map((c) => c.id)).toEqual(["squeeze"]);
  });

  it("shows it once a griffin is at the table", () => {
    const context = ctx();
    const state = started(context, [
      { playerId: "p_1", intent: CREATE_UNICORN },
      { playerId: "p_2", intent: CREATE_GRIFFIN },
    ]);
    const prompt = state.prompt;
    if (prompt?.kind !== "choice") throw new Error("expected a choice prompt");
    expect(prompt.options.map((o) => o.id)).toEqual(["squeeze", "over"]);
  });

  it("rejects a hidden choice even if a client asks for it", () => {
    const context = ctx();
    const state = started(context, [{ playerId: "p_1", intent: CREATE_UNICORN }]);
    const result = applyIntent(state, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "over" } }, context);
    expect(result.error?.code).toBe("ILLEGAL");
  });

  it("refuses a `when`-hidden choice exactly as it refuses a requiresItem-hidden one (#158)", () => {
    const chapter = makeChapter();
    const clearing = chapter.scenes["scene_clearing"] as StoryScene;
    clearing.choices = [
      ...clearing.choices,
      { id: "by_key", label: "Use the key", icon: "key", goto: "scene_shrine", requiresItem: "rusted_key" },
      {
        id: "by_facets",
        label: "Set the stones",
        icon: "gem",
        goto: "scene_shrine",
        when: { count: { of: "facet_*", min: 2 } },
      },
    ];
    const context = ctx({ chapter });
    const state = started(context, [{ playerId: "p_1", intent: CREATE_UNICORN }]);
    if (state.prompt?.kind !== "choice") throw new Error("expected a choice prompt");
    // Hidden, not disabled: neither is offered at all.
    expect(state.prompt.options.map((o) => o.id)).toEqual(["squeeze"]);
    expect(currentChoices(state, chapter).map((c) => c.id)).toEqual(["squeeze"]);

    const choose = (choiceId: string) =>
      applyIntent(state, { playerId: "p_1", intent: { type: "CHOOSE", choiceId } }, context);
    const byItem = choose("by_key");
    const byWhen = choose("by_facets");
    expect(byItem.error?.code).toBe("ILLEGAL");
    expect(byWhen.error?.code).toBe(byItem.error?.code);
    expect(byWhen.error?.message).toBe(byItem.error?.message.replace("by_key", "by_facets"));
    expect(byWhen.state).toEqual(state);
  });
});

describe("story turns (spec §6.1)", () => {
  function atFirstStory(context: EngineContext): RunState {
    return walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;
  }

  function withConnected(state: RunState, playerId: string, connected: boolean): RunState {
    return {
      ...state,
      party: state.party.map((m) => (m.playerId === playerId ? { ...m, connected } : m)),
    };
  }

  it("puts a story choice to one player, and nobody else may take it", () => {
    const context = ctx();
    const state = atFirstStory(context);
    expect(state.prompt).toMatchObject({ kind: "choice", vote: false, forPlayerIds: ["p_1"] });

    const jumped = applyIntent(state, { playerId: "p_2", intent: { type: "CHOOSE", choiceId: "squeeze" } }, context);
    expect(jumped.error?.code).toBe("FORBIDDEN");
  });

  it("keeps a beat on its owner, and passes the spotlight after its last moment", () => {
    const chapter = chapterWithForkedShrine();
    // An ordinary check, the beat's owner's to roll (the fixture's goes to the best at it).
    chapter.scenes["check_squeeze"] = { ...chapter.scenes["check_squeeze"]!, roller: "party" } as Scene;
    const context = ctx({ rng: fixedRng(20), chapter });
    const state = atFirstStory(context);
    const taken = applyIntent(state, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } }, context);
    expect(taken.error).toBeUndefined();
    expect(storyTurnHolder(taken.state)?.playerId).toBe("p_1");
    expect(taken.state.spotlightMoments).toBe(1);

    // The check is the owner's to roll, and the next decision is theirs too.
    const owner = taken.state.party[0]!.character.id;
    expect(taken.state.prompt).toMatchObject({ kind: "roll", characterId: owner });
    const rolled = applyIntent(taken.state, { playerId: "p_1", intent: { type: "ROLL" } }, context).state;
    expect(rolled.spotlightMoments).toBe(2);
    expect(rolled.prompt).toMatchObject({ kind: "choice", forPlayerIds: ["p_1"] });
    // The third moment is the beat's last: the spotlight passes to p_2.
    expect(SPOTLIGHT_BEAT).toBe(3);
    const second = applyIntent(rolled, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } }, context);
    expect(second.error).toBeUndefined();
    expect(storyTurnHolder(second.state)?.playerId).toBe("p_2");
    expect(second.state.spotlightMoments).toBe(0);
  });

  it("ends a beat early at a scene that starts a new one, once its owner has had a moment", () => {
    const chapter = chapterWithForkedShrine();
    chapter.scenes["check_squeeze"] = { ...chapter.scenes["check_squeeze"]!, spotlight: "next" } as Scene;
    const context = ctx({ rng: fixedRng(20), chapter });
    const taken = applyIntent(atFirstStory(context), { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } }, context);
    // p_1 has had their moment, so the check opens on p_2's beat.
    expect(storyTurnHolder(taken.state)?.playerId).toBe("p_2");
    expect(taken.state.prompt).toMatchObject({ kind: "roll", characterId: taken.state.party[1]!.character.id });

    // A beat nobody has had a moment of yet is not cut short.
    const fresh = enterScene(taken.state, "check_squeeze", context).state;
    expect(storyTurnHolder(fresh)?.playerId).toBe("p_2");
  });

  it("keeps the turn where it is on a beat with only one way on", () => {
    const context = ctx({ rng: fixedRng(20) });
    const state = atFirstStory(context);
    const taken = applyIntent(state, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } }, context);
    // The fixture's check goes to whoever is best at it, which is nobody's moment.
    const rolled = applyIntent(taken.state, { playerId: "p_2", intent: { type: "ROLL" } }, context).state;
    expect(rolled.spotlightMoments).toBe(1);
    // The shrine offers only "Take the path east": p_1 reads on, and it is
    // not a moment of their beat either.
    expect(rolled.prompt).toMatchObject({ kind: "choice", forPlayerIds: ["p_1"] });
    const onward = applyIntent(rolled, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } }, context);
    expect(onward.error).toBeUndefined();
    expect(storyTurnHolder(onward.state)?.playerId).toBe("p_1");
    expect(onward.state.spotlightMoments).toBe(1);
  });

  it("counts only the options the party can see when deciding if a beat is a decision", () => {
    // The clearing has two ways out, but "Go over it" needs wings. Without a
    // griffin or dragonling at the table it is a one-way beat.
    const context = ctx();
    const grounded = walk(
      newRun(),
      [
        { playerId: "p_1", intent: CREATE_UNICORN },
        { playerId: "p_2", intent: { ...CREATE_UNICORN, name: "Second" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
        { playerId: "p_2", intent: { type: "READY", ready: true } },
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
      ],
      context,
    ).state;
    expect(grounded.prompt).toMatchObject({ kind: "choice", forPlayerIds: ["p_1"] });
    const taken = applyIntent(grounded, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } }, context);
    expect(taken.error).toBeUndefined();
    expect(storyTurnHolder(taken.state)?.playerId).toBe("p_1");
  });

  it("skips a seat whose phone has dropped when the turn comes round", () => {
    const context = ctx();
    const state = withConnected(atFirstStory(context), "p_1", false);
    // Re-open the same scene with p_1 away: the turn goes to the next seat.
    const reopened = enterScene(state, state.sceneId!, context).state;
    expect(reopened.prompt).toMatchObject({ kind: "choice", forPlayerIds: ["p_2"] });
  });

  it("lets anyone stand in when the turn holder drops mid-choice", () => {
    const context = ctx();
    // The prompt named p_1, then p_1's phone died before they tapped.
    const state = withConnected(atFirstStory(context), "p_1", false);
    expect(state.prompt).toMatchObject({ forPlayerIds: ["p_1"] });

    const stoodIn = applyIntent(state, { playerId: "p_2", intent: { type: "CHOOSE", choiceId: "squeeze" } }, context);
    expect(stoodIn.error).toBeUndefined();
    // The stand-in spends the owner's moment, not one of their own: the beat
    // is still p_1's when they are back.
    expect(stoodIn.state.storyTurn ?? 0).toBe(0);
    expect(stoodIn.state.spotlightMoments).toBe(1);
  });

  it("leaves a rest scene's way out open to anyone", () => {
    const context = ctx({ rng: fixedRng(20) });
    const atCamp = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
        { playerId: "p_2", intent: { type: "READY", ready: true } },
      ],
      context,
    ).state;
    expect(atCamp.sceneType).toBe("rest");
    expect(atCamp.prompt).toMatchObject({ kind: "choice", forPlayerIds: [] });
  });
});

describe("checks", () => {
  function atCheck(context: EngineContext): RunState {
    return walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
      ],
      context,
    ).state;
  }

  it("nominates the best roller when nobody has rolled yet, and opens a roll prompt", () => {
    const state = atCheck(ctx());
    expect(state.phase).toBe("check");
    expect(state.prompt).toMatchObject({
      kind: "roll",
      stat: "quick",
      tn: 12,
      // Windstep the griffin duskrunner: 1 base + 3 assigned + 1 species = 5 Quick.
      // Read off the party rather than spelled out: character ids are scoped to
      // the run (see doCreateCharacter), and what this test cares about is
      // *which* character was nominated, not how ids are built.
      characterId: state.party[1]!.character.id,
    });
  });

  it("passes the die to whoever has rolled the fewest checks", () => {
    // The griffin's 5 Quick would win this check on stat alone. Once they have
    // had a turn, the shared check goes round to the unicorn instead. The
    // fixture pins this check to "best", so it is reopened as the default.
    const chapter = makeChapter();
    chapter.scenes["check_squeeze"] = { ...chapter.scenes["check_squeeze"]!, roller: "party" } as Scene;
    const context = ctx({ chapter });
    const started = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;
    const griffin = started.party[1]!.character.id;
    const unicorn = started.party[0]!.character.id;
    const atCheck = walk(
      { ...started, checkRolls: { [griffin]: 1 } },
      [{ playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } }],
      context,
    ).state;
    expect(atCheck.prompt).toMatchObject({ kind: "roll", characterId: unicorn });
  });

  it("counts each roll toward the roller's turn", () => {
    const context = ctx({ rng: fixedRng(20) });
    const result = applyIntent(atCheck(context), { playerId: "p_2", intent: { type: "ROLL" } }, context);
    expect(result.state.checkRolls).toEqual({ [result.state.party[1]!.character.id]: 1 });
  });

  it("never nominates a player whose phone has dropped", () => {
    const context = ctx();
    const started = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;
    const griffinAway = {
      ...started,
      party: started.party.map((m) => (m.playerId === "p_2" ? { ...m, connected: false } : m)),
    };
    const state = walk(
      griffinAway,
      [{ playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } }],
      context,
    ).state;
    expect(state.prompt).toMatchObject({ kind: "roll", characterId: state.party[0]!.character.id });
  });

  it("lets anyone roll, as themselves, once the nominee's phone drops", () => {
    const context = ctx({ rng: fixedRng(20) });
    const before = atCheck(context);
    const dropped = {
      ...before,
      party: before.party.map((m) => (m.playerId === "p_2" ? { ...m, connected: false } : m)),
    };
    const result = applyIntent(dropped, { playerId: "p_1", intent: { type: "ROLL" } }, context);
    expect(result.error).toBeUndefined();
    expect(result.state.lastRoll?.characterId).toBe(dropped.party[0]!.character.id);
  });

  it("adds a helper's die to the roll, sized by the helper's tier", () => {
    // Every draw is 0.451: a 10 on the d20, and floor(0.451 * 4) + 1 = 2 on the d4.
    const context = ctx({ rng: fixedRng(10) });
    const helped = applyIntent(atCheck(context), { playerId: "p_1", intent: { type: "HELP" } }, context);
    expect(helped.error).toBeUndefined();
    const unicorn = helped.state.party[0]!.character.id;
    expect(helped.state.prompt).toMatchObject({ kind: "roll", helper: { characterId: unicorn, sides: 4 } });
    const rolled = applyIntent(helped.state, { playerId: "p_2", intent: { type: "ROLL" } }, context);
    expect(rolled.state.lastRoll).toMatchObject({
      die: 10,
      mod: 5,
      help: { characterId: unicorn, sides: 4, value: 2 },
      total: 17,
    });
  });

  it("refuses help from the roller, a second helper, or one who has helped since the last rest", () => {
    const context = ctx();
    const state = atCheck(context);
    expect(applyIntent(state, { playerId: "p_2", intent: { type: "HELP" } }, context).error?.code).toBe("ILLEGAL");
    const helped = applyIntent(state, { playerId: "p_1", intent: { type: "HELP" } }, context).state;
    expect(applyIntent(helped, { playerId: "p_1", intent: { type: "HELP" } }, context).error?.code).toBe("ILLEGAL");
    const unicorn = state.party[0]!.character.id;
    const spent = { ...state, helpSpent: [unicorn] };
    expect(applyIntent(spent, { playerId: "p_1", intent: { type: "HELP" } }, context).error?.code).toBe("ILLEGAL");
  });

  it("recharges help at a rest", () => {
    const context = ctx({ rng: fixedRng(20) });
    const unicorn = atCheck(context).party[0]!.character.id;
    const atCamp = walk(
      { ...atCheck(context), helpSpent: [unicorn] },
      [
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
        { playerId: "p_2", intent: { type: "READY", ready: true } },
      ],
      context,
    ).state;
    expect(atCamp.sceneType).toBe("rest");
    expect(atCamp.helpSpent).toEqual([]);
  });

  it("only the nominated character's player may roll", () => {
    const context = ctx();
    const state = atCheck(context);
    const wrong = applyIntent(state, { playerId: "p_1", intent: { type: "ROLL" } }, context);
    expect(wrong.error?.code).toBe("FORBIDDEN");
  });

  it("takes onSuccess on a high roll, granting the item to the roller", () => {
    const context = ctx({ rng: fixedRng(20) });
    const result = applyIntent(atCheck(context), { playerId: "p_2", intent: { type: "ROLL" } }, context);
    expect(result.presentation).toMatchObject({ kind: "ROLL" });
    expect(result.state.lastRoll).toMatchObject({ die: 20, mod: 5, total: 25, tn: 12, result: "success" });
    expect(result.state.sceneId).toBe("scene_shrine");
    const roller = result.state.party.find((m) => m.playerId === "p_2")!;
    expect(roller.character.inventory.map((e) => e.itemId)).toEqual(["sunbloom_draught"]);
  });

  it("takes onFailure on a low roll, damaging the roller and showing the branch line", () => {
    const context = ctx({ rng: fixedRng(1) });
    const before = atCheck(context);
    const hpBefore = before.party.map((m) => m.hp);
    const result = applyIntent(before, { playerId: "p_2", intent: { type: "ROLL" } }, context);
    expect(result.state.lastRoll?.result).toBe("failure");
    expect(result.state.sceneId).toBe("scene_scratched");
    expect(result.state.narration).toContain("the thorns take their toll");
    expect(result.state.narration).toContain("Scratched, but through.");
    const [unicorn, griffin] = result.state.party;
    // `to` was omitted, and there was a roller — so only the roller took it.
    expect(unicorn!.hp).toBe(hpBefore[0]);
    expect(griffin!.hp).toBe(hpBefore[1]! - 1);
  });
});

describe("whole-party checks", () => {
  function groupCtx(rng: Rng): EngineContext {
    const chapter = makeChapter();
    chapter.scenes["check_squeeze"] = { ...chapter.scenes["check_squeeze"]!, roller: "all" } as Scene;
    return ctx({ chapter, rng });
  }
  function atGroupCheck(context: EngineContext): RunState {
    return walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
      ],
      context,
    ).state;
  }

  it("waits for everyone, then succeeds when half or more make it", () => {
    const context = groupCtx(fixedRng(20));
    const start = atGroupCheck(context);
    const [unicorn, griffin] = start.party.map((m) => m.character.id);
    expect(start.prompt).toMatchObject({ kind: "roll", group: { pending: [unicorn, griffin], rolls: [] } });

    const first = applyIntent(start, { playerId: "p_1", intent: { type: "ROLL" } }, context);
    expect(first.presentation).toMatchObject({ kind: "ROLL" });
    expect(first.state.prompt).toMatchObject({ kind: "roll", characterId: griffin, group: { pending: [griffin] } });
    expect(applyIntent(first.state, { playerId: "p_1", intent: { type: "ROLL" } }, context).error?.code).toBe(
      "ILLEGAL",
    );

    const last = applyIntent(first.state, { playerId: "p_2", intent: { type: "ROLL" } }, context);
    expect(last.state.lastRoll?.group).toEqual({ made: 2, of: 2, result: "success" });
    expect(last.state.sceneId).toBe("scene_shrine");
  });

  it("fails when fewer than half make it", () => {
    const context = groupCtx(fixedRng(1));
    const done = walk(
      atGroupCheck(context),
      [
        { playerId: "p_1", intent: { type: "ROLL" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
      ],
      context,
    ).state;
    expect(done.lastRoll?.group).toEqual({ made: 0, of: 2, result: "failure" });
    expect(done.sceneId).toBe("scene_scratched");
  });

  it("counts each group die toward the rotation, so whoever sat it out rolls next", () => {
    // A three-seat party: the griffin's phone is away for the group check, so
    // only the unicorn and the third hero roll. Once it reconnects, the next
    // shared check must go to the griffin, who has rolled the fewest.
    const chapter = makeChapter();
    chapter.scenes["check_squeeze"] = { ...chapter.scenes["check_squeeze"]!, roller: "all" } as Scene;
    const context = ctx({ chapter, rng: fixedRng(20) });
    const seated = seatedParty(context);
    const third = {
      ...seated.party[0]!,
      playerId: "p_3",
      character: { ...seated.party[0]!.character, id: `${seated.party[0]!.character.id}_3`, ownerPlayerId: "p_3" },
    };
    const started = walk(
      { ...seated, party: [...seated.party, third] },
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;
    const [unicorn, griffin, other] = started.party.map((m) => m.character.id);
    const griffinAway = {
      ...started,
      party: started.party.map((m) => (m.playerId === "p_2" ? { ...m, connected: false } : m)),
    };
    const done = walk(
      griffinAway,
      [
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_1", intent: { type: "ROLL" } },
        { playerId: "p_3", intent: { type: "ROLL" } },
      ],
      context,
    ).state;
    expect(done.lastRoll?.group).toEqual({ made: 2, of: 2, result: "success" });
    expect(done.checkRolls).toEqual({ [unicorn!]: 1, [other!]: 1 });

    // Back online, and the next shared check comes round while the beat's
    // owner (p_1) is away: the rotation picks, and the griffin is due.
    const back = {
      ...done,
      party: done.party.map((m) =>
        m.playerId === "p_2" ? { ...m, connected: true } : m.playerId === "p_1" ? { ...m, connected: false } : m,
      ),
    };
    const rotating = makeChapter();
    const next = enterScene(back, "check_squeeze", {
      ...ctx({ chapter: rotating }),
      chapter: {
        ...rotating,
        scenes: { ...rotating.scenes, check_squeeze: { ...rotating.scenes["check_squeeze"]!, roller: "party" } as Scene },
      },
    });
    expect(next.state.prompt).toMatchObject({ kind: "roll", characterId: griffin });
  });

  it("refuses help, since everyone is rolling", () => {
    const context = groupCtx(fixedRng(10));
    const result = applyIntent(atGroupCheck(context), { playerId: "p_1", intent: { type: "HELP" } }, context);
    expect(result.error?.code).toBe("ILLEGAL");
  });

  it("lets the table roll for a friend whose phone dropped", () => {
    const context = groupCtx(fixedRng(20));
    const first = applyIntent(atGroupCheck(context), { playerId: "p_1", intent: { type: "ROLL" } }, context).state;
    const dropped = {
      ...first,
      party: first.party.map((m) => (m.playerId === "p_2" ? { ...m, connected: false } : m)),
    };
    const done = applyIntent(dropped, { playerId: "p_1", intent: { type: "ROLL" } }, context);
    expect(done.error).toBeUndefined();
    expect(done.state.lastRoll?.group).toEqual({ made: 2, of: 2, result: "success" });
  });
});

describe("a full walk of a chapter", () => {
  it("a gated encounter resolves through onVictory without raising a board", () => {
    /*
     * The chapter-4 gate (types/chapter.ts `autoResolve`). Combat is engine-
     * complete but the phones have no combat UI yet, so a chapter routed into
     * a fight dead-ended: state advanced, prompt empty, nothing to tap. A
     * scene marked `autoResolve: "victory"` flows through its victory branch
     * — the old placeholder behavior, opt-in per scene and authored in
     * content — with the encounter's narration kept in front of the
     * destination's so the beat still reads.
     */
    const chapter = makeChapter();
    const scene = chapter.scenes["encounter_wisps"];
    if (scene?.type !== "encounter") throw new Error("fixture moved");
    scene.autoResolve = "victory";
    const context = ctx({ rng: fixedRng(20), chapter });

    const result = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
      ],
      context,
    );

    // Straight through to the far side: no ready prompt, no board, and the
    // party never saw a phase it has no UI for.
    expect(result.state.sceneId).toBe("scene_camp");
    expect(result.state.sceneType).toBe("rest");
    expect(result.state.encounter).toBeFalsy();
    expect(result.state.prompt).toMatchObject({ kind: "choice" });
    // The gated scene's narration still reads, ahead of the destination's.
    expect(result.state.narration).toContain("Three wisps rise out of the bracken.");
    expect(result.state.narration).toContain("A hollow out of the wind.");
    // And that lead is the encounter's own authored line, so it has its address.
    expect(result.state.narrationParts?.[0]).toMatchObject({
      address: "bramblewood-01/encounter_wisps/narration",
      line: "Three wisps rise out of the bracken.",
    });
  });

  it("goes entry → check → shrine → encounter → rest → vote → ending", () => {
    const context = ctx({ rng: fixedRng(20) });
    const state = seatedParty(context);

    const result = walk(
      state,
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
      ],
      context,
    );

    // The shrine's onEnter fired: a slot-free quest item and a story flag.
    expect(result.state.flags["found_shrine"]).toBe(true);

    // The encounter waits for the party to ready up before the board goes up.
    expect(result.state.phase).toBe("encounter");
    expect(result.state.prompt).toMatchObject({ kind: "ready" });
    expect(result.state.encounter).toBeFalsy();

    // The board goes up stamped with the step it began on: the fight's
    // identity, which live previews key on (previewContext).
    const p1Ready = applyIntent(result.state, { playerId: "p_1", intent: { type: "READY", ready: true } }, context).state;
    const begun = applyIntent(p1Ready, { playerId: "p_2", intent: { type: "READY", ready: true } }, context).state;
    expect(begun.encounter?.startedAt).toBe(p1Ready.seq);

    // Ready up, and the fight is real — `walk` plays it out (see its comment).
    // ADVANCE used to cross this for free, back when the engine handed out an
    // automatic victory.
    const afterFight = walk(
      result.state,
      [
        { playerId: "p_1", intent: { type: "READY", ready: true } },
        { playerId: "p_2", intent: { type: "READY", ready: true } },
      ],
      context,
    );
    expect(afterFight.state.encounter).toBeFalsy();
    expect(afterFight.state.sceneId).toBe("scene_camp");
    expect(afterFight.state.sceneType).toBe("rest");

    const atRidge = walk(
      afterFight.state,
      [{ playerId: "p_1", intent: { type: "CHOOSE", choiceId: "sleep" } }],
      context,
    ).state;
    expect(atRidge.sceneId).toBe("scene_ridge");

    // choice_point puts it to a vote: the first answer does not settle it.
    const prompt = atRidge.prompt;
    if (prompt?.kind !== "choice") throw new Error("expected a choice prompt");
    expect(prompt.vote).toBe(true);
    expect(prompt.forPlayerIds).toEqual(["p_1", "p_2"]);

    const firstVote = applyIntent(atRidge, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "high" } }, context);
    expect(firstVote.state.sceneId).toBe("scene_ridge");
    expect(firstVote.state.prompt).toMatchObject({ kind: "choice", votes: { p_1: "high" } });

    const secondVote = applyIntent(
      firstVote.state,
      { playerId: "p_2", intent: { type: "CHOOSE", choiceId: "high" } },
      context,
    );

    // The ending scene has no exits, so it completes the chapter.
    expect(secondVote.state.sceneId).toBe("scene_ending");
    expect(secondVote.state.phase).toBe("chapter_complete");
    expect(secondVote.state.prompt).toBeNull();
    expect(secondVote.state.xpEarned).toBe(300);
    // The ending's own page comes first; any seated phone turns it to the tally.
    expect(secondVote.state.endingRead).toBe(false);
    const read = applyIntent(secondVote.state, { playerId: "p_2", intent: { type: "ENDING_READ" } }, context);
    expect(read.error).toBeUndefined();
    expect(read.state.endingRead).toBe(true);
    expect(applyIntent(read.state, { playerId: "p_9", intent: { type: "ENDING_READ" } }, context).error?.code).toBe("FORBIDDEN");
    expect(applyIntent(firstVote.state, { playerId: "p_1", intent: { type: "ENDING_READ" } }, context).error?.code).toBe("ILLEGAL");
    // The fixture's ending declares no outcome, so it is a success and pays in
    // full — the guarantee that every chapter written before spec §8.2 keeps
    // working without being edited.
    expect(secondVote.presentation).toMatchObject({
      kind: "CHAPTER_COMPLETE",
      xp: 300,
      outcome: "success",
    });
    expect(secondVote.state.chapterOutcome).toBe("success");
  });

  it("breaks a tied vote toward whoever holds the story turn (spec §6.1)", () => {
    const context = ctx({ rng: fixedRng(20), chapter: chapterWithForkedShrine() });
    const atRidge = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
        { playerId: "p_2", intent: { type: "READY", ready: true } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "sleep" } },
        { playerId: "p_2", intent: { type: "CHOOSE", choiceId: "low" } },
      ],
      context,
    ).state;

    // p_1's beat (two choices) ends at the camp, where a beat breaks, and
    // hands the marker to p_2; the rest scene's open choice does not move it.
    expect(storyTurnHolder(atRidge)?.playerId).toBe("p_2");

    // One vote each, so it is tied — the turn holder's vote wins.
    const settled = applyIntent(atRidge, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "high" } }, context);
    expect(settled.state.flags["took_low"]).toBe(true);
    expect(settled.state.flags["took_high"]).toBeUndefined();

    // The same tie with the marker on p_1 goes p_1's way: it is the turn, not
    // party order, that breaks it.
    const theirTurn = applyIntent(
      { ...atRidge, storyTurn: 0 },
      { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "high" } },
      context,
    );
    expect(theirTurn.state.flags["took_high"]).toBe(true);
    expect(theirTurn.state.flags["took_low"]).toBeUndefined();
  });

  it("records what the party voted for, on the scene the vote led to (RunState.decision)", () => {
    const chapter = chapterWithForkedShrine();
    const context = ctx({ rng: fixedRng(20), chapter });
    const atRidge = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
        { playerId: "p_2", intent: { type: "READY", ready: true } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "sleep" } },
        { playerId: "p_2", intent: { type: "CHOOSE", choiceId: "low" } },
      ],
      context,
    ).state;
    const ridge = chapter.scenes["scene_ridge"] as { choices: { id: string; label: string }[] };
    // Tied, and broken toward p_2, whose beat began at the camp.
    const low = ridge.choices.find((c) => c.id === "low");

    const settled = applyIntent(atRidge, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "high" } }, context).state;
    expect(settled.decision).toEqual({
      sceneId: settled.sceneId,
      label: low?.label,
      byPlayerId: "p_1",
      vote: true,
    });
  });

  it("waits for the whole party before putting the board up", () => {
    /*
     * One phone readying is not the fight starting. This used to be the test
     * for the auto-victory placeholder — a full ready-up *resolved* the
     * encounter, because there was no board to put up. Now it builds one, and
     * a half-ready party must not have a fight begin around it: whoever is
     * still on the character sheet would find their figure already taking
     * damage.
     */
    const context = ctx({ rng: fixedRng(20) });
    const half = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
      ],
      context,
    ).state;
    expect(half.phase).toBe("encounter");
    expect(half.encounter).toBeFalsy();

    const begun = applyIntent(half, { playerId: "p_2", intent: { type: "READY", ready: true } }, context);
    expect(begun.error).toBeUndefined();
    expect(begun.state.encounter).toBeTruthy();
    expect(begun.presentation).toMatchObject({ kind: "ENCOUNTER_BEGAN", mapId: "thicket" });
    // Whoever won initiative is on the clock, and it is a real figure.
    expect(begun.state.encounter?.order.length).toBe(5); // 2 heroes + 3 wisps

    /*
     * And the ready-up is **closed**, because it has been answered.
     *
     * Left open it is a control that outlives its question. Only one prompt is
     * ever open at a time, so for the rest of the fight every phone renders
     * "You're ready / Wait, not yet" beside the combat UI, and tapping it
     * un-readies a player in the middle of a round it has no business
     * touching — while the turn that actually needs taking goes untaken.
     *
     * Found by an intermittent e2e failure: a fight stuck in round 2, all
     * three players already ready, a `ready` prompt still standing, and the
     * playthrough answering it forever instead of ending anybody's turn.
     */
    expect(begun.state.prompt).toBeNull();
  });

  it("ends a turn by itself once the action is spent, and runs the monsters", () => {
    /*
     * Five taps an attack used to take: card, target, confirm, End turn,
     * confirm. §7.2 is "move, then one action", so once the action is spent
     * there is nothing a phone could legally send but END_TURN; the engine
     * sends it for them (`finishTurnIfSpent`). Get Ready, which has no
     * target, is the simplest action to prove it with.
     */
    const context = ctx({ rng: fixedRng(20) });
    const readying = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
      ],
      context,
    ).state;
    // The last READY by hand: `walk` would helpfully play the whole fight out.
    const begun = applyIntent(
      readying,
      { playerId: "p_2", intent: { type: "READY", ready: true } },
      context,
    ).state;
    const encounter = begun.encounter!;
    const actor = currentActor(encounter)!;
    expect(actor.side).toBe("party");
    const owner = begun.party.find((m) => m.character.id === actor.id)!;

    const readied = applyIntent(
      begun,
      { playerId: owner.playerId, intent: { type: "COMBAT_ACTION", abilityId: "ready" } },
      context,
    );
    expect(readied.error).toBeUndefined();
    const after = readied.state.encounter!;
    // The clock moved on, and never stopped on a monster: their turns ran in
    // the same intent, so the next figure on the clock is a hero again.
    expect(currentActorId(after)).not.toBe(actor.id);
    expect(currentActor(after)?.side).toBe("party");
    // Nothing left for the old phone to say.
    const late = applyIntent(
      readied.state,
      { playerId: owner.playerId, intent: { type: "END_TURN" } },
      context,
    );
    expect(late.error?.code).toBe("FORBIDDEN");
  });

  it("refuses a combat intent from a player whose turn it is not", () => {
    // The authority check every combat intent goes through. Without it any phone
    // could drive anybody's figure, including a monster's.
    const context = ctx({ rng: fixedRng(20) });
    const begun = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
      ],
      context,
    ).state;
    const started = applyIntent(begun, { playerId: "p_1", intent: { type: "READY", ready: true } }, context);
    const fighting = applyIntent(
      started.state,
      { playerId: "p_2", intent: { type: "READY", ready: true } },
      context,
    ).state;

    const acting = fighting.encounter ? currentActor(fighting.encounter) : null;
    const owner = fighting.party.find((m) => m.character.id === acting?.id);
    const other = fighting.party.find((m) => m.playerId !== owner?.playerId);
    if (!owner || !other) throw new Error("expected the turn to belong to one of two players");

    const stolen = applyIntent(
      fighting,
      { playerId: other.playerId, intent: { type: "END_TURN" } },
      context,
    );
    expect(stolen.error?.code).toBe("FORBIDDEN");
  });
});

describe("rest scenes", () => {
  it("heals on arrival (spec §6.1)", () => {
    const context = ctx({ rng: fixedRng(20) });
    let state = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;
    state = applyEffects(state, [{ type: "damage", amount: 5, to: "party" }], context);
    const hurt = state.party.map((m) => m.hp);

    const rested = enterScene(state, "scene_camp", context);
    expect(rested.state.party.map((m) => m.hp)).toEqual(hurt.map((hp) => hp! + 3));
  });
});

describe("priority scenes", () => {
  it("carries a scene's priority onto the run while the party stands in it", () => {
    const chapter = makeChapter();
    (chapter.scenes["scene_shrine"] as StoryScene).priority = 1;
    const context = ctx({ rng: fixedRng(20), chapter });
    const started = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;
    expect(started.scenePriority ?? null).toBeNull();

    const revealed = enterScene(started, "scene_shrine", context).state;
    expect(revealed.scenePriority).toBe(1);

    // An ordinary scene after it is ordinary again, not still gilded.
    const after = enterScene(revealed, "scene_camp", context).state;
    expect(after.scenePriority).toBeNull();
  });
});

describe("scene hints (#255)", () => {
  it("carries a scene's hint onto the run while the party stands in it, and no key otherwise", () => {
    const chapter = makeChapter();
    (chapter.scenes["scene_shrine"] as StoryScene).hint = "Tap what you want to do.";
    const context = ctx({ rng: fixedRng(20), chapter });
    const started = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;
    expect(started).not.toHaveProperty("hint");

    const hinted = enterScene(started, "scene_shrine", context).state;
    expect(hinted.hint).toBe("Tap what you want to do.");

    // The next scene has none, and the key goes with it.
    expect(enterScene(hinted, "scene_camp", context).state).not.toHaveProperty("hint");
  });

  it("puts the friend after the story-turn holder on the ground in a friendDown fight, and nobody when alone", () => {
    const chapter = makeChapter();
    const scene = chapter.scenes["encounter_wisps"];
    if (scene?.type !== "encounter") throw new Error("fixture moved");
    scene.friendDown = true;
    const context = ctx({ rng: fixedRng(20), chapter });
    const fightWith = (seated: RunState, readies: string[]) => {
      const started = walk(seated, [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }], context).state;
      let state = enterScene(started, "encounter_wisps", context).state;
      for (const playerId of readies) state = applyIntent(state, { playerId, intent: { type: "READY", ready: true } }, context).state;
      return state;
    };

    const pair = fightWith(seatedParty(context), ["p_1", "p_2"]);
    const holder = storyTurnHolder(pair)!.character.id;
    const heroes = pair.encounter!.combatants.filter((c) => c.side === "party");
    expect(heroes.filter((c) => c.down).map((c) => c.id)).toEqual(heroes.filter((c) => c.id !== holder).map((c) => c.id));
    // The run's own HP is untouched: only the fight starts them down.
    expect(pair.party.every((m) => !m.down)).toBe(true);

    const alone = walk(newRun(), [
      { playerId: "p_1", intent: CREATE_UNICORN },
      { playerId: "p_1", intent: { type: "READY", ready: true } },
    ], context).state;
    const solo = fightWith(alone, ["p_1"]);
    expect(solo.encounter!.combatants.filter((c) => c.side === "party" && c.down)).toEqual([]);
  });

  it("stands a party that walks in already down up at 1 hp, so it gets a turn (#389)", () => {
    const context = ctx({ rng: fixedRng(20) });
    const into = (seated: RunState, down: string[]) => {
      let state = walk(seated, [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }], context).state;
      // What a lost fight leaves behind (`carryDamageOut`) when its onDefeat
      // road runs straight into the next one.
      state = { ...state, party: state.party.map((m) => (down.includes(m.playerId) ? { ...m, hp: 0, down: true } : m)) };
      state = enterScene(state, "encounter_wisps", context).state;
      for (const m of state.party) state = applyIntent(state, { playerId: m.playerId, intent: { type: "READY", ready: true } }, context).state;
      return state;
    };

    const alone = walk(newRun(), [
      { playerId: "p_1", intent: CREATE_UNICORN },
      { playerId: "p_1", intent: { type: "READY", ready: true } },
    ], context).state;
    const solo = into(alone, ["p_1"]);
    // Not lost before anybody moved: the fight is on, and the hero is up, barely.
    expect(solo.phase).toBe("encounter");
    expect(solo.encounter).not.toBeNull();
    expect(solo.encounter!.combatants.find((c) => c.side === "party")).toMatchObject({ hp: 1, down: false });

    // One friend still standing is a table that can play: nobody is lifted.
    const pair = into(seatedParty(context), ["p_2"]);
    const heroes = pair.encounter!.combatants.filter((c) => c.side === "party");
    expect(heroes.map((c) => [c.down, c.hp === 0])).toEqual([[false, false], [true, true]]);
  });

  it("leaves the practice to the server", () => {
    const context = ctx({ rng: fixedRng(20) });
    expect(() => walk(seatedParty(context), [{ playerId: "p_1", intent: { type: "START_PRACTICE" } }], context)).toThrow(
      /resolved by the server/,
    );
  });
});

/*
 * Trading — spec §9.4. "At Rest scenes, the party can freely pass items between
 * characters. Drag on your phone, tap to accept on theirs."
 *
 * The rule the whole design turns on: **an offer moves nothing.** The item sits
 * in the giver's bag until the other phone answers, which is what makes a
 * declined offer free and a stale one harmless. Every test below is really
 * asking the same question — after this sequence, who is holding it? — because
 * the failure that matters is an item that ends up in two bags or in none.
 */
describe("trading at a Rest scene (spec §9.4)", () => {
  /** The party at `scene_camp`, p_1 carrying two things and p_2 nothing. */
  function atCamp(context = ctx()): RunState {
    const started = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;
    const stocked = applyEffects(
      started,
      [
        { type: "grantItem", itemId: "sunbloom_draught", to: "p_1" },
        { type: "grantItem", itemId: "river_charm", to: "p_1" },
      ],
      context,
    );
    return enterScene(stocked, "scene_camp", context).state;
  }

  const bagOf = (state: RunState, playerId: string): string[] =>
    state.party
      .find((m) => m.playerId === playerId)!
      .character.inventory.map((e) => e.itemId);

  const offer = (toPlayerId: string, itemId: string): ClientIntent => ({
    type: "OFFER_ITEM",
    itemId,
    toPlayerId,
  });

  const onlyOffer = (state: RunState) => (state.trades ?? [])[0]!;

  it("an offer moves nothing until it is answered", () => {
    const context = ctx();
    const offered = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
      context,
    );

    expect(offered.error).toBeUndefined();
    expect(offered.state.trades).toHaveLength(1);
    // Still hers. This is the whole point of the two-tap shape.
    expect(bagOf(offered.state, "p_1")).toContain("sunbloom_draught");
    expect(bagOf(offered.state, "p_2")).toEqual([]);
  });

  it("accepting hands it over exactly once", () => {
    const context = ctx();
    const offered = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
      context,
    ).state;
    const done = applyIntent(
      offered,
      { playerId: "p_2", intent: { type: "RESOLVE_TRADE", tradeId: onlyOffer(offered).id, accept: true } },
      context,
    );

    expect(done.error).toBeUndefined();
    expect(bagOf(done.state, "p_1")).toEqual(["river_charm"]);
    expect(bagOf(done.state, "p_2")).toEqual(["sunbloom_draught"]);
    expect(done.state.trades).toEqual([]);
  });

  it("declining costs nobody anything", () => {
    const context = ctx();
    const offered = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
      context,
    ).state;
    const declined = applyIntent(
      offered,
      { playerId: "p_2", intent: { type: "RESOLVE_TRADE", tradeId: onlyOffer(offered).id, accept: false } },
      context,
    );

    expect(declined.error).toBeUndefined();
    expect(bagOf(declined.state, "p_1")).toContain("sunbloom_draught");
    expect(declined.state.trades).toEqual([]);
  });

  it("lets the giver take an offer back", () => {
    // Declining and withdrawing are the same event from opposite ends. An
    // offer only the receiver could clear would strand an item behind a phone
    // nobody is holding.
    const context = ctx();
    const offered = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
      context,
    ).state;
    const back = applyIntent(
      offered,
      { playerId: "p_1", intent: { type: "RESOLVE_TRADE", tradeId: onlyOffer(offered).id, accept: false } },
      context,
    );

    expect(back.error).toBeUndefined();
    expect(back.state.trades).toEqual([]);
    expect(bagOf(back.state, "p_1")).toContain("sunbloom_draught");
  });

  it("refuses an accept from anybody but the person it was offered to", () => {
    const context = ctx();
    const offered = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
      context,
    ).state;
    const grabbed = applyIntent(
      offered,
      { playerId: "p_1", intent: { type: "RESOLVE_TRADE", tradeId: onlyOffer(offered).id, accept: true } },
      context,
    );

    expect(grabbed.error?.code).toBe("FORBIDDEN");
    expect(grabbed.state.trades).toHaveLength(1);
  });

  it("only at a Rest scene", () => {
    // The same gate a banked stat point passes. Mid-fight a consumable would
    // cross an open turn order; mid-story it puts a bag in front of a question.
    const context = ctx();
    const story = applyEffects(
      walk(
        seatedParty(context),
        [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
        context,
      ).state,
      [{ type: "grantItem", itemId: "sunbloom_draught", to: "p_1" }],
      context,
    );

    expect(story.sceneType).toBe("story");
    const refused = applyIntent(story, { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") }, context);
    expect(refused.error?.code).toBe("ILLEGAL");
    expect(refused.error?.message).toMatch(/Rest scene/);
  });

  it("drops unanswered offers when the party leaves the scene", () => {
    // Nothing has moved, so dropping them costs the party nothing — and an
    // offer left standing would be acceptable two scenes later, in a fight.
    const context = ctx();
    const offered = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
      context,
    ).state;
    const moved = enterScene(offered, "scene_ridge", context).state;

    expect(moved.trades).toEqual([]);
    expect(bagOf(moved, "p_1")).toContain("sunbloom_draught");
  });

  it("refuses a quest item, which the whole party already benefits from", () => {
    // §9.2 plus `itemMatches`: a gate is satisfied by *anyone* holding it, so
    // handing a story key over can never open a choice that was not already
    // open. There is nothing to trade for.
    const context = ctx();
    const withKey = applyEffects(atCamp(context), [{ type: "grantQuestItem", itemId: "rusted_key" }], context);
    const refused = applyIntent(withKey, { playerId: "p_1", intent: offer("p_2", "rusted_key") }, context);

    expect(refused.error?.code).toBe("ILLEGAL");
  });

  it("refuses an offer of something the giver is not carrying", () => {
    const context = ctx();
    const refused = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_2", "firecracker") },
      context,
    );
    expect(refused.error?.code).toBe("NOT_FOUND");
  });

  /**
   * Six full slots is §9.1's question — "keep it and drop one, or leave it" —
   * and a trade answers it in the *same* intent as the accept.
   *
   * The alternative, raising the swap prompt the way a grant does, would put
   * the item in limbo between the accept and the answer: off the giver, not yet
   * on the receiver, with "leave it behind" forced to mean "give it back" — a
   * rule nobody at the table would guess. One intent, and the item is either
   * where it was or where it went.
   */
  describe("when the receiver's six slots are full", () => {
    function receiverFull(context: EngineContext): RunState {
      const full = applyEffects(
        atCamp(context),
        Array.from({ length: INVENTORY_SLOTS }, () => ({
          type: "grantItem" as const,
          itemId: "firecracker",
          to: "p_2",
        })),
        context,
      );
      expect(bagOf(full, "p_2")).toHaveLength(INVENTORY_SLOTS);
      return full;
    }

    it("still lets the offer be made", () => {
      // Hiding it would teach a second, worse answer for a situation §9.1 has
      // already taught once.
      const context = ctx();
      const offered = applyIntent(
        receiverFull(context),
        { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
        context,
      );
      expect(offered.error).toBeUndefined();
      expect(offered.state.trades).toHaveLength(1);
    });

    it("takes it, dropping the named thing, in one event", () => {
      const context = ctx();
      const offered = applyIntent(
        receiverFull(context),
        { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
        context,
      ).state;
      const done = applyIntent(
        offered,
        {
          playerId: "p_2",
          intent: {
            type: "RESOLVE_TRADE",
            tradeId: onlyOffer(offered).id,
            accept: true,
            dropItemId: "firecracker",
          },
        },
        context,
      );

      expect(done.error).toBeUndefined();
      const bag = bagOf(done.state, "p_2");
      expect(bag).toHaveLength(INVENTORY_SLOTS);
      expect(bag).toContain("sunbloom_draught");
      // Exactly one firecracker went down, not all of them.
      expect(bag.filter((id) => id === "firecracker")).toHaveLength(INVENTORY_SLOTS - 1);
      expect(bagOf(done.state, "p_1")).not.toContain("sunbloom_draught");
    });

    it("refuses an accept that does not say what goes down, without emptying the giver's bag", () => {
      const context = ctx();
      const offered = applyIntent(
        receiverFull(context),
        { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
        context,
      ).state;
      const refused = applyIntent(
        offered,
        { playerId: "p_2", intent: { type: "RESOLVE_TRADE", tradeId: onlyOffer(offered).id, accept: true } },
        context,
      );

      expect(refused.error?.code).toBe("ILLEGAL");
      expect(refused.error?.message).toMatch(/something has to go down/);
      // The failure this whole design exists to make impossible.
      expect(bagOf(refused.state, "p_1")).toContain("sunbloom_draught");
      expect(refused.state.trades).toHaveLength(1);
    });

    it("refuses a drop of something the receiver is not carrying", () => {
      const context = ctx();
      const offered = applyIntent(
        receiverFull(context),
        { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
        context,
      ).state;
      const refused = applyIntent(
        offered,
        {
          playerId: "p_2",
          intent: {
            type: "RESOLVE_TRADE",
            tradeId: onlyOffer(offered).id,
            accept: true,
            dropItemId: "oak_token",
          },
        },
        context,
      );

      expect(refused.error?.code).toBe("ILLEGAL");
      expect(bagOf(refused.state, "p_1")).toContain("sunbloom_draught");
    });

    it("declining is still free, and still drops nothing", () => {
      const context = ctx();
      const offered = applyIntent(
        receiverFull(context),
        { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
        context,
      ).state;
      const declined = applyIntent(
        offered,
        { playerId: "p_2", intent: { type: "RESOLVE_TRADE", tradeId: onlyOffer(offered).id, accept: false } },
        context,
      );

      expect(declined.error).toBeUndefined();
      expect(bagOf(declined.state, "p_2")).toHaveLength(INVENTORY_SLOTS);
      expect(bagOf(declined.state, "p_1")).toContain("sunbloom_draught");
    });
  });

  it("refuses a second identical offer instead of stacking two answers onto one item", () => {
    const context = ctx();
    const once = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
      context,
    ).state;
    const twice = applyIntent(once, { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") }, context);

    expect(twice.error?.code).toBe("ILLEGAL");
    expect(twice.state.trades).toHaveLength(1);
  });

  it("clears the losing offer when the same item was offered to two people", () => {
    /*
     * The race that would otherwise show two players a gift one tap already
     * spent. p_1 has one potion; both friends are offered it; the first accept
     * takes it and the other offer goes with it, rather than waiting to refuse
     * somebody who thought they had it.
     */
    const context = ctx();
    const three = walk(
      atCamp(context),
      [{ playerId: "p_3", intent: { ...CREATE_GRIFFIN, name: "Thistle" } as ClientIntent }],
      context,
    ).state;
    let state = applyIntent(three, { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") }, context).state;
    state = applyIntent(state, { playerId: "p_1", intent: offer("p_3", "sunbloom_draught") }, context).state;
    expect(state.trades).toHaveLength(2);

    const toP2 = (state.trades ?? []).find((t) => t.toPlayerId === "p_2")!;
    const settled = applyIntent(
      state,
      { playerId: "p_2", intent: { type: "RESOLVE_TRADE", tradeId: toP2.id, accept: true } },
      context,
    );

    expect(settled.error).toBeUndefined();
    expect(settled.state.trades).toEqual([]);
    expect(bagOf(settled.state, "p_2")).toContain("sunbloom_draught");
    expect(bagOf(settled.state, "p_3")).not.toContain("sunbloom_draught");
    expect(bagOf(settled.state, "p_1")).not.toContain("sunbloom_draught");
  });

  it("takes the offer off the table the moment the giver drinks the potion", () => {
    /*
     * Not "refuses the accept" — the offer has to be *gone*, before the other
     * phone can tap it. A refusal cannot clear it: `applyIntent` returns the
     * original state when a handler throws, so an offer dropped on the way out
     * of a rejected accept is dropped into a discarded draft, and the receiver
     * would be left tapping a gift that is not there.
     */
    const context = ctx();
    const hurt = applyEffects(atCamp(context), [{ type: "damage", amount: 4, to: "p_1" }], context);
    const offered = applyIntent(hurt, { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") }, context).state;
    expect(offered.trades).toHaveLength(1);

    const drunk = applyIntent(
      offered,
      { playerId: "p_1", intent: { type: "USE_ITEM", itemId: "sunbloom_draught" } },
      context,
    );

    expect(drunk.error).toBeUndefined();
    expect(drunk.state.trades).toEqual([]);

    // And the item cannot be conjured out of a bag that no longer holds it,
    // even by a client replaying the old id.
    const late = applyIntent(
      drunk.state,
      { playerId: "p_2", intent: { type: "RESOLVE_TRADE", tradeId: onlyOffer(offered).id, accept: true } },
      context,
    );
    expect(late.error?.code).toBe("NOT_FOUND");
    expect(bagOf(late.state, "p_2")).not.toContain("sunbloom_draught");
  });

  it("asks what goes down when the bag filled up between the offer and the tap", () => {
    // The receiver's room is the one thing that genuinely moves in the gap —
    // she may have taken somebody else's offer into her last slot. So it is
    // settled at the tap, not reserved at the offer.
    const context = ctx();
    const offered = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
      context,
    ).state;
    const filled = applyEffects(
      offered,
      Array.from({ length: INVENTORY_SLOTS }, () => ({
        type: "grantItem" as const,
        itemId: "firecracker",
        to: "p_2",
      })),
      context,
    );

    const bare = applyIntent(
      filled,
      { playerId: "p_2", intent: { type: "RESOLVE_TRADE", tradeId: onlyOffer(offered).id, accept: true } },
      context,
    );
    expect(bare.error?.code).toBe("ILLEGAL");
    expect(bagOf(bare.state, "p_1")).toContain("sunbloom_draught");

    // And it goes through once she says what to put down.
    const done = applyIntent(
      filled,
      {
        playerId: "p_2",
        intent: {
          type: "RESOLVE_TRADE",
          tradeId: onlyOffer(offered).id,
          accept: true,
          dropItemId: "firecracker",
        },
      },
      context,
    );
    expect(done.error).toBeUndefined();
    expect(bagOf(done.state, "p_2")).toContain("sunbloom_draught");
  });

  /*
   * The finding that mattered most, and it was never only about trading:
   * `RunState` holds *resolved* characters, nothing re-resolves during a
   * chapter, and every path that changed a bag used to assign `inventory`
   * alone. So a trinket's effect stayed wherever the last full resolve had put
   * it — spec §9.2 calls them "passive, always on" and for a whole sitting
   * they were not.
   */
  describe("a trinket brings its effect with it", () => {
    function withCharm(context: EngineContext): RunState {
      return applyEffects(
        atCamp(context),
        [{ type: "grantItem", itemId: "river_charm", to: "p_1" }],
        context,
      );
    }

    const stepsOf = (state: RunState, playerId: string): number =>
      state.party.find((m) => m.playerId === playerId)!.character.steps;

    it("lands the moment it is picked up, not at the end of the chapter", () => {
      // The pre-existing half of this: a trinket found mid-chapter did nothing
      // until chapter-completion persistence re-resolved the party.
      const context = ctx();
      const before = atCamp(context);
      const after = withCharm(context);
      expect(stepsOf(after, "p_1")).toBe(stepsOf(before, "p_1") + 1);
    });

    it("moves to the receiver and off the giver when it is handed over", () => {
      const context = ctx();
      const start = withCharm(context);
      const giverBefore = stepsOf(start, "p_1");
      const takerBefore = stepsOf(start, "p_2");

      const offered = applyIntent(start, { playerId: "p_1", intent: offer("p_2", "river_charm") }, context).state;
      const done = applyIntent(
        offered,
        { playerId: "p_2", intent: { type: "RESOLVE_TRADE", tradeId: onlyOffer(offered).id, accept: true } },
        context,
      );

      expect(done.error).toBeUndefined();
      expect(stepsOf(done.state, "p_1")).toBe(giverBefore - 1);
      expect(stepsOf(done.state, "p_2")).toBe(takerBefore + 1);
    });

    it("does not leave anybody standing above their own ceiling", () => {
      // An oak token is +2 max HP. Handing it away has to take the hit points
      // it was holding up with it, or the sheet reads 12/10.
      const context = ctx();
      const start = applyEffects(
        atCamp(context),
        [
          { type: "grantItem", itemId: "oak_token", to: "p_1" },
          { type: "heal", amount: 99, to: "p_1" },
        ],
        context,
      );
      const giver = (state: RunState) => state.party.find((m) => m.playerId === "p_1")!;
      // The unicorn's own passive is Heart, so the token is the only thing
      // holding this ceiling up: 10 + 2.
      expect(giver(start).character.maxHp).toBe(rules.baseMaxHp + 2);
      expect(giver(start).hp).toBe(rules.baseMaxHp + 2);

      const offered = applyIntent(start, { playerId: "p_1", intent: offer("p_2", "oak_token") }, context).state;
      const done = applyIntent(
        offered,
        { playerId: "p_2", intent: { type: "RESOLVE_TRADE", tradeId: onlyOffer(offered).id, accept: true } },
        context,
      ).state;

      // The ceiling came down, and the hit points that were resting on it came
      // down with it — no 12/10 on anybody's sheet.
      expect(giver(done).character.maxHp).toBe(rules.baseMaxHp);
      expect(giver(done).hp).toBe(rules.baseMaxHp);
      // And the receiver got the ceiling, without being handed the hit points.
      const taker = done.party.find((m) => m.playerId === "p_2")!;
      expect(taker.character.maxHp).toBe(rules.baseMaxHp + 2);
      expect(taker.hp).toBeLessThanOrEqual(taker.character.maxHp);
    });
  });

  it("refuses a drop when the receiver has room, rather than destroying it for nothing", () => {
    /*
     * Reachable without a bad client: she picks what to put down while her bag
     * is full, then drinks something before tapping accept. `dropItemId` means
     * "make room", there is none to make, and obeying it would lose an item —
     * the same rule doUseItem states in the other direction.
     */
    const context = ctx();
    const offered = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") },
      context,
    ).state;
    const armed = applyEffects(offered, [{ type: "grantItem", itemId: "firecracker", to: "p_2" }], context);

    const refused = applyIntent(
      armed,
      {
        playerId: "p_2",
        intent: {
          type: "RESOLVE_TRADE",
          tradeId: onlyOffer(offered).id,
          accept: true,
          dropItemId: "firecracker",
        },
      },
      context,
    );

    expect(refused.error?.code).toBe("ILLEGAL");
    expect(refused.error?.message).toMatch(/nothing needs to go down/);
    expect(bagOf(refused.state, "p_2")).toContain("firecracker");
  });

  it("refuses an offer to yourself", () => {
    const context = ctx();
    const refused = applyIntent(
      atCamp(context),
      { playerId: "p_1", intent: offer("p_1", "sunbloom_draught") },
      context,
    );
    expect(refused.error?.code).toBe("ILLEGAL");
  });

  it("survives a run persisted before trading existed", () => {
    // `trades` is optional on RunState for the same reason `bonuses` is, and
    // every reader coalesces rather than indexing into undefined.
    const context = ctx();
    const legacy = { ...atCamp(context) };
    delete (legacy as { trades?: unknown }).trades;

    const offered = applyIntent(legacy, { playerId: "p_1", intent: offer("p_2", "sunbloom_draught") }, context);
    expect(offered.error).toBeUndefined();
    expect(offered.state.trades).toHaveLength(1);
  });
});

describe("items in play", () => {
  function withDraught(context: EngineContext): RunState {
    const state = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
      ],
      context,
    ).state;
    return applyEffects(state, [{ type: "damage", amount: 6, to: "p_2" }], context);
  }

  it("uses a consumable and heals", () => {
    const context = ctx({ rng: fixedRng(20) });
    const state = withDraught(context);
    const before = state.party.find((m) => m.playerId === "p_2")!.hp;

    const result = applyIntent(state, { playerId: "p_2", intent: { type: "USE_ITEM", itemId: "sunbloom_draught" } }, context);
    const after = result.state.party.find((m) => m.playerId === "p_2")!;
    expect(after.hp).toBe(before + 4);
    expect(after.character.inventory).toEqual([]);
    expect(result.presentation).toMatchObject({ kind: "HEAL", amount: 4 });
  });

  it("refuses an item the character isn't carrying", () => {
    const context = ctx({ rng: fixedRng(20) });
    const result = applyIntent(
      withDraught(context),
      { playerId: "p_1", intent: { type: "USE_ITEM", itemId: "sunbloom_draught" } },
      context,
    );
    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("refuses to burn a quest item", () => {
    const context = ctx();
    const result = applyIntent(
      seatedParty(context),
      { playerId: "p_1", intent: { type: "USE_ITEM", itemId: "rusted_key" } },
      context,
    );
    expect(result.error?.code).toBe("ILLEGAL");
  });

  it("prompts to swap rather than dropping a grant into a full bag", () => {
    const context = ctx();
    let state = seatedParty(context);
    state = applyEffects(
      state,
      [
        { type: "grantItem", itemId: "river_charm", to: "p_1" },
        { type: "grantItem", itemId: "emberglass_shard", to: "p_1" },
        { type: "grantItem", itemId: "oak_token", to: "p_1" },
        { type: "grantItem", itemId: "pebble", to: "p_1" },
        { type: "grantItem", itemId: "acorn", to: "p_1" },
        { type: "grantItem", itemId: "feather", to: "p_1" },
      ],
      context,
    );
    expect(state.party[0]!.character.inventory).toHaveLength(6);

    state = applyEffects(state, [{ type: "grantItem", itemId: "ribbon", to: "p_1" }], context);
    expect(state.prompt).toEqual({
      kind: "item_swap",
      characterId: state.party[0]!.character.id,
      incomingItemId: "ribbon",
    });

    const swapped = applyIntent(
      state,
      { playerId: "p_1", intent: { type: "RESOLVE_ITEM_SWAP", dropItemId: "pebble" } },
      context,
    );
    const inventory = swapped.state.party[0]!.character.inventory.map((e) => e.itemId);
    expect(inventory).toHaveLength(6);
    expect(inventory).toContain("ribbon");
    expect(inventory).not.toContain("pebble");
    expect(swapped.state.prompt).toBeNull();

    // "Leave it" is the other half of the one prompt.
    const left = applyIntent(
      state,
      { playerId: "p_1", intent: { type: "RESOLVE_ITEM_SWAP", dropItemId: null } },
      context,
    );
    expect(left.state.party[0]!.character.inventory.map((e) => e.itemId)).not.toContain("ribbon");
  });

  it("carries a swap prompt across a scene transition rather than losing the item", () => {
    const context = ctx({ rng: fixedRng(20) });
    // Fill the griffin's bag, then walk into the check whose success grants it
    // one more item.
    let state = seatedParty(context);
    for (const itemId of ["river_charm", "emberglass_shard", "oak_token", "pebble", "acorn", "feather"]) {
      state = applyEffects(state, [{ type: "grantItem", itemId, to: "p_2" }], context);
    }
    state = walk(
      state,
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
      ],
      context,
    ).state;

    // Arrived at the shrine, but the grant is still owed a decision.
    expect(state.sceneId).toBe("scene_shrine");
    expect(state.prompt).toMatchObject({ kind: "item_swap", incomingItemId: "sunbloom_draught" });

    const answered = applyIntent(
      state,
      { playerId: "p_2", intent: { type: "RESOLVE_ITEM_SWAP", dropItemId: "pebble" } },
      context,
    );
    // ...and the scene's own prompt opens once it's answered.
    expect(answered.state.prompt).toMatchObject({ kind: "choice", sceneId: "scene_shrine" });
    expect(
      answered.state.party.find((m) => m.playerId === "p_2")!.character.inventory.map((e) => e.itemId),
    ).toContain("sunbloom_draught");
  });

  it("only the owner answers the swap prompt", () => {
    const context = ctx();
    let state = seatedParty(context);
    for (const itemId of ["river_charm", "emberglass_shard", "oak_token", "pebble", "acorn", "feather", "ribbon"]) {
      state = applyEffects(state, [{ type: "grantItem", itemId, to: "p_1" }], context);
    }
    const result = applyIntent(
      state,
      { playerId: "p_2", intent: { type: "RESOLVE_ITEM_SWAP", dropItemId: "pebble" } },
      context,
    );
    expect(result.error?.code).toBe("FORBIDDEN");
  });
});

describe("effects", () => {
  it("grants quest items outside the slot budget and only once", () => {
    const context = ctx();
    let state = seatedParty(context);
    state = applyEffects(state, [{ type: "grantQuestItem", itemId: "rusted_key" }], context);
    state = applyEffects(state, [{ type: "grantQuestItem", itemId: "rusted_key" }], context);
    const holder = state.party[0]!;
    expect(holder.character.questItems).toEqual(["rusted_key"]);
    expect(holder.character.inventory).toEqual([]);
  });

  it("sets flags and accumulates XP", () => {
    const context = ctx();
    const state = applyEffects(
      seatedParty(context),
      [
        { type: "setFlag", flag: "found_shrine" },
        { type: "setFlag", flag: "lantern_lit", value: false },
        { type: "grantXp", amount: 50 },
      ],
      context,
    );
    expect(state.flags).toEqual({ found_shrine: true, lantern_lit: false });
    expect(state.xpEarned).toBe(50);
  });

  it("fills and spends the party purse, never below zero", () => {
    const context = ctx();
    let state = applyEffects(seatedParty(context), [{ type: "grantCoins", amount: 6 }], context);
    expect(state.coins).toBe(6);
    state = applyEffects(state, [{ type: "spendCoins", amount: 4 }], context);
    expect(state.coins).toBe(2);
    state = applyEffects(state, [{ type: "spendCoins", amount: 5 }], context);
    expect(state.coins).toBe(0);
  });

  it("takes an item from whoever holds it, first preference first", () => {
    const context = ctx();
    let state = applyEffects(
      seatedParty(context),
      [
        { type: "grantItem", itemId: "sunbloom_draught", to: "p_2" },
        { type: "grantItem", itemId: "brave_whistle", to: "p_1" },
        { type: "grantItem", itemId: "brave_whistle", to: "p_1" },
      ],
      context,
    );
    // Preference order, not bag order: the whistle is wanted first.
    state = applyEffects(state, [{ type: "takeItem", itemId: ["brave_whistle", "sunbloom_draught"] }], context);
    expect(state.party[0]!.character.inventory.map((e) => e.itemId)).toEqual(["brave_whistle"]);
    expect(state.party[1]!.character.inventory.map((e) => e.itemId)).toEqual(["sunbloom_draught"]);

    // Falls through to the next id once the first is gone.
    state = applyEffects(state, [{ type: "takeItem", itemId: ["firecracker", "sunbloom_draught"] }], context);
    expect(state.party[1]!.character.inventory).toEqual([]);

    // Holding none of them is a no-op, not an error.
    const before = state;
    state = applyEffects(state, [{ type: "takeItem", itemId: "firecracker" }], context);
    expect(state.party).toEqual(before.party);
  });

  it("takes a quest item, and a trinket's bonus goes with it", () => {
    const context = ctx();
    let state = applyEffects(
      seatedParty(context),
      [
        { type: "grantQuestItem", itemId: "rusted_key" },
        { type: "grantItem", itemId: "oak_token", to: "p_1" },
      ],
      context,
    );
    const withToken = state.party[0]!.character;
    state = applyEffects(
      state,
      [
        { type: "takeItem", itemId: "rusted_key" },
        { type: "takeItem", itemId: "oak_token" },
      ],
      context,
    );
    expect(state.party.flatMap((m) => m.character.questItems)).not.toContain("rusted_key");
    expect(state.party[0]!.character.inventory).toEqual([]);
    expect(state.party[0]!.character.maxHp).toBeLessThanOrEqual(withToken.maxHp);
  });

  it("keeps the purse across a chapter start, seeded from the campaign when given", () => {
    const start: ClientIntent = { type: "START_CHAPTER", chapterId: "bramblewood-01" };
    const carried = applyEffects(seatedParty(ctx()), [{ type: "grantCoins", amount: 7 }], ctx());
    const kept = applyIntent(carried, { playerId: "p_1", intent: start }, ctx());
    expect(kept.state.coins).toBe(7);
    const seeded = applyIntent(carried, { playerId: "p_1", intent: start }, ctx({ campaignCoins: 3 }));
    expect(seeded.state.coins).toBe(3);
  });

  describe("a cost that is spent while the prompt waits", () => {
    /** The clearing, plus a choice that hands over the party's draught. */
    function clearingWithGift(type: "story" | "choice_point"): Chapter {
      const chapter = makeChapter();
      const clearing = chapter.scenes["scene_clearing"] as StoryScene;
      chapter.scenes["scene_clearing"] = {
        ...clearing,
        type,
        choices: [
          ...clearing.choices,
          {
            id: "gift",
            label: "Leave the draught for the shrine",
            icon: "potion",
            goto: "scene_shrine",
            when: { item: "sunbloom_draught" },
            effects: [{ type: "takeItem", itemId: "sunbloom_draught" }],
          },
        ],
      } as Scene;
      return chapter;
    }

    function atClearing(context: EngineContext): RunState {
      let state = seatedParty(context);
      state = applyEffects(
        state,
        [
          { type: "grantItem", itemId: "sunbloom_draught", to: "p_1" },
          { type: "damage", amount: 4, to: "p_1" },
        ],
        context,
      );
      state = applyIntent(state, { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }, context).state;
      expect(state.prompt?.kind === "choice" && state.prompt.options.map((o) => o.id)).toContain("gift");
      return state;
    }

    it("drops the option once the item is gone, and refuses a late tap on it", () => {
      const context = ctx({ chapter: clearingWithGift("story") });
      const drunk = applyIntent(
        atClearing(context),
        { playerId: "p_1", intent: { type: "USE_ITEM", itemId: "sunbloom_draught" } },
        context,
      );
      expect(drunk.error).toBeUndefined();
      const prompt = drunk.state.prompt;
      expect(prompt?.kind === "choice" && prompt.options.map((o) => o.id)).not.toContain("gift");

      const chooser = prompt?.kind === "choice" ? (prompt.forPlayerIds[0] ?? "p_1") : "p_1";
      const late = applyIntent(drunk.state, { playerId: chooser, intent: { type: "CHOOSE", choiceId: "gift" } }, context);
      expect(late.error?.code).toBe("ILLEGAL");
      expect(late.state.sceneId).toBe("scene_clearing");
    });

    it("withdraws a vote cast for it, so the vote cannot carry it", () => {
      const context = ctx({ chapter: clearingWithGift("choice_point") });
      const voted = applyIntent(
        atClearing(context),
        { playerId: "p_2", intent: { type: "CHOOSE", choiceId: "gift" } },
        context,
      );
      expect(voted.error).toBeUndefined();
      expect(voted.state.prompt?.kind === "choice" && voted.state.prompt.votes).toEqual({ p_2: "gift" });

      const drunk = applyIntent(
        voted.state,
        { playerId: "p_1", intent: { type: "USE_ITEM", itemId: "sunbloom_draught" } },
        context,
      ).state;
      expect(drunk.prompt?.kind === "choice" && drunk.prompt.votes).toEqual({});

      // The vote finishes on what the party can still do.
      let state = applyIntent(drunk, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } }, context).state;
      state = applyIntent(state, { playerId: "p_2", intent: { type: "CHOOSE", choiceId: "squeeze" } }, context).state;
      expect(state.sceneId).toBe("check_squeeze");
    });
  });

  it("knocks characters down instead of killing them, and never ends the run", () => {
    const context = ctx();
    const state = applyEffects(seatedParty(context), [{ type: "damage", amount: 99, to: "party" }], context);
    expect(state.party.every((m) => m.hp === 0 && m.down)).toBe(true);
    expect(isPartyDown(state)).toBe(true);
    // spec §7.3 — a wipe is a story branch. There is no game-over phase at all.
    expect(state.phase).not.toBe("chapter_complete");
    expect(["lobby", "creation", "scene", "check", "encounter", "chapter_complete"]).toContain(
      state.phase,
    );
  });

  it("lifts a knocked-down character back up on a heal", () => {
    const context = ctx();
    let state = applyEffects(seatedParty(context), [{ type: "damage", amount: 99, to: "party" }], context);
    state = applyEffects(state, [{ type: "heal", amount: 1, to: "p_1" }], context);
    expect(state.party[0]).toMatchObject({ hp: 1, down: false });
    expect(state.party[1]).toMatchObject({ down: true });
  });

  it("caps healing at max HP", () => {
    const context = ctx();
    const state = applyEffects(seatedParty(context), [{ type: "heal", amount: 99, to: "party" }], context);
    for (const member of state.party) expect(member.hp).toBe(member.character.maxHp);
  });

  it("never mutates the state it was handed", () => {
    const context = ctx();
    const state = seatedParty(context);
    const before = JSON.parse(JSON.stringify(state)) as RunState;
    applyEffects(state, [{ type: "damage", amount: 3, to: "party" }], context);
    expect(state).toEqual(before);
  });
});

describe("SET_MODE", () => {
  it("switches layout mid-run — the laptop dying is exactly when you need it", () => {
    const context = ctx();
    const result = applyIntent(
      seatedParty(context),
      { playerId: "p_1", intent: { type: "SET_MODE", mode: "party" } },
      context,
    );
    expect(result.state.mode).toBe("party");
  });
});

describe("an intent the server only cast, never checked", () => {
  // The server hands the engine a phone's JSON with a type cast. These
  // shapes used to throw a TypeError (a 500, every retry) or land in state.
  const malformed: [string, unknown][] = [
    ["MOVE with no tile", { type: "MOVE" }],
    ["MOVE to null", { type: "MOVE", to: null }],
    ["MOVE to half a tile", { type: "MOVE", to: { x: 1 } }],
    ["targets as a string", { type: "COMBAT_ACTION", abilityId: "strike", targetIds: "a" }],
    ["tiles as a string", { type: "COMBAT_ACTION", abilityId: "strike", targetTiles: "ab" }],
    ["a tile that is not one", { type: "COMBAT_ACTION", abilityId: "strike", targetTile: [1, 2] }],
    ["no ability", { type: "COMBAT_ACTION", targetId: "e_1" }],
    ["a mode that is not one", { type: "SET_MODE", mode: { x: "y".repeat(1000) } }],
    ["ready as a word", { type: "READY", ready: "yes" }],
    ["accept as a word", { type: "RESOLVE_TRADE", tradeId: "t_1", accept: "no" }],
    ["a type nobody sends", { type: "NOT_A_THING" }],
  ];

  it.each(malformed)("refuses %s, and leaves the run where it was", (_, intent) => {
    const context = ctx();
    const before = seatedParty(context);
    const result = applyIntent(before, { playerId: "p_1", intent: intent as ClientIntent }, context);
    expect(result.error?.code).toBe("ILLEGAL");
    expect(result.state).toEqual(before);
  });
});

describe("the end of a chapter", () => {
  /** The fixture chapter, played to its end by a party of two. */
  function toChapterEnd(context: EngineContext): RunState {
    const start = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: makeChapter().id } }],
      context,
    );

    let state = start.state;
    // Walk whatever is left of the chapter until it completes.
    for (let guard = 0; guard < 20 && state.phase !== "chapter_complete"; guard++) {
      const prompt = state.prompt;
      if (prompt?.kind === "choice") {
        for (const member of state.party) {
          state = applyIntent(
            state,
            { playerId: member.playerId, intent: { type: "CHOOSE", choiceId: prompt.options[0]!.id } },
            context,
          ).state;
          if (state.phase === "chapter_complete") break;
        }
      } else if (prompt?.kind === "roll") {
        const owner = state.party.find((m) => m.character.id === prompt.characterId)!;
        state = applyIntent(state, { playerId: owner.playerId, intent: { type: "ROLL" } }, context).state;
      } else if (prompt?.kind === "ready") {
        // An encounter. Everybody readies, the board goes up, and `walk` plays
        // the fight out. ADVANCE used to do this for free, back when the engine
        // handed out an automatic victory.
        state = walk(
          state,
          state.party.map((m) => ({
            playerId: m.playerId,
            intent: { type: "READY", ready: true } as ClientIntent,
          })),
          context,
        ).state;
      } else {
        state = applyIntent(state, { playerId: "p_1", intent: { type: "ADVANCE" } }, context).state;
      }
    }
    expect(state.phase).toBe("chapter_complete");
    return state;
  }

  it("ADVANCE returns the party to the lobby rather than doing nothing", () => {
    const context = ctx();
    const state = toChapterEnd(context);
    const result = applyIntent(state, { playerId: "p_1", intent: { type: "ADVANCE" } }, context);
    expect(result.error).toBeUndefined();

    // The completion screen offers a button; it has to land somewhere real.
    expect(result.state.phase).toBe("lobby");
    expect(result.state.chapterId).toBeNull();
    expect(result.state.chapterInfo).toBeNull();
    expect(result.state.prompt).toBeNull();
    expect(result.state.party).toHaveLength(2);
    expect(result.state.party.every((m) => !m.ready)).toBe(true);
  });

  it("leaves for the lobby only once everyone still reading has said they're done", () => {
    const context = ctx();
    const ended = toChapterEnd(context);
    // The vote starts from nobody, whatever was readied during the chapter.
    expect(ended.party.every((m) => !m.ready)).toBe(true);

    const one = applyIntent(ended, { playerId: "p_1", intent: { type: "READY", ready: true } }, context);
    expect(one.error).toBeUndefined();
    // p_2 is still on the summary: one phone's tap must not take it away.
    expect(one.state.phase).toBe("chapter_complete");
    expect(one.state.chapterId).not.toBeNull();

    const changedMind = applyIntent(one.state, { playerId: "p_1", intent: { type: "READY", ready: false } }, context);
    expect(changedMind.state.phase).toBe("chapter_complete");
    expect(changedMind.state.party.every((m) => !m.ready)).toBe(true);

    const both = walk(
      one.state,
      [{ playerId: "p_2", intent: { type: "READY", ready: true } }],
      context,
    ).state;
    expect(both.phase).toBe("lobby");
    expect(both.chapterId).toBeNull();
    expect(both.party.every((m) => !m.ready)).toBe(true);
  });

  it("does not wait on a phone that has dropped off", () => {
    const context = ctx();
    const ended = toChapterEnd(context);
    const gone = {
      ...ended,
      party: ended.party.map((m) => (m.playerId === "p_2" ? { ...m, connected: false } : m)),
    };
    const left = applyIntent(gone, { playerId: "p_1", intent: { type: "READY", ready: true } }, context);
    expect(left.state.phase).toBe("lobby");
  });
});

/**
 * The fixture chapter with an outcome, an award, or objectives bolted onto it.
 * Built by spreading rather than by editing test-fixtures.ts, so every other
 * suite keeps playing a chapter with none of these fields — which is the case
 * that has to keep working.
 */
function chapterWith(patch: {
  outcome?: ChapterOutcome;
  xpAward?: number;
  objectives?: ChapterObjective[];
  /** Effects on the ending scene itself, for flags decided at the last moment. */
  endingOnEnter?: StoryScene["onEnter"];
}): Chapter {
  const base = makeChapter();
  const ending = base.scenes["scene_ending"] as StoryScene;
  return {
    ...base,
    xpAward: patch.xpAward ?? base.xpAward,
    ...(patch.objectives ? { objectives: patch.objectives } : {}),
    scenes: {
      ...base.scenes,
      scene_ending: {
        ...ending,
        ...(patch.outcome ? { outcome: patch.outcome } : {}),
        ...(patch.endingOnEnter ? { onEnter: patch.endingOnEnter } : {}),
      },
    },
  };
}

/**
 * Plays `context.chapter` from the lobby to its ending, taking the high road
 * at the vote. Along the way the shrine sets `found_shrine` and the winning
 * choice sets `took_high` — the two flags the objective tests watch.
 */
function playToEnding(context: EngineContext): EngineResult {
  return walk(
    seatedParty(context),
    [
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: context.chapter!.id } },
      { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
      { playerId: "p_2", intent: { type: "ROLL" } },
      { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
      // The encounter. Both phones ready up, the board goes up, and `walk`
      // fights it out — a single ADVANCE used to cross it, back when the engine
      // handed out an automatic victory.
      { playerId: "p_1", intent: { type: "READY", ready: true } },
      { playerId: "p_2", intent: { type: "READY", ready: true } },
      { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "sleep" } },
      { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "high" } },
      { playerId: "p_2", intent: { type: "CHOOSE", choiceId: "high" } },
    ],
    context,
  );
}

describe("chapter outcomes (spec §8.2)", () => {
  it("pays half the award, rounded down, at a setback ending", () => {
    const context = ctx({ chapter: chapterWith({ outcome: "setback", xpAward: 101 }), rng: fixedRng(20) });
    const result = playToEnding(context);

    // 101 is deliberately odd: rounding this up or to nearest would pay 51 and
    // hand a family that failed the chapter more than the spec allows.
    expect(result.state.xpEarned).toBe(50);
    expect(result.state.chapterOutcome).toBe("setback");
    expect(result.presentation).toMatchObject({ kind: "CHAPTER_COMPLETE", outcome: "setback", xp: 50 });
  });

  it("does not turn a setback into a game over or a retry", () => {
    const context = ctx({ chapter: chapterWith({ outcome: "setback" }), rng: fixedRng(20) });
    const ended = playToEnding(context);

    // Play simply stopped at that ending. There is no losing phase to land in,
    // nothing offers the chapter again, and the party is still standing —
    // exactly like a failed check or a wipe (§6.1, §7.3).
    expect(ended.state.phase).toBe("chapter_complete");
    expect(ended.state.party).toHaveLength(2);
    expect(ended.state.party.some((m) => m.down)).toBe(false);

    const onward = applyIntent(ended.state, { playerId: "p_1", intent: { type: "ADVANCE" } }, context);
    expect(onward.error).toBeUndefined();
    expect(onward.state.phase).toBe("lobby");
  });

  it("starts the next chapter without the last one's ending hanging around", () => {
    const context = ctx({ chapter: chapterWith({ outcome: "setback" }), rng: fixedRng(20) });
    const ended = playToEnding(context);
    expect(ended.state.chapterOutcome).toBe("setback");
    // The trail is built by playing, so it is real rather than planted.
    expect((ended.state.visited ?? []).length).toBeGreaterThan(0);

    const restarted = walk(
      ended.state,
      [
        { playerId: "p_1", intent: { type: "ADVANCE" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
        { playerId: "p_2", intent: { type: "READY", ready: true } },
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: context.chapter!.id } },
      ],
      context,
    );

    // Left behind, a phone rendering from chapterOutcome would open the second
    // chapter of the evening under the first one's setback banner.
    expect(restarted.state.chapterOutcome).toBeNull();
    expect(restarted.state.bonuses).toEqual([]);
    expect(restarted.state.xpEarned).toBe(0);

    /*
     * The trail, which is chapter-scoped for exactly the same reason and was
     * missed the first time: carried across, the second chapter's recap
     * retells the first one's scenes and names rooms that are not in this
     * chapter at all.
     */
    expect(restarted.state.visited).toEqual(["scene_clearing"]);
  });
});

describe("bonus objectives (spec §8.2)", () => {
  const HIGH_ROAD: ChapterObjective = {
    id: "high_road",
    label: "Took the high road",
    flag: "took_high",
    xp: 30,
  };
  const SHRINE: ChapterObjective = {
    id: "shrine",
    label: "Found the shrine",
    flag: "found_shrine",
    xp: 30,
  };

  it("pays every objective whose flag is set, itemised, on top of the award", () => {
    const context = ctx({
      chapter: chapterWith({ objectives: [SHRINE, HIGH_ROAD] }),
      rng: fixedRng(20),
    });
    const result = playToEnding(context);

    // 300 award + 30 + 30. One number for the whole party, never per player —
    // there is no per-character XP anywhere for an objective to land in (§8.2,
    // "Why XP is never individual").
    expect(result.state.xpEarned).toBe(360);
    expect(result.state.bonuses).toEqual([
      { id: "shrine", label: "Found the shrine", xp: 30 },
      { id: "high_road", label: "Took the high road", xp: 30 },
    ]);
    // The breakdown has to add up to the total, or the completion screen
    // itemises to a different number than the one above it.
    expect(result.state.bonuses!.reduce((n, b) => n + b.xp, 0)).toBe(
      result.state.xpEarned - context.chapter!.xpAward,
    );
  });

  it("pays nothing for an objective the party did not meet", () => {
    const missed: ChapterObjective = { id: "low_road", label: "Took the low road", flag: "took_low", xp: 30 };
    const context = ctx({ chapter: chapterWith({ objectives: [missed] }), rng: fixedRng(20) });
    const result = playToEnding(context);

    // The walk votes "high", so took_low is never set. An objective that paid
    // out on an unset flag would pay every bonus in every chapter.
    expect(result.state.bonuses).toEqual([]);
    expect(result.state.xpEarned).toBe(300);
  });

  it("does not pay an objective whose flag was explicitly unset", () => {
    const context = ctx({
      chapter: chapterWith({
        objectives: [{ id: "almost", label: "Kept the lantern lit", flag: "lantern_lit", xp: 30 }],
        endingOnEnter: [{ type: "setFlag", flag: "lantern_lit", value: false }],
      }),
      rng: fixedRng(20),
    });
    const result = playToEnding(context);

    // `setFlag` carries a value, so a flag can be set to false — the lantern
    // you lit and then lost. A truthiness check would read `false` as "present
    // in flags" and pay for it.
    expect(result.state.flags["lantern_lit"]).toBe(false);
    expect(result.state.bonuses).toEqual([]);
    expect(result.state.xpEarned).toBe(300);
  });

  it("clamps the bonuses at 25% of the award however much a chapter asks for", () => {
    const greedy = chapterWith({
      xpAward: 100,
      objectives: [
        { ...SHRINE, xp: 60 },
        { ...HIGH_ROAD, xp: 60 },
      ],
    });
    const result = playToEnding(ctx({ chapter: greedy, rng: fixedRng(20) }));

    // tools/content/validate.mjs would never let this chapter into the repo,
    // but a hand-edited or stale one must not distort the pacing at the table:
    // 25 XP is the whole budget, and it is shared, not granted per objective.
    expect(result.state.xpEarned).toBe(125);
    expect(result.state.bonuses).toEqual([
      { id: "shrine", label: "Found the shrine", xp: 25 },
      // Still listed at nothing: the party did do it, and dropping it would
      // misreport the evening rather than just the arithmetic.
      { id: "high_road", label: "Took the high road", xp: 0 },
    ]);
  });
});

describe("a late joiner", () => {
  it("can still make a character after the chapter has started", () => {
    const context = ctx();
    const started = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: makeChapter().id } }],
      context,
    ).state;
    expect(started.phase).not.toBe("lobby");

    const result = applyIntent(started, { playerId: "p_3", intent: CREATE_UNICORN }, context);

    // Refusing here strands them: their phone offers the creation flow because
    // they have no character, and the server refuses the only thing they can do.
    expect(result.error).toBeUndefined();
    expect(result.state.party.some((m) => m.playerId === "p_3")).toBe(true);
  });

  it("does not drag the rest of the party off the scene they are playing", () => {
    const context = ctx();
    const started = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: makeChapter().id } }],
      context,
    ).state;

    const result = applyIntent(started, { playerId: "p_3", intent: CREATE_UNICORN }, context);

    // Flipping the run to "creation" would pull every other phone off the
    // scene while leaving sceneId and the open prompt in place.
    expect(result.state.phase).toBe(started.phase);
    expect(result.state.sceneId).toBe(started.sceneId);
    expect(result.state.prompt).toEqual(started.prompt);
  });
});

describe("START_CHAPTER guards", () => {
  it("refuses to start until everybody is ready", () => {
    const context = ctx();
    const result = applyIntent(
      seatedPartyNotReady(context),
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: makeChapter().id } },
      context,
    );
    expect(result.error?.code).toBe("ILLEGAL");
  });

  it("refuses to restart from the middle of a chapter", () => {
    const context = ctx();
    const started = walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: makeChapter().id } }],
      context,
    ).state;

    const result = applyIntent(
      started,
      { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: makeChapter().id } },
      context,
    );

    // The UI never offers this, but the UI is not the authority: a stale tap
    // would otherwise reset flags and XP and throw away the evening.
    expect(result.error?.code).toBe("ILLEGAL");
    expect(result.state.sceneId).toBe(started.sceneId);
  });
});

describe("items in a fight (spec §7.2's fourth universal action)", () => {
  /** Into the thicket fight with both bags stocked, and stay in it. */
  function midFight(context: EngineContext): RunState {
    let state = seatedParty(context);
    state = applyEffects(
      state,
      [
        { type: "grantItem", itemId: "brave_whistle", to: "p_1" },
        { type: "grantItem", itemId: "firecracker", to: "p_1" },
        { type: "grantItem", itemId: "brave_whistle", to: "p_2" },
        { type: "grantItem", itemId: "firecracker", to: "p_2" },
      ],
      context,
    );
    state = walk(
      state,
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
      ],
      context,
    ).state;
    // The last READY by hand — `walk` would helpfully play the whole fight out.
    const begun = applyIntent(state, { playerId: "p_2", intent: { type: "READY", ready: true } }, context);
    if (begun.error) throw new Error(`READY rejected: ${begun.error.message}`);
    if (!begun.state.encounter) throw new Error("expected a fight in progress");
    return begun.state;
  }

  function activeMember(state: RunState) {
    const actor = state.encounter ? currentActor(state.encounter) : null;
    const member = state.party.find((m) => m.character.id === actor?.id);
    if (!actor || !member) throw new Error("expected a party member on the clock");
    return member;
  }

  it("refuses a malformed move on the hero's own turn, rather than throwing out of the engine", () => {
    const context = ctx({ rng: fixedRng(20) });
    const state = midFight(context);
    const member = activeMember(state);
    for (const intent of [{ type: "MOVE" }, { type: "MOVE", to: null }, { type: "MOVE", to: { x: "1", y: 2 } }]) {
      const result = applyIntent(state, { playerId: member.playerId, intent: intent as ClientIntent }, context);
      expect(result.error?.code).toBe("ILLEGAL");
      expect(result.state).toEqual(state);
    }
  });

  it("a consumable is the turn's one action, and its bonus lands on the fight", () => {
    const context = ctx({ rng: fixedRng(20) });
    const state = midFight(context);
    const member = activeMember(state);

    const used = applyIntent(
      state,
      { playerId: member.playerId, intent: { type: "USE_ITEM", itemId: "brave_whistle" } },
      context,
    );
    expect(used.error).toBeUndefined();
    const combatant = used.state.encounter?.combatants.find((c) => c.id === member.character.id);
    expect(combatant?.rollBonus).toBe(2);
    // The item was the turn's one action, and a spent turn hands itself on
    // (`finishTurnIfSpent`): the clock has moved off this hero.
    expect(currentActorId(used.state.encounter!)).not.toBe(member.character.id);
    const bag = used.state.party
      .find((m) => m.playerId === member.playerId)!
      .character.inventory.map((e) => e.itemId);
    expect(bag).not.toContain("brave_whistle");

    // The turn is over — a second item from the same phone is refused as not
    // its turn any more, and *kept*.
    const again = applyIntent(
      used.state,
      { playerId: member.playerId, intent: { type: "USE_ITEM", itemId: "firecracker" } },
      context,
    );
    expect(again.error?.code).toBe("FORBIDDEN");
    expect(
      again.state.party
        .find((m) => m.playerId === member.playerId)!
        .character.inventory.map((e) => e.itemId),
    ).toContain("firecracker");
  });

  it("a thrown item needs a monster within range, and a refusal never costs the item", () => {
    const context = ctx({ rng: fixedRng(20) });
    const state = midFight(context);
    const member = activeMember(state);
    const encounter = state.encounter!;

    // The thicket seats the party on the west edge and the wisps on the east —
    // out of throwing range until somebody closes the gap.
    expect(legalItemTargets(encounter, member.character.id)).toEqual([]);
    const tooFar = applyIntent(
      state,
      {
        playerId: member.playerId,
        intent: { type: "USE_ITEM", itemId: "firecracker", targetId: "wisp#1" },
      },
      context,
    );
    expect(tooFar.error?.code).toBe("ILLEGAL");
    expect(
      tooFar.state.party
        .find((m) => m.playerId === member.playerId)!
        .character.inventory.map((e) => e.itemId),
    ).toContain("firecracker");

    // Walk east until a wisp is inside ITEM_RANGE, then throw.
    let working = state;
    for (let hop = 0; hop < 4; hop++) {
      const enc = working.encounter!;
      if (legalItemTargets(enc, member.character.id).length > 0) break;
      const moves = legalMoves(enc);
      const east = [...moves].sort((a, b) => b.x - a.x)[0];
      if (!east) throw new Error("expected a reachable tile to the east");
      const moved = applyIntent(
        working,
        { playerId: member.playerId, intent: { type: "MOVE", to: { x: east.x, y: east.y } } },
        context,
      );
      expect(moved.error).toBeUndefined();
      working = moved.state;
    }
    const targets = legalItemTargets(working.encounter!, member.character.id);
    expect(targets.length).toBeGreaterThan(0);
    const targetId = targets[0]!;
    const before = working.encounter!.combatants.find((c) => c.id === targetId)!.hp;

    const thrown = applyIntent(
      working,
      { playerId: member.playerId, intent: { type: "USE_ITEM", itemId: "firecracker", targetId } },
      context,
    );
    expect(thrown.error).toBeUndefined();
    expect(thrown.state.encounter?.combatants.find((c) => c.id === targetId)?.hp).toBe(before - 3);
    // The throw was the action; the turn ended with it.
    expect(currentActorId(thrown.state.encounter!)).not.toBe(member.character.id);
  });

  it("a no-op use is refused with the action and the item both intact", () => {
    /*
     * The review case: a heal at full HP, or a bonus no better than the one in
     * place, used to come back ok — spending the turn's action and, because
     * the engine consumes on success, the item itself. Both must be refusals
     * that leave everything exactly as it was.
     */
    const context = ctx({ rng: fixedRng(20) });
    const state = midFight(context);
    const member = activeMember(state);
    // Fresh out of the lobby, the party is at full health.
    expect(member.hp).toBe(member.character.maxHp);
    state.party.forEach((m) => {
      m.character.inventory = [
        { itemId: "sunbloom_draught", kind: "consumable" },
        { itemId: "brave_whistle", kind: "consumable" },
      ];
    });

    const fullHeal = applyIntent(
      state,
      { playerId: member.playerId, intent: { type: "USE_ITEM", itemId: "sunbloom_draught" } },
      context,
    );
    expect(fullHeal.error?.code).toBe("ILLEGAL");
    expect(fullHeal.state.encounter?.actionTaken).toBe(false);
    expect(
      fullHeal.state.party
        .find((m) => m.playerId === member.playerId)!
        .character.inventory.map((e) => e.itemId),
    ).toContain("sunbloom_draught");

    // A whistle no stronger than the bonus already in place is refused and
    // kept. The bonus is put there directly: a first whistle would spend the
    // action and, with it, the turn (`finishTurnIfSpent`).
    const braced = {
      ...state,
      encounter: {
        ...state.encounter!,
        combatants: state.encounter!.combatants.map((c) =>
          c.id === member.character.id ? { ...c, rollBonus: 2 } : c,
        ),
      },
    };
    const second = applyIntent(
      braced,
      { playerId: member.playerId, intent: { type: "USE_ITEM", itemId: "brave_whistle" } },
      context,
    );
    expect(second.error?.code).toBe("ILLEGAL");
    expect(second.state.encounter?.actionTaken).toBe(false);
    expect(
      second.state.party
        .find((m) => m.playerId === member.playerId)!
        .character.inventory.map((e) => e.itemId),
    ).toContain("brave_whistle");
  });

  it("only the player on the clock may use an item in a fight", () => {
    const context = ctx({ rng: fixedRng(20) });
    const state = midFight(context);
    const member = activeMember(state);
    const other = state.party.find((m) => m.playerId !== member.playerId)!;

    const stolen = applyIntent(
      state,
      { playerId: other.playerId, intent: { type: "USE_ITEM", itemId: "brave_whistle" } },
      context,
    );
    expect(stolen.error?.code).toBe("FORBIDDEN");
  });

  it("a heal at full health refuses outside a fight too, unconsumed", () => {
    // The same no-op rule as in combat, in the same order: an unheld item is
    // still NOT_FOUND first, and a held potion at full HP comes back ILLEGAL
    // with the bag untouched — never consumed for a heal of zero.
    const context = ctx();
    let state = seatedParty(context);
    state = applyEffects(state, [{ type: "grantItem", itemId: "sunbloom_draught", to: "p_1" }], context);
    expect(state.party[0]!.hp).toBe(state.party[0]!.character.maxHp);

    const result = applyIntent(
      state,
      { playerId: "p_1", intent: { type: "USE_ITEM", itemId: "sunbloom_draught" } },
      context,
    );
    expect(result.error?.code).toBe("ILLEGAL");
    expect(result.state.party[0]!.character.inventory.map((e) => e.itemId)).toContain(
      "sunbloom_draught",
    );

    const unheld = applyIntent(
      state,
      { playerId: "p_2", intent: { type: "USE_ITEM", itemId: "sunbloom_draught" } },
      context,
    );
    expect(unheld.error?.code).toBe("NOT_FOUND");
  });

  it("a combat-only item still refuses outside a fight, unconsumed", () => {
    const context = ctx();
    let state = seatedParty(context);
    state = applyEffects(state, [{ type: "grantItem", itemId: "firecracker", to: "p_1" }], context);
    const result = applyIntent(
      state,
      { playerId: "p_1", intent: { type: "USE_ITEM", itemId: "firecracker" } },
      context,
    );
    expect(result.error?.code).toBe("ILLEGAL");
    expect(result.state.party[0]!.character.inventory.map((e) => e.itemId)).toContain("firecracker");
  });
});

describe("narration variants and tokens (#159)", () => {
  /** The fixture chapter with variants and tokens on the shrine and the failed squeeze. */
  function chapterWithVariants(): Chapter {
    const chapter = makeChapter();
    const shrine = chapter.scenes["scene_shrine"] as StoryScene;
    shrine.variants = [
      // The shrine's own onEnter grants the key, so this holds on arrival.
      { when: { item: "rusted_key" }, text: "The key hums for {party}." },
      { when: { flag: "never_set" }, text: "This never reads." },
      { when: { count: { of: "facet_*", max: 0 } }, text: "Nothing glitters yet.", at: "start" },
    ];
    shrine.choices = [
      { id: "east", label: "Lead {party} east ({facets} facets)", icon: "arrow", goto: "encounter_wisps" },
    ];
    const squeeze = chapter.scenes["check_squeeze"];
    if (squeeze?.type !== "check") throw new Error("fixture changed");
    squeeze.onFailure.variants = [
      { when: { partySize: { min: 2 } }, text: "Luckily, {party} pull each other free." },
      { when: { partySize: { max: 1 } }, text: "You pull yourself free." },
    ];
    return chapter;
  }

  function atClearing(context: EngineContext): RunState {
    return walk(
      seatedParty(context),
      [{ playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }],
      context,
    ).state;
  }

  it("leaves narration exactly as authored when a scene has no variants or tokens", () => {
    const context = ctx({ chapter: chapterWithVariants() });
    expect(atClearing(context).narration).toBe("A wall of thorns twice your height.");
  });

  it("composes scene variants after onEnter, in order, and fills tokens in text and labels", () => {
    const context = ctx({ chapter: chapterWithVariants() });
    const state = walk(
      atClearing(context),
      [{ playerId: "p_1", intent: { type: "CHOOSE", choiceId: "over" } }],
      context,
    ).state;
    expect(state.sceneId).toBe("scene_shrine");
    expect(state.narration).toBe(
      [
        "Nothing glitters yet.",
        "A small stone shrine, half-swallowed by roots.",
        "The key hums for both of you.",
      ].join("\n\n"),
    );
    if (state.prompt?.kind !== "choice") throw new Error("expected a choice prompt");
    expect(state.prompt.options.map((o) => o.label)).toEqual(["Lead both of you east (no facets)"]);
  });

  it("shows branch narration variants on the scene the branch leads to", () => {
    const context = ctx({ chapter: chapterWithVariants(), rng: fixedRng(1) });
    const state = walk(
      atClearing(context),
      [
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
      ],
      context,
    ).state;
    expect(state.sceneId).toBe("scene_scratched");
    expect(state.narration).toBe(
      [
        "You get through, but the thorns take their toll.",
        "Luckily, both of you pull each other free.",
        "Scratched, but through.",
      ].join("\n\n"),
    );
  });

  it("writes parts beside the narration, each at the address it was authored at", () => {
    const context = ctx({ chapter: chapterWithVariants() });
    const state = walk(
      atClearing(context),
      [{ playerId: "p_1", intent: { type: "CHOOSE", choiceId: "over" } }],
      context,
    ).state;
    expect(state.narrationParts).toEqual([
      { address: "bramblewood-01/scene_shrine/variants/2", line: "Nothing glitters yet." },
      { address: "bramblewood-01/scene_shrine/narration", line: "A small stone shrine, half-swallowed by roots." },
      { address: "bramblewood-01/scene_shrine/variants/0", line: "The key hums for {party}.", token: { party: "2" } },
    ]);
  });

  it("tells identical words apart by where they were authored", () => {
    const chapter = chapterWithVariants();
    const squeeze = chapter.scenes["check_squeeze"];
    if (squeeze?.type !== "check") throw new Error("fixture changed");
    // Success and failure read the same and land in the same place.
    squeeze.onSuccess = { goto: "scene_scratched", narration: "Through the thorns." };
    squeeze.onFailure = { goto: "scene_scratched", narration: "Through the thorns." };
    const play = (roll: number) => {
      const context = ctx({ chapter, rng: fixedRng(roll) });
      return walk(
        atClearing(context),
        [
          { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
          { playerId: "p_2", intent: { type: "ROLL" } },
        ],
        context,
      ).state;
    };
    const won = play(20).narrationParts?.[0];
    const lost = play(1).narrationParts?.[0];
    expect(won?.line).toBe("Through the thorns.");
    expect(lost?.line).toBe(won?.line);
    expect(won?.address).toBe("bramblewood-01/check_squeeze/onSuccess/narration");
    expect(lost?.address).toBe("bramblewood-01/check_squeeze/onFailure/narration");
  });

  it("addresses a branch's line, its variants and the destination's own text", () => {
    const state = walk(
      atClearing(ctx({ chapter: chapterWithVariants() })),
      [
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
      ],
      ctx({ chapter: chapterWithVariants(), rng: fixedRng(1) }),
    ).state;
    expect(state.narrationParts?.map((part) => part.address)).toEqual([
      "bramblewood-01/check_squeeze/onFailure/narration",
      "bramblewood-01/check_squeeze/onFailure/variants/0",
      "bramblewood-01/scene_scratched/narration",
    ]);
  });

  it("stores the composed text, so a reload mid-scene reads the same words", () => {
    const context = ctx({ chapter: chapterWithVariants() });
    const state = walk(
      atClearing(context),
      [{ playerId: "p_1", intent: { type: "CHOOSE", choiceId: "over" } }],
      context,
    ).state;

    // A reload is a fresh copy of the persisted JSON.
    const reloaded = JSON.parse(JSON.stringify(state)) as RunState;
    expect(reloaded.narration).toBe(state.narration);
    expect(reloaded.prompt).toEqual(state.prompt);

    // And it is not recomputed against a party that has since changed: the
    // words were fixed when the scene opened.
    for (const member of reloaded.party) member.character.questItems = ["facet_ember"];
    const reconnected = applyIntent(
      reloaded,
      { playerId: "p_2", intent: { type: "READY", ready: true } },
      context,
    ).state;
    expect(reconnected.sceneId).toBe("scene_shrine");
    expect(reconnected.narration).toBe(state.narration);
    expect(reconnected.narration).not.toContain("{");
  });
});

/*
 * Drop in, drop out (#258). Every place the table waits on one player, with
 * that player's phone gone: the table can always go on, and the absent hero
 * is the same hero when their phone comes back. Each case sets `connected`
 * by hand, the way presence (server handlers/presence.ts) or Remove does.
 */
describe("a player who steps away (#258)", () => {
  function away(state: RunState, playerId: string, gone = true): RunState {
    return {
      ...state,
      party: state.party.map((m) => (m.playerId === playerId ? { ...m, connected: !gone } : m)),
    };
  }

  /** At the pre-fight ready-up, before anybody has said ready. */
  function atFight(context: EngineContext): RunState {
    return walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
      ],
      context,
    ).state;
  }

  /** In the fight, on a hero's turn, with its owner and the other player named. */
  function onAHerosTurn(context: EngineContext) {
    const ready = applyIntent(atFight(context), { playerId: "p_1", intent: { type: "READY", ready: true } }, context);
    const state = applyIntent(ready.state, { playerId: "p_2", intent: { type: "READY", ready: true } }, context).state;
    const actor = currentActor(state.encounter!)!;
    expect(actor.side).toBe("party");
    const owner = state.party.find((m) => m.character.id === actor.id)!;
    const other = state.party.find((m) => m.playerId !== owner.playerId)!;
    return { state, actor, owner, other };
  }

  it("lets anyone at the table pass an absent hero's combat turn, and nothing more", () => {
    const context = ctx({ rng: fixedRng(20) });
    const { state, actor, owner, other } = onAHerosTurn(context);
    const gone = away(state, owner.playerId);
    expect(combatTurnAway(state)).toBe(false);
    expect(combatTurnAway(gone)).toBe(true);

    // Not their move or their action: a stand-in only hands the clock on.
    const moved = applyIntent(
      gone,
      { playerId: other.playerId, intent: { type: "COMBAT_ACTION", abilityId: "ready" } },
      context,
    );
    expect(moved.error?.code).toBe("FORBIDDEN");

    const passed = applyIntent(gone, { playerId: other.playerId, intent: { type: "END_TURN" } }, context);
    expect(passed.error).toBeUndefined();
    expect(currentActorId(passed.state.encounter!)).not.toBe(actor.id);
    // Still on the board, in the order, with every hit point they had.
    const hero = passed.state.encounter!.combatants.find((c) => c.id === actor.id)!;
    expect(passed.state.encounter!.board.actors.some((a) => a.id === actor.id)).toBe(true);
    expect(hero.down).toBe(false);
  });

  it("keeps a present player's turn their own", () => {
    const context = ctx({ rng: fixedRng(20) });
    const { state, other } = onAHerosTurn(context);
    // The *other* player stepping away changes nothing about this turn.
    const result = applyIntent(away(state, other.playerId), { playerId: other.playerId, intent: { type: "END_TURN" } }, context);
    expect(result.error?.code).toBe("FORBIDDEN");
  });

  it("gives the turn back to a player whose phone returns", () => {
    const context = ctx({ rng: fixedRng(20) });
    const { state, owner, other } = onAHerosTurn(context);
    const back = away(away(state, owner.playerId), owner.playerId, false);
    expect(combatTurnAway(back)).toBe(false);
    expect(applyIntent(back, { playerId: other.playerId, intent: { type: "END_TURN" } }, context).error?.code).toBe(
      "FORBIDDEN",
    );
    const acted = applyIntent(
      back,
      { playerId: owner.playerId, intent: { type: "COMBAT_ACTION", abilityId: "ready" } },
      context,
    );
    expect(acted.error).toBeUndefined();
  });

  it("starts the fight without an absent player once the rest are ready", () => {
    const context = ctx({ rng: fixedRng(20) });
    const ready = applyIntent(atFight(context), { playerId: "p_1", intent: { type: "READY", ready: true } }, context).state;
    // p_2 drops before saying ready. Nothing counts until a tap lands, so
    // the ready player says it again (the phone offers "Start without ...").
    const gone = away(ready, "p_2");
    expect(gone.encounter).toBeFalsy();
    const again = applyIntent(gone, { playerId: "p_1", intent: { type: "READY", ready: true } }, context);
    expect(again.error).toBeUndefined();
    expect(again.state.encounter).toBeTruthy();
    // The absent hero is in the fight, on the board, to come back to.
    const griffin = gone.party.find((m) => m.playerId === "p_2")!;
    expect(again.state.encounter!.combatants.some((c) => c.id === griffin.character.id)).toBe(true);
  });

  it("closes a vote whose last voter stepped away when a voter says it again", () => {
    const context = ctx({ rng: fixedRng(20) });
    const atRest = walk(
      atFight(context),
      [
        { playerId: "p_1", intent: { type: "READY", ready: true } },
        { playerId: "p_2", intent: { type: "READY", ready: true } },
      ],
      context,
    ).state;
    const atRidge = walk(atRest, [{ playerId: "p_1", intent: { type: "CHOOSE", choiceId: "sleep" } }], context).state;
    const voted = applyIntent(atRidge, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "high" } }, context).state;
    const prompt = voted.prompt as Extract<RunState["prompt"], { kind: "choice" }>;
    expect(voteWaitsOnlyOnAway(voted.party, prompt)).toBe(false);

    const gone = away(voted, "p_2");
    expect(voteWaitsOnlyOnAway(gone.party, prompt)).toBe(true);
    const closed = applyIntent(gone, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "high" } }, context);
    expect(closed.error).toBeUndefined();
    expect(closed.state.sceneId).toBe("scene_ending");
  });

  it("lets anyone leave an absent player's find, and never empty their bag", () => {
    const context = ctx();
    let state = seatedParty(context);
    for (const itemId of ["river_charm", "emberglass_shard", "oak_token", "pebble", "acorn", "feather", "ribbon"]) {
      state = applyEffects(state, [{ type: "grantItem", itemId, to: "p_1" }], context);
    }
    const gone = away(state, "p_1");
    const prompt = gone.prompt as Extract<RunState["prompt"], { kind: "item_swap" }>;
    expect(swapOwnerAway(state.party, prompt)).toBe(false);
    expect(swapOwnerAway(gone.party, prompt)).toBe(true);

    const dropped = applyIntent(gone, { playerId: "p_2", intent: { type: "RESOLVE_ITEM_SWAP", dropItemId: "pebble" } }, context);
    expect(dropped.error?.code).toBe("FORBIDDEN");
    const left = applyIntent(gone, { playerId: "p_2", intent: { type: "RESOLVE_ITEM_SWAP", dropItemId: null } }, context);
    expect(left.error).toBeUndefined();
    expect(left.state.prompt).toBeNull();
    expect(left.state.party[0]!.character.inventory).toEqual(state.party[0]!.character.inventory);
  });

  it("starts a chapter from the lobby without a player who stepped away", () => {
    const context = ctx();
    const seated = seatedPartyNotReady(context);
    const ready = applyIntent(seated, { playerId: "p_1", intent: { type: "READY", ready: true } }, context).state;
    const start = { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } as ClientIntent };

    expect(applyIntent(ready, start, context).error?.code).toBe("ILLEGAL");
    const started = applyIntent(away(ready, "p_2"), start, context);
    expect(started.error).toBeUndefined();
    // Their hero comes along, to play the moment their phone is back.
    expect(started.state.party.map((m) => m.playerId)).toEqual(["p_1", "p_2"]);
  });

  it("never starts a chapter with nobody at the table", () => {
    expect(readyWithoutAway([])).toBe(false);
    const context = ctx();
    const ready = seatedParty(context);
    expect(readyWithoutAway(ready.party)).toBe(true);
    expect(readyWithoutAway(away(away(ready, "p_1"), "p_2").party)).toBe(false);
  });
});

describe("XP for rolls that go well", () => {
  const paying = makeRules({ rollXp: { check: 2, attack: 1, natural20: 3, chapterCap: 5 } });

  function atCheck(context: EngineContext): RunState {
    return walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
      ],
      context,
    ).state;
  }

  /** Every hero's roll XP, added up: what the rolls paid, however it was split. */
  function heroTotal(state: RunState): number {
    return Object.values(state.heroRollXp ?? {}).reduce((sum, xp) => sum + xp, 0);
  }

  it("pays the hero who makes a check that succeeds, and the party nothing", () => {
    const context = ctx({ rules: makeRules({ rollXp: { check: 2, attack: 1, chapterCap: 5 } }), rng: fixedRng(20) });
    const state = atCheck(context);
    const rolled = applyIntent(state, { playerId: "p_2", intent: { type: "ROLL" } }, context).state;
    const roller = rolled.lastRoll?.characterId ?? "";
    expect(rolled.lastRoll?.result).toBe("success");
    expect(rolled.xpEarned).toBe(state.xpEarned);
    expect(rolled.heroRollXp).toEqual({ [roller]: 2 });
  });

  it("pays nothing for a check that fails", () => {
    const context = ctx({ rules: paying, rng: fixedRng(1) });
    const state = atCheck(context);
    const rolled = applyIntent(state, { playerId: "p_2", intent: { type: "ROLL" } }, context).state;
    expect(rolled.lastRoll?.result).toBe("failure");
    expect(rolled.xpEarned).toBe(state.xpEarned);
    expect(rolled.heroRollXp).toBeUndefined();
  });

  it("pays nothing when the rules have no roll XP", () => {
    const context = ctx({ rng: fixedRng(20) });
    const state = atCheck(context);
    const rolled = applyIntent(state, { playerId: "p_2", intent: { type: "ROLL" } }, context).state;
    expect(rolled.xpEarned).toBe(state.xpEarned);
    expect(rolled.heroRollXp).toBeUndefined();
  });

  it("pays a natural 20 on top of the check it succeeds, to the hero who rolled it", () => {
    const context = ctx({ rules: makeRules({ rollXp: { check: 2, attack: 1, natural20: 3, chapterCap: 100 } }), rng: fixedRng(20) });
    const state = atCheck(context);
    const rolled = applyIntent(state, { playerId: "p_2", intent: { type: "ROLL" } }, context).state;
    const roller = rolled.lastRoll?.characterId ?? "";
    expect(rolled.xpEarned).toBe(state.xpEarned);
    expect(rolled.heroRollXp).toEqual({ [roller]: 5 });
  });

  it("pays no natural 20 bonus for a roll that is not one", () => {
    const context = ctx({ rules: makeRules({ rollXp: { check: 2, attack: 1, natural20: 3, chapterCap: 100 } }), rng: fixedRng(19) });
    const state = atCheck(context);
    const rolled = applyIntent(state, { playerId: "p_2", intent: { type: "ROLL" } }, context).state;
    expect(rolled.lastRoll?.die).toBe(19);
    expect(heroTotal(rolled)).toBe(rolled.lastRoll?.result === "success" ? 2 : 0);
  });

  it("pays nobody but the roller", () => {
    const context = ctx({ rules: makeRules({ rollXp: { check: 2, attack: 1, natural20: 3, chapterCap: 100 } }), rng: fixedRng(20) });
    const state = atCheck(context);
    const rolled = applyIntent(state, { playerId: "p_2", intent: { type: "ROLL" } }, context).state;
    const others = rolled.party.filter((m) => m.character.id !== rolled.lastRoll?.characterId);
    expect(others.length).toBeGreaterThan(0);
    for (const m of others) expect(rolled.heroRollXp?.[m.character.id] ?? 0).toBe(0);
  });

  it("keeps a chapter begun before individual roll XP on its one shared pot", () => {
    const context = ctx({ rules: makeRules({ rollXp: { check: 2, attack: 1, natural20: 3, chapterCap: 30 } }), rng: fixedRng(20) });
    // A run persisted before roll XP was individual: 28 of the shared 30 already paid.
    const state: RunState = { ...atCheck(context), rollXp: 28 };
    const rolled = applyIntent(state, { playerId: "p_2", intent: { type: "ROLL" } }, context).state;
    expect(rolled.xpEarned).toBe(state.xpEarned + 2);
    expect(rolled.rollXp).toBe(30);
    expect(rolled.heroRollXp).toBeUndefined();
  });

  it("clears a legacy shared pot when the next chapter starts", () => {
    const context = ctx({ rules: paying, rng: fixedRng(20) });
    const seated: RunState = { ...seatedParty(context), rollXp: 28 };
    const started = applyIntent(seated, { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } }, context).state;
    expect(started.rollXp).toBeUndefined();
  });

  it("stops at the chapter's cap, for each hero on her own", () => {
    const context = ctx({ rules: makeRules({ rollXp: { check: 2, attack: 1, chapterCap: 3 } }), rng: fixedRng(20) });
    const base = atCheck(context);
    const state: RunState = {
      ...base,
      heroRollXp: Object.fromEntries(base.party.map((m) => [m.character.id, 2])),
    };
    const rolled = applyIntent(state, { playerId: "p_2", intent: { type: "ROLL" } }, context).state;
    const roller = rolled.lastRoll?.characterId ?? "";
    expect(rolled.heroRollXp?.[roller]).toBe(3);
    for (const m of rolled.party) {
      if (m.character.id !== roller) expect(rolled.heroRollXp?.[m.character.id]).toBe(2);
    }
  });

  it("pays each hero for her own hits in a fight, and the party nothing", () => {
    const context = ctx({ rules: makeRules({ rollXp: { check: 2, attack: 1, chapterCap: 100 } }), rng: fixedRng(20) });
    let state = walk(
      seatedParty(context),
      [
        { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
        { playerId: "p_2", intent: { type: "ROLL" } },
        { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
        { playerId: "p_1", intent: { type: "READY", ready: true } },
      ],
      context,
    ).state;
    const checkXp = heroTotal(state);
    const partyXp = state.xpEarned;
    const begun = applyIntent(state, { playerId: "p_2", intent: { type: "READY", ready: true } }, context);
    if (!begun.state.encounter) throw new Error("expected a fight in progress");
    state = fightToTheEnd(begun.state, context);
    expect(heroTotal(state)).toBeGreaterThan(checkXp);
    expect(state.xpEarned).toBe(partyXp);
  });

  it("pays the hero who lands a natural 20 an attack", () => {
    const play = (natural20: number): { heroes: number; party: number } => {
      const context = ctx({ rules: makeRules({ rollXp: { check: 0, attack: 1, natural20, chapterCap: 1000 } }), rng: fixedRng(20) });
      const state = walk(
        seatedParty(context),
        [
          { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
          { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
          { playerId: "p_2", intent: { type: "ROLL" } },
          { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
          { playerId: "p_1", intent: { type: "READY", ready: true } },
        ],
        context,
      ).state;
      const begun = applyIntent(state, { playerId: "p_2", intent: { type: "READY", ready: true } }, context);
      const done = fightToTheEnd(begun.state, context);
      return { heroes: heroTotal(done), party: done.xpEarned };
    };
    expect(play(3).heroes).toBeGreaterThan(play(0).heroes);
  });

  it("pays the acting hero exactly attack plus natural 20 for one natural 20 attack, and nobody else", () => {
    const context = ctx({ rules: makeRules({ rollXp: { check: 2, attack: 1, natural20: 3, chapterCap: 100 } }), rng: fixedRng(20) });
    const begun = applyIntent(
      walk(
        seatedParty(context),
        [
          { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
          { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
          { playerId: "p_2", intent: { type: "ROLL" } },
          { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
          { playerId: "p_1", intent: { type: "READY", ready: true } },
        ],
        context,
      ).state,
      { playerId: "p_2", intent: { type: "READY", ready: true } },
      context,
    ).state;
    const combatContext = { rules: context.rules, abilities: context.abilities ?? {}, rng: context.rng };
    // Play the fight forward, a turn at a time, until a hero has a swing in reach.
    let ready = begun;
    for (let turn = 0; turn < 40; turn++) {
      const enc = ready.encounter!;
      const actor = currentActor(enc);
      const member = actor ? ready.party.find((m) => m.character.id === actor.id) : undefined;
      if (!actor || !member) break;
      if (legalActions(enc, combatContext).some((a: LegalAction) => a.targets.length > 0)) break;
      const at = enc.board.actors.find((a) => a.id === actor.id);
      const plan = at
        ? planEnemyTurn({
            board: enc.board,
            enemy: { id: actor.id, at: { x: at.x, y: at.y }, steps: actor.steps },
            party: enc.combatants
              .filter((c) => c.side === "enemy")
              .map((c) => {
                const spot = enc.board.actors.find((a) => a.id === c.id);
                return { id: c.id, at: { x: spot?.x ?? 0, y: spot?.y ?? 0 }, hp: c.hp, maxHp: c.maxHp, down: c.down };
              }),
          })
        : undefined;
      if (plan?.moveTo) {
        const moved = applyIntent(ready, { playerId: member.playerId, intent: { type: "MOVE", to: plan.moveTo } as ClientIntent }, context);
        if (!moved.error) ready = moved.state;
      }
      if (legalActions(ready.encounter!, combatContext).some((a: LegalAction) => a.targets.length > 0)) break;
      ready = applyIntent(ready, { playerId: member.playerId, intent: { type: "END_TURN" } as ClientIntent }, context).state;
    }
    const encounter = ready.encounter!;
    const actorId = currentActorId(encounter);
    const member = ready.party.find((m) => m.character.id === actorId);
    if (!member) throw new Error("expected a hero to act first");
    const attack = legalActions(encounter, combatContext).find((a: LegalAction) => a.targets.length > 0);
    if (!attack) throw new Error("expected the hero to have an attack in reach");

    const swung = applyIntent(
      ready,
      { playerId: member.playerId, intent: { type: "COMBAT_ACTION", abilityId: attack.abilityId, targetId: attack.targets[0]! } as ClientIntent },
      context,
    );
    expect(swung.error).toBeUndefined();
    const before = ready.heroRollXp ?? {};
    const after = swung.state.heroRollXp ?? {};
    // A natural 20 always hits: 1 for the attack, 3 more for the natural 20.
    expect((after[actorId!] ?? 0) - (before[actorId!] ?? 0)).toBe(4);
    for (const m of ready.party) {
      if (m.character.id === actorId) continue;
      expect(after[m.character.id] ?? 0).toBe(before[m.character.id] ?? 0);
    }
    expect(swung.state.xpEarned).toBe(ready.xpEarned);
  });

  it("pays more when foes are knocked out, to the hero who knocks them out", () => {
    const play = (defeat: number): number => {
      const context = ctx({ rules: makeRules({ rollXp: { check: 0, attack: 1, defeat, chapterCap: 1000 } }), rng: fixedRng(20) });
      const state = walk(
        seatedParty(context),
        [
          { playerId: "p_1", intent: { type: "START_CHAPTER", chapterId: "bramblewood-01" } },
          { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "squeeze" } },
          { playerId: "p_2", intent: { type: "ROLL" } },
          { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "east" } },
          { playerId: "p_1", intent: { type: "READY", ready: true } },
        ],
        context,
      ).state;
      const begun = applyIntent(state, { playerId: "p_2", intent: { type: "READY", ready: true } }, context);
      // Every foe one hit from down, so the fight does not hinge on the helper's aim.
      const fragile = {
        ...begun.state,
        encounter: {
          ...begun.state.encounter!,
          combatants: begun.state.encounter!.combatants.map((c) => (c.side === "enemy" ? { ...c, hp: 1 } : c)),
        },
      };
      return heroTotal(fightToTheEnd(fragile, context));
    };
    expect(play(5)).toBeGreaterThan(play(0));
  });
});
