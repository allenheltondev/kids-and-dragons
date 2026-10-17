/**
 * Who just joined (#267).
 *
 * A room code is the only thing between a stranger and the game, so the room
 * should see everyone who arrives, the moment they arrive, and not only once
 * they have made a hero. The server announces each join (`ArrivalMessage`);
 * this draws it on the screens that answer for the room: the shared display,
 * and the device that opened the room. A player's own phone is busy with
 * their own turn and does not get them.
 *
 * On the host's device each notice has a Remove button: one tap and that
 * phone is out of the game (`removePlayer`). Everywhere else it is a notice
 * and nothing more, and it goes away on its own. The host's stay until the
 * host dismisses one or removes that player: a host who looks away, or only
 * notices a stranger later, must not lose the one control that takes them
 * out. A refresh still loses them; the host's roster (HostControls, #263)
 * does not, and has the same Remove.
 *
 * Two placements, because the two screens differ in what can be covered:
 *
 *  - `float`, for the shared display (App): a corner of a screen nobody taps.
 *  - `inline`, for a host's phone (PlayerView): in the flow, at the top, so it
 *    pushes that player's own controls down instead of sitting on them. A
 *    floating notice there blocked the very button a host needed for its turn,
 *    for as long as it was shown.
 */

import { useEffect, useState } from "react";
import { useGameStore } from "../store";
import type { Arrival } from "../store/contract";
import { Button } from "../ui";
import { Icon } from "./icons";
import "./ArrivalNotices.css";

/** Long enough to read across a room. A host's notices do not expire. */
const SHOWN_MS = 8_000;

/**
 * Cards drawn before the rest fold behind "N more". A busy lobby is a handful
 * of arrivals; a flood is hundreds, and drawing them all would bury the host's
 * own controls, Remove included.
 */
const SHOWN_AT_ONCE = 3;

export function ArrivalNotices({ placement }: { placement: "float" | "inline" }): React.JSX.Element | null {
  const session = useGameStore((store) => store.session);
  const arrivals = useGameStore((store) => store.arrivals);
  const dropped = useGameStore((store) => store.arrivalsDropped);
  const [expanded, setExpanded] = useState(false);
  const display = session?.playerId === "";
  const host = session?.host === true;
  // The display floats its notices; a seated host gets them in its own view.
  const mine = placement === "float" ? display : host && !display;

  // A flood's warning outlives the cards: players who fell off the list may
  // still be in the room after the host clears the ones it could see. It goes
  // when this screen leaves the room (`arrivalsDropped` resets on disconnect).
  const flooded = host && dropped > 0;
  if (!session || !mine || (arrivals.length === 0 && !flooded)) return null;

  // Newest first, and only a few unless the host asks for the rest.
  const newest = [...arrivals].reverse();
  const shown = expanded ? newest : newest.slice(0, SHOWN_AT_ONCE);
  const folded = newest.length - shown.length;

  return (
    <div
      className={`kad-arrivals kad-arrivals--${placement}${expanded ? " kad-arrivals--expanded" : ""}`}
      aria-live="polite"
    >
      {flooded ? (
        <p className="kad-arrivals__flood" role="alert">
          A lot of phones are joining. If you don't know them, start a new room.
        </p>
      ) : null}
      {shown.map((arrival) => (
        <ArrivalNotice key={arrival.playerId} arrival={arrival} host={host} />
      ))}
      {folded > 0 || expanded ? (
        <Button
          variant="ghost"
          size="md"
          icon={<Icon name="players" />}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show fewer" : `${folded} more joined`}
        </Button>
      ) : null}
    </div>
  );
}

function ArrivalNotice({ arrival, host }: { arrival: Arrival; host: boolean }): React.JSX.Element {
  const dismissArrival = useGameStore((store) => store.dismissArrival);
  const removePlayer = useGameStore((store) => store.removePlayer);

  useEffect(() => {
    if (host) return;
    const timer = setTimeout(() => dismissArrival(arrival.playerId), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [arrival.playerId, host, dismissArrival]);

  return (
    <div className="kad-arrival" role="status">
      <span className="kad-arrival__mark" style={{ background: arrival.color }} aria-hidden="true">
        <Icon name="players" />
      </span>
      <p className="kad-arrival__text">
        <strong>{arrival.name}</strong> joined
      </p>
      {host ? (
        <Button
          variant="ghost"
          size="md"
          icon={<Icon name="close" />}
          aria-label={`Remove ${arrival.name} from this game`}
          onClick={() => void removePlayer(arrival.playerId)}
        >
          Remove
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="md"
        icon="✕"
        aria-label="Dismiss"
        onClick={() => dismissArrival(arrival.playerId)}
      />
    </div>
  );
}
