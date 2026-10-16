import { dismissPlayerSheet, usePlayerNavigation } from "../store/player-navigation";
/**
 * Party Mode — at home (spec §2.1).
 *
 * One surface per device, chosen by the route (architecture §4.6):
 *
 *   /tv/:code  → WorldView, full screen. A pure display client: no authority,
 *                no session token, refreshable at any moment. A tablet propped
 *                on the table is just a small TV, and that falls out for free
 *                because "TV" is a route, not a device class.
 *   /p/:code   → PlayerView, with World and Map a tap away.
 *
 * Trivial compared to TravelLayout, which is the point of having built that
 * one first. Like TravelLayout, this shell owns the only viewport unit in the
 * subtree.
 *
 * The TV remains the world display. Phones can inspect World or Map without
 * changing the room mode; each new question brings their controls back.
 */

import { useEffect, useRef, useState } from "react";
import { WorldView } from "./WorldView";
import { PlayerView } from "./PlayerView";
import { MapView } from "./MapView";
import { ModeSwitch } from "./ModeSwitch";
import { TrayObject } from "../screens/TrayObjects";
import { RiftlightIndicator } from "../screens/RiftSight";
import { GuideTab } from "./GuideTab";
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

type Showing = "world" | "player" | "map";

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

  const section = usePlayerNavigation((navigation) => navigation.section);
  const onMap = showing === "map";
  const inGuide = showing === "player" && section === "guide";

  return (
    <div className="kad-party kad-party--player">
      {/* Four destinations on every phone; the TV stays a pure display. */}
      <nav className="kad-party__bar kad-tray" aria-label="What to look at">
        <button
          type="button"
          className={`kad-tray__tab kad-tap kad-focusable${showing === "world" ? " kad-tray__tab--on" : ""}`}
          aria-pressed={showing === "world"}
          onClick={() => { dismissPlayerSheet(); setShowing("world"); }}
        >
          <span className="kad-tray__object">
            <TrayObject name="globe" />
            {/* A Starweaver's cue that the world has Riftlight to read (#229);
                out while they are looking at it. */}
            <RiftlightIndicator onWorld={showing === "world"} />
          </span>
          <span className="kad-tray__label">World</span>
        </button>
        <button
          type="button"
          className={`kad-tray__tab kad-tray__tab--primary kad-tap kad-focusable${showing === "player" && !inGuide ? " kad-tray__tab--on" : ""}`}
          aria-label="You"
          aria-pressed={showing === "player" && !inGuide}
          onClick={() => { dismissPlayerSheet(); setShowing("player"); }}
        >
          <span className="kad-tray__object">
            <TrayObject name="satchel" />
            {turnKey !== null && (showing !== "player" || section !== "turn") ? (
              <span className="kad-tray__badge" aria-label="Your turn">★</span>
            ) : null}
          </span>
          <span className="kad-tray__label">You</span>
        </button>
        <button
          type="button"
          className={`kad-tray__tab kad-tap kad-focusable${onMap ? " kad-tray__tab--on" : ""}`}
          aria-pressed={onMap}
          onClick={() => { dismissPlayerSheet(); setShowing("map"); }}
        >
          <span className="kad-tray__object">
            <TrayObject name="map" />
          </span>
          <span className="kad-tray__label">Map</span>
        </button>
        <GuideTab on={inGuide} onShowPlayer={() => setShowing("player")} />
      </nav>

      {/* `hidden` rather than unmounted, like the Travel panes: a selection
          half-made in the bag survives a look at the map. */}
      <div className="kad-party__pane" data-pane="player" data-showing={showing === "player"}>
        <PlayerView roomControls={<ModeSwitch />} />
      </div>
      <div className="kad-party__pane" data-pane="world" data-showing={showing === "world"}>
        {/* Mounted behind the controls, so it says when it is actually seen. */}
        <WorldView gatesPresentations={false} prefetch={showing === "world"} />
      </div>
      {onMap ? (
        <div className="kad-party__pane" data-pane="map" data-showing>
          <MapView />
        </div>
      ) : null}
    </div>
  );
}
