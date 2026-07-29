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
 */

import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import { createScene, setActiveScene, type PartyScene } from "./scene";
import { useParty } from "../store";

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
      instance.canvas.style.width = "100%";
      instance.canvas.style.height = "100%";
      instance.canvas.style.display = "block";
      host.appendChild(instance.canvas);

      const scene = createScene(instance);
      sceneRef.current = scene;
      setActiveScene(scene);
      scene.setParty(party);

      const size = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        instance.renderer.resize(width, height);
        scene.resize(width, height);
      };
      size();

      observer = new ResizeObserver(size);
      observer.observe(host);
    })();

    return () => {
      cancelled = true;
      void ready
        .catch(() => undefined)
        .then(() => {
          observer?.disconnect();
          observer = null;
          if (sceneRef.current) {
            setActiveScene(null);
            sceneRef.current.destroy();
            sceneRef.current = null;
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
