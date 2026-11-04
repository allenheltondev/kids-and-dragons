import { buffBonus, buffed } from "./buffs.js";
import { combatantById, currentActorId, positionOf, type EncounterState } from "./encounter.js";
import { planEnemyTurn, type EnemyPlan } from "./enemy-ai.js";
import type { RiftBehavior } from "./types/chapter.js";

/** The server's current enemy decision, or a present-board forecast for a future enemy.
 * A forecast never simulates intervening actors, dice, hazards, or future rounds.
 */
export function enemyPlanFor(state: EncounterState, id: string): EnemyPlan {
  const enemy = combatantById(state, id);
  const at = positionOf(state, id);
  if (!enemy || enemy.side !== "enemy" || enemy.down || !at || enemy.skipNextTurn || enemy.windupAttack) return { moveTo: null, attack: null };
  const steps = currentActorId(state) === id ? state.stepsLeft
    : enemy.rooted ? 0 : buffed(enemy.steps, buffBonus(state.buffs, id, "move"), 1);
  const behaviors: Record<string, RiftBehavior> = {};
  for (const fighter of state.combatants) if (fighter.side === "enemy" && fighter.rift) behaviors[fighter.id] = fighter.rift;
  return planEnemyTurn({
    board: state.board, enemy: { id, at, steps, ...(enemy.rift ? { rift: enemy.rift } : {}) },
    party: state.combatants.filter(c => c.side === "party" && !c.escaped).map(c => ({
      id: c.id, at: positionOf(state, c.id)!, hp: c.hp, maxHp: c.maxHp, down: c.down,
    })),
    ...(state.environment ? { environment: { spec: state.environment.spec, round: state.round,
      ...(state.environment.rescue ? { rescue: state.environment.rescue } : {}),
      ...(Object.keys(behaviors).length ? { behaviors } : {}),
    } } : {}),
  });
}
