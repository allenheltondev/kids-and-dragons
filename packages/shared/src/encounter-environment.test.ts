/**
 * Environmental combat (#201): the place fighting back.
 *
 * Three layers, the way the feature is built. The rules (`endTurnWithEvents`)
 * on small hand-built boards, one rule per test; the authoring check
 * (`checkEncounterEnvironment`) against the sandbox chapter and bent copies of
 * it; and the sandbox chapter played through the engine to each of its four
 * endings, on rigged dice so every run is the same run. The Gemfall side —
 * that a fight with no environment is byte-for-byte the fight it was — is
 * pinned here structurally and in ordered-campaigns.test.ts by the #200 digest.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  beginEncounter,
  combatantById,
  currentActorId,
  encounterOutcome,
  endTurn,
  endTurnWithEvents,
  legalActions,
  legalMoves,
  moveTo,
  positionOf,
  type AbilityCatalog,
  type EncounterEvent,
  type EncounterSetup,
  type EncounterState,
} from "./encounter.js";
import { checkEncounterEnvironment, environmentView } from "./environment.js";
import { applyIntent, createRunState, type EngineContext } from "./engine.js";
import { validateChapter } from "./chapter-graph.js";
import { parseCampaignGraph } from "./campaign-graph.js";
import { completeVisit, startJourney } from "./journey.js";
import { worldFacts } from "./world-state.js";
import { parseBoard, stepsBetween, terrainAt, type Position } from "./grid.js";
import type { Rng } from "./dice.js";
import { resolveCharacter } from "./character.js";
import { APPEARANCE, makeCharacter, makeItems, makeRules } from "./test-fixtures.js";
import type { Campaign, Chapter, EncounterEnvironment, EncounterMap, EncounterScene, EnemySpec } from "./types/chapter.js";
import type { ClientIntent } from "./types/protocol.js";
import type { RunState } from "./types/state.js";

const RULES = makeRules();
const ITEMS = makeItems();
/** Every die lands on `die`: 1 misses everything, 20 hits everything. */
const ALWAYS: (die: number) => Rng = (die) => ({ next: () => (die - 1) / 20 + 0.001 });
const ctxOf = (rng: Rng = ALWAYS(1)) => ({ rules: RULES, abilities: {} as AbilityCatalog, rng });

const WISP: EnemySpec = { id: "wisp", count: 1, hp: 6, guard: 9, quick: 0, steps: 3, attack: 2 };

function hero(id: string) {
  // Quick 3 beats any monster here, so the heroes always go first.
  return resolveCharacter(
    makeCharacter({ id, name: id, species: "unicorn", class: "thornguard", stats: { might: 1, quick: 3, clever: 0, heart: 0 } }),
    RULES,
    ITEMS,
  );
}

function setup(environment?: EncounterEnvironment, hp: { a?: number; b?: number } = {}): EncounterSetup {
  return {
    board: parseBoard(Array.from({ length: 8 }, () => ".".repeat(10))),
    party: [
      { character: hero("c_a"), at: { x: 0, y: 3 }, ...(hp.a !== undefined ? { hp: hp.a } : {}) },
      { character: hero("c_b"), at: { x: 0, y: 4 }, ...(hp.b !== undefined ? { hp: hp.b } : {}) },
    ],
    enemies: [{ spec: WISP, at: { x: 9, y: 3 } }],
    ...(environment ? { environment } : {}),
  };
}

function begin(environment?: EncounterEnvironment, hp?: { a?: number; b?: number }): EncounterState {
  return beginEncounter(setup(environment, hp), ctxOf());
}

function walk(state: EncounterState, to: Position): EncounterState {
  const moved = moveTo(state, to);
  if (!moved.ok) throw new Error(moved.reason);
  return moved.state;
}

/** Ends turns until it is `id`'s turn, collecting what the environment did. */
function until(state: EncounterState, id: string, events: EncounterEvent[] = []): EncounterState {
  let s = state;
  for (let guard = 0; guard < 30 && currentActorId(s) !== id; guard++) {
    const ended = endTurnWithEvents(s);
    events.push(...ended.events);
    s = ended.state;
  }
  if (currentActorId(s) !== id) throw new Error(`never reached ${id}'s turn`);
  return s;
}

const types = (events: readonly EncounterEvent[]) => events.map((e) => e.type);

// ---------------------------------------------------------------------------
// No environment: nothing changes
// ---------------------------------------------------------------------------

describe("a fight without an environment", () => {
  it("has no environment key, no escaped figure, and endTurnWithEvents is endTurn with no events", () => {
    let state = begin();
    expect(state).not.toHaveProperty("environment");
    for (let i = 0; i < 9; i++) {
      const ended = endTurnWithEvents(state);
      expect(ended.events).toEqual([]);
      expect(ended.state).toEqual(endTurn(state));
      state = ended.state;
    }
    expect(JSON.stringify(state)).not.toContain("escaped");
    expect(encounterOutcome(state)).toBe("ongoing");
  });
});

// ---------------------------------------------------------------------------
// The rules, one at a time
// ---------------------------------------------------------------------------

