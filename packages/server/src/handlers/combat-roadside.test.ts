import path from "node:path";
import { describe, expect, it } from "vitest";
import { beginEncounter, committedAttacks, currentActor, enemyPlanFor, encounterOutcome, endTurnWithEvents,
  legalMoves, moveTo, parseBoard, performAction, performEnemyWindup, positionOf, resolveCharacter, stepsBetween,
  type EncounterScene, type EncounterState } from "@kad/shared";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { loadContent } from "../content/loader.ts";

const content = await loadContent(path.resolve(import.meta.dirname, "../../../../content"));
const chapter = content.chapter("gemfall-02")!;
// Misses isolate route/clock fairness for support heroes. Shared windup tests
// exercise damage, protection, interruption and recovery after a poor move.
const ctx = { rules: content.rules(), abilities: content.abilities(), rng: { next: () => .001 } };
function setup(id: string, seats: number) {
  const scene = chapter.scenes[id] as EncounterScene;
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
      const targets = id === "encounter_wolves" ? [{ x: 3, y: 2 }] : [{ x: 6, y: 2 }, { x: 6, y: 3 }];
      const distance = (p: { x: number; y: number }) => Math.min(...targets.map(t => stepsBetween(p, t)));
      const tile = [...legalMoves(state)].sort((a, b) => distance(a) - distance(b))[0];
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
  it.each(["encounter_wolves", "encounter_mimic_plank"])("ignoring %s reaches its authored recovery", id => {
    const { state } = play(id, 2, false);
    expect(encounterOutcome(state)).toBe("timedOut");
    const scene = chapter.scenes[id] as EncounterScene;
    expect(chapter.scenes[scene.onTimeout!.goto]).toBeDefined();
  });
  it("crossing leaves the mimic's treasure behind; defeating it still earns the whistle", () => {
    const scene = chapter.scenes.encounter_mimic_plank as EncounterScene;
    expect(scene.onEscape?.goto).toBe("scene_mimic_passed");
    expect(scene.onEscape?.effects).toBeUndefined();
    expect(scene.onVictory.effects).toContainEqual({ type: "grantItem", itemId: "brave_whistle", to: "party" });
  });
});
