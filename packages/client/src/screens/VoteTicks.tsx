/**
 * Who voted for an option, as ticks rather than names.
 *
 * A row of names grows with every vote, and a growing row rewraps whatever it
 * sits beside — the label you are reading, or the whole line of choices on the
 * TV. So each voter gets a seat for the life of the question, drawn whether
 * they have voted here or not, and voting only fills it in their color: the
 * row is the same width from the first vote to the last, and a seat is always
 * the same player, so "the gold one is Thistle" reads at a glance.
 *
 * The names are still here, for screen readers (and anything else reading the
 * option's text) — they just take no room.
 */

import type { ReactElement, CSSProperties } from "react";
import type { PartyMember } from "@kad/shared";
import { ScreenReaderOnly } from "../ui/ScreenReaderOnly";

export interface VoteTicksProps {
  /** Everyone with a vote on this question, in seat order. */
  voterIds: readonly string[];
  /** Which of them voted for this option. */
  votedIds: readonly string[];
  party: readonly PartyMember[];
  className?: string;
}

export function VoteTicks({ voterIds, votedIds, party, className }: VoteTicksProps): ReactElement {
  const voted = new Set(votedIds);
  // A vote from somebody without a seat (they joined mid-question) still
  // shows: it takes a seat on the end rather than vanishing.
  const seats = [...voterIds, ...votedIds.filter((id) => !voterIds.includes(id))];
  const names = votedIds.map(
    (id) => party.find((m) => m.playerId === id)?.character.name ?? "Someone",
  );
  return (
    <span className={`kad-vote-ticks${className ? ` ${className}` : ""}`}>
      <span className="kad-vote-ticks__row" aria-hidden="true">
        {seats.map((id) => {
          const accent = party.find((m) => m.playerId === id)?.character.appearance.accent;
          return (
            <span
              key={id}
              className={`kad-vote-tick${voted.has(id) ? " kad-vote-tick--on" : ""}`}
              style={accent ? ({ "--kad-tick": accent } as CSSProperties) : undefined}
            />
          );
        })}
      </span>
      {names.length === 0 ? null : <ScreenReaderOnly>Votes: {names.join(", ")}</ScreenReaderOnly>}
    </span>
  );
}