describe("hazards", () => {
  const FIRE: EncounterEnvironment = {
    hazards: [{ id: "fire", kind: "fire", label: "Rift fire", tiles: [{ x: 2, y: 3 }, { x: 9, y: 3 }], damage: 2 }],
  };

  it("hurt a hero who stops on one — not a hit: no roll, straight off the hearts", () => {
    const state = walk(begin(FIRE), { x: 2, y: 3 });
    const before = combatantById(state, "c_a")!.hp;
    const ended = endTurnWithEvents(state);
    expect(ended.events).toEqual([
      { type: "hazard", actorId: "c_a", hazardId: "fire", label: "Rift fire" },
      { type: "damage", actorId: "c_a", amount: 2, hp: before - 2 },
    ]);
    expect(currentActorId(ended.state)).toBe("c_b");
  });

  it("do nothing to a hero who stops off them", () => {
    const ended = endTurnWithEvents(walk(begin(FIRE), { x: 3, y: 3 }));
    expect(ended.events).toEqual([]);
  });

  it("hurt monsters too: the rift takes no sides", () => {
    // The wisp stands on its spawn, which is burning, and never moves.
    const ended = endTurnWithEvents(until(begin(FIRE), "wisp#1"));
    expect(types(ended.events)).toEqual(["hazard", "damage"]);
    expect(combatantById(ended.state, "wisp#1")!.hp).toBe(WISP.hp - 2);
  });

  it("only bite while active", () => {
    const later: EncounterEnvironment = { hazards: [{ ...FIRE.hazards![0]!, fromRound: 2 }] };
    let state = walk(begin(later), { x: 2, y: 3 });
    const first = endTurnWithEvents(state);
    expect(first.events).toEqual([]);
    state = until(first.state, "c_a");
    expect(state.round).toBe(2);
    expect(types(endTurnWithEvents(state).events)).toEqual(["hazard", "damage"]);
  });
});

describe("exits", () => {
  const TEAR: EncounterEnvironment = {
    exits: [{ id: "tear", label: "The tear", tiles: [{ x: 2, y: 3 }, { x: 2, y: 4 }], opensRound: 2 }],
  };

  it("are nothing while closed, and step a hero out of the fight once open", () => {
    let state = walk(begin(TEAR), { x: 2, y: 3 });
    const closed = endTurnWithEvents(state);
    expect(closed.events).toEqual([]);
    state = until(closed.state, "c_a");
    expect(state.round).toBe(2);

    const out = endTurnWithEvents(state);
    expect(out.events).toEqual([{ type: "escaped", actorId: "c_a", exitId: "tear" }]);
    expect(combatantById(out.state, "c_a")).toMatchObject({ escaped: true, down: false });
    expect(positionOf(out.state, "c_a")).toBeNull();
    expect(encounterOutcome(out.state)).toBe("ongoing");

    // Gone from the turn order and from everybody's reach.
    let s = out.state;
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push(currentActorId(s)!);
      s = endTurn(s);
    }
    expect(seen).not.toContain("c_a");
    expect(legalActions(s, ctxOf()).flatMap((a) => a.targets)).not.toContain("c_a");
  });

  it("end the fight as an escape once every hero still standing is through", () => {
    let state = until(walk(begin(TEAR), { x: 2, y: 3 }), "c_b");
    state = until(walk(state, { x: 2, y: 4 }), "c_a");
    state = endTurnWithEvents(state).state; // c_a through
    expect(encounterOutcome(state)).toBe("ongoing");
    const last = endTurnWithEvents(state); // c_b through
    expect(types(last.events)).toEqual(["escaped"]);
    expect(encounterOutcome(last.state)).toBe("escaped");
  });

  it("pull a knocked-down friend through: partly out and partly down is an escape, not a defeat", () => {
    let state = beginEncounter(
      { ...setup(TEAR), party: [setup().party[0]!, { ...setup().party[1]!, hp: 0, down: true }] },
      ctxOf(),
    );
    state = until(endTurn(walk(state, { x: 2, y: 3 })), "c_a");
    expect(state.round).toBe(2);
    const out = endTurnWithEvents(state);
    expect(encounterOutcome(out.state)).toBe("escaped");
    expect(combatantById(out.state, "c_b")!.down).toBe(true);
  });

  it("never take a monster", () => {
    const env: EncounterEnvironment = { exits: [{ id: "tear", label: "The tear", tiles: [{ x: 9, y: 3 }] }] };
    const ended = endTurnWithEvents(until(begin(env), "wisp#1"));
    expect(ended.events).toEqual([]);
    expect(positionOf(ended.state, "wisp#1")).toEqual({ x: 9, y: 3 });
  });
});

