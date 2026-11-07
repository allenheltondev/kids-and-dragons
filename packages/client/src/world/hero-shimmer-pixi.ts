/**
 * A shimmer coat's sweep on a Pixi stage (docs/hero-looks.md §5.5; #669): a
 * soft band of light that slides across her every few seconds, laid over her
 * sprite as a child and masked by her coat mask (a sprite mask reads the red
 * channel, so the greyscale mask works as painted: white is coloured), so it
 * lights only her coloured part. The tinter is not involved: the band is
 * drawn over whatever texture the sprite shows, as painted or tinted.
 *
 * Under reduced motion it is a still sheen: the band rests across her middle
 * and the ticker is never asked for. The timing is hero-art.ts `SHIMMER`,
 * which the DOM's keyframes keep to as well.
 *
 * Built from `Texture.WHITE` alone (five strips of stepped strength make the
 * soft band), so it needs no canvas and no art.
 */

import { Container, Sprite, Texture, Ticker } from "pixi.js";
import { SHIMMER, shimmerAt } from "./hero-art";

export interface ShimmerLayer {
  /** The layer, a child of her sprite. */
  readonly view: Container;
  /** Move the band to where it is at `t` ms (the ticker does this; tests call it). */
  at(t: number): void;
  destroy(): void;
}

/** What moves the band: Pixi's `Ticker`, as far as it is used. */
export interface ShimmerTicker {
  add(fn: () => void): unknown;
  remove(fn: () => void): unknown;
}

export interface ShimmerOptions {
  /** A still sheen, no sweep (reduced motion). */
  still?: boolean;
  /** The ticker that moves it; Pixi's shared one unless a test says otherwise. */
  ticker?: ShimmerTicker | null;
  now?: () => number;
}

/** The band's strips, left to right: strength of each, as a share of the band. */
const STRIPS = [0.12, 0.25, 0.42, 0.25, 0.12];
/** How bright the band is at most, over her colour. */
const STRENGTH = 0.55;
/** A still sheen is quieter than a passing sweep. */
const STILL_STRENGTH = 0.35;

/**
 * Lay a shimmer over `sprite`, masked by `mask` (her coat mask's texture, on
 * the same canvas as her painting). Returns the layer; `destroy` takes it off.
 */
export function shimmerLayer(sprite: Sprite, mask: Texture, { still = false, ticker = Ticker.shared, now = () => performance.now() }: ShimmerOptions = {}): ShimmerLayer {
  const view = new Container();
  view.label = "hero-shimmer";
  const clip = new Sprite(mask);
  const band = new Container();
  const strips = STRIPS.map((alpha) => {
    const strip = new Sprite(Texture.WHITE);
    strip.alpha = alpha * (still ? STILL_STRENGTH : STRENGTH) * (1 / Math.max(...STRIPS));
    strip.blendMode = "add";
    band.addChild(strip);
    return strip;
  });
  view.addChild(clip, band);
  view.mask = clip;
  sprite.addChild(view);

  const at = (t: number): void => {
    const texture = sprite.texture;
    const w = texture.width;
    const h = texture.height;
    // On her sprite's own canvas: its anchor is where 0,0 is.
    const left = -sprite.anchor.x * w;
    const top = -sprite.anchor.y * h;
    clip.anchor.set(sprite.anchor.x, sprite.anchor.y);
    clip.width = w;
    clip.height = h;
    const x = shimmerAt(t, still);
    band.visible = x !== null;
    if (x === null) return;
    const bandW = SHIMMER.band * w;
    const stripW = bandW / strips.length;
    strips.forEach((strip, i) => {
      strip.x = left + x * w - bandW / 2 + i * stripW;
      strip.y = top;
      strip.width = stripW;
      strip.height = h;
    });
  };
  at(now());
  const tick = (): void => at(now());
  if (!still) ticker?.add(tick);

  return {
    view,
    at,
    destroy() {
      if (!still) ticker?.remove(tick);
      if (!view.destroyed) {
        view.parent?.removeChild(view);
        view.destroy({ children: true });
      }
    },
  };
}
