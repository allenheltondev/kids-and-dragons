import { describe, expect, it } from "vitest";

import {
  applyEffects,
  applyIntent,
  createRunState,
  currentChoices,
  enterScene,
  isPartyDown,
} from "./engine.js";
import type { EngineContext, EngineResult } from "./engine.js";
import {
  currentActor,
  legalActions,
  legalItemTargets,
  legalMoves,
  type LegalAction,
} from "./encounter.js";
import { planEnemyTurn } from "./enemy-ai.js";
import { makeRng } from "./dice.js";
import type { Rng } from "./dice.js";
import type { ClientIntent } from "./types/protocol.js";
import { INVENTORY_SLOTS, MAX_PARTY } from "./types/domain.js";
import type { RunState } from "./types/state.js";
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
      ? [
          { type: "COMBAT_ACTION", abilityId: attack.abilityId, targetId: attack.targets[0]! } as ClientIntent,
          { type: "END_TURN" } as ClientIntent,
        ]
      : [{ type: "END_TURN" } as ClientIntent];

    for (const intent of finish) {
      const result = applyIntent(current, { playerId: member.playerId, intent }, context);
      if (result.error) return current;
      current = result.state;
      if (!current.encounter) return current;
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
  for (const step of steps) {
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

  it("nominates the best roller and opens a roll prompt", () => {
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

  it("breaks a tied vote toward the first player in party order", () => {
    const context = ctx({ rng: fixedRng(20) });
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

    // One vote each, so it is tied — p_1 votes first in party order and wins.
    const settled = applyIntent(atRidge, { playerId: "p_1", intent: { type: "CHOOSE", choiceId: "high" } }, context);
    expect(settled.state.flags["took_high"]).toBe(true);
    expect(settled.state.flags["took_low"]).toBeUndefined();
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

describe("the end of a chapter", () => {
  it("ADVANCE returns the party to the lobby rather than doing nothing", () => {
    const context = ctx();
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

    const result = applyIntent(state, { playerId: "p_1", intent: { type: "ADVANCE" } }, context);
    expect(result.error).toBeUndefined();

    // The completion screen offers a button; it has to land somewhere real.
    expect(result.state.phase).toBe("lobby");
    expect(result.state.chapterId).toBeNull();
    expect(result.state.prompt).toBeNull();
    expect(result.state.party).toHaveLength(2);
    expect(result.state.party.every((m) => !m.ready)).toBe(true);
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
    expect(used.state.encounter?.actionTaken).toBe(true);
    const bag = used.state.party
      .find((m) => m.playerId === member.playerId)!
      .character.inventory.map((e) => e.itemId);
    expect(bag).not.toContain("brave_whistle");

    // The action is spent — a second item this turn is refused, and *kept*.
    const again = applyIntent(
      used.state,
      { playerId: member.playerId, intent: { type: "USE_ITEM", itemId: "firecracker" } },
      context,
    );
    expect(again.error?.code).toBe("ILLEGAL");
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
    expect(thrown.state.encounter?.actionTaken).toBe(true);
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

    // First whistle lands; a second, no stronger, is refused and kept.
    const first = applyIntent(
      state,
      { playerId: member.playerId, intent: { type: "USE_ITEM", itemId: "brave_whistle" } },
      context,
    );
    expect(first.error).toBeUndefined();
    const rearmed = { ...first.state, encounter: { ...first.state.encounter!, actionTaken: false } };
    rearmed.party
      .find((m) => m.playerId === member.playerId)!
      .character.inventory = [{ itemId: "brave_whistle", kind: "consumable" }];
    const second = applyIntent(
      rearmed,
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