describe("the rift clock", () => {
  it("counts the rounds down where the phones can see it, and a collapse ends the fight", () => {
    const env: EncounterEnvironment = { clock: { rounds: 2, label: "The rift closes", onExpire: "collapse" } };
    let state = begin(env);
    expect(environmentView(state)!.clock).toEqual({ label: "The rift closes", onExpire: "collapse", roundsLeft: 2, expired: false });
    state = until(until(state, "wisp#1"), "c_a");
    expect(state.round).toBe(2);
    expect(environmentView(state)!.clock!.roundsLeft).toBe(1);
    expect(encounterOutcome(state)).toBe("ongoing");

    const over = endTurnWithEvents(until(state, "wisp#1"));
    expect(over.events).toEqual([{ type: "riftClock", onExpire: "collapse" }]);
    expect(encounterOutcome(over.state)).toBe("timedOut");
    expect(environmentView(over.state)!.clock).toMatchObject({ roundsLeft: 0, expired: true });
  });

  it("a surge keeps the fight going and hurts every hero still here, every round past the clock", () => {
    const env: EncounterEnvironment = { clock: { rounds: 1, label: "The rift boils", onExpire: "surge", surge: 2 } };
    let state = until(begin(env), "wisp#1");
    const surge = endTurnWithEvents(state);
    expect(types(surge.events)).toEqual(["riftClock", "surge", "damage", "damage"]);
    expect(encounterOutcome(surge.state)).toBe("ongoing");
    state = until(surge.state, "wisp#1");
    expect(types(endTurnWithEvents(state).events)).toEqual(["surge", "damage", "damage"]);
  });

  it("a surge that drops the hero the clock just reached hands the turn on", () => {
    const env: EncounterEnvironment = { clock: { rounds: 1, label: "The rift boils", onExpire: "surge", surge: 2 } };
    const state = until(begin(env, { a: 2 }), "wisp#1");
    const surge = endTurnWithEvents(state);
    expect(types(surge.events)).toEqual(["riftClock", "surge", "damage", "down", "damage"]);
    expect(combatantById(surge.state, "c_a")!.down).toBe(true);
    expect(currentActorId(surge.state)).toBe("c_b");
    expect(surge.state.stepsLeft).toBe(combatantById(surge.state, "c_b")!.steps);
  });
});

describe("a rescue", () => {
  const PIP: EncounterEnvironment = { rescue: { name: "Pip", at: { x: 2, y: 6 }, byRound: 2 } };

  it("walls the captive's tile until a hero ends a turn beside them", () => {
    let state = begin(PIP);
    expect(terrainAt(state.board, { x: 2, y: 6 })).toBe("blocked");
    expect(environmentView(state)!.captives).toEqual([{ name: "Pip", at: { x: 2, y: 6 }, status: "waiting", roundsLeft: 2 }]);
    state = until(state, "c_b");
    const freed = endTurnWithEvents(walk(state, { x: 1, y: 5 }));
    expect(freed.events).toEqual([{ type: "freed", byId: "c_b" }]);
    expect(freed.state.environment!.rescue).toBe("freed");
    expect(terrainAt(freed.state.board, { x: 2, y: 6 })).toBe("open");
  });

  it("is lost when the deadline passes", () => {
    const events: EncounterEvent[] = [];
    const state = until(until(begin(PIP), "wisp#1"), "c_a", events);
    expect(state.round).toBe(2);
    expect(events).toEqual([]);
    const late = until(until(state, "wisp#1"), "c_a", events);
    expect(late.round).toBe(3);
    expect(events).toEqual([{ type: "captiveLost" }]);
    expect(late.environment!.rescue).toBe("lost");
  });

  it("is never freed by a monster standing beside them", () => {
    const env: EncounterEnvironment = { rescue: { name: "Pip", at: { x: 8, y: 3 } } };
    const ended = endTurnWithEvents(until(begin(env), "wisp#1"));
    expect(ended.events).toEqual([]);
    expect(ended.state.environment!.rescue).toBe("waiting");
  });
});

describe("relocation", () => {
  it("moves a monster at the start of its round — unless the tile is taken", () => {
    const env: EncounterEnvironment = { relocate: [{ round: 2, enemy: "wisp#1", to: { x: 3, y: 3 } }] };
    const moved = endTurnWithEvents(until(begin(env), "wisp#1"));
    expect(moved.events).toEqual([{ type: "relocated", actorId: "wisp#1", to: { x: 3, y: 3 } }]);
    expect(positionOf(moved.state, "wisp#1")).toEqual({ x: 3, y: 3 });

    const blocked = until(walk(begin(env), { x: 3, y: 3 }), "wisp#1");
    const stayed = endTurnWithEvents(blocked);
    expect(stayed.events).toEqual([]);
    expect(positionOf(stayed.state, "wisp#1")).toEqual({ x: 9, y: 3 });
  });
});

