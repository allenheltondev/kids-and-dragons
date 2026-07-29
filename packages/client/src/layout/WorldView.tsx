/**
 * WorldView — the shared board (spec §2).
 *
 * ===========================================================================
 * TWO RULES, AND THEY ARE NOT PREFERENCES (architecture §4.6, roadmap
 * "Mode-agnostic surfaces"):
 *
 *   1. NOTHING IN HERE MAY READ THE ROOM MODE. Not this file, not anything it
 *      renders. If a behaviour has to differ between a TV and a phone pane, it
 *      belongs in a layout shell — the shells are the only things that know.
 *
 *   2. NO `vw`, `vh`, `dvh`, `svh`, OR `lvh` ANYWHERE INSIDE. This subtree is
 *      100% of a whole TV in Party Mode and 60% of a phone in Travel Mode. Size
 *      everything with `%`, `cqw`/`cqh`, and `em` against `.kad-surface`, which
 *      is a size container. It will be tempting to reach for `100vh` on a
 *      full-screen overlay; that overlay would then be taller than its pane on
 *      a phone and the PlayerView would disappear under it.
 * ===========================================================================
 *
 * Composition is a function of phase and nothing else. Every panel below is
 * exported from `screens/` and takes no props — they read the store, which is
 * what keeps rule 1 enforceable: there is no prop to smuggle the mode through.
 */

import { useEffect, useRef, useState } from "react";
import type { Presentation } from "@kad/shared";
import {
  ChapterCompletePanel,
  CreationPreview,
  DiceOverlay,
  LobbyContent,
  NarrationPanel,
} from "../screens";
import { PixiStage } from "../world/PixiStage";
import { useGameStore, useMe, usePresentation, useRunState, useSession } from "../store";
import type { PresentationEvent } from "../store/contract";

/**
 * How long each presentation holds the stage before its patch is applied.
 *
 * This is the "play the animation, *then* apply the patch" half of
 * architecture §4.2 — the die has to land before the HP number moves. Values
 * are placeholders sized to the spec's ~1.5s roll (spec §2.2); real durations
 * come from the Rive state machines in Chapter 4.
 */
const PRESENTATION_MS: Record<Presentation["kind"], number> = {
  SCENE_ENTER: 350,
  ROLL: 1500,
  CHOICE_MADE: 200,
  // Everyone taking their places on a board that was not there a moment ago.
  // Longer than any other beat except a transformation: the camera has to frame
  // the fight and three phones have to swap to a combat UI, and arriving mid-
  // shuffle is how a player misses whose turn it is (spec §7.2).
  ENCOUNTER_BEGAN: 1200,
  ATTACK: 700,
  HEAL: 600,
  DOWN: 700,
  REVIVE: 700,
  LEVEL_UP: 1200,
  TRANSFORM: 2000,
  CHAPTER_COMPLETE: 800,
};

export function WorldView(): React.JSX.Element {
  const phase = useRunState()?.phase ?? "lobby";
  const me = useMe();
  // A display client has no player (spec §2.1), so it never has a character and
  // must never be parked on the creation preview waiting for one.
  const isDisplay = (useSession()?.playerId ?? "") === "";
  const [rolling, setRolling] = useState(false);

  // Same trigger PlayerView uses: "I have no character yet", not the run phase.
  const creating = (phase === "lobby" || phase === "creation") && me === null && !isDisplay;

  /**
   * Registering here — rather than in a shell — is what keeps rule 1 intact.
   * "I am the surface that draws the world" is a fact about this component; "I
   * am a TV" would be a fact about the mode. A Party Mode phone never mounts a
   * WorldView, so it never registers, so its patches apply the instant they
   * arrive and presentation is ignored. That falls out; nobody branches on it.
   */
  useEffect(() => {
    const play = (event: PresentationEvent): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, PRESENTATION_MS[event.presentation.kind] ?? 0);
      });
    return useGameStore.getState().registerPresentationPlayer(play);
  }, []);

  // The overlay outlives the gate by a beat so the result is readable after the
  // die stops, then dismisses itself back to the layout (spec §2.2).
  const rollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  usePresentation("ROLL", () => {
    setRolling(true);
    if (rollTimer.current) clearTimeout(rollTimer.current);
    rollTimer.current = setTimeout(() => setRolling(false), PRESENTATION_MS.ROLL + 500);
  });
  useEffect(() => () => {
    if (rollTimer.current) clearTimeout(rollTimer.current);
  }, []);

  return (
    <div className="kad-surface kad-surface--world" data-surface="world">
      <PixiStage />

      {/* The preview is a view of *this device's* draft, so it belongs on
          screen only while this device is still choosing. Once your character
          exists you want the lobby — the party filling up, and who the room is
          still waiting on. Keying it off the phase alone would leave everyone
          who finished first staring at "pick a species". */}
      {creating ? <CreationPreview /> : null}
      {!creating && (phase === "lobby" || phase === "creation") && <LobbyContent />}
      {isSceneLike(phase) && <NarrationPanel />}
      {phase === "chapter_complete" && <ChapterCompletePanel />}

      {/* The roll is the centrepiece of whatever pane it lands in. On a TV that
          is the room; on a phone the shell hands the world the whole screen for
          its ~1.5s (spec §2.2) — but the overlay itself only ever fills its
          container, which is why it has no viewport units in it. */}
      {rolling && <DiceOverlay />}
    </div>
  );
}

function isSceneLike(phase: string): boolean {
  return phase === "scene" || phase === "check" || phase === "encounter";
}
