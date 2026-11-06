import path from "node:path";
import { describe, expect, it } from "vitest";
import { beginEncounter, committedAttacks, currentActor, enemyPlanFor, encounterOutcome, endTurnWithEvents,
  combatantById, legalMoves, moveTo, parseBoard, performAction, performEnemyWindup, positionOf, resolveCharacter, stepsBetween,
  type EncounterScene, type EncounterState } from "@kad/shared";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { loadContent } from "../content/loader.ts";

const content = await loadContent(path.resolve(import.meta.dirname, "../../../../content"));
const chapter = content.chapter("gemfall-02")!;
const ford = content.chapter("gemfall-03c")!;
// Misses isolate route/clock fairness for support heroes. Shared windup tests
// exercise damage, protection, interruption and recovery after a poor move.
const ctx = { rules: content.rules(), abilities: content.abilities(), rng: { next: () => .001 } };
function setup(id: string, seats: number, source = id === "encounter_crabs" ? ford : chapter) {
  const scene = source.scenes[id] as EncounterScene;
  const map = content.map(scene.map)!;
  return { scene, state: beginEncounter({ board: parseBoard(map.rows), environment: scene.environment!,
    party: Array.from({ length: seats }, (_, i) => ({ character: resolveCharacter(makeCharacter({ id: `hero${i}`, class: "songkeeper" }), ctx.rules, content.items()), at: map.partySpawns[i]! })),
    enemies: scene.enemies.flatMap(spec => Array.from({ length: spec.count }, () => spec)).map((spec, i) => ({ spec, at: map.enemySpawns[i]! })),
  }, ctx) };
}
function enemyTurn(state: EncounterState) {
  const actor = currentActor(state)!;
  if (actor.windupAttack) return performEnemyWindup(state, ctx).state;
  const plan = enemyPlanFor(state, actor.id);
  if (plan.moveTo) { const moved = moveTo(state, plan.moveTo); if (moved.ok) state = moved.state; }
  if (plan.attack) { const attack = performAction(state, ctx, { abilityId: "attack", targetId: plan.attack }); if (attack.ok) state = attack.state; }
  return state;
}
function play(id: string, seats: number, cooperate: boolean) {
  let { state } = setup(id, seats);
  let warnings = 0;
  for (let turn = 0; turn < 100 && encounterOutcome(state) === "ongoing"; turn++) {
    const actor = currentActor(state)!;
    if (actor.side === "enemy") state = enemyTurn(state);
    else if (cooperate) {
      const targets = id === "encounter_mimic_plank" ? [{ x: 6, y: 2 }, { x: 6, y: 3 }] : [{ x: 3, y: 2 }];
      const distance = (p: { x: number; y: number }) => Math.min(...targets.map(t => stepsBetween(p, t)));
      const moves = legalMoves(state).filter(tile => id !== "encounter_crabs" || tile.x !== 2 || tile.y !== 3);
      const tile = moves.sort((a, b) => distance(a) - distance(b))[0];
      if (tile && distance(tile) < distance(positionOf(state, actor.id)!)) { const moved = moveTo(state, tile); if (moved.ok) state = moved.state; }
    }
    warnings += committedAttacks(state).length;
    // Saved threats and partial hold progress must survive reload.
    state = JSON.parse(JSON.stringify(endTurnWithEvents(state).state));
  }
  return { state, warnings };
}

