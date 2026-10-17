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
 * and nothing more. Notices go away on their own, the host's more slowly, so
 * a busy lobby does not pile up on the TV.
 *
 * Two placements, because the two screens differ in what can be covered:
 *
 *  - `float`, for the shared display (App): a corner of a screen nobody taps.
 *  - `inline`, for a host's phone (PlayerView): in the flow, at the top, so it
 *    pushes that player's own controls down instead of sitting on them. A
 *    floating notice there blocked the very button a host needed for its turn,
 *    for as long as it was shown.
 */

import { useEffect } from "react";
import { useGameStore } from "../store";
import type { Arrival } from "../store/contract";
import { Button } from "../ui";
import { Icon } from "./icons";
import "./ArrivalNotices.css";

/** Long enough to read across a room. */
const SHOWN_MS = 8_000;
/** Long enough to decide that is not somebody you know, and to reach the button. */
const HOST_SHOWN_MS = 30_000;

export function ArrivalNotices({ placement }: { placement: "float" | "inline" }): React.JSX.Element | null {
  const session = useGameStore((store) => store.session);
  const arrivals = useGameStore((store) => store.arrivals);
  const display = session?.playerId === "";
  const host = session?.host === true;
  // The display floats its notices; a seated host gets them in its own view.
  const mine = placement === "float" ? display : host && !display;

  if (!session || !mine || arrivals.length === 0) return null;

  return (
    <div className={`kad-arrivals kad-arrivals--${placement}`} aria-live="polite">
      {arrivals.map((arrival) => (
        <ArrivalNotice key={arrival.playerId} arrival={arrival} host={host} />
      ))}
    </div>
  );
}

function ArrivalNotice({ arrival, host }: { arrival: Arrival; host: boolean }): React.JSX.Element {
  const dismissArrival = useGameStore((store) => store.dismissArrival);
  const removePlayer = useGameStore((store) => store.removePlayer);

  useEffect(() => {
    const timer = setTimeout(() => dismissArrival(arrival.playerId), host ? HOST_SHOWN_MS : SHOWN_MS);
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
