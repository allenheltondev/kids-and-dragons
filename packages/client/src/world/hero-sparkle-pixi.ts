/**
 * A sparkle special on a Pixi stage (docs/hero-looks.md §5.5): small stars
 * twinkling over her whole figure, laid over her sprite **as a child of it**,
 * so it moves, scales, flips and fades with every transform the stage gives
 * her, and clipped by the sprite's own texture read by its alpha (a stage's
 * figure is a cut-out painting, whose alpha is her figure: the coat mask's
 * blue channel matches it there). The tinter is not involved: the stars are
 * drawn over whatever texture the sprite shows, as painted, coloured or gold,
 * and the clip follows that texture when it changes.
 *
 * Under reduced motion the stars rest at a steady glow and the ticker is
 * never asked for. The timing and the places are hero-art.ts `SPARKLE`,
 * `sparkleAt` and `sparklePlace`, which the DOM keeps to as well.
 *
 * Built from `Texture.WHITE` alone (each star two thin crossed strips), so it
 * needs no canvas and no art.
 */

import { Container, Sprite, Texture, Ticker } from "pixi.js";
import { SPARKLE, sparkleAt, sparklePlace } from "./hero-art";

export interface SparkleLayer {
  /** The layer, a child of her sprite. */
  readonly view: Container;
  /** The sprite whose alpha clips it: her own texture, kept in step with hers. */
  readonly clip: Sprite;
  /** Set every star to how it is at `t` ms (the ticker does this; tests call it). */
  at(t: number): void;
  destroy(): void;
}

/** What twinkles the stars: Pixi's `Ticker`, as far as it is used. */
export interface SparkleTicker {
  add(fn: () => void): unknown;
  remove(fn: () => void): unknown;
}

export interface SparkleOptions {
  /** A steady glow, no twinkle (reduced motion). */
  still?: boolean;
  /** The ticker that twinkles it; Pixi's shared one unless a test says otherwise. */
  ticker?: SparkleTicker | null;
  now?: () => number;
}

/** A star's arms: the long one's thickness, as a share of its length. */
const ARM = 0.18;

/** Lay sparkles over `sprite`, clipped by its own alpha. Returns the layer; `destroy` takes it off. */
export function sparkleLayer(sprite: Sprite, { still = false, ticker = Ticker.shared, now = () => performance.now() }: SparkleOptions = {}): SparkleLayer {
  const view = new Container();
  view.label = "hero-sparkle";
  const clip = new Sprite(sprite.texture);
  const stars = new Container();
  const glints = Array.from({ length: SPARKLE.count }, () => {
    const star = new Container();
    for (const turn of [0, Math.PI / 2]) {
      const arm = new Sprite(Texture.WHITE);
      arm.anchor.set(0.5);
      arm.rotation = turn + Math.PI / 4;
      arm.blendMode = "add";
      star.addChild(arm);
    }
    stars.addChild(star);
    return star;
  });
  view.addChild(clip, stars);
  view.setMask({ mask: clip, channel: "alpha" });
  sprite.addChild(view);

  const at = (t: number): void => {
    const texture = sprite.texture;
    // Her clip is her texture, whatever she is drawn with now.
    if (clip.texture !== texture) clip.texture = texture;
    const w = texture.width;
    const h = texture.height;
    // On her sprite's own canvas: its anchor is where 0,0 is.
    clip.anchor.set(sprite.anchor.x, sprite.anchor.y);
    const left = -sprite.anchor.x * w;
    const top = -sprite.anchor.y * h;
    const size = SPARKLE.size * w;
    glints.forEach((star, i) => {
      const place = sparklePlace(i);
      star.x = left + place.x * w;
      star.y = top + place.y * h;
      star.alpha = sparkleAt(t, i, still);
      // A twinkle grows a little as it brightens; a still star keeps its size.
      const grow = still ? 1 : 0.6 + 0.4 * star.alpha;
      for (const arm of star.children as Sprite[]) {
        arm.width = size * grow;
        arm.height = size * grow * ARM;
      }
    });
  };
  at(now());
  const tick = (): void => at(now());
  if (!still) ticker?.add(tick);

  return {
    view,
    clip,
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
