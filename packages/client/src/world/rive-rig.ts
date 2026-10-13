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
 * that is only picking colors.
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
 *   - **A rig wears the colours it was drawn in — unless asked not to.**
 *     There used to be a runtime recolour here that wrote one flat hue into
 *     the rigs' `mane`/`accent` tint slots, and it flattened the shading the
 *     tier art exists for. Those slots stay unbound. The one exception is
 *     creation, where the player is choosing a look and must see it: a rig
 *     made `recolorable` loads its own copy of the file and `setLook` swaps
 *     its part images for repainted ones (rig-look.ts), which keep every
 *     pixel's shading and move only the hues the palette says belong to the
 *     slot. Telling two players apart is still the nameplate's job
 *     (`nameplate.ts`), which also answers it for a player who cannot
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
import type { ClassId, SpeciesId, TierId } from "@kad/shared";
import { characterRigUrl } from "./art-paths";
import { partLookKey } from "./rig-look";
import { forgetPart, paintPartPng, warmPart } from "./rig-look-pool";
import type { RigLook } from "./rig-look";

// Re-exported so the Pixi wrapper takes its anchor from the same one source.
// The *rig* anchor, not the static-art one: a rig is drawn on the 1400 stage and
// stands at 1088/1400, where `assembled.png` is 1024 art standing at 900/1024.
// This module re-exported ANCHOR_Y until the stage grew, which was correct only
// while the two were the same number (art-paths, art-pipeline §6.3).
export { RIG_ANCHOR_X, RIG_ANCHOR_Y } from "./art-paths";

/**
 * Offscreen buffer, in px. The spike measured 512 as the size where seven
 * concurrent uploads stayed cheap; the artboard was 1024 and a figure is drawn
 * at ~414 design units, so 512 lost nothing visible on a TV.
 *
 * The artboard is 1400 now (art-pipeline §6.3), so the figure occupies 1024/1400
 * of the texture and 512 buys ~375px of character where it used to buy 512.
 * Matching the old sharpness means ~700, at ~1.9x the upload bytes — and the
 * spike has never been re-run at either the new stage or on the TV, which is the
 * only machine that decides it. Left at 512 deliberately: a number nobody has
 * measured is not an improvement on a number somebody did.
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
  /**
   * Repaint the figure's parts for a chosen look (rig-look.ts). Only present
   * on a rig created with `{ recolorable: true }`, which owns its own file —
   * an image swapped on a shared file would repaint every figure built from it.
   */
  setLook?: (look: RigLook) => Promise<void>;
  destroy(): void;
}

/** One embedded part image: the runtime's handle, and the bytes it came from. */
interface PartImage {
  /** Unique per loaded file, so the paint pool's decoded copies never mix. */
  id: string;
  name: string;
  asset: any;
  bytes: Uint8Array;
  /** The `partLookKey` this part currently shows; "" is as painted. */
  shown: string;
  /** Encoded repaints by `partLookKey`, so a choice tapped twice is free. Bounded. */
  cache: Map<string, Uint8Array>;
}

let nextPartFile = 1;

/** Repaints kept per part: enough to tap back and forth without a wait. */
const PART_CACHE_SIZE = 8;

/**
 * A rig file of its own, with every embedded image captured on the way in.
 * Not cached: the images in it are about to be swapped for one player's look.
 */
async function recolorableRigFile(url: string): Promise<{ file: any; parts: PartImage[] } | null> {
  try {
    const rive = await runtime();
    if (!rive) return null;
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const parts: PartImage[] = [];
    const loader = new rive.CustomFileAssetLoader({
      loadContents: (asset: any, inBand: Uint8Array): boolean => {
        if (asset.isImage && inBand && inBand.length > 0) {
          // Copied: the view points into wasm memory, which the next
          // allocation is free to move.
          parts.push({
            id: `part-${String(nextPartFile)}-${String(parts.length)}`,
            name: String(asset.name).replace(/\.[a-z]+$/i, ""),
            asset,
            bytes: inBand.slice(),
            shown: "",
            cache: new Map(),
          });
        }
        // Not handled — the runtime decodes the embedded image as it always
        // does, so the rig draws as painted until a look is set.
        return false;
      },
    });
    nextPartFile += 1;
    const file = await rive.load(bytes, loader);
    return file ? { file, parts } : null;
  } catch {
    return null;
  }
}

function decodeRiveImage(rive: RiveRuntime, bytes: Uint8Array): Promise<any | null> {
  return new Promise((resolve) => {
    try {
      rive.decodeImage(bytes, (image: any) => resolve(image ?? null));
    } catch {
      resolve(null);
    }
  });
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
  /** Selects an exact manifest.rigVariants build when one is delivered. */
  characterClass?: ClassId,
  /** `recolorable`: load a private copy of the file so `setLook` can repaint it. */
  options: { recolorable?: boolean } = {},
): Promise<RigHandle | null> {
  const rive = await runtime();
  if (!rive) return null;
  const url = characterRigUrl(species, tier, characterClass);
  const own = options.recolorable ? await recolorableRigFile(url) : null;
  const file = own ? own.file : await rigFile(url);
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

    /*
     * Per part: the look it currently shows, and the most recent request.
     * Taps arrive faster than a repaint finishes, so a repaint that is no
     * longer the latest request throws its work away rather than landing a
     * stale color over a newer one. Each part is keyed on only what it
     * depends on (`partLookKey`), so a tap repaints the parts it changes and
     * nothing else, and a choice tapped before comes back from the cache.
     */
    let request = 0;
    const setLook = own
      ? async (look: RigLook): Promise<void> => {
          const mine = ++request;
          const stale = (): boolean => destroyed || mine !== request;
          const changed = own.parts.filter((part) => part.shown !== partLookKey(part.name, look));
          if (changed.length === 0) return;
          const results = await Promise.all(
            changed.map(async (part) => {
              const key = partLookKey(part.name, look);
              // "As painted" restores the original bytes rather than a
              // repaint that changes nothing — exactly the art.
              let png: Uint8Array | null = key === "" ? part.bytes : part.cache.get(key) ?? null;
              if (png && key !== "") {
                // Most recently used last, so the oldest is first to go.
                part.cache.delete(key);
                part.cache.set(key, png);
              }
              if (!png) {
                png = await paintPartPng(part.id, part.name, part.bytes, look);
                if (!png || stale()) return null;
                part.cache.set(key, png);
                const oldest = part.cache.keys().next().value;
                if (part.cache.size > PART_CACHE_SIZE && oldest !== undefined) part.cache.delete(oldest);
              }
              const image = await decodeRiveImage(rive, png);
              return image ? { part, key, image } : null;
            }),
          );
          if (stale()) {
            for (const result of results) result?.image.unref?.();
            return;
          }
          // All parts land together, so no frame shows a half-painted figure.
          for (const result of results) {
            if (!result) continue;
            result.part.asset.setRenderImage(result.image);
            // The asset holds its own reference now.
            result.image.unref?.();
            result.part.shown = result.key;
          }
        }
      : undefined;

    // Decode every part as soon as the figure is standing, so the first tap
    // only has to paint — the decode is most of a first repaint's wait.
    if (own) {
      for (const part of own.parts) warmPart(part.id, part.bytes);
    }

    return {
      canvas,
      ...(setLook ? { setLook } : {}),
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
        for (const part of own?.parts ?? []) forgetPart(part.id);
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
