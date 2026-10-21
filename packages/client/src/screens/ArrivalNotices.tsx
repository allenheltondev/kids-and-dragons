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
 * On a host's phone each notice has a Remove button: one tap and that phone
 * is out of the game (`removePlayer`). The phone's stay until the host
 * dismisses one or removes that player: a host who looks away, or only
 * notices a stranger later, must not lose the control that takes them out.
 * A refresh still loses them; the host's roster (HostControls, #263) does
 * not, and has the same Remove.
 *
 * The shared screen is read, not driven (a remote is a clumsy mouse), so
 * there it is one line with nothing to tap, "Pip and Bo joined", that goes
 * by itself (`noticeMs`). A TV that hosts keeps its Remove in the Room panel,
 * where the roster has everyone, however long ago they came.
 *
 * Two placements, because the two screens differ in what can be covered:
 *
 *  - `float`, for the shared display (App): in the display's column, which
 *    stands below the chapter's goal and above the story (App.tsx).
 *  - `inline`, for a host's phone (PlayerView): in the flow, at the top, so it
 *    pushes that player's own controls down instead of sitting on them. A
 *    floating notice there blocked the very button a host needed for its turn,
 *    for as long as it was shown.
 */

import { useEffect, useState } from "react";
import { useGameStore } from "../store";
import type { Arrival } from "../store/contract";
import { Button } from "../ui";
import { noticeMs } from "../ui/notice-timing";
import { Icon } from "./icons";
import "./ArrivalNotices.css";

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
  // The shared screen's flood warning goes like any notice; more phones dropped bring it back.
  const [floodRead, setFloodRead] = useState(0);
  const display = session?.playerId === "";
  const host = session?.host === true;
  // The display floats its notices; a seated host gets them in its own view.
  const mine = placement === "float" ? display : host && !display;

  // A flood's warning outlives the cards: players who fell off the list may
  // still be in the room after the host clears the ones it could see. It goes
  // when this screen leaves the room (`arrivalsDropped` resets on disconnect).
  const flooded = host && dropped > 0;
  if (!session || !mine || (arrivals.length === 0 && !flooded)) return null;

  if (placement === "float") {
    const floodUp = flooded && dropped > floodRead;
    if (!floodUp && arrivals.length === 0) return null;
    return (
      <div className="kad-arrivals kad-arrivals--float" aria-live="polite">
        {floodUp ? <DisplayFlood dropped={dropped} onRead={setFloodRead} /> : null}
        {arrivals.length > 0 ? <DisplayArrival arrivals={arrivals} /> : null}
      </div>
    );
  }

  // Newest first, and only a few unless the host asks for the rest.
  const newest = [...arrivals].reverse();
  const shown = expanded ? newest : newest.slice(0, SHOWN_AT_ONCE);
  const folded = newest.length - shown.length;

  return (
    <div
      className={`kad-arrivals kad-arrivals--${placement}${expanded ? " kad-arrivals--expanded" : ""}`}
      aria-live="polite"
    >
      {flooded ? <Flood /> : null}
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

const FLOOD = "A lot of phones are joining. If you don't know them, start a new room.";

function Flood(): React.JSX.Element {
  return (
    <p className="kad-arrivals__flood" role="alert">
      {FLOOD}
    </p>
  );
}

/**
 * The flood warning on the shared screen: up for `noticeMs`, like every notice there, and up
 * again if more phones fall off the list after it went. The roster in the Room panel lists
 * everybody in the room meanwhile, so the warning going hides nobody.
 */
function DisplayFlood({ dropped, onRead }: { dropped: number; onRead: (dropped: number) => void }): React.JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => onRead(dropped), noticeMs(FLOOD));
    return () => clearTimeout(timer);
  }, [dropped, onRead]);
  return <Flood />;
}

/** Names that fit one line across a room: "Pip", "Pip and Bo", "Pip, Bo and Cy", "Pip, Bo and 3 more". */
export function joinedLine(names: string[]): string {
  if (names.length <= 1) return `${names[0] ?? "Somebody"} joined`;
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!} joined`;
  return `${names.slice(0, 2).join(", ")} and ${String(names.length - 2)} more joined`;
}

/**
 * Everyone who just came, as one line on the shared screen, never a stack of cards. It goes by
 * itself once it has been up long enough to read; somebody new arriving meanwhile joins the line
 * and starts the reading time again.
 */
function DisplayArrival({ arrivals }: { arrivals: readonly Arrival[] }): React.JSX.Element {
  const dismissArrival = useGameStore((store) => store.dismissArrival);
  const line = joinedLine(arrivals.map((arrival) => arrival.name));
  const ids = arrivals.map((arrival) => arrival.playerId).join(" ");

  useEffect(() => {
    const timer = setTimeout(() => {
      for (const id of ids.split(" ")) dismissArrival(id);
    }, noticeMs(line));
    return () => clearTimeout(timer);
  }, [ids, line, dismissArrival]);

  const newest = arrivals[arrivals.length - 1]!;
  return (
    <div className="kad-arrival" role="status">
      <span className="kad-arrival__mark" style={{ background: newest.color }} aria-hidden="true">
        <Icon name="players" />
      </span>
      <p className="kad-arrival__text">{line}</p>
    </div>
  );
}

function ArrivalNotice({ arrival, host }: { arrival: Arrival; host: boolean }): React.JSX.Element {
  const dismissArrival = useGameStore((store) => store.dismissArrival);
  const removePlayer = useGameStore((store) => store.removePlayer);

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
