/**
 * A rigged character, drawn into a canvas — the seam art-pipeline.md §7 names,
 * with no renderer opinion of its own.
 *
 * Each rig owns an offscreen canvas and a Rive renderer; every tick the state
 * machine advances and the artboard draws into that canvas. What happens to
 * the canvas afterwards is the caller's business: `rive-actor.ts` uploads it
 * as a Pixi texture for the two stages, and `screens/RigFigure.tsx` puts it
 * straight in the DOM for the creation preview.
 *
 * **Nothing here imports Pixi, and that is the point.** `screens/` must never
 * drag the renderer into the main bundle (art-paths.ts says so, and WorldView
 * lazy-loads PixiStage precisely to avoid it), so the split is what lets the
 * creation flow show a real rigged figure without shipping Pixi to a phone
 * that is only picking colours.
 *
 * Three rules shape the module:
 *
 *   - **The rig is an upgrade, never a requirement.** `createRiveActor`
 *     resolves null for a species/tier with no `rig.riv`, a fetch that fails,
 *     a runtime that will not load, or a file missing the contract's artboard
 *     — and the caller keeps the PNG path it always had. Per-species rollout,
 *     no flag day, and an old cached bundle cannot blank the stage.
 *   - **The contract is the only vocabulary.** Everything fired at the state
 *     machine is a name from `assets/manifest.json`'s rigContract — the nine
 *     triggers, `knockedDown`, `facing`. Nothing here knows a clip name; clips
 *     are the rig's business.
 *   - **A rig wears the colours it was drawn in.** There used to be a runtime
 *     recolour here: the rigs expose `mane`/`accent` tint slots, and this
 *     module wrote the player's palette into them through a data-binding view
 *     model so two players who picked the same species could be told apart. A
 *     hue pushed onto authored shading flattens the detail the tier art exists
 *     for, and it was never going to read as commissioned. The figures are
 *     drawn as authored now and the name under their feet does the telling
 *     apart (`nameplate.ts`) — which also answers it for a player who cannot
 *     separate two hues in the first place (spec §11).
 *   - **Rive handles are C++ objects.** Everything this module *owns* is
 *     deleted in `destroy()`, exactly once — see the ownership audit below,
 *     which is against the installed `@rive-app/canvas-advanced` and not
 *     against a general intuition about wasm.
 *
 * ---------------------------------------------------------------------------
 * WHAT OWNS A C++ HANDLE, AND WHAT ONLY LOOKS LIKE ONE
 *
 * `rive_advanced.mjs.d.ts` is the authority, and it is blunt: a type either
 * declares `delete()` or it does not. Audited entry by entry, because "delete
 * everything that came out of wasm" over-deletes and "delete the obvious
 * three" under-deletes, and both are how a fight ends in a blank stage.
 *
 *   Owned, deleted here:
 *     `Artboard`            — `delete()`; one instance per actor
 *     `StateMachineInstance`— `delete()`; one per actor
 *     `Renderer`            — `delete()` (via `RendererWrapper`)
 *
 *   Not owned, deliberately not deleted:
 *     `SMIInput`            — no `delete()`. `asBool()` / `asTrigger()` return
 *                             `SMIInput` again: typed *views* on the same
 *                             object, not new allocations, so holding both the
 *                             untyped and the typed handle is one object and
 *                             deleting "both" would be deleting an alias.
 *     `File`                — no `delete()`, and cached for the session anyway
 *                             (three party members at one tier share one file,
 *                             and every artboard is instanced *from* it).
 *
 * `ViewModelInstance` used to be on the owned list — `defaultInstance()` hands
 * back a handle with `delete()` and its own refcount pair, and it *was* leaking
 * before the palette binding was audited. Nothing binds a view model now that
 * the recolour is gone, so the allocation is not made in the first place.
 *
 * Deletion order is consumers before the thing they read: machine, artboard,
 * then the renderer — so the last reference dropped is ours, and never a live
 * artboard pointing at a freed renderer.
 */

import RiveCanvas from "@rive-app/canvas-advanced";
import wasmUrl from "@rive-app/canvas-advanced/rive.wasm?url";
import type { SpeciesId, TierId } from "@kad/shared";
import { characterRigUrl } from "./art-paths";

// Re-exported so the Pixi wrapper takes its anchor from the same one source.
export { ANCHOR_Y } from "./art-paths";

/**
 * Offscreen buffer, in px. The spike measured 512 as the size where seven
 * concurrent uploads stayed cheap; the artboard is 1024 but a figure is drawn
 * at ~414 design units, so 512 loses nothing visible on a TV.
 */
export const BUFFER_PX = 512;

/** The artboard and state machine every generated rig names (rive-mcp `rig`). */
const ARTBOARD_NAME = "Rig";

/* eslint-disable @typescript-eslint/no-explicit-any -- the canvas-advanced
   runtime ships loose types for artboards/machines; the spike made the same
   call. The surface area is contained to this module. */

type RiveRuntime = Awaited<ReturnType<typeof RiveCanvas>>;

/** One runtime for the whole session; null once loading has failed. */
let runtimePromise: Promise<RiveRuntime | null> | null = null;

function runtime(): Promise<RiveRuntime | null> {
  runtimePromise ??= RiveCanvas({ locateFile: () => wasmUrl }).catch(() => null);
  return runtimePromise;
}

/**
 * Loaded rig files by URL. A promise, so three party members hitting the same
 * tier fetch it once — and a failure is cached too, because retrying a 404 on
 * every setParty would hammer the host for a file that is not there.
 */
const rigFiles = new Map<string, Promise<any | null>>();

