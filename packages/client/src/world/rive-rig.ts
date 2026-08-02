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
 *     triggers, `knockedDown`, `facing` — and the palette is driven through
 *     the data-binding colors the rigs expose (`mane`, `accent`), which is
 *     the chapter-1 "palette slots wired to Rive color properties" item.
 *     Nothing here knows a clip name; clips are the rig's business.
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
 *     `ViewModelInstance`   — `delete()`, plus its own refcount pair. Returned
 *                             by `defaultInstance()`, so the palette binding
 *                             hands us an owned handle. This one *was* leaking.
 *
 *   Not owned, deliberately not deleted:
 *     `SMIInput`            — no `delete()`. `asBool()` / `asTrigger()` return
 *                             `SMIInput` again: typed *views* on the same
 *                             object, not new allocations, so holding both the
 *                             untyped and the typed handle is one object and
 *                             deleting "both" would be deleting an alias.
 *     `ViewModelInstanceValue` (and `…Color`) — no `delete()`. `instance.color(slot)`
 *                             is a property view; it dies with its instance.
 *     `ViewModel`           — no `delete()`.
 *     `File`                — no `delete()`, and cached for the session anyway
 *                             (three party members at one tier share one file,
 *                             and every artboard is instanced *from* it).
 *
 * Deletion order is consumers before the thing they read: machine, artboard,
 * then the view-model instance those two were bound to, then the renderer. So
 * the last reference dropped is ours, whatever the binding did to the
 * refcount — never a live artboard pointing at a freed instance.
 */

import RiveCanvas from "@rive-app/canvas-advanced";
import wasmUrl from "@rive-app/canvas-advanced/rive.wasm?url";
import type { Appearance, SpeciesId, TierId } from "@kad/shared";
import { characterRigUrl } from "./art-paths";

// Re-exported so the Pixi wrapper takes its anchor from the same one source.
export { ANCHOR_Y } from "./art-paths";
import { PALETTES } from "../screens/creationContent";

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

/**
 * The view-model colors for an appearance, in the rigs' slot vocabulary.
 * Exported for tests: this mapping is the one pure decision in the module.
 *
 * The mane comes from the named palette the player picked at creation
 * (creationContent PALETTES — "Orchid" is a mane hue first); the accent is
 * already a hex on the appearance. Unknown palette names return no mane
 * rather than a guess, which leaves the rig's authored color standing.
 *
 * Two things it deliberately does not answer:
 *
 *   - **`coat` is not a slot.** The manifest's `paletteRule` names one, but a
 *     coat tint traced from a flattened body layer takes the markings with it
 *     (rive-mcp's rigging playbook §2 says so in as many words), and the rule
 *     gives markings their own saturation. So the coat is the authored art's,
 *     and the creation swatches lead with the mane to say so.
 *   - **Two species have no `accent` surface.** `paletteRule` puts the accent
 *     "on the signature part only"; bigfoot's signature *is* its mane (one
 *     part cannot carry both), and the manticore's is a bone-meshed tail,
 *     where a tint slot stays rigid and would visibly detach mid-strike. Both
 *     are recorded in their rig configs and enforced by rig-configs.test.ts.
 *     Returning `accent` regardless is correct and cheap: a slot the rig does
 *     not expose optional-chains away, and the accent still colors this
 *     player's UI chrome (SignInFlow) either way.
 */
export function paletteColorsFor(
  appearance: Appearance,
): { mane?: string; accent?: string } {
  const mane = PALETTES.find((p) => p.id === appearance.palette)?.mane;
  const accent = /^#[0-9a-fA-F]{6}$/.test(appearance.accent) ? appearance.accent : undefined;
  return { ...(mane ? { mane } : {}), ...(accent ? { accent } : {}) };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
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
  /**
   * Re-bind the palette on a live rig.
   *
   * Colours are data bindings, not baked frames, so a recolour is a write —
   * not a reload. That matters most where the palette changes fastest: the
   * creation flow repaints on every tap, and rebuilding a megabyte of rig per
   * tap would make picking a colour feel like waiting for one.
   */
  setPalette(appearance: Appearance): void;
  destroy(): void;
}

/**
 * A rigged figure drawing into its own canvas, or null when the caller's
 * fallback should carry on.
 */
export async function createRig(
  species: SpeciesId,
  tier: TierId,
  appearance?: Appearance,
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
  /** The palette binding's owned handle — see the ownership audit. */
  let vmInstance: any = null;
  /** Every owned handle, consumers first. One list, so the success path and
      the construction-failure path can never drift about what to release. */
  const release = (): void => {
    machine?.delete?.();
    artboard?.delete?.();
    vmInstance?.delete?.();
    renderer?.delete?.();
    machine = artboard = vmInstance = renderer = null;
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
     * Palette, via the data-binding view model the rigs expose. Wrapped
     * whole: an older runtime without view-model bindings, or a rig built
     * without tint slots, degrades to the authored colors — recoloring is
     * cosmetic and must never cost anybody the character.
     */
    try {
      const vm = file.defaultArtboardViewModel?.(artboard) ?? file.viewModelByName?.("Palette");
      const instance = vm?.defaultInstance?.();
      if (instance) {
        // Kept for the rig's lifetime, not just for this block: the bound
        // instance is what the fills read on every advance, and dropping it
        // here would either free it under the artboard or leak it. It is
        // released in `release()` with everything else.
        vmInstance = instance;
        artboard.bindViewModelInstance?.(instance);
        machine.bindViewModelInstance?.(instance);
      }
    } catch {
      /* authored colors stand */
    }

    /**
     * Write the palette into the bound instance. Separate from the binding
     * above so `setPalette` can call it again on a live rig — the binding is
     * made once, the colours are written as often as somebody taps.
     */
    const applyPalette = (next: Appearance): void => {
      if (!vmInstance) return;
      try {
        for (const [slot, hex] of Object.entries(paletteColorsFor(next))) {
          const { r, g, b } = hexToRgb(hex);
          // A slot the rig does not expose optional-chains away. Two species
          // have no `accent` surface on purpose — see paletteColorsFor.
          vmInstance.color?.(slot)?.rgb?.(r, g, b);
        }
      } catch {
        /* authored colors stand */
      }
    };
    if (appearance) applyPalette(appearance);

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
      setPalette(next: Appearance): void {
        if (destroyed) return;
        applyPalette(next);
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