describe("state", () => {
  it("survives a save mid-fight", () => {
    const env: EncounterEnvironment = {
      clock: { rounds: 3, label: "The rift closes", onExpire: "collapse" },
      exits: [{ id: "tear", label: "The tear", tiles: [{ x: 2, y: 3 }], opensRound: 2 }],
      rescue: { name: "Pip", at: { x: 2, y: 6 } },
    };
    const midway = until(walk(begin(env), { x: 2, y: 3 }), "c_a");
    const resumed = JSON.parse(JSON.stringify(midway)) as EncounterState;
    expect(resumed).toEqual(midway);
    expect(endTurnWithEvents(resumed)).toEqual(endTurnWithEvents(midway));
  });

  it("shows exits opening and closing", () => {
    const env: EncounterEnvironment = { exits: [{ id: "tear", label: "The tear", tiles: [{ x: 2, y: 3 }], opensRound: 2, closesRound: 2 }] };
    let state = begin(env);
    expect(environmentView(state)!.exits[0]).toMatchObject({ open: false, opensIn: 1 });
    state = until(until(state, "wisp#1"), "c_a");
    expect(environmentView(state)!.exits[0]).toMatchObject({ open: true, closesIn: 1 });
    state = until(until(state, "wisp#1"), "c_a");
    expect(environmentView(state)!.exits[0]).toMatchObject({ open: false, gone: true });
  });

  it("tells a hazard that has not started from one that has burnt out", () => {
    const env: EncounterEnvironment = {
      hazards: [
        { id: "late", kind: "fire", label: "Late fire", tiles: [{ x: 5, y: 5 }], damage: 1, fromRound: 2 },
        { id: "brief", kind: "thorns", label: "Brief thorns", tiles: [{ x: 6, y: 5 }], damage: 1, untilRound: 1 },
      ],
    };
    let state = begin(env);
    expect(environmentView(state)!.hazards.map((h) => [h.id, h.active, h.gone ?? false])).toEqual([
      ["late", false, false],
      ["brief", true, false],
    ]);
    state = until(until(state, "wisp#1"), "c_a");
    expect(environmentView(state)!.hazards.map((h) => [h.id, h.active, h.gone ?? false])).toEqual([
      ["late", true, false],
      ["brief", false, true],
    ]);
  });
});

// ---------------------------------------------------------------------------
// The sandbox chapter: checked, then played to every ending
// ---------------------------------------------------------------------------

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const SANDBOX: Chapter = read("rift-skirmish.chapter.json");
const SANDBOX_MAP: EncounterMap = read("rift-skirmish.map.json");
const FIGHT = "fight_rift";
const sandboxFight = (chapter: Chapter = SANDBOX) => chapter.scenes[FIGHT] as EncounterScene;

describe("the authoring check", () => {
  const problems = (bend: (scene: EncounterScene) => void, map: EncounterMap | null = SANDBOX_MAP) => {
    const scene = structuredClone(sandboxFight());
    bend(scene);
    return checkEncounterEnvironment(scene, map).map((p) => `${p.path} ${p.problem}`);
  };

  it("passes the sandbox chapter, with its map and without", () => {
    expect(problems(() => {})).toEqual([]);
    expect(problems(() => {}, null)).toEqual([]);
    expect(validateChapter(SANDBOX)).toEqual([]);
  });

  it("refuses a missing or a pointless extra branch", () => {
    expect(problems((s) => delete s.onEscape).join()).toContain("needs an onEscape branch");
    expect(problems((s) => delete s.onTimeout).join()).toContain("needs an onTimeout branch");
    expect(problems((s) => delete s.environment!.exits).join()).toContain("onEscape with no environment exits");
    expect(problems((s) => (s.environment!.clock!.onExpire = "surge")).join()).toContain('onTimeout without a "collapse" clock');
    expect(validateChapter({ ...SANDBOX, scenes: { ...SANDBOX.scenes, [FIGHT]: { ...sandboxFight(), onEscape: undefined } } })
      .map((i) => i.code)).toContain("BAD_ENVIRONMENT");
  });

  it("holds tiles to the map: on open ground, off the party's spawns, never shared", () => {
    expect(problems((s) => (s.environment!.hazards![0]!.tiles[0] = { x: 6, y: 2 })).join()).toContain("blocked tile");
    expect(problems((s) => (s.environment!.exits![0]!.tiles[0] = { x: 0, y: 3 })).join()).toContain("party spawn");
    expect(problems((s) => (s.environment!.exits![0]!.tiles[0] = { x: 3, y: 2 })).join()).toContain('already exit "north-tear"');
    expect(problems((s) => (s.environment!.rescue!.at = { x: 9, y: 3 })).join()).toContain("spawn point");
    expect(problems((s) => (s.environment!.rescue!.at = { x: 12, y: 3 })).join()).toContain("off the 10×8 board");
  });

  it("refuses windows that cannot happen and monsters that do not exist", () => {
    expect(problems((s) => (s.environment!.exits![0]!.opensRound = 5)).join()).toContain("after the clock collapses");
    expect(problems((s) => (s.environment!.exits![0]!.closesRound = 1)).join()).toContain("closes before it opens");
    expect(problems((s) => (s.environment!.relocate![0]!.enemy = "shade#3")).join()).toContain("not one of this scene's enemies");
    expect(problems((s) => (s.environment!.relocate![0]!.round = 6)).join()).toContain("never starts");
  });

  it("refuses an exit or a captive nobody can walk to", () => {
    const walled: EncounterMap = { ...SANDBOX_MAP, rows: SANDBOX_MAP.rows.map((row, y) => (y === 1 ? "##########" : row)) };
    expect(problems(() => {}, walled).join()).toContain('no hero can walk to exit "north-tear"');
    const boxed: EncounterMap = {
      ...SANDBOX_MAP,
      rows: SANDBOX_MAP.rows.map((row, y) => (y === 6 ? "###......." : y === 7 ? "#.#......." : row)),
    };
    expect(problems(() => {}, boxed).join()).toContain("nobody can stand next to the captive");
  });
});

