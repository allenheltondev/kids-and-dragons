/**
 * Party Mode — at home (spec §2.1).
 *
 * One surface per device, chosen by the route (architecture §4.6):
 *
 *   /tv/:code  → WorldView, full screen. A pure display client: no authority,
 *                no session token, refreshable at any moment. A tablet propped
 *                on the table is just a small TV, and that falls out for free
 *                because "TV" is a route, not a device class.
 *   /p/:code   → PlayerView, full screen.
 *
 * Trivial compared to TravelLayout, which is the point of having built that
 * one first. Like TravelLayout, this shell owns the only viewport unit in the
 * subtree.
 */

import { WorldView } from "./WorldView";
import { PlayerView } from "./PlayerView";
import { ModeSwitch } from "./ModeSwitch";

export interface PartyLayoutProps {
  surface: "world" | "player";
}

export function PartyLayout({ surface }: PartyLayoutProps): React.JSX.Element {
  return (
    <div className={`kad-party kad-party--${surface}`}>
      {/* The laptop dying is exactly when you need this, and the TV cannot
          offer it — a display client has no input at all (spec §2.1), so it
          rides on the phone. In flow rather than floating: a floating control
          overlapped whatever was beneath it, and what is beneath it on a phone
          is the primary action of every screen. */}
      {surface === "player" ? (
        <div className="kad-party__bar">
          <ModeSwitch />
        </div>
      ) : null}
      {surface === "world" ? <WorldView /> : <PlayerView />}
    </div>
  );
}
