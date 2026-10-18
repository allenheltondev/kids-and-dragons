/**
 * Running the room (#263): the host's view of who is in it, and the levers.
 *
 * Only on the screen that opened the room (`ClientSession.host`): the TV in
 * Party Mode, the host's phone in Travel Mode, or a family tablet (#250). Its
 * controls are the low-stakes, recoverable ones, which is why the host can be
 * a TV or a kid's phone:
 *
 *   - take a player out, in one tap (#267)
 *   - lock the room to new joins, and open it again
 *   - close the room for everyone, after one "are you sure?"
 *
 * The roster is read from the run (`RunState.seats`, with `party` for heroes
 * and who is connected), so unlike the arrival notices it survives a refresh
 * of the host's screen, and shows a kid still making their hero.
 *
 * Two placements, as `ArrivalNotices` has: `inline` in a host's PlayerView,
 * folded away until opened; `float`, a corner button on the shared display.
 */

import { useState } from "react";
import type { RunState } from "@kad/shared";
import { useGameStore, useRunState, useSession } from "../store";
import { Button } from "../ui";
import { Icon } from "./icons";
import "./HostControls.css";

export type RosterStatus = "here" | "away" | "creating" | "out";

export interface RosterRow {
  playerId: string;
  /** The hero's name once there is one, else the profile's. */
  name: string;
  color: string;
  device: "phone" | "tablet" | null;
  status: RosterStatus;
  /** The host's own seat: listed, but never offered for removal. */
  me: boolean;
}

/**
 * Everybody in the room, in the order they joined, from the run alone. A
 * party member with no roster entry (a run from before the roster) is still
 * listed, so nobody seated is ever missing from the host's view.
 */
export function rosterOf(state: Pick<RunState, "seats" | "party" | "removed">, me: string): RosterRow[] {
  const seats = state.seats ?? {};
  const ids = [...Object.keys(seats)];
  for (const member of state.party) if (!ids.includes(member.playerId)) ids.push(member.playerId);
  return ids.map((playerId) => {
    const seat = seats[playerId];
    const member = state.party.find((m) => m.playerId === playerId);
    const status: RosterStatus = state.removed?.includes(playerId)
      ? "out"
      : member
        ? member.connected
          ? "here"
          : "away"
        : "creating";
    return {
      playerId,
      name: member?.character.name || seat?.name || "Somebody",
      color: seat?.color ?? member?.character.appearance.accent ?? "#888",
      device: seat?.device ?? null,
      status,
      me: playerId === me,
    };
  });
}

const STATUS: Record<RosterStatus, string> = {
  here: "Here",
  away: "Away",
  creating: "Making a hero",
  out: "Taken out",
};

export function HostControls({ placement }: { placement: "inline" | "float" }): React.JSX.Element | null {
  const session = useSession();
  const state = useRunState();
  const [open, setOpen] = useState(false);
  if (!session?.host || !state || state.closed) return null;

  const panel = <HostPanel state={state} me={session.playerId} />;
  if (placement === "inline") {
    return (
      <details className="kad-host kad-host--inline">
        <summary className="kad-host__summary kad-focusable">
          <Icon name="players" />
          <span>Running this room</span>
          {state.locked ? <span className="kad-host__badge">Locked</span> : null}
        </summary>
        {panel}
      </details>
    );
  }
  return (
    <div className="kad-host kad-host--float">
      <Button
        variant="secondary"
        size="md"
        icon={<Icon name="players" />}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {state.locked ? "Room (locked)" : "Room"}
      </Button>
      {open ? panel : null}
    </div>
  );
}

function HostPanel({ state, me }: { state: RunState; me: string }): React.JSX.Element {
  const removePlayer = useGameStore((store) => store.removePlayer);
  const lockRoom = useGameStore((store) => store.lockRoom);
  const closeRoom = useGameStore((store) => store.closeRoom);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const rows = rosterOf(state, me);
  const locked = state.locked === true;

  const run = async (task: () => Promise<boolean>): Promise<void> => {
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kad-host__panel">
      {rows.length === 0 ? (
        <p className="kad-host__empty">Nobody has joined yet.</p>
      ) : (
        <ul className="kad-host__roster" aria-label="Who is in this room">
          {rows.map((row) => (
            <li key={row.playerId} className={`kad-host__row kad-host__row--${row.status}`}>
              <span className="kad-host__dot" style={{ background: row.color }} aria-hidden="true" />
              <span className="kad-host__who">
                <strong>{row.name}</strong>
                {row.me ? " (you)" : null}
                <span className="kad-host__meta">
                  {STATUS[row.status]}
                  {row.device === "tablet" ? " · family tablet" : row.device === "phone" ? " · own phone" : ""}
                </span>
              </span>
              {row.me || row.status === "out" ? null : (
                <Button
                  variant="ghost"
                  size="md"
                  icon={<Icon name="close" />}
                  aria-label={`Remove ${row.name} from this game`}
                  disabled={busy}
                  onClick={() => void run(() => removePlayer(row.playerId))}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="kad-host__actions">
        <Button
          variant="secondary"
          size="md"
          block
          disabled={busy}
          aria-pressed={locked}
          onClick={() => void run(() => lockRoom(!locked))}
        >
          {locked ? "Let new players join again" : "Lock the room"}
        </Button>
        <p className="kad-host__hint">
          {locked
            ? "Locked: nobody new can join. Everyone here can still come back."
            : "Lock it once everyone is in, and nobody else can join with the code."}
        </p>

        {closing ? (
          <div className="kad-host__confirm" role="alertdialog" aria-label="Close the room?">
            <p>Close the room for everyone? Heroes and what they earned are kept.</p>
            <Button
              variant="danger"
              size="md"
              block
              disabled={busy}
              onClick={() => void run(closeRoom).then(() => setClosing(false))}
            >
              Close it
            </Button>
            <Button variant="ghost" size="md" block disabled={busy} onClick={() => setClosing(false)}>
              Keep playing
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="md" block disabled={busy} onClick={() => setClosing(true)}>
            Close the room
          </Button>
        )}
      </div>
    </div>
  );
}
