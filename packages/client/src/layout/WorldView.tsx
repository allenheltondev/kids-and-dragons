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

import { Suspense, lazy, useEffect } from "react";
import type { Presentation } from "@kad/shared";
import {
  ChapterCompletePanel,
  CreationPreview,
  DiceOverlay,
  LobbyContent,
  NarrationPanel,
} from "../screens";
import { useGameStore, useMe, useRunState, useSession } from "../store";
import type { PresentationEvent } from "../store/contract";

// Loaded on demand: PixiStage pulls in all of pixi.js, which is most of the
// bundle and pure decoration (the stage is aria-hidden). Nothing waits on it —
// the join screen and the player controls must be interactive before the
// renderer has even started downloading.
const PixiStage = lazy(() =>
  import("../world/PixiStage").then((module) => ({ default: module.PixiStage })),
);

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
  // Never read: COMBAT_SEQUENCE's hold scales with its events — see
  // presentationDuration(). The entry only satisfies the Record.
  COMBAT_SEQUENCE: 700,
  ATTACK: 700,
  HEAL: 600,
  DOWN: 700,
  REVIVE: 700,
  LEVEL_UP: 1200,
  TRANSFORM: 2000,
  CHAPTER_COMPLETE: 800,
};

/*
 * COMBAT_SEQUENCE carries the whole enemy round — every move, roll and hit in
 * one presentation (protocol.ts). A flat hold meant one goblin and four got
 * the same 700ms: four beats of damage flashed past unreadably. So the hold
 * grows with the beats, capped so a crowded round cannot stall the table.
 */
const COMBAT_BEAT_BASE_MS = 300;
const COMBAT_BEAT_PER_EVENT_MS = 400;
const COMBAT_BEAT_MAX_MS = 4000;

function presentationDuration(presentation: Presentation): number {
  if (presentation.kind === "COMBAT_SEQUENCE") {
    return Math.min(
      COMBAT_BEAT_MAX_MS,
      COMBAT_BEAT_BASE_MS + presentation.events.length * COMBAT_BEAT_PER_EVENT_MS,
    );
  }
  return PRESENTATION_MS[presentation.kind] ?? 0;
}

export function WorldView(): React.JSX.Element {
  const phase = useRunState()?.phase ?? "lobby";
  const me = useMe();
  // A display client has no player (spec §2.1), so it never has a character and
  // must never be parked on the creation preview waiting for one.
  const isDisplay = (useSession()?.playerId ?? "") === "";

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
        setTimeout(resolve, presentationDuration(event.presentation));
      });
    return useGameStore.getState().registerPresentationPlayer(play);
  }, []);

  return (
    <div className="kad-surface kad-surface--world" data-surface="world">
      <Suspense fallback={null}>
        <PixiStage />
      </Suspense>

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
          container, which is why it has no viewport units in it.

          Mounted unconditionally on purpose: it renders nothing while idle and
          brings itself up on the ROLL presentation. Mount-on-roll was the bug
          that ate every first roll — the ROLL event is what would trigger the
          mount, so the overlay always subscribed one event too late. */}
      <DiceOverlay />
    </div>
  );
}

function isSceneLike(phase: string): boolean {
  return phase === "scene" || phase === "check" || phase === "encounter";
}
