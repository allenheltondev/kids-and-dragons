import type { EncounterEvent, EncounterState } from "@kad/shared";

export type CombatReaction = "hurt" | "ready" | "celebrate";
export interface CombatFeedback {
  actorId: string;
  effect: "impact_strike" | "heal_bloom" | "guard_ward" | "miss_veer" | "burst_star";
  reaction?: CombatReaction;
  label: string;
  eventIndex: number;
}
/** Read events, never infer damage or consume input. The same batch drives both screens. */
export function combatFeedback(events: readonly EncounterEvent[], encounter: EncounterState): CombatFeedback[] {
  const out: CombatFeedback[] = [];
  const defeated = new Set(encounter.combatants.filter(c => c.side === "enemy" && c.down).map(c => c.id));
  const downAfterBatch = new Set(encounter.combatants.filter(c => c.down).map(c => c.id));
  for (const event of events) {
    if (event.type === "down") downAfterBatch.add(event.actorId);
    if (event.type === "revived") downAfterBatch.delete(event.actorId);
  }
  let celebrated = false;
  events.forEach((event, eventIndex) => {
    const add = (actorId: string, effect: CombatFeedback["effect"], label: string, reaction?: CombatReaction) =>
      out.push({ actorId, effect, label, eventIndex, ...(reaction ? { reaction } : {}) });
    switch (event.type) {
      case "damage": if (event.amount > 0) add(event.actorId, "impact_strike", `−${event.amount}`, "hurt"); break;
      case "heal": if (event.amount > 0) add(event.actorId, "heal_bloom", `+${event.amount}`); break;
      case "revived": add(event.actorId, "heal_bloom", "Up again!", "celebrate"); break;
      case "warded": add(event.actorId, "guard_ward", "Guarded", "ready"); break;
      case "protected": add(event.byId, "guard_ward", "Protected!", "ready"); break;
      case "bonus": add(event.actorId, "guard_ward", `+${event.amount} ready`, "ready"); break;
      case "evaded": add(event.actorId, "miss_veer", "Dodged!"); break;
      case "roll":
        if (event.targetId && event.roll.result !== "hit" && event.roll.result !== "success")
          add(event.targetId, "miss_veer", "Miss!");
        break;
      case "freed": add(event.byId, "burst_star", "Safe!", "celebrate"); break;
      case "objective": if (event.progress >= event.target && event.byId) add(event.byId, "burst_star", "Done!", "celebrate"); break;
      case "down": {
        if (!encounter.combatants.some(c => c.id === event.actorId && c.side === "enemy")) break;
        defeated.add(event.actorId);
        if (!celebrated && encounter.combatants.filter(c => c.side === "enemy").every(c => defeated.has(c.id))) {
          celebrated = true;
          for (const c of encounter.combatants.filter(c => c.side === "party" && !downAfterBatch.has(c.id)))
            add(c.id, "burst_star", "We did it!", "celebrate");
        }
        break;
      }
    }
  });
  return out;
}
export const EFFECT_FRAMES = { impact_strike: 8, heal_bloom: 12, guard_ward: 8, miss_veer: 8, burst_star: 12 } as const;
