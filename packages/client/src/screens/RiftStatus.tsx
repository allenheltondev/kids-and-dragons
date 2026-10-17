/**
 * The rift, on the shared screen (#201 follow-up): the clock a room can read
 * from the sofa, what the ways out and the captive are doing, and one caption
 * line for each thing the place just did.
 *
 * ---------------------------------------------------------------------------
 * WHY DOM, BESIDE A PIXI BOARD
 *
 * The board marks the squares (world/environment-overlay.ts); this says the
 * rule. A number painted into board pixels is scaled with the camera and goes
 * soft on a 4K panel, while this is type sized in `em` against the surface —
 * the TurnBanner's rule — and readable by a screen reader, which the
 * aria-hidden stage never is. Every word comes from environment-copy.ts, the
 * same lines the phone's combat panel says, so the room and the phone in a
 * child's hand say one thing.
 *
 * ---------------------------------------------------------------------------
 * ONLY IN A FIGHT WITH AN ENVIRONMENT
 *
 * WorldView mounts this only while the encounter carries one, and it renders
 * nothing without one as well: an ordinary fight's shared screen has exactly
 * the DOM it always had.
 *
 * ---------------------------------------------------------------------------
 * THE CAPTION
 *
 * A round's beats arrive on a COMBAT_SEQUENCE (or the opening ENCOUNTER_BEGAN)
 * while the board plays them and the patch waits behind them (sync/channel.ts).
 * The environmental ones — a hazard bites, a hero steps through, the captive
 * is freed or lost, a monster thrown, the clock running out, a surge — are put
 * into words for the length of a read and then fade, keyed on the
 * presentation's sequence number so a new round replaces the last. Ordinary
 * beats are the board's damage numbers' job, and are not repeated here.
 */

import { useState, type ReactElement } from "react";
import type { EncounterEvent, EncounterState } from "@kad/shared";
import { captiveName, combatantById, environmentView } from "@kad/shared";
import { usePresentation, useRunState } from "../store";
import { Icon } from "./icons";
import { combatantLabel } from "./combat-grid";
import {
  CAPTIVE_ICON,
  CLOCK_ICON,
  EXIT_ICON,
  clockReadout,
  environmentBeatLine,
  exitLine,
  modifierIcon,
  modifierLine,
  objectiveIcon,
  objectiveLine,
  rescueLine,
} from "./environment-copy";
import "./RiftStatus.css";

/** At most this many caption lines from one round: the newest win. */
const CAPTION_LINES = 3;

/**
 * The environmental beats of one round, in words for the whole room: names,
 * never "You" — the shared screen is nobody's own.
 */
export function riftCaption(events: readonly EncounterEvent[], encounter: EncounterState): string[] {
  const words = {
    name: (id: string): string => {
      const c = combatantById(encounter, id);
      return c ? combatantLabel(c) : id;
    },
    isParty: (id: string): boolean => combatantById(encounter, id)?.side === "party",
    captive: (index?: number) => captiveName(encounter.environment?.spec, index),
    objective: (id: string) => encounter.environment?.spec.objectives?.find((o) => o.id === id)?.label ?? id,
  };
  const lines: string[] = [];
  for (const event of events) {
    const line = environmentBeatLine(event, words);
    if (line) lines.push(line.text);
  }
  return lines.slice(-CAPTION_LINES);
}

export function RiftStatus(): ReactElement | null {
  const encounter = useRunState()?.encounter ?? null;
  const [caption, setCaption] = useState<{ seq: number; lines: string[] } | null>(null);

  const captionFrom = (events: readonly EncounterEvent[] | undefined, seq: number): void => {
    if (!encounter?.environment || !events) return;
    const lines = riftCaption(events, encounter);
    if (lines.length > 0) setCaption({ seq, lines });
  };
  usePresentation("COMBAT_SEQUENCE", (presentation, event) => captionFrom(presentation.events, event.seq));
  usePresentation("ENCOUNTER_BEGAN", (presentation, event) => captionFrom(presentation.events, event.seq));

  if (!encounter) return null;
  const view = environmentView(encounter);
  if (!view) return null;
  const clock = view.clock ? clockReadout(view.clock) : null;

  return (
    <aside className="rift-status" aria-label="The rift">
      {clock ? (
        <p className={`rift-status__clock rift-status__clock--${clock.mood}`} role="status">
          <span className="rift-status__figure" aria-hidden="true">
            <Icon name={CLOCK_ICON} />
            <b>{clock.figure}</b>
          </span>
          <span>{clock.text}</span>
        </p>
      ) : null}
      <ul className="rift-status__lines">
        {view.exits.map((exit) => (
          <li key={`exit:${exit.id}`} className={exit.open ? "rift-status__line--open" : undefined}>
            <Icon name={EXIT_ICON} />
            <span>{exitLine(exit)}</span>
          </li>
        ))}
        {view.modifiers.map((modifier) => (
          <li key={`modifier:${modifier.id}`}>
            <Icon name={modifierIcon(modifier)} />
            <span>{modifierLine(modifier)}</span>
          </li>
        ))}
        {view.objectives.map((objective) => (
          <li key={`objective:${objective.id}`} className={objective.done ? "rift-status__line--open" : undefined}>
            <Icon name={objectiveIcon(objective.kind)} />
            <span>{objectiveLine(objective)}</span>
          </li>
        ))}
        {view.captives.map((captive, i) => (
          <li key={`rescue:${i}`}>
            <Icon name={CAPTIVE_ICON} />
            <span>{rescueLine(captive)}</span>
          </li>
        ))}
      </ul>
      {caption ? (
        <ul className="rift-status__caption" key={caption.seq} aria-live="polite">
          {caption.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
