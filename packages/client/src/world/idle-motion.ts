import type { CastStance } from "@kad/shared";

/** A gentle six-second breath around the figure's fixed ground anchor. */
export function idleBreath(seconds: number, phase: number, still = false): number {
  return still ? 0 : (1 - Math.cos(seconds * Math.PI / 3 + phase)) * 0.004;
}

/**
 * One frame of a figure's idle, by stance (#362). Offsets are fractions of
 * the figure's drawn height (`dy` negative is up); the caller multiplies.
 *
 * - standing: today's breath, a stretch about the feet, and nothing else.
 * - hovering: a slow bob, the body only, so the shadow under it stays put
 *   and tightens as the figure rises.
 * - flying: a longer drift up and down, a sideways sway and a little tilt,
 *   on three periods that never quite line up, so it reads as air and not a
 *   loop.
 * - swimming: a small rise and fall against the water line, a slower tilt,
 *   and the ripple at the water line breathing with it.
 *
 * `still` (reduced motion) flattens all of it: nothing moves, the shadow and
 * the ripple sit at rest.
 */
export interface StanceIdle {
  dx: number;
  dy: number;
  rotation: number;
  /** The breath's vertical stretch (standing only). */
  breath: number;
  /** Multiplier on the shadow under the figure. */
  shadow: number;
  /** Multiplier on the ripple's width (swimming only). */
  ripple: number;
}

const REST: StanceIdle = { dx: 0, dy: 0, rotation: 0, breath: 0, shadow: 1, ripple: 1 };

/** How far each stance's idle travels at its peak, as a fraction of height. */
export const HOVER_BOB = 0.035;
export const FLY_DRIFT = 0.05;
export const FLY_SWAY = 0.03;
export const FLY_TILT = 0.035;
export const SWIM_BOB = 0.012;
export const SWIM_TILT = 0.02;

export function stanceIdle(stance: CastStance, seconds: number, phase: number, still = false): StanceIdle {
  if (still) return REST;
  const wave = (period: number, offset = 0) => Math.sin((seconds * 2 * Math.PI) / period + phase + offset);
  switch (stance) {
    case "hovering": {
      const up = (1 - Math.cos((seconds * 2 * Math.PI) / 3 + phase)) / 2;
      return { ...REST, dy: -HOVER_BOB * up, shadow: 1 - 0.2 * up };
    }
    case "flying": {
      const up = (wave(5) + 1) / 2;
      return { ...REST, dy: -FLY_DRIFT * up, dx: FLY_SWAY * wave(7, 1), rotation: FLY_TILT * wave(5, 1.6), shadow: 1 - 0.25 * up };
    }
    case "swimming":
      return { ...REST, dy: SWIM_BOB * wave(4), rotation: SWIM_TILT * wave(6, 0.8), ripple: 1 + 0.08 * wave(2.5, 0.4) };
    default: {
      const breath = idleBreath(seconds, phase);
      return { ...REST, breath };
    }
  }
}
