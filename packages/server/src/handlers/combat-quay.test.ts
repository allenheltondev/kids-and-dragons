import path from "node:path";
import { describe, expect, it } from "vitest";
import { beginEncounter, currentActor, enemyPlanFor, encounterOutcome, endTurnWithEvents, legalMoves, moveTo,
  parseBoard, performAction, performEnemyWindup, resolveCharacter, stepsBetween, type EncounterScene } from "@kad/shared";
import { makeCharacter } from "../../../shared/src/test-fixtures.ts";
import { loadContent } from "../content/loader.ts";

const content = await loadContent(path.resolve(import.meta.dirname, "../../../../content"));
const scene = content.chapter("gemfall-01")!.scenes.encounter_quay_wisps as EncounterScene;
const map = content.map(scene.map)!;
// All enemy rolls miss so these tests isolate authored reachability and endings;
// combat-windup.test exercises staying in a blast, damage, protection and interruption.
const ctx = { rules: content.rules(), abilities: content.abilities(), rng: { next: () => .001 } };
function play(seats: number, help: boolean) {
  let state = beginEncounter({ board: parseBoard(map.rows), environment: scene.environment!,
    party: Array.from({ length: seats }, (_, i) => ({ character: resolveCharacter(makeCharacter({ id: `hero${i}`, name: `Hero ${i}`, class: "songkeeper" }), ctx.rules, content.items()), at: map.partySpawns[i]! })),
    enemies: scene.enemies.flatMap((spec, i) => Array.from({ length: spec.count }, () => ({ spec, at: map.enemySpawns[i]! }))),
  }, ctx);
  const helpers = new Set<string>();
  const goal = scene.environment!.objectives![0]!;
  if (goal.kind !== "close") throw Error("The ferry uses a helping objective");
  for (let turn = 0; turn < 60 && encounterOutcome(state) === "ongoing"; turn++) {
    const actor = currentActor(state)!;
    if (actor.side === "party" && help) {
      const tile = [...legalMoves(state)].sort((a, b) => stepsBetween(a, goal.at!) - stepsBetween(b, goal.at!))[0];
      if (tile) { const moved = moveTo(state, tile); if (moved.ok) state = moved.state; }
    } else if (actor.side === "enemy") {
      if (actor.windupAttack) state = performEnemyWindup(state, ctx).state;
      else {
        const plan = enemyPlanFor(state, actor.id);
        if (plan.moveTo) { const moved = moveTo(state, plan.moveTo); if (moved.ok) state = moved.state; }
        if (plan.attack) { const attack = performAction(state, ctx, { abilityId: "attack", targetId: plan.attack }); if (attack.ok) state = attack.state; }
      }
    }
    const ended = endTurnWithEvents(state);
    if (ended.events.some(e => e.type === "objective")) helpers.add(actor.id);
    state = ended.state;
  }
  return { state, helpers };
}

describe("the authored ferry encounter", () => {
  it.each([1, 2, 4])("can be won by securing the ferry with %i support heroes", seats => {
    const { state, helpers } = play(seats, true);
    expect(encounterOutcome(state)).toBe("victory");
    expect(state.environment!.objectives).toEqual([2]);
    expect(state.combatants.filter(c => c.side === "enemy").every(c => !c.down)).toBe(true);
    expect(helpers.size).toBe(Math.min(seats, 2));
  });
  it("runs out of time when the party leaves the ferry untied", () => {
    expect(encounterOutcome(play(2, false).state)).toBe("timedOut");
    expect(scene.onTimeout?.goto).toBe("scene_quay_wisps_scattered");
  });
});
