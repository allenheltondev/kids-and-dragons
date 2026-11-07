/**
 * A player's hero on a Pixi stage (docs/hero-looks.md §5.1): the texture side
 * of `hero-art.ts`, for the story lineup (scene.ts), the combat board
 * (board.ts) and the camp (camp.ts).
 *
 * The texture is handed to a callback rather than returned, because it is not
 * one texture for the life of a figure. `use` is called first with her
 * painting as painted, and again with her tinted texture once the tinter's
 * pass is done (§5.3): a stage writes `use` to put whatever texture it is
 * given on her sprite. If her colour is already tinted (another surface, an
 * earlier scene), the tinted texture comes first and the painting is never
 * shown.
 *
 * The returned handle is a function that stops it: a stage calls it when the
 * figure is torn down or rebuilt, which lets go of the tinted texture's cache
 * entry (pinned while the sprite shows it). `handle.update(hero)` hands it her
 * look as it now stands: a new colour on the same painting is a new texture
 * on the same figure (the old colour stays until the new one is ready), and
 * no colour goes back to the painting. A new painting is a new figure.
 *
 * A painting that fails to load never calls `use` with it: the stage keeps its
 * "art pending" placeholder, as it always has, and `missing` (if given) is
 * told, so a stage that hides its placeholder while art loads can show it at
 * once. A painting with no mask, or a hero with no colour, never loads the
 * tinter at all.
 *
 * A sparkle special (§5.5) is laid over the sprite the stage hands to
 * `dress`, as a child of it, clipped by its own alpha (hero-sparkle-pixi.ts):
 * it needs no mask and nothing from the tinter.
 */

import { Assets, Texture } from "pixi.js";
import type { Sprite } from "pixi.js";
import { reducedMotion } from "../a11y/prefs";
import { heroCoatOf, heroPaintingUrl, heroSparkleOf, type HeroArtPlace, type HeroArtSubject, type HeroCoatRequest } from "./hero-art";
import { sparkleLayer, type SparkleLayer, type SparkleOptions } from "./hero-sparkle-pixi";
import { heroCoatsLoaded, loadHeroCoats, type HeroCoatsModule } from "./hero-coat-load";
import type { CoatEntry, CoatSlot } from "./hero-coat-cache";

export type TextureLoader = (url: string) => Promise<Texture>;

const pixiLoad: TextureLoader = (url) => Assets.load<Texture>(url);

export interface HeroTextureOptions {
  /** How a texture is loaded; Pixi's `Assets.load` unless a stage or test says otherwise. */
  load?: TextureLoader;
  /** Told when her painting cannot be loaded (after `use` throws, too, as a `.catch` would be). */
  missing?: () => void;
  /** How a tinted image becomes a texture; `Texture.from` unless a test says otherwise. */
  texture?: { make(source: unknown): Texture; destroy(texture: Texture): void };
  /** A sparkle special's twinkle (`dress`). */
  sparkle?: HeroSparkleOptions;
}

/** Stops further calls and lets go of her tinted texture; `update` gives it her look anew. */
export interface HeroTextureHandle {
  (): void;
  update(hero: HeroArtSubject): void;
  /**
   * The sprite her textures go on (§5.5): a stage hands it over once it has
   * made it, so a sparkle special can be laid over it (a child of the sprite,
   * clipped by its own alpha). A new sprite moves the sparkles to it.
   */
  dress(sprite: Sprite): void;
}

export interface HeroSparkleOptions {
  /** A steady glow, no twinkle; `reducedMotion()` unless a stage or test says otherwise. */
  still?: boolean;
  /** What twinkles it (hero-sparkle-pixi.ts); a test passes its own. */
  ticker?: SparkleOptions["ticker"];
}

const pixiTexture = {
  make: (source: unknown): Texture => Texture.from(source as HTMLCanvasElement),
  destroy: (texture: Texture): void => texture.destroy(true),
};

/** Puts `hero` in `place` on a Pixi stage: `use` gets each texture she is drawn with. */
export function loadHeroTexture(
  hero: HeroArtSubject,
  place: HeroArtPlace,
  use: (texture: Texture) => void,
  { load = pixiLoad, missing, texture = pixiTexture, sparkle: sparkleOptions = {} }: HeroTextureOptions = {},
): HeroTextureHandle {
  let live = true;
  let painted: Texture | null = null;
  let tinted = false;
  let slot: CoatSlot | null = null;
  let want: HeroCoatRequest | null = heroCoatOf(hero, place);
  const painting = heroPaintingUrl(hero, place);

  // Her sparkles (§5.5): a child of the sprite the stage dresses, clipped by its own alpha.
  let sprite: Sprite | null = null;
  let sparkles = heroSparkleOf(hero, place) !== null;
  let layer: SparkleLayer | null = null;
  const dressUp = (): void => {
    if (!live) return;
    if (layer && (!sparkles || layer.view.parent !== sprite)) {
      layer.destroy();
      layer = null;
    }
    if (!sprite || !sparkles || layer || sprite.destroyed) return;
    layer = sparkleLayer(sprite, { still: sparkleOptions.still ?? reducedMotion(), ...(sparkleOptions.ticker !== undefined ? { ticker: sparkleOptions.ticker } : {}) });
  };
  const undress = (): void => {
    layer?.destroy();
    layer = null;
  };

  const show = (entry: CoatEntry | null): void => {
    if (!live) return;
    if (entry) {
      tinted = true;
      use(entry.texture(texture.make, texture.destroy));
    } else {
      tinted = false;
      if (painted) use(painted);
    }
  };
  const ask = (): void => {
    if (slot) {
      slot.want(want);
      return;
    }
    if (!want) return;
    const start = (m: HeroCoatsModule): void => {
      if (!live) return;
      slot ??= m.heroCoats().slot(show);
      slot.want(want);
    };
    // Loaded already: a colour tinted before is on her before her painting can be.
    const now = heroCoatsLoaded();
    if (now) start(now);
    else void loadHeroCoats().then(start, () => undefined);
  };

  // After this returns, never during: a stage keeps the handle (and registers the figure) first.
  queueMicrotask(() => {
    if (live) ask();
  });
  void load(painting)
    .then((t) => {
      if (!live) return;
      painted = t;
      if (!tinted) use(t);
    })
    .catch(() => {
      // Keep the placeholder: a missing painting must never blank the stage.
      if (live) missing?.();
    });

  const stop = (() => {
    live = false;
    slot?.close();
    slot = null;
    undress();
  }) as HeroTextureHandle;
  stop.update = (next) => {
    if (!live) return;
    const request = heroCoatOf(next, place);
    if (request?.painting !== undefined && request.painting !== painting) return; // a new painting is a new figure
    if (heroPaintingUrl(next, place) === painting) {
      sparkles = heroSparkleOf(next, place) !== null;
      dressUp();
    }
    if ((request?.key ?? null) === (want?.key ?? null)) return;
    want = request;
    ask();
  };
  stop.dress = (next) => {
    if (!live) return;
    sprite = next;
    dressUp();
  };
  return stop;
}
