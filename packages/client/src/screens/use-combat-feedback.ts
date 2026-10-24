import { useEffect, useRef, useState } from "react";
import type { EncounterEvent, EncounterState } from "@kad/shared";
import { usePresentation } from "../store";
import { beatOffsetsMs } from "../world/board-math";
import { presentationDuration } from "../world/presentation";
import { combatFeedback, type CombatFeedback } from "./combat-feedback";

export interface ActiveFeedback extends CombatFeedback { key: string }
/** Decorative only: these timers never gate a command or delay an authoritative patch. */
export function useCombatFeedback(encounter: EncounterState | null): Readonly<Record<string, ActiveFeedback>> {
  const [batch, setBatch] = useState<{ events: readonly EncounterEvent[]; seq: number; ms: number; arrived: number; fight: number | null; opening: boolean } | null>(null);
  const [active, setActive] = useState<Record<string, ActiveFeedback>>({});
  const encounterRef = useRef(encounter);
  encounterRef.current = encounter;
  usePresentation("COMBAT_SEQUENCE", (p, event) => setBatch({ events: p.events, seq: event.seq, ms: presentationDuration(p), arrived: Date.now(), fight: encounterRef.current?.startedAt ?? null, opening: false }));
  usePresentation("ENCOUNTER_BEGAN", (p, event) => setBatch({ events: p.events ?? [], seq: event.seq, ms: presentationDuration(p), arrived: Date.now(), fight: encounterRef.current?.startedAt ?? null, opening: true }));
  const fight = encounter?.startedAt ?? null;
  const hasEncounter = encounter !== null;
  useEffect(() => {
    setActive({});
    const current = encounterRef.current;
    if (!batch || !current || (!batch.opening && batch.fight !== fight)) return;
    const elapsed = Date.now() - batch.arrived;
    if (elapsed > batch.ms + 1000) return;
    const offsets = beatOffsetsMs(batch.events.length, batch.ms);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const feedback of combatFeedback(batch.events, current)) {
      const delay = Math.max(0, (offsets[feedback.eventIndex] ?? 0) - elapsed);
      const key = `${batch.seq}:${feedback.eventIndex}:${feedback.actorId}`;
      timers.push(setTimeout(() => {
        setActive(previous => ({ ...previous, [feedback.actorId]: { ...feedback, key } }));
        timers.push(setTimeout(() => setActive(previous => {
          if (previous[feedback.actorId]?.key !== key) return previous;
          const next = { ...previous };
          delete next[feedback.actorId];
          return next;
        }), 1000));
      }, delay));
    }
    return () => timers.forEach(clearTimeout);
  }, [batch, fight, hasEncounter]);
  return active;
}