describe("authored roadside combat", () => {
  it.each([1, 2, 4])("%i support heroes can hold the wagon lane without defeating wolves", seats => {
    const { state } = play("encounter_wolves", seats, true);
    expect(encounterOutcome(state)).toBe("victory");
    expect(state.environment!.objectives).toEqual([2]);
    expect(state.combatants.filter(c => c.side === "enemy").every(c => !c.down)).toBe(true);
  });
  it.each([1, 2, 4])("all %i support heroes can cross the mimic's lane without defeating it", seats => {
    const { state, warnings } = play("encounter_mimic_plank", seats, true);
    expect(encounterOutcome(state)).toBe("escaped");
    expect(state.combatants.filter(c => c.side === "party").every(c => c.escaped)).toBe(true);
    expect(state.combatants.find(c => c.side === "enemy")!.down).toBe(false);
    expect(warnings).toBeGreaterThan(0);
  });
  it.each([1, 2, 4])("%i support heroes can hold the high stone without defeating crabs", seats => {
    const { state } = play("encounter_crabs", seats, true);
    expect(encounterOutcome(state)).toBe("victory");
    expect(state.environment!.objectives).toEqual([1]);
    expect(state.combatants.filter(c => c.side === "enemy").every(c => !c.down)).toBe(true);
  });
  it("the ford current pushes an exposed hero back without damage", () => {
    let { state } = setup("encounter_crabs", 1);
    while (currentActor(state)!.side === "enemy") state = endTurnWithEvents(enemyTurn(state)).state;
    const hero = currentActor(state)!;
    const moved = moveTo(state, { x: 2, y: 3 });
    if (!moved.ok) throw new Error("The low stone must be reachable");
    const resolved = endTurnWithEvents(moved.state);
    expect(positionOf(resolved.state, hero.id)).toEqual({ x: 0, y: 3 });
    expect(resolved.state.combatants.find(c => c.id === hero.id)?.hp).toBe(hero.hp);
  });
  it("a crab can shove a hero into the current before the hero gets another turn", () => {
    let { state } = setup("encounter_crabs", 1);
    while (currentActor(state)!.side === "enemy") state = endTurnWithEvents(enemyTurn(state)).state;
    const hero = currentActor(state)!;
    const moved = moveTo(state, { x: 3, y: 3 });
    if (!moved.ok) throw new Error("The tile beyond the low stone must be reachable");
    state = endTurnWithEvents(moved.state).state;
    expect(positionOf(state, hero.id)).toEqual({ x: 3, y: 3 });
    const events = [];
    while (currentActor(state)!.side === "enemy") {
      const result = endTurnWithEvents(enemyTurn(state));
      state = result.state;
      events.push(...result.events);
    }
    expect(events).toContainEqual(expect.objectContaining({ type: "hazard", actorId: hero.id, label: "Ford current" }));
    expect(positionOf(state, hero.id)).toEqual({ x: 0, y: 3 });
  });
  it.each(["encounter_wolves", "encounter_mimic_plank", "encounter_crabs"])("ignoring %s reaches its authored recovery", id => {
    const { state } = play(id, 2, false);
    expect(encounterOutcome(state)).toBe("timedOut");
    const source = id === "encounter_crabs" ? ford : chapter;
    const scene = source.scenes[id] as EncounterScene;
    expect(source.scenes[scene.onTimeout!.goto]).toBeDefined();
  });
  it("crossing leaves the mimic's treasure behind; defeating it still earns the whistle", () => {
    const scene = chapter.scenes.encounter_mimic_plank as EncounterScene;
    expect(scene.onEscape?.goto).toBe("scene_mimic_passed");
    expect(scene.onEscape?.effects).toBeUndefined();
    expect(scene.onVictory.effects).toContainEqual({ type: "grantItem", itemId: "brave_whistle", to: "party" });
  });
});

