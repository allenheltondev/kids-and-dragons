/**
 * The difference between the palette somebody asked for and the palette a rig
 * is actually wearing.
 *
 * A rig takes a moment to arrive — a dynamic import, two megabytes of wasm, a
 * megabyte of `.riv` — and colours can change while it is on its way. Both
 * surfaces that drive a rig hit the same race, and both got it wrong the same
 * way: they recorded "the palette is now Meadow" at the moment it was
 * *requested*, called `setPalette` on a handle that was still null, and then
 * installed a rig built with the colours from before. The record said applied,
 * nothing had been applied, and no later update ever disagreed — so the figure
 * kept the old mane until the player happened to tap a different swatch.
 *
 * So the two facts are kept apart here, in one place, deliberately small:
 * `request()` is what the player wants, `applyTo()` is the only thing that may
 * ever mark it done, and it can only mark it done by actually doing it. A null
 * handle is not a failure — it is "not yet", and the next `applyTo` (the one
 * the caller makes the instant the rig installs) settles it.
 *
 * Pixi-free and Rive-free on purpose: `screens/` imports this directly, and a
 * static import of `rive-rig.ts` would pull the runtime into the main bundle,
 * which is the whole reason that module is split from `rive-actor.ts`.
 */

import type { Appearance } from "@kad/shared";

/** The two slots a rig binds, as one comparable string. */
export function paletteKeyOf(appearance: Appearance): string {
  return [appearance.palette, appearance.accent].join("|");
}

/** Just enough of a rig to colour it — so tests can hand in a recorder. */
export interface PaletteTarget {
  setPalette(appearance: Appearance): void;
}

export interface PaletteLatch {
  /** Record what the player now wants. Applies nothing on its own. */
  request(appearance: Appearance): void;
  /**
   * Bind the wanted palette into `target`, if there is a target and it is not
   * already wearing it. Safe to call on every update and every install; it is
   * a no-op unless something would actually change.
   */
  applyTo(target: PaletteTarget | null | undefined): void;
  /** The palette actually bound right now, or null while nothing has been. */
  applied(): string | null;
  /** What the player last asked for, applied or not. */
  wanted(): Appearance;
}

export function createPaletteLatch(initial: Appearance): PaletteLatch {
  let want = initial;
  let appliedKey: string | null = null;

  return {
    request(appearance: Appearance): void {
      want = appearance;
    },
    applyTo(target: PaletteTarget | null | undefined): void {
      // No handle yet: leave `appliedKey` alone. Marking it here is exactly
      // the bug this module exists to make impossible.
      if (!target) return;
      const key = paletteKeyOf(want);
      if (key === appliedKey) return;
      target.setPalette(want);
      appliedKey = key;
    },
    applied(): string | null {
      return appliedKey;
    },
    wanted(): Appearance {
      return want;
    },
  };
}