/** The engine, on the sandbox, with every die rigged. */
function sandboxCtx(die: number): EngineContext {
  return {
    rules: RULES,
    items: ITEMS,
    chapter: SANDBOX,
    map: (id) => (id === SANDBOX_MAP.id ? SANDBOX_MAP : null),
    abilities: {},
    rng: ALWAYS(die),
    now: "2026-10-15T12:00:00.000Z",
    householdId: "h_1",
    playtest: true,
  };
}

const CREATE = (name: string): ClientIntent => ({
  type: "CREATE_CHARACTER",
  name,
  species: "unicorn",
  class: "songkeeper",
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  appearance: APPEARANCE,
});

function must(state: RunState, playerId: string, intent: ClientIntent, ctx: EngineContext) {
  const result = applyIntent(state, { playerId, intent }, ctx);
  if (result.error) throw new Error(`${intent.type}: ${result.error.code} ${result.error.message}`);
  return result;
}

/** Two heroes, the sandbox chapter started, the fight begun. */
function intoTheRift(ctx: EngineContext): RunState {
  let s = createRunState({ runId: "r_1", roomCode: "ABCD", mode: "travel", now: "2026-10-15T11:00:00.000Z" });
  s = must(s, "p_1", CREATE("Pip"), ctx).state;
  s = must(s, "p_2", CREATE("Wren"), ctx).state;
  s = must(s, "p_1", { type: "READY", ready: true }, ctx).state;
  s = must(s, "p_2", { type: "READY", ready: true }, ctx).state;
  s = must(s, "p_1", { type: "START_CHAPTER", chapterId: SANDBOX.id }, ctx).state;
  s = must(s, "p_1", { type: "PLAYTEST_GOTO", sceneId: FIGHT }, ctx).state;
  s = must(s, "p_1", { type: "READY", ready: true }, ctx).state;
  return must(s, "p_2", { type: "READY", ready: true }, ctx).state;
}

const ownerOf = (state: RunState) => {
  const id = currentActorId(state.encounter!);
  return state.party.find((m) => m.character.id === id)!;
};

const HAZARD_TILES = new Set(
  sandboxFight().environment!.hazards!.flatMap((h) => h.tiles.map((t) => `${t.x},${t.y}`)),
);

/**
 * The hero whose turn it is walks toward the nearest of `targets` — never
 * stopping in the fire, as a careful player would not — and ends the turn.
 * Returns every event the engine presented on the way.
 */
function stepToward(state: RunState, targets: readonly Position[], ctx: EngineContext, log: EncounterEvent[]): RunState {
  const member = ownerOf(state);
  const at = positionOf(state.encounter!, member.character.id)!;
  const distance = (p: Position) => Math.min(...targets.map((t) => stepsBetween(p, t)));
  let s = state;
  if (distance(at) > 0) {
    const options = legalMoves(s.encounter!).filter((t) => !HAZARD_TILES.has(`${t.x},${t.y}`));
    const best = [...options].sort((a, b) => distance(a) - distance(b))[0];
    if (best && distance(best) < distance(at)) s = must(s, member.playerId, { type: "MOVE", to: { x: best.x, y: best.y } }, ctx).state;
  }
  const ended = must(s, member.playerId, { type: "END_TURN" }, ctx);
  collect(ended.presentation, log);
  return ended.state;
}

function collect(presentation: unknown, log: EncounterEvent[]): void {
  let p = presentation as { kind?: string; events?: EncounterEvent[]; after?: unknown } | undefined;
  while (p) {
    if (p.kind === "COMBAT_SEQUENCE" && p.events) log.push(...p.events);
    p = p.after as typeof p;
  }
}

const EXIT_TILES = sandboxFight().environment!.exits![0]!.tiles;
const BESIDE_PIP: Position[] = [{ x: 0, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 0, y: 7 }, { x: 2, y: 7 }];

/** Resolution 2's run: one hero heads for the tear, the other frees Pip first, then follows. */
function rescueAndEscape(): { state: RunState; log: EncounterEvent[]; heroes: string[] } {
  const ctx = sandboxCtx(1); // nobody ever hits: this run is about where everyone stops
  let state = intoTheRift(ctx);
  const log: EncounterEvent[] = [];
  const heroes = state.party.map((m) => m.character.id);
  for (let guard = 0; guard < 40 && state.encounter; guard++) {
    const id = currentActorId(state.encounter)!;
    const freed = state.encounter.environment!.rescue === "freed";
    state = stepToward(state, id === heroes[1] && !freed ? BESIDE_PIP : EXIT_TILES, ctx, log);
  }
  return { state, log, heroes };
}

/** Resolution 3's run: everybody ends every turn where they stand until the rift gives up on them. */
function waitOutTheClock(): { state: RunState; log: EncounterEvent[] } {
  const ctx = sandboxCtx(1);
  let state = intoTheRift(ctx);
  const log: EncounterEvent[] = [];
  for (let guard = 0; guard < 40 && state.encounter; guard++) {
    const member = ownerOf(state);
    const ended = must(state, member.playerId, { type: "END_TURN" }, ctx);
    collect(ended.presentation, log);
    state = ended.state;
  }
  return { state, log };
}

