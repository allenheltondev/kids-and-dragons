import type { EncounterState } from "./encounter.js";
import type { Position } from "./grid.js";

/** Committed ground shared by every screen; forecasts never create danger zones. */
export function committedAttacks(state: EncounterState): { actorId: string; label: string; tiles: readonly Position[] }[] {
  return state.combatants.flatMap(c => c.side === "enemy" && !c.down && !c.skipNextTurn && c.windup && c.windupAttack
    ? [{ actorId: c.id, label: c.windupAttack.label, tiles: c.windup.tiles }] : []);
}
