import { dismissPlayerSheet, usePlayerNavigation } from "../store/player-navigation";
import { GuideTab } from "./GuideTab";
import { BookTab } from "./BookTab";
/**
 * Travel Mode — one surface at a time (spec §2.2).
 *
 * Built first, on purpose. This is the constrained case: anything that fits a
 * phone fits a TV, and the reverse is not true (roadmap, "Travel layout first").
 *
 *   ┌─────────────────────────┐
 *   │                         │
 *   │  one surface,           │
 *   │  whole screen           │
 *   │                         │
 *   ├─────────────────────────┤
 *   │ [ world ] [ map ] [ me ]│  ← the toggle, always there, under the thumb
 *   └─────────────────────────┘
 *
 * A stacked 60/40 split was the first shape this took, and it was wrong on a
 * phone: neither half had enough room, the party lineup fell off the bottom of
 * the world pane and the six inventory slots fell off the bottom of the other.
 * One surface at a time gives each of them the whole screen.
 *
 * A tablet held sideways has the width a phone lacks, so there the world (or
 * the map) sits beside your controls and the tray runs down the side
 * (landscape.ts). The rules below still hold; the world is just never hidden.
 *
 * Everything the shell owns, and the surfaces are not allowed to know:
 *
 *   • Your turn pushes your controls in front of you, automatically.
 *   • The toggle takes you back to the world for the art, the party, the detail
 *     — and back again. Never sticky past the turn it was used in.
 *   • The map is the one surface nothing ever pushes in front of you. It is
 *     brought up on request — "how far have we got?" — and left the moment the
 *     game needs you, like the world.
 *   • A roll takes the world while its card is up, wherever you were, then returns you.
 *   • A transformation takes it for as long as the cutscene runs. Same rule,
 *     bigger stakes: without it, spec §8.1's "single most important moment in
 *     the game" plays inside a `display: none` pane for whoever last tapped
 *     something — which, at the end of a chapter, is whoever just finished it.
 *
 * **Both surfaces stay mounted.** Hiding is visual only. Unmounting the world
 * would tear down the Pixi context on every toggle and — worse — drop the
 * presentation gate it registers, so the dice would stop being animated at all
 * (see sync/channel.ts).
 *
 * This is also one of the two files that may use viewport units, and it uses
 * exactly one: `100dvh` on the root, so the iOS URL bar collapsing does not
 * crop the action bar.
 */

import { useEffect, useRef, useState } from "react";
import { WorldView } from "./WorldView";
import { PlayerView } from "./PlayerView";
import { MapView } from "./MapView";
import { ModeSwitch } from "./ModeSwitch";
import { TrayObject } from "../screens/TrayObjects";
import { RiftlightIndicator } from "../screens/RiftSight";
import { useIsMyCombatTurn, useIsMyPrompt, useMe, useMyTurnKey, usePresentation, useProgression } from "../store";
import { TRANSFORM_BEAT_MS } from "../screens/TransformCutscene";
import { rollCardMs } from "../world/presentation";
import { setHelpPane } from "../help/focus";
import { useSideBySide } from "./landscape";
import { PaneFrame } from "./PaneFrame";

type Focus = "world" | "map" | "player";


/**
 * A little past the last beat, so the world is not yanked away on the exact
 * frame the cutscene clears itself.
 */
const TRANSFORM_TAIL_MS = 400;

