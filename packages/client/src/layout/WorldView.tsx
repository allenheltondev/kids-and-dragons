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

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  ChapterCompletePanel,
  CreationPreview,
  DiceOverlay,
  FightLog,
  LobbyContent,
  NarrationPanel,
  TransformCutscene,
  TurnBanner,
} from "../screens";
import { FieldGuideBanner } from "../screens/FieldGuideNews";
import { RiftStatus } from "../screens/RiftStatus";
import { ChapterGoalCard } from "../screens/ChapterGoal";
import { ChapterPreface } from "../screens/ChapterPreface";
import { StoryPlates } from "../screens/StoryPlates";
import { useChapter, useGameStore, useMe, useRunState, useSession } from "../store";
import type { PresentationEvent } from "../store/contract";
// The hold table lives in world/presentation.ts because the board renderer
// paces its damage numbers across the same hold this gate enforces.
import { presentationDuration } from "../world/presentation";
// Sound rides the same two facts the renderer already consumes: presentations
// (a cue per beat) and the chapter's biome (the music bed). Roadmap chapter 8.
import { ambience, cue, cueForPresentation, stopSceneCues } from "../audio";
import { ambienceForScene, sceneCuesFor } from "../audio/scene-audio";
import { riftCueFor } from "../world/scene-rift";
// From the import-free stats module, never from FrameMeter: a static import of
// the meter is a static import of the scene, Pixi and the figures (frame-stats.ts).
import { perfRequested } from "../world/frame-stats";
import { RendererBoundary } from "../world/RendererFallback";
import { ChunkBoundary, lazyChunk } from "../ui/ChunkBoundary";
import { usePrefetchUpcoming } from "../sw/prefetch";

// Loaded on demand: PixiStage pulls in all of pixi.js, which is most of the
// bundle and pure decoration (the stage is aria-hidden). Nothing waits on it —
// the join screen and the player controls must be interactive before the
// renderer has even started downloading.
const PixiStage = lazy(() =>
  import("../world/PixiStage").then((module) => ({ default: module.PixiStage })),
);

/*
 * The frame meter, and only when `?perf` is in the URL — roadmap chapter 8's
 * performance pass. Lazy like the stage: measuring the renderer is not worth
 * a byte in the bundle of a game nobody is measuring.
 */
const FrameMeter = lazyChunk(() => import("../world/FrameMeter"), (module) => module.FrameMeter);

