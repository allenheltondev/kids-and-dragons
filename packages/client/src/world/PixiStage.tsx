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
 */

import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import { createScene, getActiveScene, setActiveScene, type PartyScene } from "./scene";
import { useGameStore, useParty } from "../store";

export function PixiStage(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<PartyScene | null>(null);
  const party = useParty();

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
      // The live party, not the value this effect closed over at mount: init
      // is async, and anyone who joined during it would otherwise be invisible
      // until the next party change pushed a fresh value in.
      scene.setParty(useGameStore.getState().state?.party ?? []);

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
    // Deliberately empty deps: the party is pushed in by the effect below.
    // Re-initialising a WebGL context whenever someone's HP changes would be
    // absurd, and `party` is intentionally not a dependency here.
  }, []);

  useEffect(() => {
    sceneRef.current?.setParty(party);
  }, [party]);

  return <div ref={hostRef} className="kad-stage" aria-hidden="true" />;
}