export function TravelLayout(): React.JSX.Element {
  /*
   * "The game is waiting on me." Being asked something is the obvious case;
   * having no character yet is the other one, and it is the first thing that
   * ever happens — landing a new player on the world view with the creation
   * flow hidden behind a toggle is how you get a phone that appears to do
   * nothing at all.
   */
  const isMyPrompt = useIsMyPrompt();
  const isMyCombatTurn = useIsMyCombatTurn();
  const me = useMe();
  // All hooks called unconditionally: `useIsMyPrompt() || useMe() === null`
  // short-circuits the second one away the moment the first is true, which is
  // a conditional hook and breaks the moment the turn changes. A combat turn
  // counts as being asked (spec §7.2) even though no Prompt object is open.
  const myTurn = isMyPrompt || isMyCombatTurn || me === null;
  const section = usePlayerNavigation((navigation) => navigation.section);
  const [focus, setFocus] = useState<Focus>("world");
  // The pane she last went to, for the "?": side by side, two are up at once, and the one she
  // tapped (or the one a new question put in front of her) is the one to explain.
  const [engaged, setEngaged] = useState<Focus>("player");
  const [rolling, setRolling] = useState(false);
  const [transforming, setTransforming] = useState(false);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transformTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the question, not merely the boolean "my turn": successive
  // prompts for the same player can arrive without an intervening false.
  // The key stays put when the same prompt's votes or other state updates.
  //
  // On a landscape tablet your controls never leave the screen, so a new
  // question leaves the map where it is.
  const sideBySide = useSideBySide();
  const turnKey = useMyTurnKey();
  const previousTurnKey = useRef<string | null>(null);
  useEffect(() => {
    if (turnKey !== null && turnKey !== previousTurnKey.current) {
      setEngaged("player");
      if (!sideBySide) setFocus("player");
    }
    previousTurnKey.current = turnKey;
  }, [turnKey, sideBySide]);
  // Leaving side by side (the tablet turned upright) with a question still open: it was never
  // brought forward, since the controls were in view, so it is now.
  const wasSideBySide = useRef(sideBySide);
  useEffect(() => {
    if (wasSideBySide.current && !sideBySide && turnKey !== null) setFocus("player");
    wasSideBySide.current = sideBySide;
  }, [sideBySide, turnKey]);

  // The die is the one thing everybody watches, whatever they were looking at.
  // Held for as long as the dice card is up, so it can be read (spec §2.2).
  usePresentation("ROLL", (event) => {
    if (event.kind !== "ROLL") return;
    setRolling(true);
    if (rollTimer.current) clearTimeout(rollTimer.current);
    rollTimer.current = setTimeout(() => setRolling(false), rollCardMs(event.roll));
  });

  /*
   * And the transformation takes it for the whole queue.
   *
   * Sized from the cutscene's own beat length times the number of characters
   * crossing, because a queue is not a fixed duration: uniform XP (spec §8.1)
   * means the whole party can cross on the same evening, and a hold sized for
   * one would drop the pane back on somebody else's moment. `TRANSFORM_BEAT_MS`
   * is imported rather than re-typed so the two clocks cannot drift.
   */
  useProgression((event) => {
    const crossings = (event.progression.awards ?? []).filter(
      (award) => award.newTier !== undefined,
    ).length;
    if (crossings === 0) return;
    setTransforming(true);
    if (transformTimer.current) clearTimeout(transformTimer.current);
    transformTimer.current = setTimeout(
      () => setTransforming(false),
      crossings * TRANSFORM_BEAT_MS + TRANSFORM_TAIL_MS,
    );
  });

  useEffect(
    () => () => {
      if (rollTimer.current) clearTimeout(rollTimer.current);
      if (transformTimer.current) clearTimeout(transformTimer.current);
    },
    [],
  );

  /*
   * The transformation outranks the roll, which outranks whatever you were
   * looking at. Nothing outranks the transformation.
   */
  const showing: Focus = transforming || rolling ? "world" : focus;
  /*
   * Side by side (landscape.ts): your controls are always up, and the big pane
   * beside them is the world unless the map was asked for. The roll and the
   * transformation take that pane, as they take the screen on a phone.
   */
  const beside: Focus = showing === "map" ? "map" : "world";
  const shows = (pane: Focus): boolean =>
    sideBySide ? pane === "player" || pane === beside : pane === showing;
  const inGuide = shows("player") && section === "guide";
  // Side by side, You and Guide are already on the screen: they leave the map where it is.
  const showPlayer = (): void => {
    setEngaged("player");
    setFocus((at) => (sideBySide && at === "map" ? at : "player"));
  };
  const show = (pane: "world" | "map"): void => {
    setEngaged(pane);
    setFocus(pane);
  };
  // The "?" in the corner row (#256) explains whatever pane is up; side by side, the one she is in.
  const helpPane: Focus = sideBySide ? engaged : showing;
  useEffect(() => {
    setHelpPane(helpPane);
    return () => setHelpPane("player");
  }, [helpPane]);

  return (
    <div className="kad-travel" data-side-by-side={sideBySide || undefined}>
      {/* The tray (screens/TrayObjects.tsx): a shelf of things rather than a
          row of tabs — the realm globe, your satchel, the map, the Field Guide's
          journal. */}
      <nav className="kad-travel__bar kad-tray" aria-label="What to look at">
        <button
          type="button"
          className={`kad-travel__tab kad-tray__tab kad-tap kad-focusable${shows("world") ? " kad-travel__tab--on kad-tray__tab--on" : ""}`}
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
        </button>
        <button
          type="button"
          className={`kad-travel__tab kad-tray__tab kad-tray__tab--primary kad-tap kad-focusable${shows("player") && !inGuide ? " kad-travel__tab--on kad-tray__tab--on" : ""}`}
          aria-label="You"
          aria-pressed={shows("player") && !inGuide}
          onClick={() => { dismissPlayerSheet(); showPlayer(); }}
        >
          <span className="kad-tray__object">
            <TrayObject name="satchel" />
            {/* A badge with a shape, not a colour: "you are needed" must not
                be colour alone (spec §11). */}
            {myTurn && (!shows("player") || section !== "turn") ? (
              <span className="kad-travel__nudge kad-tray__badge" aria-label="Your turn">
                ★
              </span>
            ) : null}
          </span>
          <span className="kad-tray__label">You</span>
        </button>
        <button
          type="button"
          className={`kad-travel__tab kad-tray__tab kad-tap kad-focusable${shows("map") ? " kad-travel__tab--on kad-tray__tab--on" : ""}`}
          aria-pressed={shows("map")}
          onClick={() => { dismissPlayerSheet(); show("map"); }}
        >
          <span className="kad-tray__object">
            <TrayObject name="map" />
          </span>
          <span className="kad-tray__label">Map</span>
        </button>
        <GuideTab on={inGuide} onShowPlayer={showPlayer}
          className="kad-travel__tab" onClassName="kad-travel__tab--on" />
        <BookTab className="kad-travel__tab" />
      </nav>

      {/* `hidden` rather than unmounted — see the header. */}
      <div className="kad-travel__pane" data-pane="world" data-showing={shows("world")}>
        <WorldView prefetch={shows("world")} />
        <PaneFrame />
      </div>
      <div className="kad-travel__pane" data-pane="player" data-showing={shows("player")}>
        <PlayerView roomControls={<ModeSwitch />} />
      </div>
      {/* Map navigation is remembered separately, so this can stay unmounted
          until requested — and it is the one pane whose
          chapter fetch (`useEnsureChapter`) should not run on a phone that
          never asked for it. */}
      {shows("map") ? (
        <div className="kad-travel__pane" data-pane="map" data-showing>
          <MapView />
          <PaneFrame />
        </div>
      ) : null}
    </div>
  );
}
