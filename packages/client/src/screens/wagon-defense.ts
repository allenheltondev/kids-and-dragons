import { combatantById, enemyPlanFor, positionOf, type EncounterState } from "@kad/shared";

/** Authored wagon mission. All progress and forecasts come from combat state. */
export function wagonDefense(encounter: EncounterState) {
  const index = encounter.environment?.spec.objectives?.findIndex(o => o.id === "wagon-lane") ?? -1;
  const goal = encounter.environment?.spec.objectives?.[index];
  if (!goal || goal.kind !== "hold") return null;
  const progress = Math.min(goal.rounds, encounter.environment?.objectives?.[index] ?? 0);
  const post = goal.tiles[0]!;
  const standing = encounter.board.actors.find(a => a.x === post.x && a.y === post.y && !combatantById(encounter, a.id)?.down);
  const defender = standing && combatantById(encounter, standing.id)?.side === "party" ? combatantById(encounter, standing.id)! : null;
  const threats = encounter.combatants.filter(c => c.side === "enemy" && !c.down).flatMap(c => {
    const target = enemyPlanFor(encounter, c.id).attack;
    const from = positionOf(encounter, c.id), to = target ? positionOf(encounter, target) : null;
    return from && to ? [{ from, to, targetId: target! }] : [];
  });
  return { progress, target: goal.rounds, post, defender, threats,
    roundsLeft: Math.max(0, (encounter.environment?.spec.clock?.rounds ?? 0) - encounter.round + 1),
    label: progress ? "Wheels turning" : "Wagon stuck",
    instruction: defender ? `${defender.name} holds the lane. Keep them standing through the round.` : "Stand on the shield to get the wagon moving.",
  };
}
