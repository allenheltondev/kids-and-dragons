/**
 * A rigged figure as a Pixi sprite — the renderer half of `rive-rig.ts`.
 *
 * The rig draws into its own canvas (that module); this uploads that canvas as
 * a texture and hands back a sprite the two stages can place. It is the whole
 * of the Rive↔Pixi seam art-pipeline.md §7 names, and it is deliberately thin:
 * everything with an opinion about *rigs* — the contract's inputs, the handle
 * ownership — lives one module down, where the creation screen can reach it
 * without importing a renderer.
 *
 * The upload is per-repaint rather than per-frame-unconditionally: `createRig`
 * calls back when it has actually drawn, so a rig that stops advancing stops
 * costing GPU bandwidth. In practice everything on a board plays a looping
 * idle, so this is the same cost the spike measured — it just stops being a
 * cost the moment a figure is genuinely still.
 */

import { Sprite, Texture } from "pixi.js";
import type { ClassId, SpeciesId, TierId } from "@kad/shared";
import { CANVAS, RIG_STAGE } from "./art-paths";
import { RIG_ANCHOR_X, RIG_ANCHOR_Y, createRig, type RigHandle } from "./rive-rig";

export interface RiveActorHandle {
  /** Anchored like every character sprite: feet on the manifest origin. */
  readonly sprite: Sprite;
  /** Advance the state machine and repaint the sprite. Call once per frame. */
  tick(dtSeconds: number): void;
  /** The contract's `knockedDown` boolean — the rig walks down/down_loop/revive itself. */
  setKnockedDown(down: boolean): void;
  /** Fire one of the contract's nine triggers by name. Unknown names are ignored. */
  fire(trigger: string): void;
  destroy(): void;
}

/**
 * A rigged figure, or null when the PNG path should carry on. `height` is the
 * drawn height in the caller's units (scene design units, board pixels).
 */
export async function createRiveActor(
  species: SpeciesId,
  tier: TierId,
  height: number,
  characterClass?: ClassId,
): Promise<RiveActorHandle | null> {
  let texture: Texture | null = null;
  let rig: RigHandle | null = null;

  rig = await createRig(species, tier, () => {
    // Only after a real repaint. `texture` is still null for the first draw,
    // which happens inside `createRig` before this closure has anything to
    // update — the sprite's first frame comes from the initial upload below.
    texture?.source.update();
  }, characterClass);
  if (!rig) return null;

  const built = rig;
  try {
    texture = Texture.from(built.canvas);
    const sprite = new Sprite(texture);
    // `height` is how tall the CHARACTER should be, and the character is not
    // the whole texture. The artboard is the manifest's rigStage (1400), with
    // the 1024 art canvas centred inside it so a knocked-down figure has room
    // to sweep its own diagonal (art-pipeline §6.3) — so the canvas is 1024/1400
    // of the buffer and a sprite sized to `height` draws the character at 73% of
    // the size asked for. Scale the sprite so the *canvas region* measures
    // `height`, and the surrounding margin simply hangs off the edges.
    //
    // The anchor needs no adjustment: RIG_ANCHOR_Y is a fraction of the stage,
    // so it lands on the manifest origin at any sprite size. Checked in
    // art-paths.test.ts, which pins both to the manifest rather than to numbers
    // written here.
    const stageOverCanvas = RIG_STAGE.width / CANVAS.width;
    sprite.anchor.set(RIG_ANCHOR_X, RIG_ANCHOR_Y);
    sprite.width = height * stageOverCanvas;
    sprite.height = height * stageOverCanvas;

    let destroyed = false;
    const drawnTexture = texture;

    return {
      sprite,
      tick(dtSeconds: number): void {
        if (destroyed) return;
        built.tick(dtSeconds);
      },
      setKnockedDown(down: boolean): void {
        if (!destroyed) built.setKnockedDown(down);
      },
      fire(trigger: string): void {
        if (!destroyed) built.fire(trigger);
      },
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        // The rig owns the C++ handles; this owns the GPU allocation. Both
        // released, in that order, exactly once.
        built.destroy();
        if (!sprite.destroyed) sprite.destroy();
        drawnTexture.destroy(true);
      },
    };
  } catch {
    // A texture that could not be made is a fallback, not a crash — and the
    // rig behind it has to come down with it or its handles leak.
    built.destroy();
    texture?.destroy(true);
    return null;
  }
}
