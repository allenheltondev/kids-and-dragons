/**
 * Environmental combat, the deferred effects (#220): ground that slows, holds
 * and throws. Same layers as encounter-environment.test.ts — the rules on
 * small hand-built boards, one rule per test, and the authoring check.
 */

import { describe, expect, it } from "vitest";

import {
  beginEncounter,
  combatantById,
  currentActorId,
  encounterOutcome,
  endTurnWithEvents,
  moveTo,
  positionOf,
  type AbilityCatalog,
  type EncounterEvent,
  type EncounterSetup,
  type EncounterState,
} from "./encounter.js";
import { checkEncounterEnvironment, environmentView, resolveEnvironment } from "./environment.js";
import { parseBoard, terrainAt, type Position } from "./grid.js";
import { buffBonus } from "./buffs.js";
import type { Rng } from "./dice.js";
import { resolveCharacter } from "./character.js";
import { makeCharacter, makeItems, makeRules } from "./test-fixtures.js";
import type { EncounterEnvironment, EnemySpec } from "./types/chapter.js";

const RULES = makeRules();
const ITEMS = makeItems();
const ALWAYS: (die: number) => Rng = (die) => ({ next: () => (die - 1) / 20 + 0.001 });
const ctxOf = (rng: Rng = ALWAYS(1)) => ({ rules: RULES, abilities: {} as AbilityCatalog, rng });

const WISP: EnemySpec = { id: "wisp", count: 1, hp: 6, guard: 9, quick: 0, steps: 3, attack: 2 };

function hero(id: string) {
  return resolveCharacter(
    makeCharacter({ id, name: id, species: "unicorn", class: "thornguard", stats: { might: 1, quick: 3, clever: 0, heart: 0 } }),
    RULES,
    ITEMS,
  );
}

function setup(environment?: EncounterEnvironment, enemies: EncounterSetup["enemies"] = [{ spec: WISP, at: { x: 9, y: 3 } }]): EncounterSetup {
  return {
    board: parseBoard(Array.from({ length: 8 }, () => ".".repeat(10))),
    party: [
      { character: hero("c_a"), at: { x: 0, y: 3 } },
      { character: hero("c_b"), at: { x: 0, y: 4 } },
    ],
    enemies,
    ...(environment ? { environment } : {}),
  };
}

function begin(environment?: EncounterEnvironment, enemies?: EncounterSetup["enemies"]): EncounterState {
  return beginEncounter(setup(environment, enemies), ctxOf());
}

function walk(state: EncounterState, to: Position): EncounterState {
  const moved = moveTo(state, to);
  if (!moved.ok) throw new Error(moved.reason);
  return moved.state;
}

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
// Hazards that do more than hurt
// ---------------------------------------------------------------------------

