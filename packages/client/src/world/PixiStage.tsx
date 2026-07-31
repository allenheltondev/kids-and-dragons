/**
 * Mounts a Pixi 8 Application sized to its container.
 *
 * Container-sized, never viewport-sized: this canvas is 60% of a phone in
 * Travel Mode and a whole TV in Party Mode, and it must not know which
 * (architecture §4.6 rule 2). A ResizeObserver is the only size input.
 *
 * React 19 strict mode double-invokes effects, and `Application.init()` is
 * async — the naive version leaks a WebGL context per mount and eventually the
 * browser starts dropping them. The `cancelled` flag plus the promise chain in
 * the cleanup is what makes mount → unmount → mount land on exactly one live
 * renderer.
 *
 * The ticker runs only while there is something to draw *to*: it stops when
 * the tab is hidden and when the host box is zero-sized — which is exactly the
 * Travel Mode `display: none` pane (components.css). A GPU pass per frame into
 * an invisible canvas is pure battery drain on the phone this mode exists for.
 * The combat board adds no ticker of its own — it rides this one — so that
 * discipline survives a fight.
 *
 * This component is also where the store meets the scene: it pushes the party,
 * the encounter (with the chapter's biome and enemy art), the camera's
 * attention key, and the COMBAT_SEQUENCE beats. The scene stays a plain Pixi
 * module with no React and no store in it.
 */

import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import type { Chapter, PartyMember, RunState } from "@kad/shared";
import { currentActorId, enemyArtId } from "@kad/shared";
import { createScene, getActiveScene, setActiveScene, type PartyScene } from "./scene";
import type { BoardViewState } from "./board";
import { presentationDuration } from "./presentation";
import { useChapter, useGameStore, useParty, usePresentation, useRunState, useSession } from "../store";
import { useEnsureChapter } from "../screens/content";

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

    const ready = (async () => {
      const instance = new Application();
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
        instance.destroy(true, { children: true });
        return;
      }

      app = instance;
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
    })();

    return () => {
      cancelled = true;
      void ready
        .catch(() => undefined)
        .then(() => {
          removeVisibilityListener?.();
          removeVisibilityListener = null;
          observer?.disconnect();
          observer = null;
          if (scene) {
            // Only clear the module-level handles if they still point at *this*
            // scene — a newer effect instance may already own them.
            if (getActiveScene() === scene) setActiveScene(null);
            if (sceneRef.current === scene) sceneRef.current = null;
            scene.destroy();
            scene = null;
          }
          app?.destroy(true, { children: true });
          app = null;
        });
    };
    // Deliberately empty deps: state is pushed in by the effects below.
    // Re-initialising a WebGL context whenever someone's HP changes would be
    // absurd, and `party` is intentionally not a dependency here.
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
    sceneRef.current?.playCombatEvents(presentation.events, presentationDuration(presentation));
  });
  usePresentation("ENCOUNTER_BEGAN", (presentation) => {
    if (presentation.events && presentation.events.length > 0) {
      sceneRef.current?.playCombatEvents(
        presentation.events,
        presentationDuration(presentation),
      );
    }
  });

  return <div ref={hostRef} className="kad-stage" aria-hidden="true" />;
}
