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
 * changing the room mode; each new question brings their controls back. A
 * tablet held sideways shows the world (or the map) beside the controls
 * instead (landscape.ts), so there is nothing to bring back.
 */

import { useEffect, useRef, useState } from "react";
import { WorldView } from "./WorldView";
import { PlayerView } from "./PlayerView";
import { MapView } from "./MapView";
import { ModeSwitch } from "./ModeSwitch";
import { TrayObject } from "../screens/TrayObjects";
import { RiftlightIndicator } from "../screens/RiftSight";
import { GuideTab } from "./GuideTab";
import { BookTab } from "./BookTab";
import { useMe, useMyTurnKey, useRunState } from "../store";
import { setHelpPane } from "../help/focus";
import { PlayerShell, useSideBySide } from "./landscape";
import { PaneFrame } from "./PaneFrame";
import { PhoneFrame } from "./PhoneFrame";
import { TvFocus, useTvFocusSetting } from "./tv-focus";
import { useSeesRiftlight } from "../screens/RiftSight";

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
  return <PhoneFrame><PhoneLayout /></PhoneFrame>;
}

type Showing = "world" | "player" | "map";

function PhoneLayout(): React.JSX.Element {
  // The same three facts TravelLayout reads, for the same reason: being asked
  // something — or having no character yet — is the game waiting on you, and
  // nothing you brought up on purpose outranks that.
  const [showing, setShowing] = useState<Showing>("player");
  // The pane she last went to, for the "?": side by side, two are up at once, and the one she
  // tapped (or the one a new question put in front of her) is the one to explain.
  const [engaged, setEngaged] = useState<Showing>("player");
  // Side by side, your controls are a drawer (see TravelLayout): You slides it away and back.
  const [youOpen, setYouOpen] = useState(true);

  /*
   * TV focus (Display settings): there is a TV in Party Mode, so the story lives there and this
   * phone keeps only You. Held sideways, that means no world beside the controls either: one
   * pane at a time, as upright, with the rail still down the side.
   *
   * Only once there is a story to watch: in the lobby, and while a hero is being made, the phone
   * is the whole job (the guide, the map, the world beside the sheet), so the setting waits for
   * the chapter to start. The tray, the layout and the context all read this one value.
   */
  const focusSetting = useTvFocusSetting();
  const runState = useRunState();
  const hasHero = useMe() !== null;
  const playing = runState !== null && runState.phase !== "lobby" && runState.phase !== "creation" && hasHero;
  const focus = focusSetting && playing;
  const sideBySide = useSideBySide() && !focus;
  // Each new question takes focus, including two consecutive questions for
  // the same player. An update to the current question (such as another vote)
  // does not: the player can keep looking at the map while thinking.
  const turnKey = useMyTurnKey();
  const previousTurnKey = useRef<string | null>(null);
  useEffect(() => {
    if (turnKey !== null && turnKey !== previousTurnKey.current) {
      setEngaged("player");
      setYouOpen(true);
      if (!sideBySide) setShowing("player");
    }
    previousTurnKey.current = turnKey;
  }, [turnKey, sideBySide]);
  // Leaving side by side (the tablet turned upright) with a question still open: it was never
  // brought forward, since the controls were in view, so it is now.
  const wasSideBySide = useRef(sideBySide);
  useEffect(() => {
    if (wasSideBySide.current && !sideBySide && turnKey !== null) setShowing("player");
    wasSideBySide.current = sideBySide;
  }, [sideBySide, turnKey]);

  const section = usePlayerNavigation((navigation) => navigation.section);
  /*
   * Under TV focus the World tab stays for a Starweaver, whose phone alone shows the
   * Riftlight; Map, Guide and Book come back when the setting goes off. A pane she was looking
   * at when it went on gives way to her controls.
   */
  const seesRiftlight = useSeesRiftlight();
  const worldTab = !focus || seesRiftlight;
  useEffect(() => {
    if (!focus) return;
    setShowing((at) => (at === "map" || (at === "world" && !seesRiftlight) ? "player" : at));
    if (section === "guide") dismissPlayerSheet();
  }, [focus, seesRiftlight, section]);

  // The "?" in the corner row (#256) explains whatever pane is up; side by side, the one she is in.
  const beside: Showing = showing === "map" ? "map" : "world";
  const helpPane: Showing = sideBySide ? (engaged === "player" && !youOpen ? beside : engaged) : showing;
  useEffect(() => {
    setHelpPane(helpPane);
    return () => setHelpPane("player");
  }, [helpPane]);
  // Side by side, the controls are a drawer and the pane beside them is the
  // world unless the map was asked for, the whole width while the drawer is shut.
  const shows = (pane: Showing): boolean =>
    sideBySide ? (pane === "player" ? youOpen : pane === beside) : pane === showing;
  const onMap = shows("map");
  const inGuide = shows("player") && section === "guide";
  // Side by side, You and Guide open the drawer and leave the map where it is.
  const showPlayer = (): void => {
    setEngaged("player");
    setYouOpen(true);
    setShowing((at) => (sideBySide && at === "map" ? at : "player"));
  };
  const show = (pane: "world" | "map"): void => {
    setEngaged(pane);
    setShowing(pane);
  };

  return (
    <PlayerShell.Provider value>
      <div className="kad-party kad-party--player" data-side-by-side={sideBySide || undefined} data-tv-focus={focus || undefined}>
        {/* Four destinations on every phone; the TV stays a pure display. */}
        <nav className="kad-party__bar kad-tray" aria-label="What to look at">
          {worldTab ? <button
            type="button"
            className={`kad-tray__tab kad-tap kad-focusable${shows("world") ? " kad-tray__tab--on" : ""}`}
            aria-pressed={shows("world")}
            onClick={() => { dismissPlayerSheet(); show("world"); }}
          >
            <span className="kad-tray__object">
              <TrayObject name="globe" />
              {/* A Starweaver's cue that the world has Riftlight to read (#229);
                  out while they are looking at it. */}
              <RiftlightIndicator onWorld={shows("world")} />
            </span>
            <span className="kad-tray__label">World</span>
          </button> : null}
          <button
            type="button"
            className={`kad-tray__tab kad-tray__tab--primary kad-tap kad-focusable${shows("player") && !inGuide ? " kad-tray__tab--on" : ""}`}
            aria-label="You"
            aria-pressed={shows("player") && !inGuide}
            onClick={() => {
              if (sideBySide && youOpen && !inGuide) {
                setYouOpen(false);
                setEngaged(beside);
                return;
              }
              dismissPlayerSheet();
              showPlayer();
            }}
          >
            <span className="kad-tray__object">
              <TrayObject name="satchel" />
              {turnKey !== null && (!shows("player") || section !== "turn") ? (
                <span className="kad-tray__badge" aria-label="Your turn">★</span>
              ) : null}
            </span>
            <span className="kad-tray__label">You</span>
          </button>
          {focus ? null : <button
            type="button"
            className={`kad-tray__tab kad-tap kad-focusable${onMap ? " kad-tray__tab--on" : ""}`}
            aria-pressed={onMap}
            onClick={() => { dismissPlayerSheet(); show("map"); }}
          >
            <span className="kad-tray__object">
              <TrayObject name="map" />
            </span>
            <span className="kad-tray__label">Map</span>
          </button>}
          {focus ? null : <GuideTab on={inGuide} onShowPlayer={showPlayer} />}
          {focus ? null : <BookTab />}
        </nav>

        {/* `hidden` rather than unmounted, like the Travel panes: a selection
            half-made in the bag survives a look at the map. */}
        <div className="kad-party__pane" data-pane="player" data-showing={shows("player")}>
          <TvFocus.Provider value={focus}>
            <PlayerView roomControls={<ModeSwitch />} />
          </TvFocus.Provider>
        </div>
        <div className="kad-party__pane" data-pane="world" data-showing={shows("world")}>
          {/* Mounted behind the controls, so it says when it is actually seen. */}
          <WorldView gatesPresentations={false} prefetch={shows("world")} />
          <PaneFrame />
        </div>
        {onMap ? (
          <div className="kad-party__pane" data-pane="map" data-showing>
            <MapView />
            <PaneFrame />
          </div>
        ) : null}
      </div>
    </PlayerShell.Provider>
  );
}
