/**
 * Quiet mode (#260): the room is somewhere calm, a sleeping sibling, a car,
 * a late evening.
 *
 * The host turns it on for the room (`RunState.quiet`, set by a host control),
 * and every device applies it to itself:
 *
 *   - sound is capped at `QUIET_VOLUME_SCALE` of the device's own volume and
 *     the sudden cues are dropped (audio/cues.ts, `CUE_QUIET`)
 *   - the stage does not shake (`joltStrength`, world/shake.ts) and the
 *     victory bloom is a glow, not a flash
 *   - the display is dimmed, and the CSS flashes are still (styles/theme.css,
 *     keyed on `html[data-quiet]`)
 *
 * The room says whether it is quiet; this module is the one place a device
 * remembers it, so the audio engine, the stage and the stylesheet all read the
 * same answer. A device can still go lower on its own: the volume it keeps
 * (audio/engine.ts) is scaled, never replaced. Nothing here is stored: the
 * flag belongs to the room, so a device that leaves one goes back to normal
 * on its own.
 */

/** What is left of the device's own volume while the room is quiet. */
export const QUIET_VOLUME_SCALE = 0.4;

/** How much of the victory bloom's brightness a quiet room keeps. */
export const QUIET_FLASH_SCALE = 0.3;

let quiet = false;
const listeners = new Set<(quiet: boolean) => void>();

export function isQuiet(): boolean {
  return quiet;
}

/** Applies the room's flag to this device. Idempotent. */
export function setQuiet(next: boolean): void {
  if (next === quiet) return;
  quiet = next;
  if (typeof document !== "undefined") {
    if (next) document.documentElement.setAttribute("data-quiet", "");
    else document.documentElement.removeAttribute("data-quiet");
  }
  for (const listener of listeners) listener(next);
}

export function onQuietChange(listener: (quiet: boolean) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
