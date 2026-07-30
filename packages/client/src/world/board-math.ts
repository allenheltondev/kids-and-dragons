/**
 * The board renderer's pure arithmetic, apart from board.ts so it can be
 * tested without importing pixi.js (vitest runs in node; a WebGL renderer
 * does not). board.ts re-exports these — callers never notice the split.
 */

/** asset-brief §4.5 — the tile sheets are authored at this size. */
export const BOARD_TILE_PX = 128;

/**
 * Which of the sheet's four variants dresses tile (x, y). Deterministic on
 * purpose: this renders on every phone and the TV at once, and a floor that
 * shuffles per device (or per render) reads as a glitch, not texture.
 */
export function tileVariant(x: number, y: number): number {
  return Math.abs(x * 7 + y * 13 + x * y * 3) % 4;
}

/**
 * How far apart to space a sequence's beats so they fill — and never outrun —
 * the presentation hold the gate is enforcing (world/presentation.ts). A beat
 * scheduled past the hold would play after its own patch, which is the exact
 * bug the shared timing table exists to prevent; the `+ 1` keeps the last
 * beat strictly inside the hold.
 */
export function beatOffsetsMs(eventCount: number, totalMs: number): number[] {
  if (eventCount <= 0) return [];
  const step = Math.min(400, totalMs / (eventCount + 1));
  return Array.from({ length: eventCount }, (_, i) => step * (i + 1));
}
