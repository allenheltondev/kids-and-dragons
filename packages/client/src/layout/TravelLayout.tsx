/**
 * Travel Mode — one surface at a time (spec §2.2).
 *
 * Built first, on purpose. This is the constrained case: anything that fits a
 * phone fits a TV, and the reverse is not true (roadmap, "Travel layout first").
 *
 *   ┌─────────────────┐
 *   │ [ world ] [ me ]│  ← the toggle, always there
 *   ├─────────────────┤
 *   │                 │
 *   │  one surface,   │
 *   │  whole screen   │
 *   │                 │
 *   └─────────────────┘
 *
 * A stacked 60/40 split was the first shape this took, and it was wrong on a
 * phone: neither half had enough room, the party lineup fell off the bottom of
 * the world pane and the six inventory slots fell off the bottom of the other.
 * One surface at a time gives each of them the whole screen.
 *
 * Everything the shell owns, and the surfaces are not allowed to know:
 *
 *   • Your turn pushes your controls in front of you, automatically.
 *   • The toggle takes you back to the world for the art, the party, the detail
 *     — and back again. Never sticky past the turn it was used in.
 *   • A roll takes the world for its ~1.5s wherever you were, then returns you.
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
import { ModeSwitch } from "./ModeSwitch";
import { Icon } from "../screens/icons";
import { useIsMyPrompt, useMe, usePresentation } from "../store";

type Focus = "world" | "player";

/** Long enough for the die to land and be read (spec §2.2). */
const ROLL_HOLD_MS = 2000;

export function TravelLayout(): React.JSX.Element {
  /*
   * "The game is waiting on me." Being asked something is the obvious case;
   * having no character yet is the other one, and it is the first thing that
   * ever happens — landing a new player on the world view with the creation
   * flow hidden behind a toggle is how you get a phone that appears to do
   * nothing at all.
   */
  const isMyPrompt = useIsMyPrompt();
  const me = useMe();
  // Both hooks called unconditionally: `useIsMyPrompt() || useMe() === null`
  // short-circuits the second one away the moment the first is true, which is
  // a conditional hook and breaks the moment the turn changes.
  const myTurn = isMyPrompt || me === null;
  const [focus, setFocus] = useState<Focus>("world");
  const [rolling, setRolling] = useState(false);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Needing you pushes your controls in front of you. Deliberately keyed on
  // the turn rather than set once: going back to the world to re-read a scene
  // must not stop the *next* question from reaching you.
  useEffect(() => {
    if (myTurn) setFocus("player");
  }, [myTurn]);

  // The die is the one thing everybody watches, whatever they were looking at.
  usePresentation("ROLL", () => {
    setRolling(true);
    if (rollTimer.current) clearTimeout(rollTimer.current);
    rollTimer.current = setTimeout(() => setRolling(false), ROLL_HOLD_MS);
  });

  useEffect(
    () => () => {
      if (rollTimer.current) clearTimeout(rollTimer.current);
    },
    [],
  );

  const showing: Focus = rolling ? "world" : focus;

  return (
    <div className="kad-travel">
      <nav className="kad-travel__bar" aria-label="What to look at">
        <button
          type="button"
          className={`kad-travel__tab kad-tap kad-focusable${showing === "world" ? " kad-travel__tab--on" : ""}`}
          aria-pressed={showing === "world"}
          onClick={() => setFocus("world")}
        >
          <Icon name="map" />
          <span>World</span>
        </button>
        <button
          type="button"
          className={`kad-travel__tab kad-tap kad-focusable${showing === "player" ? " kad-travel__tab--on" : ""}`}
          aria-pressed={showing === "player"}
          onClick={() => setFocus("player")}
        >
          <Icon name="bag" />
          {/* A dot, not a colour: "you are needed" must not be colour alone
              (spec §11). */}
          <span>You</span>
          {myTurn && showing !== "player" ? (
            <span className="kad-travel__nudge" aria-label="Your turn">
              ●
            </span>
          ) : null}
        </button>
        <ModeSwitch />
      </nav>

      {/* `hidden` rather than unmounted — see the header. */}
      <div className="kad-travel__pane" data-showing={showing === "world"}>
        <WorldView />
      </div>
      <div className="kad-travel__pane" data-showing={showing === "player"}>
        <PlayerView />
      </div>
    </div>
  );
}