describe("the sandbox, keyed on the world (#220)", () => {
  /** The sandbox with a variant: while the river is "flooded", the fire is out and the tear never opens. */
  function flooded(facts?: Record<string, string>): RunState {
    const fight = sandboxFight();
    const keyed: Chapter = {
      ...SANDBOX,
      scenes: {
        ...SANDBOX.scenes,
        [FIGHT]: {
          ...fight,
          environment: {
            ...fight.environment!,
            variants: [{ when: { facts: { river: "flooded" } }, hazards: [], clock: { rounds: 6, label: "The water rises", onExpire: "collapse" } }],
          },
        },
      },
    };
    return intoTheRift({ ...sandboxCtx(1), chapter: keyed, ...(facts ? { campaignFacts: facts } : {}) });
  }

  it("fights in the variant the run's facts satisfy, with the parts it lists replaced", () => {
    const state = flooded({ river: "flooded" });
    expect(state.facts).toEqual({ river: "flooded" });
    const spec = state.encounter!.environment!.spec;
    expect(spec).not.toHaveProperty("variants");
    expect(spec).not.toHaveProperty("hazards");
    expect(spec.clock).toEqual({ rounds: 6, label: "The water rises", onExpire: "collapse" });
    // Untouched parts stay as authored.
    expect(spec.exits).toEqual(sandboxFight().environment!.exits);
  });

  it("fights in the place as authored when no variant holds, or the run has no facts", () => {
    for (const state of [flooded({ river: "calm" }), flooded()]) {
      const spec = state.encounter!.environment!.spec;
      expect(spec).not.toHaveProperty("variants");
      expect(spec).toEqual(sandboxFight().environment);
    }
    expect(flooded()).not.toHaveProperty("facts");
  });
});

describe("the sandbox, through the engine", () => {
  it("starts the fight with its environment on the state, the captive walled in", () => {
    const state = intoTheRift(sandboxCtx(1));
    expect(state.phase).toBe("encounter");
    expect(state.encounter!.environment).toMatchObject({ expired: false, rescue: "waiting" });
    expect(terrainAt(state.encounter!.board, { x: 1, y: 7 })).toBe("blocked");
    expect(environmentView(state.encounter!)!.clock!.roundsLeft).toBe(4);
  });

  it("resolution 1 — hold the landing: beat both shades and take onVictory", () => {
    const ctx = sandboxCtx(20);
    let state = intoTheRift(ctx);
    for (let guard = 0; guard < 60 && state.encounter; guard++) {
      const member = ownerOf(state);
      const enemies = state.encounter.combatants
        .filter((c) => c.side === "enemy" && !c.down)
        .map((c) => positionOf(state.encounter!, c.id)!);
      // Walk at the nearest shade, then swing if one is in reach.
      const log: EncounterEvent[] = [];
      const at = positionOf(state.encounter!, member.character.id)!;
      const near = (p: Position) => Math.min(...enemies.map((e) => stepsBetween(p, e)));
      if (near(at) > 1) {
        // Never stopping on the tear: a hero who does steps through it, and
        // that is the other ending (the first draft of this test found out).
        const best = [...legalMoves(state.encounter)]
          .filter((t) => !HAZARD_TILES.has(`${t.x},${t.y}`) && !EXIT_TILES.some((e) => e.x === t.x && e.y === t.y))
          .sort((a, b) => near(a) - near(b))[0];
        if (best) state = must(state, member.playerId, { type: "MOVE", to: { x: best.x, y: best.y } }, ctx).state;
      }
      const attack = legalActions(state.encounter!, ctxOf(ALWAYS(20))).find((a) => a.abilityId === "attack");
      if (attack) {
        state = must(state, member.playerId, { type: "COMBAT_ACTION", abilityId: "attack", targetId: attack.targets[0]! }, ctx).state;
      }
      if (state.encounter && currentActorId(state.encounter) === member.character.id) {
        state = stepToward(state, [positionOf(state.encounter, member.character.id)!], ctx, log);
      }
    }
    expect(state.encounter).toBeNull();
    expect(state.sceneId).toBe("scene_held");
    expect(state.chapterOutcome).toBe("success");
    expect(state.flags.pip_rescued).toBeUndefined();
  });

  it("resolution 2 — free Pip, then get through the tear before it shuts: onEscape, with the rescue a story fact", () => {
    const { state, log, heroes } = rescueAndEscape();
    const [first, second] = heroes;
    expect(state.encounter).toBeNull();
    expect(types(log)).toEqual(expect.arrayContaining(["freed", "escaped"]));
    expect(log.filter((e) => e.type === "escaped").map((e) => (e as { actorId: string }).actorId).sort()).toEqual(
      [first, second].sort(),
    );
    expect(state.sceneId).toBe("scene_through");
    expect(state.chapterOutcome).toBe("success");
    expect(state.flags.pip_rescued).toBe(true);
    expect(state.narration).toContain("Pip tumbles through after you");
    // The rescue was the chapter's bonus objective, and it paid.
    expect(state.bonuses?.map((b) => b.id)).toContain("save_pip");
    // And the completion screen is told how the fight ended (#220).
    expect(state.fightEndings).toEqual([{ outcome: "escaped", freed: ["Pip the ferry-sprite"], lost: [], done: [] }]);
  });

  it("the tactical cost — going straight for the tear leaves Pip behind", () => {
    const ctx = sandboxCtx(1);
    let state = intoTheRift(ctx);
    const log: EncounterEvent[] = [];
    for (let guard = 0; guard < 40 && state.encounter; guard++) state = stepToward(state, EXIT_TILES, ctx, log);
    expect(types(log)).not.toContain("freed");
    expect(state.sceneId).toBe("scene_through");
    expect(state.flags.pip_rescued).toBeUndefined();
    expect(state.narration).toContain("Pip's lantern winks out");
  });

  it("the shades play the place: one watches the tear, one goes for Pip, neither waits in the fire", () => {
    /*
     * The engine hands its monsters the environment (enemy-ai.ts, "In a place
     * that fights back"). On the waiting run nobody comes near them, so what
     * they do is all the place: shade#1, nearest the tear, stands beside it
     * from round 1 (it opens in round 2); shade#2 heads for Pip's side; and
     * neither ever ends a turn in the fire or on the tear itself. Rigged dice
     * (every die a 1) mean nobody is hurt, so the runs above still reach the
     * endings they always did — these shades contest them, they do not close them.
     */
    const { log } = waitOutTheClock();
    const moves = log.filter((e): e is Extract<EncounterEvent, { type: "moved" }> => e.type === "moved");
    expect(moves.find((m) => m.actorId === "shade#1")?.to).toEqual({ x: 6, y: 0 });
    expect(moves.filter((m) => m.actorId === "shade#1")).toHaveLength(1);
    const towardPip = moves.filter((m) => m.actorId === "shade#2").slice(0, 2).map((m) => m.to);
    expect(towardPip).toEqual([{ x: 6, y: 3 }, { x: 3, y: 6 }]);
    const stops = moves.map((m) => `${m.to.x},${m.to.y}`);
    expect(stops.filter((s) => HAZARD_TILES.has(s))).toEqual([]);
    expect(stops.filter((s) => EXIT_TILES.some((t) => `${t.x},${t.y}` === s))).toEqual([]);
    expect(log.filter((e) => e.type === "hazard")).toEqual([]);
  });

  it("resolution 3 — stay too long: the clock runs out, Pip is lost, and the fight takes onTimeout", () => {
    const { state, log } = waitOutTheClock();
    expect(state.encounter).toBeNull();
    expect(types(log)).toEqual(expect.arrayContaining(["captiveLost", "riftClock", "relocated"]));
    expect(state.sceneId).toBe("scene_collapse");
    expect(state.chapterOutcome).toBe("setback");
    expect(state.narration).toContain("Pip did not come with you");
  });
});