function rigFile(url: string): Promise<any | null> {
  let file = rigFiles.get(url);
  if (!file) {
    file = (async () => {
      const rive = await runtime();
      if (!rive) return null;
      const response = await fetch(url);
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return (await rive.load(bytes)) ?? null;
    })().catch(() => null);
    rigFiles.set(url, file);
  }
  return file;
}

export interface RigHandle {
  /** The square buffer the rig draws into, `BUFFER_PX` on a side. */
  readonly canvas: HTMLCanvasElement;
  /** Advance the state machine and repaint the canvas. Call once per frame. */
  tick(dtSeconds: number): void;
  /** The contract's `knockedDown` boolean — the rig walks down/down_loop/revive itself. */
  setKnockedDown(down: boolean): void;
  /** Fire one of the contract's nine triggers by name. Unknown names are ignored. */
  fire(trigger: string): void;
  destroy(): void;
}

/**
 * A rigged figure drawing into its own canvas, or null when the caller's
 * fallback should carry on.
 */
export async function createRig(
  species: SpeciesId,
  tier: TierId,
  /** Called after every repaint — how the Pixi wrapper knows to re-upload. */
  onDrawn?: () => void,
): Promise<RigHandle | null> {
  const rive = await runtime();
  if (!rive) return null;
  const file = await rigFile(characterRigUrl(species, tier));
  if (!file) return null;

  let renderer: any = null;
  let artboard: any = null;
  let machine: any = null;
  /** Every owned handle, consumers first. One list, so the success path and
      the construction-failure path can never drift about what to release. */
  const release = (): void => {
    machine?.delete?.();
    artboard?.delete?.();
    renderer?.delete?.();
    machine = artboard = renderer = null;
  };
  try {
    artboard = file.artboardByName?.(ARTBOARD_NAME) ?? file.defaultArtboard();
    if (!artboard) return null;
    const smCount: number = artboard.stateMachineCount?.() ?? 0;
    if (smCount < 1) {
      artboard.delete?.();
      return null;
    }
    machine = new rive.StateMachineInstance(artboard.stateMachineByIndex(0), artboard);

    const canvas = document.createElement("canvas");
    canvas.width = BUFFER_PX;
    canvas.height = BUFFER_PX;
    renderer = rive.makeRenderer(canvas);

    /*
     * The contract's inputs, by name, already narrowed to their typed
     * handles. `machine.input(i)` is an untyped wrapper whose `.value` is
     * inert — the runtime wants `.asBool()` / `.asTrigger()` / `.asNumber()`
     * — and the type codes are the runtime's own (59 bool, 56 number,
     * anything else a trigger, the same reading rive-mcp's page script and
     * verify-rig.ts make). Read once: handles are stable for the machine's
     * lifetime.
     */
    const bools = new Map<string, any>();
    const triggers = new Map<string, any>();
    const inputCount: number = machine.inputCount();
    for (let i = 0; i < inputCount; i++) {
      const input = machine.input(i);
      if (input.type === 59) bools.set(input.name, input.asBool());
      else if (input.type === 56) continue; // `facing` — nothing drives it yet
      else triggers.set(input.name, input.asTrigger());
    }

    /*
     * No view model is bound. The rigs still carry `mane`/`accent` tint slots
     * from when the palette was written into them at runtime; nothing reads
     * them, so every figure draws in the colours it was authored in — which is
     * the point, and is also what a rig built without those slots always did.
     */

    let destroyed = false;
    /*
     * The handles the closures below use. `release()` owns the mutable
     * references above so a construction failure can null them; the live
     * actor holds its own consts, so `tick` and `draw` never re-check a
     * handle they were built with — and nothing they touch can be nulled out
     * from under them while `destroyed` is false.
     */
    const drawnRenderer = renderer;
    const drawnArtboard = artboard;
    const drawnMachine = machine;

    const draw = (): void => {
      drawnRenderer.clear();
      drawnRenderer.save();
      drawnRenderer.align(
        rive.Fit.contain,
        rive.Alignment.center,
        { minX: 0, minY: 0, maxX: BUFFER_PX, maxY: BUFFER_PX },
        drawnArtboard.bounds,
      );
      drawnArtboard.draw(drawnRenderer);
      drawnRenderer.restore();
      // Canvas2D commands are queued; this executes them. Per-actor rather
      // than batched per frame — at a lineup's three figures the difference
      // is noise, and the board pass owns the batching optimisation.
      rive.resolveAnimationFrame();
      onDrawn?.();
    };

    return {
      canvas,
      tick(dtSeconds: number): void {
        if (destroyed) return;
        drawnMachine.advance(dtSeconds);
        drawnArtboard.advance(dtSeconds);
        draw();
      },
      setKnockedDown(down: boolean): void {
        if (destroyed) return;
        const input = bools.get("knockedDown");
        if (input && input.value !== down) input.value = down;
      },
      fire(trigger: string): void {
        if (destroyed) return;
        triggers.get(trigger)?.fire();
      },
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        release();
        /*
         * And take the canvas out of whatever it was put into. A DOM caller
         * appends this element itself (screens/RigFigure.tsx), and a rig
         * replaced in place — a tier crossing, which is the one thing this
         * chapter is *about* — would otherwise leave the dead canvas stacked
         * under its replacement, still sized, still in the layout. Harmless
         * for the Pixi callers, whose sprite owns the canvas instead, and
         * cheaper than asking every caller to remember.
         */
        canvas.remove();
      },
    };
  } catch {
    // A rig the runtime cannot walk is a fallback, not a crash — the same
    // posture verify-rig takes, minus the red build, because at the table
    // the PNG is standing right there. The same `release()` the success path
    // uses, so a throw between the texture and the return cannot leave a
    // handle behind either.
    release();
    return null;
  }
}
