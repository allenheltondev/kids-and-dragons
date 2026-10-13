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
 * Given a `look`, it wears it: the rig's own part images are repainted for
 * the chosen colors, markings and horn/wing style (world/rig-look.ts), so a
 * tap on "Rose" turns the creature rose under your finger. This is not the
 * old tint-slot recolour that flattened the shading — every pixel keeps its
 * value and only moves hue where the species palette says it belongs.
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
import type { RigLook } from "../world/rig-look";
import "./RigFigure.css";

export interface RigFigureProps {
  species: SpeciesId;
  tier: TierId;
  className?: string;
  /** Drawn while the rig loads, and left in place if it never does. */
  fallback: ReactElement;
  /** The player's chosen look. Absent: the figure is drawn as painted. */
  look?: RigLook;
}

/** Is the element laid out at all? (`hidden` panes have no boxes.) */
function isShown(element: HTMLElement | null): boolean {
  return element !== null && element.getClientRects().length > 0;
}

export function RigFigure({ species, tier, className, fallback, look }: RigFigureProps): ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const rig = useRef<RigHandle | null>(null);
  const [ready, setReady] = useState(false);
  // Read by the build effect without rebuilding on every tap: a look change
  // repaints the rig in place (the effect below), it does not replace it.
  const lookRef = useRef(look);
  lookRef.current = look;
  const recolorable = look !== undefined;
  /** A look that arrived while the figure was hidden; see the look effect. */
  const pendingLook = useRef<RigLook | null>(null);

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
      const handle = await createRig(species, tier, undefined, undefined, { recolorable });
      // The screen may have moved on while the wasm and the file loaded —
      // a different species picked, or creation left altogether.
      if (cancelled || !handle) {
        handle?.destroy();
        return;
      }
      // Wear the look before the figure is first seen, so it never arrives
      // in its painted colors and then changes.
      if (lookRef.current && handle.setLook) await handle.setLook(lookRef.current);
      if (cancelled) {
        handle.destroy();
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
        const waiting = pendingLook.current;
        if (waiting && isShown(host.current)) {
          pendingLook.current = null;
          void handle.setLook?.(waiting);
        }
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
  }, [species, tier, recolorable]);

  // A new look repaints the rig that is already standing there — once it is
  // on screen. A phone holds the TV's creation preview in a hidden pane, and
  // repainting a figure nobody can see would double the wait on the one they
  // can; the frame loop below hands it the look when its pane is shown.
  useEffect(() => {
    if (!look || !ready) return;
    if (isShown(host.current)) {
      pendingLook.current = null;
      void rig.current?.setLook?.(look);
    } else {
      pendingLook.current = look;
    }
  }, [look, ready]);

  return (
    <div className={`rig-figure${className ? ` ${className}` : ""}`}>
      <div ref={host} className="rig-figure__host" data-ready={ready ? "true" : undefined} />
      {ready ? null : fallback}
    </div>
  );
}
