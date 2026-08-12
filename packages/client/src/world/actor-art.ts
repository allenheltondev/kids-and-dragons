/**
 * The bits of actor drawing that both stages share.
 *
 * Two things draw creatures: the story lineup (scene.ts) and the combat board
 * (board.ts). They agree on where art lives, where a figure's feet are inside
 * its canvas, what "art pending" looks like, and how motion is smoothed —
 * because a unicorn that stands differently in a fight than in a scene reads
 * as two different unicorns. This module is that agreement, extracted so
 * neither stage imports the other.
 *
 * Art conventions come from assets/manifest.json, which is the contract the
 * verifier enforces: a 1024×1024 canvas with the character's ground contact at
 * (512, 900). That origin is why the sprite anchor is 0.5 / 0.879 rather than
 * centred — actors are positioned by where their feet touch the floor, so a
 * Mythic unicorn and a Fledgling one stand on the same line.
 *
 * The canvas constants and the URL helpers themselves live in `art-paths.ts`,
 * which imports no Pixi: `screens/` draws the same art as `<img>` and must not
 * pull the renderer into the main bundle. They are re-exported here so the two
 * stages keep importing one module.
 */

import { Graphics } from "pixi.js";

export {
  ANCHOR_X,
  ANCHOR_Y,
  CANVAS,
  STARTING_TIER,
  biomeBackdropUrl,
  biomeTilesUrl,
  characterArtUrl,
  characterWorldArtUrl,
  enemyArtUrl,
} from "./art-paths";

/**
 * Move `current` toward `target` by a fixed *rate* rather than a fixed
 * per-frame fraction: `1 - e^(-rate·dt)` is the frame-rate-independent form of
 * "close X% of the gap each frame".
 */
export function approach(current: number, target: number, rate: number, dtSeconds: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dtSeconds));
}

/*
 * Smoothing rates for `approach`, in 1/seconds. Each is derived from the
 * per-60fps-frame fraction the scene was tuned with
 * (rate = -ln(1 - fraction) × 60), so the feel at 60fps is unchanged — but a
 * 30fps mini-PC and a 120Hz phone converge at the same speed instead of half
 * and double it.
 */
export const CAMERA_RATE = 7.7; // was 0.12/frame
export const DOWN_RATE = 11.9; // was 0.18/frame
export const BOB_RATE = 13.4; // was 0.2/frame
export const FADE_RATE = 9.8; // was 0.15/frame
/** Walking pace for a figure whose tile changed — fast enough to read as a
    step, slow enough to read as movement rather than teleportation. */
export const WALK_RATE = 9.0;

/** spec §7.3 — the fallen pose. Shared so "knocked down" looks the same on
    the story lineup and on the grid. */
export const FALLEN_ROTATION = -1.25;
export const FALLEN_ALPHA = 0.75;

/**
 * A silhouette that reads as "art pending" at a glance — hatched fill, dashed
 * outline. Anything that fails to load gets this rather than a broken image:
 * a placeholder that looks like a placeholder is a to-do, a broken image is a
 * bug report.
 */
export function drawPlaceholder(height: number): Graphics {
  const g = new Graphics();
  const w = height * 0.52;
  const h = height;

  g.roundRect(-w / 2, -h, w, h * 0.62, w * 0.3).fill({ color: 0x2b2a45 });
  g.circle(0, -h * 0.78, w * 0.34).fill({ color: 0x2b2a45 });
  g.roundRect(-w * 0.3, -h * 0.38, w * 0.22, h * 0.38, w * 0.1).fill({ color: 0x2b2a45 });
  g.roundRect(w * 0.08, -h * 0.38, w * 0.22, h * 0.38, w * 0.1).fill({ color: 0x2b2a45 });

  for (let i = 0; i < 7; i += 1) {
    const y = -h + (h / 7) * i;
    g.moveTo(-w / 2, y).lineTo(w / 2, y - h / 14).stroke({ width: 2, color: 0x6c7ab0, alpha: 0.35 });
  }

  g.roundRect(-w / 2, -h, w, h, w * 0.2).stroke({
    width: 3,
    color: 0x8b6cf5,
    alpha: 0.75,
  });

  return g;
}
