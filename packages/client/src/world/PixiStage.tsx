/** Container-sized renderer; state updates do not recreate its WebGL context. */

import { useEffect, useRef, useState } from "react";
import { Application } from "pixi.js";
import type { Chapter, PartyMember, RunState } from "@kad/shared";
import { currentActorId, enemyArtId } from "@kad/shared";
import { createScene, getActiveScene, setActiveScene, type PartyScene } from "./scene";
import type { BoardViewState } from "./board";
import { presentationDuration } from "./presentation";
import { shakeStrengthFor } from "./shake";
import { justWonAFight } from "./victory";
import { cue } from "../audio/cue";
import { useChapter, useGameStore, useParty, usePresentation, useRunState, useSession } from "../store";
import { useEnsureChapter } from "../screens/content";
import { RendererFallback } from "./RendererFallback";

/**
 * Enemy spec id → art id, read off the chapter's encounter scene. The
 * `EncounterState` deliberately carries no art (it is rules state); the chapter
 * file is where a wisp's picture lives, exactly like scene art.
 *
 * The chapter fetched here is the *authored* one — a static asset, not the
 * server's resolved copy — so an enemy that inherits its art from canon has
 * none written down. `enemyArtId` applies the bestiary's own
 * `enemies/<creature>` convention rather than making the client fetch a whole
 * catalog for one string mid-battle.
 */
export function enemyArtFor(chapter: Chapter | null, sceneId: string | null): Record<string, string> {
  if (!chapter || !sceneId) return {};
  const scene = chapter.scenes[sceneId];
  if (!scene || scene.type !== "encounter") return {};
  const out: Record<string, string> = {};
  for (const spec of scene.enemies) {
    const art = enemyArtId(spec);
    if (art) out[spec.id] = art;
  }
  return out;
}

/**
 * The camera's attention key (world/camera.ts header): the encounter scene
 * plus the id of whoever this device is being asked to act as. It changes
 * exactly when a question starts or stops being yours — which is the one
 * moment the game may take a panned camera back (§2.2, "your turn comes to
 * you") — and at no other time, so a pan survives everyone else's turns.
 */
export function attentionKeyFor(
  state: RunState | null,
  myCharacterId: string | null,
): string {
  const encounter = state?.encounter ?? null;
  if (!encounter) return `scene:${state?.sceneId ?? ""}`;
  const activeId = currentActorId(encounter);
  const mine = activeId !== null && activeId === myCharacterId ? activeId : "";
  return `${state?.sceneId ?? ""}:${mine}`;
}

/**
 * Whether the figures should carry their names (world/nameplate.ts).
 *
 * Off for exactly the phases that put `LobbyContent` over the lineup
 * (WorldView mounts it on `lobby` and `creation`). That card row already names
 * every player, with their level and whether they are ready, in a band
 * directly above the figures — so a nameplate there is the same name twice,
 * and the copy nobody needs is the one crowding the art. Everywhere else the
 * name is the only thing that says which unicorn is yours.
 *
 * Pure and exported so the pairing with WorldView's mount condition is a test
 * rather than a coincidence: the two drift apart silently, and the symptom is
 * either a doubled name or no name at all in a fight.
 *
 * No state yet reads as `lobby`, which is WorldView's own default for it
 * (`useRunState()?.phase ?? "lobby"`) — the two have to answer a missing phase
 * the same way or the pairing holds everywhere except at startup, which is
 * precisely where it would not be noticed.
 */
export function nameplatesVisibleIn(phase: string | null | undefined): boolean {
  const resolved = phase ?? "lobby";
  return resolved !== "lobby" && resolved !== "creation";
}

function boardView(
  state: RunState | null,
  party: readonly PartyMember[],
  chapter: Chapter | null,
): BoardViewState | null {
  const encounter = state?.encounter ?? null;
  if (!encounter) return null;
  return {
    encounter,
    biome: chapter?.biome ?? null,
    enemyArt: enemyArtFor(chapter, state?.sceneId ?? null),
    party,
  };
}

