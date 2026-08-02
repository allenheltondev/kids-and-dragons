/**
 * A Rive-backed figure for the Pixi stage — the seam art-pipeline.md §7 names,
 * as production code.
 *
 * scene.ts has always said its static PNGs and sine waves are "a deliberate
 * placeholder, not a design", and that `setParty`, the knocked-down state and
 * `focusCamera` are the seams a Rive-backed actor drops into. This is that
 * actor. Each figure owns an offscreen canvas and a Rive renderer; every tick
 * the state machine advances, the artboard draws into the canvas, and the
 * canvas is uploaded as the sprite's texture — the spike's architecture
 * (spike/rive-pixi.ts), with its measured 512px buffer, minus the measurement
 * harness.
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
 *   - **Rive handles are C++ objects.** Everything created is deleted in
 *     `destroy()`, in reverse order, exactly once. The loaded *files* are
 *     cached for the session (three party members at the same tier share
 *     one), which is why file handles are deliberately not deleted here.
 */

import { Sprite, Texture } from "pixi.js";
import RiveCanvas from "@rive-app/canvas-advanced";
import wasmUrl from "@rive-app/canvas-advanced/rive.wasm?url";
import type { Appearance, SpeciesId, TierId } from "@kad/shared";
import { characterRigUrl } from "./art-paths";
import { PALETTES } from "../screens/creationContent";

/**
 * Offscreen buffer, in px. The spike measured 512 as the size where seven
 * concurrent uploads stayed cheap; the artboard is 1024 but a figure is drawn
 * at ~414 design units, so 512 loses nothing visible on a TV.
 */
const BUFFER_PX = 512;

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
  appearance?: Appearance,
): Promise<RiveActorHandle | null> {
  const rive = await runtime();
  if (!rive) return null;
  const file = await rigFile(characterRigUrl(species, tier));
  if (!file) return null;

  let renderer: any = null;
  let artboard: any = null;
  let machine: any = null;
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
    if (appearance) {
      try {
        const vm = file.defaultArtboardViewModel?.(artboard) ?? file.viewModelByName?.("Palette");
        const instance = vm?.defaultInstance?.();
        if (instance) {
          artboard.bindViewModelInstance?.(instance);
          machine.bindViewModelInstance?.(instance);
          const colors = paletteColorsFor(appearance);
          for (const [slot, hex] of Object.entries(colors)) {
            const { r, g, b } = hexToRgb(hex);
            instance.color?.(slot)?.rgb?.(r, g, b);
          }
        }
      } catch {
        /* authored colors stand */
      }
    }

    const texture = Texture.from(canvas);
    const sprite = new Sprite(texture);
    // The artboard is the manifest's 1024 canvas drawn contain-fit into a
    // square buffer — an exact fill — so the feet sit at originY/height of
    // the buffer exactly as they do in the PNGs (art-paths ANCHOR_*).
    sprite.anchor.set(0.5, 900 / 1024);
    sprite.width = height;
    sprite.height = height;

    let destroyed = false;

    const draw = (): void => {
      renderer.clear();
      renderer.save();
      renderer.align(
        rive.Fit.contain,
        rive.Alignment.center,
        { minX: 0, minY: 0, maxX: BUFFER_PX, maxY: BUFFER_PX },
        artboard.bounds,
      );
      artboard.draw(renderer);
      renderer.restore();
      // Canvas2D commands are queued; this executes them. Per-actor rather
      // than batched per frame — at a lineup's three figures the difference
      // is noise, and the board pass owns the batching optimisation.
      rive.resolveAnimationFrame();
      texture.source.update();
    };

    return {
      sprite,
      tick(dtSeconds: number): void {
        if (destroyed) return;
        machine.advance(dtSeconds);
        artboard.advance(dtSeconds);
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
        machine?.delete?.();
        artboard?.delete?.();
        renderer?.delete?.();
        if (!sprite.destroyed) sprite.destroy();
        texture.destroy(true);
      },
    };
  } catch {
    // A rig the runtime cannot walk is a fallback, not a crash — the same
    // posture verify-rig takes, minus the red build, because at the table
    // the PNG is standing right there.
    machine?.delete?.();
    artboard?.delete?.();
    renderer?.delete?.();
    return null;
  }
}
