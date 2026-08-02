/**
 * A rigged character in the DOM — the creation preview's figure.
 *
 * `CharacterPortrait` draws a tier PNG in an `<img>`, and for every other
 * surface that is exactly right. Here it is not: this screen's whole job is to
 * show the choices as they are made (spec §5), and a PNG cannot show a colour
 * the player just picked. So creation gets the same rig the scene draws, in a
 * plain canvas, with the palette written straight into it — pick "Meadow" and
 * the mane goes green while your finger is still on the swatch.
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
import type { Appearance, SpeciesId, TierId } from "@kad/shared";
import type { RigHandle } from "../world/rive-rig";
import "./RigFigure.css";

export interface RigFigureProps {
  species: SpeciesId;
  tier: TierId;
  appearance: Appearance;
  className?: string;
  /** Drawn while the rig loads, and left in place if it never does. */
  fallback: ReactElement;
}

export function RigFigure({
  species,
  tier,
  appearance,
  className,
  fallback,
}: RigFigureProps): ReactElement {
  const host = useRef<HTMLDivElement | null>(null);
  const rig = useRef<RigHandle | null>(null);
  const [ready, setReady] = useState(false);

  /*
   * Build on species/tier — the asset identity, exactly the split
   * `world/scene.ts` makes. Appearance is deliberately not a dependency: a
   * palette is a binding write on a live rig (the effect below), and rebuilding
   * per tap would make choosing a colour feel like waiting for one.
   */
  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    let last = 0;
    setReady(false);

    void (async () => {
      const { createRig } = await import("../world/rive-rig");
      const handle = await createRig(species, tier, appearance);
      // The screen may have moved on while the wasm and the file loaded —
      // a different species picked, or creation left altogether.
      if (cancelled || !handle) {
        handle?.destroy();
        return;
      }
      rig.current = handle;
      handle.canvas.className = "rig-figure__canvas";
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
    };
    // `appearance` is read here but deliberately not a dependency — it drives
    // the binding effect below instead. Listing it would rebuild the rig on
    // every tap, which is the thing `setPalette` exists to avoid.
  }, [species, tier]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * Colour, written into whatever rig is currently live — including the one
   * that is still loading, since the effect above applies the appearance it
   * was built with and this one catches every change after.
   *
   * Keyed on the two values rather than the object: a draft patch makes a new
   * `appearance` object for unrelated edits too (a name, a stat), and there is
   * no reason to rewrite fills because somebody typed a letter.
   */
  useEffect(() => {
    rig.current?.setPalette(appearance);
  }, [appearance.palette, appearance.accent]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`rig-figure${className ? ` ${className}` : ""}`}>
      <div ref={host} className="rig-figure__host" data-ready={ready ? "true" : undefined} />
      {ready ? null : fallback}
    </div>
  );
}