export function PixiStage(): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<PartyScene | null>(null);
  const party = useParty();
  const state = useRunState();
  const session = useSession();
  const chapter = useChapter();
  // The board needs the chapter for its biome and enemy art; content is data,
  // fetched over HTTP like rules and items, never baked into the bundle.
  useEnsureChapter();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let app: Application | null = null;
    let observer: ResizeObserver | null = null;
    // Local to this effect run, never the shared ref: strict mode overlaps two
    // effect instances, and a cleanup that reads `sceneRef.current` tears down
    // whichever scene happens to be there — usually the *new* one.
    let scene: PartyScene | null = null;
    let removeVisibilityListener: (() => void) | null = null;

    const dispose = () => {
      removeVisibilityListener?.();
      removeVisibilityListener = null;
      observer?.disconnect();
      observer = null;
      if (scene) {
        // Strict Mode may already have installed a newer scene.
        if (getActiveScene() === scene) setActiveScene(null);
        if (sceneRef.current === scene) sceneRef.current = null;
        scene.destroy();
        scene = null;
      }
      if (app?.renderer) app.destroy(true, { children: true });
      else app?.stage.destroy({ children: true });
      app = null;
    };

    void (async () => {
      const instance = new Application();
      app = instance;
      await instance.init({
        antialias: true,
        backgroundAlpha: 0,
        // The TV may be a modest mini-PC; capping DPR keeps fill rate sane.
        resolution: Math.min(globalThis.devicePixelRatio || 1, 2),
        autoDensity: true,
        resizeTo: undefined,
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
      });

      if (cancelled) {
        dispose();
        return;
      }

      // Canvas inspection for development browser tests.
      if (import.meta.env.DEV) {
        (globalThis as Record<string, unknown>).__kadScene = () => sceneRef.current;
      }
      // autoDensity owns the canvas CSS size (it keeps style px in step with
      // the renderer on every resize); we only stop it rendering inline.
      instance.canvas.style.display = "block";
      host.appendChild(instance.canvas);

      scene = createScene(instance);
      sceneRef.current = scene;
      setActiveScene(scene);
      // The live state, not the values this effect closed over at mount: init
      // is async, and anyone who joined — or a fight that began — during it
      // would otherwise be invisible until the next change pushed a fresh one.
      const live = useGameStore.getState();
      // Before `setParty`, which is what lays the labels out: a scene that
      // finished initialising during the lobby would otherwise show every
      // name for one frame before the effect below caught up.
      scene.setNameplatesVisible(nameplatesVisibleIn(live.state?.phase));
      scene.setParty(live.state?.party ?? []);
      scene.setBiome(live.chapter?.biome ?? null);
      scene.setEncounter(boardView(live.state, live.state?.party ?? [], live.chapter));

      /** Run the ticker only when a frame could actually be seen. */
      const syncTicker = () => {
        const hidden = typeof document !== "undefined" && document.hidden;
        const sized = host.clientWidth > 0 && host.clientHeight > 0;
        if (hidden || !sized) {
          instance.ticker.stop();
        } else if (!instance.ticker.started) {
          instance.ticker.start();
          // One immediate frame, so coming back is not a beat of stale canvas.
          instance.render();
        }
      };

      const size = () => {
        const width = host.clientWidth;
        const height = host.clientHeight;
        if (width === 0 || height === 0) {
          // The hidden Travel pane. Don't squash the renderer to a token 1×1 —
          // that throws away the framebuffer and forces a real resize (and a
          // flash of letterboxing) on every toggle back. Just go to sleep.
          instance.ticker.stop();
          return;
        }
        instance.renderer.resize(width, height);
        scene?.resize(width, height);
        syncTicker();
      };
      size();

      observer = new ResizeObserver(size);
      observer.observe(host);

      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", syncTicker);
        removeVisibilityListener = () => {
          document.removeEventListener("visibilitychange", syncTicker);
        };
      }
    })().catch(() => {
      dispose();
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      // Pending init owns disposal until it settles.
      if (app?.renderer && scene) dispose();
    };
    // State is pushed through the effects below without restarting WebGL.
  }, []);

  useEffect(() => {
    sceneRef.current?.setParty(party);
  }, [party]);

  // The chapter's biome is what the party is standing in (spec §6.2). The board
  // reads it off the same chapter for its tiles; this is the story half.
  useEffect(() => {
    sceneRef.current?.setBiome(chapter?.biome ?? null);
  }, [chapter]);

  // The board is a reader of the mirrored state (brief, trap 2): every patch
  // that touches the encounter flows through here and nowhere else.
  useEffect(() => {
    sceneRef.current?.setEncounter(boardView(state, party, chapter));
  }, [state, party, chapter]);

  /*
   * The victory beat — roadmap chapter 8, read off the state rather than
   * announced by a presentation (world/victory.ts explains why the engine
   * should not grow a VICTORY kind for something the state already says).
   *
   * The previous state is held in a ref rather than derived, because this is a
   * *transition*: the fight that was running one patch ago is the only thing
   * that knows the fight was won, and by this patch the engine has cleared it.
   */
  const previousState = useRef<RunState | null>(null);
  useEffect(() => {
    const before = previousState.current;
    previousState.current = state;
    if (justWonAFight(before, state)) {
      sceneRef.current?.playVictory();
      cue("victory");
    }
  }, [state]);

  // Names off while the lobby's card row is over the lineup — see
  // nameplatesVisibleIn.
  const named = nameplatesVisibleIn(state?.phase);
  useEffect(() => {
    sceneRef.current?.setNameplatesVisible(named);
  }, [named]);

  // Whose attention the camera may claim — see attentionKeyFor.
  const me = party.find((member) => member.playerId === (session?.playerId ?? ""));
  const attention = attentionKeyFor(state, me?.character.id ?? null);
  useEffect(() => {
    sceneRef.current?.setCameraAttention(attention);
  }, [attention]);

  // Combat beats ride presentations, and the patch behind each one is held
  // until its hold elapses (sync/channel.ts) — so the numbers pop while the
  // board still shows the world they happened to.
  usePresentation("COMBAT_SEQUENCE", (presentation) => {
    // No head shake: the sequence's impacts jolt on the beats they belong
    // to, scheduled by the scene alongside the damage numbers (shake.ts,
    // `impactBeats`).
    sceneRef.current?.playCombatEvents(presentation.events, presentationDuration(presentation));
  });
  usePresentation("ENCOUNTER_BEGAN", (presentation) => {
    if (presentation.events && presentation.events.length > 0) {
      sceneRef.current?.playCombatEvents(
        presentation.events,
        presentationDuration(presentation),
      );
    }
    // The arrival thump; any opening turns' own impacts ride the schedule
    // above.
    sceneRef.current?.shake(shakeStrengthFor(presentation));
  });

  /*
   * The impacts — roadmap chapter 8. Strengths live in world/shake.ts's
   * table (zero for most kinds); these hooks name exactly the kinds whose
   * strength is non-zero plus the scene step, because usePresentation
   * subscribes one kind at a time. Wired here rather than in WorldView's
   * gate so pixi-adjacent code stays inside the lazy chunk.
   */
  usePresentation("ATTACK", (presentation) => {
    sceneRef.current?.shake(shakeStrengthFor(presentation));
  });
  usePresentation("DOWN", (presentation) => {
    sceneRef.current?.shake(shakeStrengthFor(presentation));
  });
  // Moving to a new scene reads as going somewhere: a dip toward dark and
  // back, sized to the SCENE_ENTER hold the gate is already enforcing.
  usePresentation("SCENE_ENTER", (presentation) => {
    sceneRef.current?.playSceneStep(presentationDuration(presentation));
  });

  if (failed) return <RendererFallback />;
  return <div ref={hostRef} className="kad-stage" aria-hidden="true" />;
}
