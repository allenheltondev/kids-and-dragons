/**
 * A rigged character in the DOM — the creation preview's figure.
 *
 * `CharacterPortrait` draws a tier PNG in an `<img>`, and for every other
 * surface that is exactly right. Here it is not: this screen's whole job is to
 * show the choices as they are made (spec §5), and a species is a way of
 * moving before it is a shape. So creation gets the same rig the scene draws,
 * in a plain canvas — pick "griffin" and a griffin walks on and breathes at
 * you, instead of a photograph of one.
 *
 * It does *not* show the palette. It used to: the rigs expose `mane`/`accent`
 * tint slots and this screen wrote the swatch straight into them, so the mane
 * went green under your finger. A hue pushed onto authored shading flattens
 * the art it is painted over, so the recolour is gone everywhere
 * (world/nameplate.ts) — the palette and accent now dress this player's UI
 * chrome, and the figure is the creature as drawn.
 *
 * **Rive is loaded on demand and never at rest.** The import is dynamic, so a
 * phone that opens the app and never reaches creation does not download the
 * runtime; `art-paths.ts` is explicit that `screens/` must not drag a renderer
 * into the main bundle, and `world/rive-rig.ts` is Pixi-free for the same
 * reason. Until the rig resolves — and forever, if it cannot — the caller's
 * fallback stays on screen.
 *
 * The figure sits in the same box a portrait would: `PORTRAIT_FLOOR` of the
 * canvas is the ground the feet stand on, so swapping between this and the
 * `<img>` does not move the character.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { SpeciesId, TierId } from "@kad/shared";
import type { RigHandle } from "../world/rive-rig";
import "./RigFigure.css";

export interface RigFigureProps {
  species: SpeciesId;
  tier: TierId;
  className?: string;
  /** Drawn while the rig loads, and left in place if it never does. */
  fallback: ReactElement;
}

export function RigFigure({ species, tier, className, fallback }: RigFigureProps): ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const rig = useRef<RigHandle | null>(null);
  const [ready, setReady] = useState(false);

  /*
   * Build on species/tier — the asset identity, exactly the split
   * `world/scene.ts` makes, and now the whole of what this figure depends on.
   */
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let last = 0;
    setReady(false);

    void (async () => {
      const { createRig } = await import("../world/rive-rig");
      const handle = await createRig(species, tier);
      // The screen may have moved on while the wasm and the file loaded —
      // a different species picked, or creation left altogether.
      if (cancelled || !handle) {
        handle?.destroy();
        return;
      }
      rig.current = handle;
      handle.canvas.className = "rig-figure__canvas";
      // Draw one frame before the fallback comes down. `createRig` does not
      // paint on its own, so revealing the canvas first would swap the
      // portrait for an empty box until the next animation frame.
      handle.tick(0);
      host.current?.appendChild(handle.canvas);
      setReady(true);

      const loop = (now: number): void => {
        const dt = last === 0 ? 0 : Math.min(0.25, (now - last) / 1000);
        last = now;
        handle.tick(dt);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    })();

    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      rig.current?.destroy();
      rig.current = null;
      setReady(false);
    };
  }, [species, tier]);

  return (
    <div className={`rig-figure${className ? ` ${className}` : ""}`}>
      <div ref={host} className="rig-figure__host" data-ready={ready ? "true" : undefined} />
      {ready ? null : fallback}
    </div>
  );
}
