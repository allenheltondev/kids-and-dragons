import { combatantById, enemyPlanFor, type EncounterState } from "@kad/shared";
import { combatantLabel } from "./combat-grid";

export function nextEnemyId(state: EncounterState): string | undefined {
  const order = state.round === 1 ? state.openingOrder : state.order;
  return [...order.slice(state.turnIndex + 1), ...order.slice(0, state.turnIndex + 1)]
    .find(id => { const f = combatantById(state, id); return f?.side === "enemy" && !f.down; });
}
/** Describes the shared planner on this board, not a promised future outcome. */
export function enemyIntentLine(state: EncounterState, id: string): string {
  const enemy = combatantById(state, id);
  if (!enemy || enemy.down) return "Out of the fight.";
  if (enemy.skipNextTurn) return "Their next turn is skipped.";
  const plan = enemyPlanFor(state, id);
  const target = plan.attack ? combatantById(state, plan.attack) : null;
  return target ? `May attack ${combatantLabel(target)}. Moving can change this.`
    : plan.moveTo ? "From here, would move closer. Watch their approach." : "From here, would hold position.";
}
export function combatMission(state: EncounterState): string {
  const env = state.environment;
  if (env?.spec.victory === "rescue") return "Rescue the friend. You win when they are free.";
  if (env?.spec.objectives?.some(o => o.endsFight)) return "Complete the objective or clear the enemies.";
  return "Make a way through together.";
}