export function WorldView({
  gatesPresentations = true,
  prefetch = true,
}: {
  gatesPresentations?: boolean;
  /**
   * Whether this world is on screen, so worth fetching the scenes ahead for
   * (sw/prefetch.ts). A layout that keeps the world mounted behind a phone's
   * controls says no while it is hidden; this surface still never reads the
   * mode, only what it is told.
   */
  prefetch?: boolean;
} = {}): React.JSX.Element {
  const phase = useRunState()?.phase ?? "lobby";
  usePrefetchUpcoming(prefetch);
  // Read once at mount: the meter is asked for when the page is opened, and a
  // URL that changes mid-session is a route change, not a settings panel.
  const [measuring] = useState(() =>
    typeof location === "undefined" ? false : perfRequested(location.search),
  );
  const me = useMe();
  // A display client has no player (spec §2.1), so it never has a character and
  // must never be parked on the creation preview waiting for one.
  const isDisplay = (useSession()?.playerId ?? "") === "";

  // Same trigger PlayerView uses: "I have no character yet", not the run phase.
  const creating = (phase === "lobby" || phase === "creation") && me === null && !isDisplay;

  /**
   * The shell supplies the timing capability independently of rendering.
   * Party phones keep this subtree alive for reference, but their controls
   * must receive authoritative patches immediately. TV and Travel surfaces
   * hold patches until their presentations finish.
   */
  useEffect(() => {
    if (!gatesPresentations) return;
    const play = (event: PresentationEvent): Promise<void> => {
      // The cue fires at the beat's head, alongside the visuals it underscores.
      // A no-op on any device without an installed audio sink.
      cue(cueForPresentation(event.presentation));
      return new Promise((resolve) => {
        setTimeout(resolve, presentationDuration(event.presentation));
      });
    };
    return useGameStore.getState().registerPresentationPlayer(play);
  }, [gatesPresentations]);

  const chapter = useChapter();
  const state = useRunState();
  const locationAmbience = ambienceForScene(chapter, state);
  useEffect(() => { ambience(locationAmbience); }, [locationAmbience]);
  useEffect(() => () => { ambience(null); }, []);

  const previousAudioState = useRef<ReturnType<typeof useRunState>>(null);
  useEffect(() => {
    const previous = previousAudioState.current;
    if (previous?.sceneId !== state?.sceneId || previous?.chapterId !== state?.chapterId || previous?.phase !== state?.phase) stopSceneCues();
    for (const id of sceneCuesFor(previousAudioState.current, state)) cue(id);
    previousAudioState.current = state;
  }, [state]);

  // A rift that opens or folds shut as its scene opens (#401). Here, not on
  // the stage, so the room hears it on the still board too. Also run when the
  // chapter lands: the state can name a scene before its chapter has loaded,
  // and `riftCueFor` keeps that scene pending until it can be judged.
  const riftCueHeard = useRef<string | null>(null);
  useEffect(() => {
    const next = riftCueFor(riftCueHeard.current, chapter, state);
    riftCueHeard.current = next.heard;
    cue(next.cue);
  }, [chapter, state]);
  useEffect(() => () => { stopSceneCues(); }, []);

  return (
    <div className="kad-surface kad-surface--world" data-surface="world">
      <RendererBoundary>
        <Suspense fallback={null}>
          <PixiStage />
        </Suspense>
      </RendererBoundary>

      {/* The preview is a view of *this device's* draft, so it belongs on
          screen only while this device is still choosing. Once your character
          exists you want the lobby — the party filling up, and who the room is
          still waiting on. Keying it off the phase alone would leave everyone
          who finished first staring at "pick a species". */}
      {creating ? <CreationPreview /> : null}
      {!creating && (phase === "lobby" || phase === "creation") && <LobbyContent />}
      {isSceneLike(phase) && <NarrationPanel />}
      {isSceneLike(phase) && <TurnBanner />}
      {/* The rift clock and what the place just did (#201) — only in a fight
          that has an environment, so an ordinary fight's screen is untouched. */}
      {isSceneLike(phase) && state?.encounter?.environment ? <RiftStatus /> : null}
      {/* The chapter's goal through a fight (#356), folded to a line in the top corner. Outside
          a fight it is in the narration's head; in a place that fights back it heads RiftStatus. */}
      {isSceneLike(phase) && state?.encounter != null && !state.encounter.environment ? (
        <div className="world__goal">
          <ChapterGoalCard place="world" folded />
        </div>
      ) : null}
      {/* "Last time…" before a chapter's first scene, and "Where you left off" for a screen that
          comes back partway (#357). Over the stage, between the corner row and the plate, and
          gone by itself once read or once play moves on. */}
      {isSceneLike(phase) && <ChapterPreface />}
      {/* A campaign's prologue or a chapter's plate, painted full pane before the first scene
          (docs/story-plates.md). Once per device and skippable; the story and "Last time…" wait
          behind it (useStartPreface), and it has nothing to tap on the shared screen. */}
      {isSceneLike(phase) && <StoryPlates />}
      {/* The fight so far, every roll with what it needed (FightLog). Mounted
          for any scene-like phase, not only once a fight is in state: the
          opening monster round rides ENCOUNTER_BEGAN, ahead of the patch that
          puts the fight there, and a mount-on-fight would miss it. It draws
          nothing outside a fight. */}
      {isSceneLike(phase) && <FightLog />}
      {phase === "chapter_complete" && <ChapterCompletePanel />}

      {/* The roll is the centrepiece of whatever pane it lands in. On a TV that
          is the room; on a phone the shell hands the world the whole screen for
          the few seconds the card is up (spec §2.2) — but the overlay itself only ever fills its
          container, which is why it has no viewport units in it.

          Mounted unconditionally on purpose: it renders nothing while idle and
          brings itself up on the ROLL presentation. Mount-on-roll was the bug
          that ate every first roll — the ROLL event is what would trigger the
          mount, so the overlay always subscribed one event too late. */}
      <DiceOverlay />

      {/* spec §8.1's "the whole party stops to watch". Mounted unconditionally
          for the same reason the dice are: the progression update that summons
          it is what would have triggered a conditional mount, so a
          mount-on-transform overlay would subscribe one event too late and eat
          the single most important moment in the game. It draws nothing until
          somebody crosses a tier. */}
      <TransformCutscene />

      {/* The shared screen's own copy of the Field Guide news. A phone's world
          pane has a player, and that phone's toast speaks for it instead. */}
      {isDisplay ? <FieldGuideBanner /> : null}

      {measuring ? (
        <ChunkBoundary quiet>
          <Suspense fallback={null}>
            <FrameMeter />
          </Suspense>
        </ChunkBoundary>
      ) : null}
    </div>
  );
}

function isSceneLike(phase: string): boolean {
  return phase === "scene" || phase === "check" || phase === "encounter";
}
