/**
 * Travel Mode — the stacked layout (spec §2.2).
 *
 * Built first, on purpose. This is the constrained case: anything that fits in
 * a 60%-height portrait pane fits on a TV, and the reverse is not true
 * (roadmap, "Travel layout first"). Party Mode is the easy layout and it comes
 * second.
 *
 *   ┌─────────────────┐
 *   │   WorldView     │  ~60%  — identical on every phone
 *   ├─────────────────┤
 *   │   PlayerView    │  ~40%  — yours
 *   └─────────────────┘
 *
 * Three transitions, all owned here because all three depend on knowing this is
 * a phone showing both surfaces — which is precisely the knowledge the surfaces
 * themselves are not allowed to have:
 *
 *   • On your turn the split shifts to ~40/60 in favour of controls, and
 *     relaxes back when the turn passes.
 *   • Tapping the world pane always restores it, turn or not.
 *   • A roll takes over the screen for its ~1.5s, then dismisses back.
 *
 * This is also the only file in the pair that may use viewport units, and it
 * uses exactly one: `100dvh` on the root, so the iOS URL bar collapsing does
 * not crop the action bar.
 */

import { useEffect, useRef, useState } from "react";
import { WorldView } from "./WorldView";
import { PlayerView } from "./PlayerView";
import { useIsMyPrompt, usePresentation } from "../store";

/** world / player, as percentages of the stack. */
const RELAXED = 60;
const MY_TURN = 40;
const ROLLING = 100;
const ROLL_HOLD_MS = 2000;

export function TravelLayout(): React.JSX.Element {
  const myTurn = useIsMyPrompt();
  const [restored, setRestored] = useState(false);
  const [rolling, setRolling] = useState(false);
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new turn re-arms the shift; the manual restore is per-turn, not sticky.
  useEffect(() => {
    setRestored(false);
  }, [myTurn]);

  usePresentation("ROLL", () => {
    setRolling(true);
    if (rollTimer.current) clearTimeout(rollTimer.current);
    rollTimer.current = setTimeout(() => setRolling(false), ROLL_HOLD_MS);
  });

  useEffect(() => () => {
    if (rollTimer.current) clearTimeout(rollTimer.current);
  }, []);

  const worldShare = rolling ? ROLLING : myTurn && !restored ? MY_TURN : RELAXED;

  return (
    <div
      className="kad-travel"
      style={{
        // Read by the panes below. The surfaces never see these.
        ["--kad-world-share" as string]: `${worldShare}%`,
        ["--kad-player-share" as string]: `${100 - worldShare}%`,
      }}
    >
      <div
        className="kad-travel__world"
        // "Tapping the world pane always restores it" (spec §2.2). Not a
        // <button>: the pane holds the map, and Chapter 4 puts pinch-zoom and
        // pan inside it. The keyboard/AT path is the button underneath.
        onPointerDown={() => setRestored(true)}
      >
        <WorldView />
      </div>

      {/* The keyboard and screen-reader path to the same restore. */}
      <button type="button" className="kad-sr-only" onClick={() => setRestored(true)}>
        Show more of the world
      </button>

      <div className="kad-travel__player">
        <PlayerView />
      </div>
    </div>
  );
}
