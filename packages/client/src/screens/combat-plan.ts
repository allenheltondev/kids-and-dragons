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
  if (enemy.windupAttack?.presentation === "slam") return enemy.windup
    ? `${enemy.windupAttack.label} hits marked ground next turn. Move clear or daze.`
    : `Aims ${enemy.windupAttack.label.toLowerCase()} at the nearest hero's ground.`;
  if (enemy.windupAttack) return enemy.windup
    ? "Marked ground bursts next turn. Move clear or daze."
    : "Marks the nearest hero's ground; bursts next turn.";
  const plan = enemyPlanFor(state, id);
  const target = plan.attack ? combatantById(state, plan.attack) : null;
  return target ? `From here: attack ${combatantLabel(target)}.`
    : plan.moveTo ? "From here: move closer." : "From here: hold position.";
}
export function combatMission(state: EncounterState): string {
  const env = state.environment;
  if (env?.spec.victory === "rescue") return "Rescue the friend. You win when they are free.";
  if (env?.spec.objectives?.some(o => o.endsFight)) return "Complete the objective or clear the enemies.";
  return "Make a way through together.";
}

export function crossingProgress(state: EncounterState): string | null {
  const exits = state.environment?.spec.exits;
  const atCampfire = exits?.some(exit => exit.id === "big-campfire");
  const pastBoundary = exits?.some(exit => exit.id === "boundary-stone");
  if (!atCampfire && !pastBoundary && !exits?.some(exit => exit.id === "far-bank")) return null;
  const heroes = state.combatants.filter(c => c.side === "party");
  const across = heroes.filter(c => c.escaped);
  return `${across.length}/${heroes.length} ${atCampfire ? "at the big campfire" : pastBoundary ? "past the boundary" : "across"}${across.length ? `: ${across.map(c => c.name).join(", ")}` : ""}.`;
}