/*
 * The other half of "effects can feed the graph": the fight never touches the
 * journey, so the consequence travels the way every chapter's does — a run
 * flag (the rescue's `effects`) and an outcome (the branch's scene), read back
 * when the visit completes, turned into world facts by the node's
 * `onComplete` rules (#198). A tiny graph around the sandbox chapter, fed the
 * two real runs above, shows both routes land.
 */
describe("the sandbox's endings, in a graph campaign", () => {
  const FERRY: Campaign = {
    id: "rift-sandbox",
    title: "Rift sandbox",
    blurb: "One ferry, one rift.",
    chapters: ["rift-skirmish", "rift-home"],
    graph: {
      version: 1,
      entry: "ferry",
      flags: ["pip_rescued"],
      facts: {
        "ferry-sprite": { domain: "alliance", type: "enum", values: ["lost", "saved"], initial: "lost", label: "Pip", visible: true },
        "ferry-landing": { domain: "locale", type: "enum", values: ["standing", "collapsed"], initial: "standing" },
      },
      nodes: {
        ferry: {
          chapter: "rift-skirmish",
          onComplete: [
            { when: { flag: "pip_rescued" }, effects: [{ type: "setFact", fact: "ferry-sprite", value: "saved" }] },
            { when: { outcome: "setback" }, effects: [{ type: "setFact", fact: "ferry-landing", value: "collapsed" }] },
          ],
        },
        home: { chapter: "rift-home", ending: { title: "Home" } },
      },
      edges: { "ferry-home": { from: "ferry", to: "home", kind: "forward" } },
    },
  } as Campaign;

  function settle(run: RunState) {
    const { graph, problems } = parseCampaignGraph(FERRY);
    expect(problems).toEqual([]);
    const journey = startJourney(graph!);
    const done = completeVisit(graph!, journey, {
      node: journey.node,
      visit: journey.visit,
      chapterId: SANDBOX.id,
      outcome: run.chapterOutcome!,
      flags: run.flags as Record<string, boolean>,
    });
    if (!done.ok || done.duplicate) throw new Error("the visit did not complete");
    return worldFacts(graph!.facts, done.journey);
  }

  it("a rescue and an escape: Pip is a saved ally, the landing still stands", () => {
    expect(settle(rescueAndEscape().state)).toMatchObject({ "ferry-sprite": "saved", "ferry-landing": "standing" });
  });

  it("a timeout: Pip is lost, and the landing collapsed behind the party", () => {
    expect(settle(waitOutTheClock().state)).toMatchObject({ "ferry-sprite": "lost", "ferry-landing": "collapsed" });
  });
});