describe("hazards that slow, hold and push (#220)", () => {
  const at = { x: 2, y: 3 };

  it("slow: the hero who stops in the mud has fewer steps for the turns it says", () => {
    const env: EncounterEnvironment = {
      hazards: [{ id: "mud", kind: "rift", label: "Rift mud", tiles: [at], slow: { steps: 2, turns: 1 } }],
    };
    const ended = endTurnWithEvents(walk(begin(env), at));
    expect(ended.events).toEqual([
      { type: "hazard", actorId: "c_a", hazardId: "mud", label: "Rift mud" },
      { type: "slowed", actorId: "c_a", hazardId: "mud", steps: 2, turns: 1 },
    ]);
    // No damage: the mud does not hurt.
    expect(combatantById(ended.state, "c_a")!.hp).toBe(combatantById(begin(env), "c_a")!.hp);
    const next = until(ended.state, "c_a");
    const full = combatantById(next, "c_a")!.steps;
    expect(next.stepsLeft).toBe(full - 2);
    // One turn, then full again. (Stepping off so the mud does not catch them twice.)
    const after = until(endTurnWithEvents(walk(next, { x: 3, y: 3 })).state, "c_a");
    expect(after.stepsLeft).toBe(full);
  });

  it("a slow and a sting are two entries: neither refreshes the other", () => {
    const env: EncounterEnvironment = {
      hazards: [{ id: "mud", kind: "rift", label: "Rift mud", tiles: [at], slow: { steps: 1, turns: 2 } }],
    };
    const ended = endTurnWithEvents(walk(begin(env), at));
    expect(ended.state.buffs).toEqual([
      { id: "slowed", label: "Slowed", kind: "move", heroId: "c_a", amount: -1, turnsLeft: 2 },
    ]);
  });

  it("root: the hero starts their next turn with no steps, then is free", () => {
    const env: EncounterEnvironment = {
      hazards: [{ id: "briar", kind: "thorns", label: "Grabbing briars", tiles: [at], damage: 1, root: true }],
    };
    const ended = endTurnWithEvents(walk(begin(env), at));
    expect(types(ended.events)).toEqual(["hazard", "damage", "rooted"]);
    const next = until(ended.state, "c_a");
    expect(next.stepsLeft).toBe(0);
    expect(combatantById(next, "c_a")!.rooted).toBe(false);
  });

  it("push: thrown the way it says, stopping at the edge or another figure", () => {
    const env: EncounterEnvironment = {
      hazards: [{ id: "gust", kind: "rift", label: "Rift wind", tiles: [at], push: { direction: "north", tiles: 3 } }],
    };
    const ended = endTurnWithEvents(walk(begin(env), at));
    expect(ended.events).toContainEqual({ type: "shoved", actorId: "c_a", to: { x: 2, y: 0 } });
    expect(positionOf(ended.state, "c_a")).toEqual({ x: 2, y: 0 });

    // c_b stands in the way: the push stops short of them.
    const blocked = begin(env);
    const s = until(endTurnWithEvents(walk(blocked, { x: 2, y: 1 })).state, "c_b");
    const pushed = endTurnWithEvents(walk(s, at));
    expect(positionOf(pushed.state, "c_b")).toEqual({ x: 2, y: 2 });
  });

  it("a hazard that knocks a figure down does nothing else to it", () => {
    const env: EncounterEnvironment = {
      hazards: [{ id: "fire", kind: "fire", label: "Fire", tiles: [at], damage: 5, root: true, push: { direction: "east" } }],
    };
    let state = walk(begin(env), at);
    state = { ...state, combatants: state.combatants.map((c) => (c.id === "c_a" ? { ...c, hp: 2 } : c)) };
    const ended = endTurnWithEvents(state);
    expect(types(ended.events)).toEqual(["hazard", "damage", "down"]);
    expect(positionOf(ended.state, "c_a")).toEqual(at);
  });

  it("the phones see what the ground does", () => {
    const env: EncounterEnvironment = {
      hazards: [{ id: "gust", kind: "rift", label: "Rift wind", tiles: [at], root: true, push: { direction: "west" }, slow: { steps: 1, turns: 2 } }],
    };
    expect(environmentView(begin(env))!.hazards[0]).toMatchObject({
      damage: 0,
      root: true,
      push: { direction: "west", tiles: 1 },
      slow: { steps: 1, turns: 2 },
    });
  });

  it("the check wants a hazard to do something, inside the limits", () => {
    const scene = (hazard: object) => ({
      enemies: [WISP],
      environment: { hazards: [{ id: "h", kind: "rift", label: "H", tiles: [at], ...hazard }] } as EncounterEnvironment,
    });
    expect(checkEncounterEnvironment(scene({ damage: 1 }))).toEqual([]);
    expect(checkEncounterEnvironment(scene({ root: true }))).toEqual([]);
    expect(checkEncounterEnvironment(scene({})).map((p) => p.path)).toEqual(["/environment/hazards/0"]);
    expect(checkEncounterEnvironment(scene({ slow: { steps: 3, turns: 9 } })).map((p) => p.path)).toEqual([
      "/environment/hazards/0/slow/steps",
      "/environment/hazards/0/slow/turns",
    ]);
    expect(checkEncounterEnvironment(scene({ push: { direction: "up", tiles: 4 } })).map((p) => p.path)).toEqual([
      "/environment/hazards/0/push/direction",
      "/environment/hazards/0/push/tiles",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Several captives, and captives the monsters can get at
// ---------------------------------------------------------------------------

describe("several captives (#220)", () => {
  const TWO: EncounterEnvironment = {
    rescue: [
      { name: "Pip", at: { x: 2, y: 6 } },
      { name: "Moss", at: { x: 2, y: 0 }, byRound: 1 },
    ],
  };

  it("walls every captive, and frees each on its own", () => {
    let state = begin(TWO);
    expect(terrainAt(state.board, { x: 2, y: 6 })).toBe("blocked");
    expect(terrainAt(state.board, { x: 2, y: 0 })).toBe("blocked");
    expect(state.environment!.rescue).toEqual(["waiting", "waiting"]);
    const freed = endTurnWithEvents(walk(state, { x: 1, y: 1 }));
    expect(freed.events).toEqual([{ type: "freed", byId: "c_a", captive: 1 }]);
    expect(freed.state.environment!.rescue).toEqual(["waiting", "freed"]);
    expect(terrainAt(freed.state.board, { x: 2, y: 0 })).toBe("open");
    state = freed.state;
    expect(environmentView(state)!.captives.map((c) => c.status)).toEqual(["waiting", "freed"]);
  });

  it("each has its own deadline", () => {
    const events: EncounterEvent[] = [];
    const state = until(until(begin(TWO), "wisp#1"), "c_a", events);
    expect(events).toEqual([{ type: "captiveLost", captive: 1 }]);
    expect(state.environment!.rescue).toEqual(["waiting", "lost"]);
    expect(terrainAt(state.board, { x: 2, y: 0 })).toBe("open");
  });

  it("the check holds each captive to the rules, by its own path", () => {
    const scene = {
      enemies: [WISP],
      environment: { rescue: [{ name: "A", at: { x: 2, y: 2 } }, { name: "B", at: { x: 2, y: 2 }, hp: 9 }] } as EncounterEnvironment,
    };
    expect(checkEncounterEnvironment(scene).map((p) => p.path)).toEqual(["/environment/rescue/1/hp", "/environment/rescue/1/at"]);
  });
});

describe("a captive the monsters can get at (#220)", () => {
  const PIP: EncounterEnvironment = { rescue: { name: "Pip", at: { x: 8, y: 3 }, hp: 2 } };

  it("loses one each turn a monster ends beside them without swinging, and is lost at none", () => {
    let state = begin(PIP);
    expect(environmentView(state)!.captives[0]).toMatchObject({ hp: 2, maxHp: 2 });
    const first = endTurnWithEvents(until(state, "wisp#1"));
    expect(first.events).toEqual([{ type: "captiveDragged", byId: "wisp#1", hp: 1 }]);
    expect(environmentView(first.state)!.captives[0]).toMatchObject({ hp: 1, status: "waiting" });
    const second = endTurnWithEvents(until(first.state, "wisp#1"));
    expect(second.events).toEqual([{ type: "captiveDragged", byId: "wisp#1", hp: 0 }, { type: "captiveLost" }]);
    expect(second.state.environment!.rescue).toBe("lost");
    expect(terrainAt(second.state.board, { x: 8, y: 3 })).toBe("open");
    state = second.state;
  });

  it("is left alone by a monster that swung this turn, and by everyone when it has no hp", () => {
    const swung = until(begin(PIP), "wisp#1");
    expect(endTurnWithEvents({ ...swung, actionTaken: true }).events).toEqual([]);
    const untouchable = until(begin({ rescue: { name: "Pip", at: { x: 8, y: 3 } } }), "wisp#1");
    expect(endTurnWithEvents(untouchable).events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Objectives besides a rescue
// ---------------------------------------------------------------------------

describe("objectives (#220)", () => {
  it("hold: a round counts when it ends with a hero on the ground and no monster", () => {
    const env: EncounterEnvironment = {
      objectives: [{ id: "stones", kind: "hold", label: "Hold the stones", tiles: [{ x: 2, y: 3 }], rounds: 2 }],
    };
    const events: EncounterEvent[] = [];
    let state = until(endTurnWithEvents(walk(begin(env), { x: 2, y: 3 })).state, "c_a", events);
    expect(events).toContainEqual({ type: "objective", objectiveId: "stones", progress: 1, target: 2 });
    expect(environmentView(state)!.objectives[0]).toMatchObject({ progress: 1, target: 2, done: false });
    // Stepping off: the next round does not count.
    events.length = 0;
    state = until(endTurnWithEvents(walk(state, { x: 3, y: 3 })).state, "c_a", events);
    expect(types(events)).not.toContain("objective");
    expect(environmentView(state)!.objectives[0]!.progress).toBe(1);
  });

  it("hold: a monster on the ground spoils the round", () => {
    const env: EncounterEnvironment = {
      objectives: [{ id: "stones", kind: "hold", label: "Hold", tiles: [{ x: 2, y: 3 }, { x: 9, y: 3 }], rounds: 2 }],
    };
    const events: EncounterEvent[] = [];
    const state = until(endTurnWithEvents(walk(begin(env), { x: 2, y: 3 })).state, "c_a", events);
    expect(state.round).toBe(2);
    expect(types(events)).not.toContain("objective");
  });

  it("close: each hero turn ended beside the tear closes it a little, and done can end the fight as a victory", () => {
    const env: EncounterEnvironment = {
      objectives: [{ id: "seal", kind: "close", label: "Close the tear", at: { x: 1, y: 3 }, turns: 2, endsFight: true }],
    };
    let state = begin(env);
    const first = endTurnWithEvents(state);
    expect(first.events).toEqual([{ type: "objective", objectiveId: "seal", progress: 1, target: 2, byId: "c_a" }]);
    expect(encounterOutcome(first.state)).toBe("ongoing");
    state = first.state;
    const second = endTurnWithEvents(state);
    expect(second.events).toEqual([{ type: "objective", objectiveId: "seal", progress: 2, target: 2, byId: "c_b" }]);
    expect(encounterOutcome(second.state)).toBe("victory");
  });

  it("without endsFight, done is only a fact: the fight goes on", () => {
    const env: EncounterEnvironment = {
      objectives: [{ id: "seal", kind: "close", label: "Close the tear", at: { x: 1, y: 3 }, turns: 1 }],
    };
    const ended = endTurnWithEvents(begin(env));
    expect(environmentView(ended.state)!.objectives[0]!.done).toBe(true);
    expect(encounterOutcome(ended.state)).toBe("ongoing");
    // Done stays done: no more progress events.
    expect(types(endTurnWithEvents(ended.state).events)).not.toContain("objective");
  });

  it("the check holds counts, tiles and the clock", () => {
    const scene = (objectives: unknown[], clock?: object) => ({
      enemies: [WISP],
      onTimeout: clock ? { goto: "x" } : undefined,
      environment: { objectives, ...(clock ? { clock } : {}) } as EncounterEnvironment,
    });
    expect(checkEncounterEnvironment(scene([{ id: "a", kind: "hold", label: "A", tiles: [{ x: 2, y: 2 }], rounds: 2 }]))).toEqual([]);
    expect(
      checkEncounterEnvironment(
        scene([{ id: "a", kind: "hold", label: "A", tiles: [{ x: 2, y: 2 }], rounds: 5 }], { rounds: 4, label: "C", onExpire: "collapse" }),
      ).map((p) => p.path),
    ).toEqual(["/environment/objectives/0/rounds"]);
    expect(
      checkEncounterEnvironment(scene([{ id: "a", kind: "close", label: "A", at: { x: 20, y: 2 }, turns: 0 }])).map((p) => p.path),
    ).toEqual(["/environment/objectives/0/turns", "/environment/objectives/0/at"]);
  });
});

// ---------------------------------------------------------------------------
// Place-wide numbers
// ---------------------------------------------------------------------------

describe("place-wide modifiers (#220)", () => {
  it("become one buff per figure they are on, read like any other and held to the same limit", () => {
    const env: EncounterEnvironment = {
      modifiers: [
        { id: "storm", label: "Storm winds", kind: "guard", amount: -1 },
        { id: "ice", label: "Ice", kind: "move", amount: -1, on: "monsters" },
      ],
    };
    const state = begin(env);
    expect(state.buffs).toEqual([
      { id: "storm", label: "Storm winds", kind: "guard", heroId: "c_a", amount: -1 },
      { id: "storm", label: "Storm winds", kind: "guard", heroId: "c_b", amount: -1 },
      { id: "storm", label: "Storm winds", kind: "guard", heroId: "wisp#1", amount: -1 },
      { id: "ice", label: "Ice", kind: "move", heroId: "wisp#1", amount: -1 },
    ]);
    expect(buffBonus(state.buffs, "wisp#1", "move")).toBe(-1);
    // Beside a party buff that is already at the limit, the total stays at it.
    const stacked = beginEncounter(
      { ...setup({ modifiers: [{ id: "calm", label: "Calm", kind: "guard", amount: 2, on: "party" }] }), buffs: [{ id: "shield", label: "Rift Shield", kind: "guard", heroId: "c_a", amount: 3 }] },
      ctxOf(),
    );
    expect(buffBonus(stacked.buffs, "c_a", "guard")).toBe(3);
    expect(environmentView(state)!.modifiers).toEqual([
      { id: "storm", label: "Storm winds", kind: "guard", amount: -1, on: "everyone" },
      { id: "ice", label: "Ice", kind: "move", amount: -1, on: "monsters" },
    ]);
  });

  it("a monster under a move modifier starts its turn with fewer steps", () => {
    const state = until(begin({ modifiers: [{ id: "ice", label: "Ice", kind: "move", amount: -1, on: "monsters" }] }), "wisp#1");
    expect(state.stepsLeft).toBe(WISP.steps - 1);
  });

  it("the check holds each to its kind's limit and keeps the fight's own names", () => {
    const scene = (modifiers: unknown[]) => ({ enemies: [WISP], environment: { modifiers } as EncounterEnvironment });
    expect(checkEncounterEnvironment(scene([{ id: "a", label: "A", kind: "damage", amount: -2 }]))).toEqual([]);
    expect(checkEncounterEnvironment(scene([{ id: "a", label: "A", kind: "damage", amount: 3 }])).map((p) => p.path)).toEqual([
      "/environment/modifiers/0/amount",
    ]);
    expect(checkEncounterEnvironment(scene([{ id: "numbed", label: "A", kind: "roll", amount: 0 }])).map((p) => p.path)).toEqual([
      "/environment/modifiers/0/id",
      "/environment/modifiers/0/amount",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Keyed on the world
// ---------------------------------------------------------------------------

describe("an environment keyed on world facts (#220)", () => {
  const BASE: EncounterEnvironment = {
    hazards: [{ id: "fire", kind: "fire", label: "Fire", tiles: [{ x: 2, y: 2 }], damage: 1 }],
    variants: [
      { when: { facts: { wyrm: "raging" } }, hazards: [{ id: "fire", kind: "fire", label: "Wyrmfire", tiles: [{ x: 2, y: 2 }, { x: 3, y: 2 }], damage: 3 }] },
      { when: { facts: { wyrm: "gone" } }, hazards: [] },
    ],
  };
  const facts = (values: Record<string, string>) => (when: { facts: Record<string, unknown> }) =>
    Object.entries(when.facts).every(([id, test]) => values[id] === test);

  it("resolves to the first variant that holds, or the base; an empty list removes the part", () => {
    expect(resolveEnvironment(BASE, facts({ wyrm: "raging" })).hazards![0]!.label).toBe("Wyrmfire");
    expect(resolveEnvironment(BASE, facts({ wyrm: "gone" }))).toEqual({});
    expect(resolveEnvironment(BASE, facts({}))).toEqual({ hazards: BASE.hazards });
    const plain: EncounterEnvironment = { hazards: BASE.hazards };
    expect(resolveEnvironment(plain, () => true)).toBe(plain);
  });

  it("the check judges every variant as a place of its own, and the branches across all of them", () => {
    const exitIn: EncounterEnvironment = {
      variants: [
        { when: { facts: { tear: "open" } }, exits: [{ id: "t", label: "T", tiles: [{ x: 4, y: 0 }] }] },
        { when: { facts: {} }, hazards: [{ id: "h", kind: "rift", label: "H", tiles: [{ x: 1, y: 1 }], damage: 9 }] },
      ],
    };
    const paths = checkEncounterEnvironment({ enemies: [WISP], environment: exitIn }).map((p) => p.path);
    expect(paths).toEqual(["/environment/variants/1/when", "/onEscape", "/environment/variants/1/hazards/0/damage"]);
    expect(checkEncounterEnvironment({ enemies: [WISP], environment: BASE })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Creatures with their own way with the place, and monsters that use it
// ---------------------------------------------------------------------------

describe("a creature's rift behaviour (#220)", () => {
  const FIRE = { id: "fire", kind: "fire" as const, label: "Rift fire", tiles: [{ x: 3, y: 3 }, { x: 9, y: 3 }], damage: 2 };

  it("rides on the combatant only in a fight with an environment", () => {
    const salamander: EnemySpec = { ...WISP, rift: { ignores: ["fire"] } };
    const enemies = [{ spec: salamander, at: { x: 9, y: 3 } }];
    expect(combatantById(begin({ hazards: [FIRE] }, enemies), "wisp#1")!.rift).toEqual({ ignores: ["fire"] });
    expect(combatantById(begin(undefined, enemies), "wisp#1")).not.toHaveProperty("rift");
  });

  it("ignores: ground of that kind does nothing to it", () => {
    const salamander: EnemySpec = { ...WISP, rift: { ignores: ["fire"] } };
    const ended = endTurnWithEvents(until(begin({ hazards: [FIRE] }, [{ spec: salamander, at: { x: 9, y: 3 } }]), "wisp#1"));
    expect(ended.events).toEqual([]);
    expect(combatantById(ended.state, "wisp#1")!.hp).toBe(WISP.hp);
  });

  it("shoves: a hero beside it with fire behind them goes into the fire, and it bites", () => {
    const troll: EnemySpec = { ...WISP, rift: { shoves: true } };
    let state = begin({ hazards: [FIRE] }, [{ spec: troll, at: { x: 5, y: 3 } }]);
    state = until(endTurnWithEvents(walk(state, { x: 4, y: 3 })).state, "wisp#1");
    const before = combatantById(state, "c_a")!.hp;
    const ended = endTurnWithEvents(state);
    expect(ended.events).toEqual([
      { type: "shoved", actorId: "c_a", to: { x: 3, y: 3 } },
      { type: "hazard", actorId: "c_a", hazardId: "fire", label: "Rift fire" },
      { type: "damage", actorId: "c_a", amount: 2, hp: before - 2 },
    ]);
  });

  it("whenHurt: the rift pulls a monster away the first round it starts at half its hearts or fewer, once", () => {
    const env: EncounterEnvironment = { relocate: [{ whenHurt: true, enemy: "wisp#1", to: { x: 9, y: 0 } }] };
    let state = begin(env);
    const events: EncounterEvent[] = [];
    state = until(endTurnWithEvents(state).state, "c_a", events);
    expect(types(events)).not.toContain("relocated");
    state = { ...state, combatants: state.combatants.map((c) => (c.id === "wisp#1" ? { ...c, hp: 3 } : c)) };
    events.length = 0;
    state = until(endTurnWithEvents(state).state, "c_a", events);
    expect(events).toContainEqual({ type: "relocated", actorId: "wisp#1", to: { x: 9, y: 0 } });
    expect(state.environment!.relocated).toEqual([0]);
    // Walked back down, it is not pulled again.
    events.length = 0;
    until(endTurnWithEvents(state).state, "c_a", events);
    expect(types(events)).not.toContain("relocated");
  });

  it("the check wants exactly one of round and whenHurt", () => {
    const scene = (move: object) => ({ enemies: [WISP], environment: { relocate: [{ enemy: "wisp#1", to: { x: 5, y: 5 }, ...move }] } as EncounterEnvironment });
    expect(checkEncounterEnvironment(scene({ whenHurt: true }))).toEqual([]);
    expect(checkEncounterEnvironment(scene({})).map((p) => p.path)).toEqual(["/environment/relocate/0"]);
    expect(checkEncounterEnvironment(scene({ round: 2, whenHurt: true })).map((p) => p.path)).toEqual(["/environment/relocate/0"]);
  });
});
