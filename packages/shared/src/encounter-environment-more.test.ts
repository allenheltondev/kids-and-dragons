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
  endTurnWithEvents,
  moveTo,
  positionOf,
  type AbilityCatalog,
  type EncounterEvent,
  type EncounterSetup,
  type EncounterState,
} from "./encounter.js";
import { checkEncounterEnvironment, environmentView } from "./environment.js";
import { parseBoard, type Position } from "./grid.js";
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
