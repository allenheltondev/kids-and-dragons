/**
 * Party Mode — at home (spec §2.1).
 *
 * One surface per device, chosen by the route (architecture §4.6):
 *
 *   /tv/:code  → WorldView, full screen. A pure display client: no authority,
 *                no session token, refreshable at any moment. A tablet propped
 *                on the table is just a small TV, and that falls out for free
 *                because "TV" is a route, not a device class.
 *   /p/:code   → PlayerView, full screen — and, on request, the map.
 *
 * Trivial compared to TravelLayout, which is the point of having built that
 * one first. Like TravelLayout, this shell owns the only viewport unit in the
 * subtree.
 *
 * The map rides on the phone, not the TV. The TV is the world, and a room
 * watching a scene does not want the scene replaced by a diagram of the
 * chapter — but the person holding a phone does, when the question is "how
 * far along are we?" rather than "what is happening?". So a Party Mode phone
 * can swap its controller for the map and back, under the same rule Travel
 * Mode uses for every surface that is not your controls: the moment the game
 * needs you, your controls come back in front of you.
 */

import { useEffect, useRef, useState } from "react";
import { WorldView } from "./WorldView";
import { PlayerView } from "./PlayerView";
import { MapView } from "./MapView";
import { ModeSwitch } from "./ModeSwitch";
import { TrayObject } from "../screens/TrayObjects";
import { useMyTurnKey } from "../store";

export interface PartyLayoutProps {
  surface: "world" | "player";
}

export function PartyLayout({ surface }: PartyLayoutProps): React.JSX.Element {
  if (surface === "world") {
    return (
      <div className="kad-party kad-party--world">
        <WorldView />
      </div>
    );
  }
  return <PhoneLayout />;
}

type Showing = "player" | "map";

function PhoneLayout(): React.JSX.Element {
  // The same three facts TravelLayout reads, for the same reason: being asked
  // something — or having no character yet — is the game waiting on you, and
  // nothing you brought up on purpose outranks that.
  const [showing, setShowing] = useState<Showing>("player");

  // Each new question takes focus, including two consecutive questions for
  // the same player. An update to the current question (such as another vote)
  // does not: the player can keep looking at the map while thinking.
  const turnKey = useMyTurnKey();
  const previousTurnKey = useRef<string | null>(null);
  useEffect(() => {
    if (turnKey !== null && turnKey !== previousTurnKey.current) setShowing("player");
    previousTurnKey.current = turnKey;
  }, [turnKey]);

  const onMap = showing === "map";

  return (
    <div className="kad-party kad-party--player">
      {/* The tray (screens/TrayObjects.tsx): your satchel and the map, and the
          mode switch beside them — the laptop dying is exactly when you need
          that, and the TV cannot offer it (a display client has no input at
          all, spec §2.1). In flow rather than floating: a floating control
          overlapped whatever was beneath it, and what is beneath it on a phone
          is the primary action of every screen. */}
      <nav className="kad-party__bar kad-tray" aria-label="What to look at">
        <button
          type="button"
          className={`kad-tray__tab kad-tap kad-focusable${onMap ? "" : " kad-tray__tab--on"}`}
          aria-pressed={!onMap}
          onClick={() => setShowing("player")}
        >
          <span className="kad-tray__object">
            <TrayObject name="satchel" />
          </span>
          <span className="kad-tray__label">You</span>
        </button>
        <button
          type="button"
          className={`kad-tray__tab kad-tap kad-focusable${onMap ? " kad-tray__tab--on" : ""}`}
          aria-pressed={onMap}
          onClick={() => setShowing("map")}
        >
          <span className="kad-tray__object">
            <TrayObject name="map" />
          </span>
          <span className="kad-tray__label">Map</span>
        </button>
        <ModeSwitch />
      </nav>

      {/* `hidden` rather than unmounted, like the Travel panes: a selection
          half-made in the bag survives a look at the map. */}
      <div className="kad-party__pane" data-pane="player" data-showing={!onMap}>
        <PlayerView />
      </div>
      {onMap ? (
        <div className="kad-party__pane" data-pane="map" data-showing>
          <MapView />
        </div>
      ) : null}
    </div>
  );
}
