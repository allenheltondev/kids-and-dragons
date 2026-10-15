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

import { Graphics, type Texture } from "pixi.js";
import { ANCHOR_X, ANCHOR_Y } from "./art-paths";

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

/**
 * Where a figure actually touches the ground inside its canvas, as fractions
 * of the canvas height measured from the anchor. The contract puts the ground
 * line at y = 900, and the art keeps to it, but nothing puts the *feet* at
 * x = 512: an old man leaning on a stick stands left of centre, a gem buyer
 * hunched over a sack stands well right of it. A shadow drawn at the anchor
 * lands beside such a figure, and a figure beside its shadow is floating.
 *
 * `x` is the middle of the painted pixels along the bottom of the figure;
 * `halfWidth` their half-span. `y` is the average height of the lowest pixel
 * in each of those columns — in a three-quarter view the far feet stand
 * higher than the near ones, and the shadow belongs among all of them, not in
 * front of the nearest. `lift` is how far the lowest pixel sits above the
 * ground line — 0 for anything standing, more for a cloud whale.
 */
export interface Footprint {
  x: number;
  y: number;
  halfWidth: number;
  lift: number;
}

/** How much of the figure counts as "the feet", from its lowest pixel up:
    deep enough to take in a quadruped's far hooves. */
const FOOT_BAND = 0.08;
/** Resolution the alpha is sampled at — 4 canvas pixels a cell at 1024. */
const FOOT_SAMPLE = 256;

const footprints = new WeakMap<object, Footprint | null>();

/**
 * Measured once per texture from a small copy of its alpha. Null when it
 * cannot be measured (no DOM canvas, a tainted image, an empty canvas), and
 * the caller falls back to a shadow centred on the anchor.
 */
export function measureFootprint(texture: Texture): Footprint | null {
  const source = texture.source?.resource as CanvasImageSource | undefined;
  if (!source || typeof document === "undefined") return null;
  const known = footprints.get(source as object);
  if (known !== undefined) return known;
  let found: Footprint | null = null;
  try {
    const size = FOOT_SAMPLE;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.drawImage(source, 0, 0, size, size);
      const alpha = ctx.getImageData(0, 0, size, size).data;
      const solid = (x: number, y: number): boolean => (alpha[(y * size + x) * 4 + 3] ?? 0) > 64;
      let bottom = -1;
      for (let y = size - 1; y >= 0 && bottom < 0; y--) {
        for (let x = 0; x < size; x++) {
          if (solid(x, y)) {
            bottom = y;
            break;
          }
        }
      }
      if (bottom >= 0) {
        const top = Math.max(0, bottom - Math.ceil(FOOT_BAND * size));
        let left = size;
        let right = -1;
        let lowSum = 0;
        let columns = 0;
        for (let x = 0; x < size; x++) {
          for (let y = bottom; y >= top; y--) {
            if (solid(x, y)) {
              left = Math.min(left, x);
              right = Math.max(right, x);
              lowSum += y + 1;
              columns += 1;
              break;
            }
          }
        }
        // Canvases are square, so a fraction of the width is one of the height.
        found = {
          x: (left + right + 1) / 2 / size - ANCHOR_X,
          y: lowSum / columns / size - ANCHOR_Y,
          halfWidth: (right + 1 - left) / 2 / size,
          lift: Math.max(0, ANCHOR_Y - (bottom + 1) / size),
        };
      }
    }
  } catch {
    found = null;
  }
  footprints.set(source as object, found);
  return found;
}

/**
 * The soft dark patch under a figure `height` pixels tall (its canvas height
 * on screen), drawn around its own origin so the caller can slide it under
 * the feet. Three stacked ellipses rather than a blur filter: a darker core
 * right where the feet press down is what reads as contact, and the wider,
 * fainter rings soften the edge without a filter pass on the TV.
 *
 * `squash` is the ellipse's depth over its width — the camera's angle on the
 * ground. Unknown art gets a modest shadow centred on the anchor.
 */
export function drawContactShadow(
  height: number,
  footprint: Footprint | null,
  squash: number,
  strength = 1,
): Graphics {
  const g = new Graphics();
  const halfWidth = Math.min(
    0.32 * height,
    Math.max(0.07 * height, (footprint?.halfWidth ?? 0.16) * height * 1.05),
  );
  // Off the ground, the shadow stays on the ground line and fades and
  // tightens with the height of the hover. On it, it sits among the feet.
  const lift = footprint?.lift ?? 0;
  const airborne = Math.max(0.3, 1 - lift * 4);
  const centreY = lift > 0.02 ? 0 : Math.min(0, Math.max(-0.06, footprint?.y ?? 0)) * height;
  const alpha = strength * airborne;
  const rings: [number, number][] = [
    [1.25, 0.16],
    [1.0, 0.2],
    [0.65, 0.3],
  ];
  for (const [spread, a] of rings) {
    const rx = halfWidth * spread * (0.6 + 0.4 * airborne);
    g.ellipse(0, centreY, rx, rx * squash).fill({ color: 0x0b0a14, alpha: a * alpha });
  }
  return g;
}

/**
 * How much a contact shadow tightens per unit of breath — the fraction a
 * figure is stretched up from its feet. At the top of an idle breath (~0.018)
 * the shadow is about 7% smaller, which reads as the body lifting off the
 * ground a little without the feet ever leaving it.
 */
const SHADOW_BREATH = 4;

/** The scale for a contact shadow under a figure breathing `breath` (see
    `SHADOW_BREATH`). A breath below rest — the lineup's exhale — spreads it a
    touch; anything past a deep breath either way is held there. */
export function breathingShadowScale(breath: number): number {
  return 1 - Math.max(-0.05, Math.min(0.05, breath)) * SHADOW_BREATH;
}

/** Where under the anchor a shadow for `footprint` goes, in pixels for a
    figure whose canvas is `height` tall on screen. */
export function shadowOffset(height: number, footprint: Footprint | null): number {
  return (footprint?.x ?? 0) * height;
}