// ---------------------------------------------------------------------------
// The storm sandbox (#220): every deferred effect in one fight
// ---------------------------------------------------------------------------

const STORM: Chapter = read("rift-storm.chapter.json");
const STORM_FIGHT = "fight_storm";
const stormFight = () => STORM.scenes[STORM_FIGHT] as EncounterScene;

function stormCtx(die: number, facts?: Record<string, string>): EngineContext {
  return { ...sandboxCtx(die), chapter: STORM, ...(facts ? { campaignFacts: facts } : {}) };
}

function intoTheStorm(ctx: EngineContext): RunState {
  let s = createRunState({ runId: "r_2", roomCode: "WXYZ", mode: "travel", now: "2026-10-15T11:00:00.000Z" });
  s = must(s, "p_1", CREATE("Pip"), ctx).state;
  s = must(s, "p_2", CREATE("Wren"), ctx).state;
  s = must(s, "p_1", { type: "READY", ready: true }, ctx).state;
  s = must(s, "p_2", { type: "READY", ready: true }, ctx).state;
  s = must(s, "p_1", { type: "START_CHAPTER", chapterId: STORM.id }, ctx).state;
  s = must(s, "p_1", { type: "PLAYTEST_GOTO", sceneId: STORM_FIGHT }, ctx).state;
  s = must(s, "p_1", { type: "READY", ready: true }, ctx).state;
  return must(s, "p_2", { type: "READY", ready: true }, ctx).state;
}

describe("the storm sandbox (#220)", () => {
  it("passes the authoring check, with its map and without, and the chapter check", () => {
    expect(checkEncounterEnvironment(stormFight(), SANDBOX_MAP)).toEqual([]);
    expect(checkEncounterEnvironment(stormFight())).toEqual([]);
    expect(validateChapter(STORM).filter((p) => p.severity === "error")).toEqual([]);
  });

  it("starts with every part in place: both captives walled, the storm on everyone, the brute's way with the place", () => {
    const state = intoTheStorm(stormCtx(1));
    const encounter = state.encounter!;
    expect(encounter.environment).toMatchObject({ rescue: ["waiting", "waiting"], captiveHp: [0, 2], objectives: [0, 0] });
    expect(terrainAt(encounter.board, { x: 1, y: 7 })).toBe("blocked");
    expect(terrainAt(encounter.board, { x: 8, y: 7 })).toBe("blocked");
    expect(encounter.buffs?.filter((b) => b.id === "storm")).toHaveLength(state.party.length + 2);
    expect(combatantById(encounter, "brute#1")!.rift).toEqual({ shoves: true, ignores: ["thorns"] });
    const view = environmentView(encounter)!;
    expect(view.captives.map((c) => c.name)).toEqual(["Pip", "Moss"]);
    expect(view.objectives.map((o) => o.id)).toEqual(["beacon", "small-tear"]);
  });

  it("is a different storm when the world says it is raging", () => {
    const spec = intoTheStorm(stormCtx(1, { storm: "raging" })).encounter!.environment!.spec;
    expect(spec.clock).toMatchObject({ rounds: 4, surge: 2 });
    expect(spec.modifiers!.map((m) => m.id)).toEqual(["rain"]);
  });

  it("is winnable: heroes who walk up and swing beat it, and the screen is told how", () => {
    const ctx = stormCtx(20);
    let state = intoTheStorm(ctx);
    const hazards = new Set(stormFight().environment!.hazards!.flatMap((h) => h.tiles.map((t) => `${t.x},${t.y}`)));
    for (let guard = 0; guard < 80 && state.encounter; guard++) {
      const member = ownerOf(state);
      const enemies = state.encounter.combatants.filter((c) => c.side === "enemy" && !c.down).map((c) => positionOf(state.encounter!, c.id)!);
      const at = positionOf(state.encounter, member.character.id)!;
      const near = (p: Position) => Math.min(...enemies.map((e) => stepsBetween(p, e)));
      if (near(at) > 1) {
        const best = [...legalMoves(state.encounter)].filter((t) => !hazards.has(`${t.x},${t.y}`)).sort((a, b) => near(a) - near(b))[0];
        if (best && near(best) < near(at)) state = must(state, member.playerId, { type: "MOVE", to: { x: best.x, y: best.y } }, ctx).state;
      }
      const attack = legalActions(state.encounter!, ctxOf(ALWAYS(20))).find((a) => a.abilityId === "attack");
      if (attack) state = must(state, member.playerId, { type: "COMBAT_ACTION", abilityId: "attack", targetId: attack.targets[0]! }, ctx).state;
      if (state.encounter && currentActorId(state.encounter) === member.character.id) {
        state = must(state, member.playerId, { type: "END_TURN" }, ctx).state;
      }
    }
    expect(state.encounter).toBeNull();
    expect(state.sceneId).toBe("scene_calm");
    expect(state.chapterOutcome).toBe("success");
    expect(state.fightEndings).toHaveLength(1);
    expect(state.fightEndings![0]!.outcome).toBe("victory");
  });
});
