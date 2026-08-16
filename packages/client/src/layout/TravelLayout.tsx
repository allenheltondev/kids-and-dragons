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
import { ModeSwitch } from "./ModeSwitch";
import { Icon } from "../screens/icons";
import { useIsMyCombatTurn, useIsMyPrompt, useMe, usePresentation, useProgression } from "../store";
import { TRANSFORM_BEAT_MS } from "../screens/TransformCutscene";

type Focus = "world" | "player";

/** Long enough for the die to land and be read (spec §2.2). */
const ROLL_HOLD_MS = 2000;

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
  const [focus, setFocus] = useState<Focus>("world");
  const [rolling, setRolling] = useState(false);
  const [transforming, setTransforming] = useState(false);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transformTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