describe("ford road combat batch", () => {
  it.each([1, 2, 4])("%i heroes can reach the big campfire without defeating the pack", seats => {
    const { scene, state: initial } = setup("encounter_wolves", seats, ford);
    const exit = scene.environment!.exits![0]!;
    let state = initial;
    for (let turn = 0; turn < 60 && encounterOutcome(state) === "ongoing"; turn++) {
      const actor = currentActor(state)!;
      if (actor.side === "enemy") state = enemyTurn(state);
      else {
        const distance = (tile: { x: number; y: number }) => Math.min(...exit.tiles.map(t => stepsBetween(tile, t)));
        const next = [...legalMoves(state)].sort((a, b) => distance(a) - distance(b))[0];
        if (next && distance(next) < distance(positionOf(state, actor.id)!)) {
          const moved = moveTo(state, next);
          if (moved.ok) state = moved.state;
        }
      }
      state = endTurnWithEvents(state).state;
    }
    expect(encounterOutcome(state)).toBe("escaped");
    expect(state.combatants.filter(c => c.side === "party").every(c => c.escaped)).toBe(true);
  });

  it.each([1, 2, 4])("%i heroes can right the wagon through the tail sweeps", seats => {
    const { state: initial } = setup("encounter_drakes", seats, ford);
    let state = initial;
    let sawWarning = false;
    const wheel = { x: 4, y: 2 };
    for (let turn = 0; turn < 60 && encounterOutcome(state) === "ongoing"; turn++) {
      const actor = currentActor(state)!;
      if (actor.side === "enemy") state = enemyTurn(state);
      else {
        const danger = committedAttacks(state).flatMap(warning => warning.tiles);
        const at = positionOf(state, actor.id)!;
        const risk = (p: { x: number; y: number }) => Number(danger.some(t => t.x === p.x && t.y === p.y));
        const score = (p: { x: number; y: number }) => risk(p) * 10 + stepsBetween(p, wheel);
        const next = [...legalMoves(state)].sort((a, b) => score(a) - score(b))[0];
        if (next && score(next) < score(at)) {
          const moved = moveTo(state, next);
          if (moved.ok) state = moved.state;
        }
      }
      sawWarning ||= committedAttacks(state).length > 0;
      state = endTurnWithEvents(state).state;
    }
    expect(sawWarning).toBe(true);
    expect(encounterOutcome(state)).toBe("victory");
    expect(state.environment!.objectives).toEqual([2]);
  });

  it("clearing the depot still earns Pennywhistle's whistle", () => {
    const depot = content.chapter("gemfall-04c")!;
    const { scene, state: initial } = setup("encounter_boxes", 2, depot);
    const hits = { ...ctx, rng: { next: () => .999 } };
    let state = initial;
    for (let turn = 0; turn < 60 && encounterOutcome(state) === "ongoing"; turn++) {
      const actor = currentActor(state)!;
      if (actor.side === "enemy") state = enemyTurn(state);
      else {
        const foes = state.combatants.filter(c => c.side === "enemy" && !c.down);
        const distance = (p: { x: number; y: number }) => Math.min(...foes.map(foe => stepsBetween(p, positionOf(state, foe.id)!)));
        const at = positionOf(state, actor.id)!;
        const tile = [...legalMoves(state)].filter(t => t.x !== 2 || (t.y !== 2 && t.y !== 3)).sort((a, b) => distance(a) - distance(b))[0];
        if (tile && distance(tile) < distance(at)) {
          const moved = moveTo(state, tile);
          if (moved.ok) state = moved.state;
        }
        for (const foe of foes) {
          const attack = performAction(state, hits, { abilityId: "attack", targetId: foe.id });
          if (attack.ok) { state = attack.state; break; }
        }
      }
      state = endTurnWithEvents(state).state;
    }
    expect(encounterOutcome(state)).toBe("victory");
    expect(scene.onVictory.effects).toContainEqual({ type: "grantItem", itemId: "brave_whistle", to: "party" });
    expect(scene.onTimeout?.effects).not.toContainEqual(expect.objectContaining({ type: "grantItem" }));
  });

  it("sticky ink costs steps after a bad stop, then wears off", () => {
    const depot = content.chapter("gemfall-04c")!;
    let { state } = setup("encounter_boxes", 1, depot);
    while (currentActor(state)!.side === "enemy") state = endTurnWithEvents(enemyTurn(state)).state;
    const hero = currentActor(state)!;
    const moved = moveTo(state, { x: 2, y: 2 });
    if (!moved.ok) throw new Error("Ink must be reachable");
    const landed = endTurnWithEvents(moved.state);
    expect(landed.events).toContainEqual(expect.objectContaining({ type: "slowed", actorId: hero.id, steps: 2, turns: 1 }));
    state = landed.state;
    while (currentActor(state)!.side === "enemy") state = endTurnWithEvents(enemyTurn(state)).state;
    expect(state.stepsLeft).toBe(hero.steps - 2);
    expect(combatantById(state, hero.id)?.hp).toBe(hero.hp);
    const escaped = legalMoves(state).find(t => t.y >= 4 || t.x >= 4);
    if (!escaped) throw new Error("The slowed hero needs a way out");
    const movedClear = moveTo(state, escaped);
    if (!movedClear.ok) throw new Error("The way out must be legal");
    state = endTurnWithEvents(movedClear.state).state;
    while (currentActor(state)!.side === "enemy") state = endTurnWithEvents(enemyTurn(state)).state;
    expect(state.stepsLeft).toBe(hero.steps);
  });
});

const mountainFights = [
  { chapter: "gemfall-04c", sceneId: "encounter_wolves", target: { x: 3, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-05a", sceneId: "encounter_wolves", target: { x: 7, y: 5 }, outcome: "escaped" },
  { chapter: "gemfall-06", sceneId: "encounter_crab", target: { x: 4, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-04a", sceneId: "encounter_mimics", target: { x: 3, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-05b", sceneId: "encounter_wolves", target: { x: 6, y: 3 }, outcome: "escaped" },
  { chapter: "gemfall-05b", sceneId: "encounter_drake", target: { x: 4, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-03a", sceneId: "encounter_crawlers", target: { x: 6, y: 3 }, outcome: "escaped" },
  { chapter: "gemfall-03a", sceneId: "encounter_crabs", target: { x: 3, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-03b", sceneId: "encounter_mimic", target: { x: 4, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-04a", sceneId: "encounter_wolves", target: { x: 3, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-04b", sceneId: "encounter_echo", target: { x: 6, y: 3 }, outcome: "escaped" },
  { chapter: "gemfall-04b", sceneId: "encounter_logs", target: { x: 4, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-08", sceneId: "encounter_gallery", target: { x: 3, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-08", sceneId: "encounter_dragon", target: { x: 4, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-08", sceneId: "encounter_crabs", target: { x: 6, y: 3 }, outcome: "escaped" },
  { chapter: "gemfall-06", sceneId: "encounter_crawlers", target: { x: 4, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-07l", sceneId: "encounter_echoes", target: { x: 4, y: 3 }, outcome: "victory" },
  { chapter: "gemfall-07r", sceneId: "encounter_drake", target: { x: 6, y: 3 }, outcome: "escaped" },
  { chapter: "gemfall-05a", sceneId: "encounter_wisps", target: { x: 4, y: 2 }, outcome: "victory" },
  { chapter: "gemfall-05c", sceneId: "encounter_crabs", target: { x: 6, y: 3 }, outcome: "escaped" },
  { chapter: "gemfall-05c", sceneId: "encounter_crawlers", target: { x: 3, y: 2 }, outcome: "victory" },
] as const;

describe.each(mountainFights)("$sceneId on the mountain road", ({ chapter, sceneId, target, outcome }) => {
  it.each([1, 2, 4])("%i support heroes can reach the authored goal without attacking", seats => {
    const { state: initial } = setup(sceneId, seats, content.chapter(chapter)!);
    let state = initial;
    let sawWarning = false;
    for (let turn = 0; turn < 70 && encounterOutcome(state) === "ongoing"; turn++) {
      const actor = currentActor(state)!;
      if (actor.side === "enemy") state = enemyTurn(state);
      else {
        const at = positionOf(state, actor.id)!;
        const danger = committedAttacks(state).flatMap(w => w.tiles);
        sawWarning ||= danger.length > 0;
        const goal = chapter === "gemfall-08" && sceneId === "encounter_crabs" && state.round >= 3 ? { x: 6, y: 1 } : target;
        const score = (p: { x: number; y: number }) =>
          Number(danger.some(t => t.x === p.x && t.y === p.y)) * 10 +
          (chapter === "gemfall-03a" && sceneId === "encounter_crawlers" ? Math.min(stepsBetween(p, goal), stepsBetween(p, { x: 6, y: 2 })) : stepsBetween(p, goal));
        const moves = legalMoves(state).filter(p => (chapter !== "gemfall-07r" || sceneId !== "encounter_drake" || p.x !== 5 || (p.y !== 1 && p.y !== 4)) &&
          (chapter !== "gemfall-03a" || sceneId !== "encounter_crawlers" || p.x !== 3 || p.y !== 3));
        const next = moves.sort((a, b) => score(a) - score(b))[0];
        // Let the crabs commit a sweep before anyone goes for the stone.
        if (next && score(next) < score(at) && (sceneId !== "encounter_crab" || sawWarning)) {
          const moved = moveTo(state, next);
          if (moved.ok) state = moved.state;
        }
      }
      state = endTurnWithEvents(state).state;
    }
    expect(encounterOutcome(state)).toBe(outcome);
    if (sceneId === "encounter_wisps" || sceneId === "encounter_crab") expect(sawWarning).toBe(true);
    if (sceneId === "encounter_crawlers" && outcome === "victory") expect(state.environment!.objectives).toEqual([2]);
    if (sceneId === "encounter_echoes") expect(state.environment!.objectives).toEqual([1]);
    if (chapter === "gemfall-07r" && sceneId === "encounter_drake") {
      expect(positionOf(state, "drake#1")).toEqual({ x: 5, y: 1 });
      expect(positionOf(state, "small#1")).toEqual({ x: 5, y: 4 });
    }
    if (outcome === "escaped") expect(state.combatants.filter(c => c.side === "party").every(c => c.escaped)).toBe(true);
    expect(state.combatants.filter(c => c.side === "enemy").every(c => !c.down)).toBe(true);
  });
  it("leaving the goal unattended reaches the authored recovery", () => {
    const { scene, state: initial } = setup(sceneId, 1, content.chapter(chapter)!);
    let state = initial;
    for (let turn = 0; turn < 70 && encounterOutcome(state) === "ongoing"; turn++) {
      if (currentActor(state)!.side === "enemy") state = enemyTurn(state);
      state = endTurnWithEvents(state).state;
    }
    expect(["timedOut", "defeat"]).toContain(encounterOutcome(state));
    expect(scene.onTimeout).toEqual(scene.onDefeat);
  });
});

it("the high stream lets a hero stand on the low route before the round-two spill", () => {
  let { state } = setup("encounter_drake", 1, content.chapter("gemfall-05b")!);
  while (currentActor(state)!.side === "enemy") state = endTurnWithEvents(enemyTurn(state)).state;
  const hero = currentActor(state)!;
  const low = { x: 2, y: 3 };
  const moved = moveTo(state, low);
  if (!moved.ok) throw new Error("The low route must be reachable");
  const first = endTurnWithEvents(moved.state);
  expect(positionOf(first.state, hero.id)).toEqual(low);
  expect(first.events.some(event => event.type === "hazard")).toBe(false);
  state = first.state;
  while (currentActor(state)!.side === "enemy") state = endTurnWithEvents(enemyTurn(state)).state;
  expect(state.round).toBe(2);
  const next = endTurnWithEvents(state);
  expect(next.events).toContainEqual(expect.objectContaining({ type: "hazard", hazardId: "stream-spill", actorId: hero.id }));
  expect(positionOf(next.state, hero.id)!.x).toBeLessThan(low.x);
});
