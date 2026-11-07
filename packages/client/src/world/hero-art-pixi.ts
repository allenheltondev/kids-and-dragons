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
 */

import { Assets, Texture } from "pixi.js";
import type { Sprite } from "pixi.js";
import { reducedMotion } from "../a11y/prefs";
import { heroCoatOf, heroPaintingUrl, heroShimmerOf, type HeroArtPlace, type HeroArtSubject, type HeroCoatRequest } from "./hero-art";
import { shimmerLayer, type ShimmerLayer, type ShimmerOptions } from "./hero-shimmer-pixi";
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
  /** A shimmer coat's sweep (`dress`). */
  shimmer?: HeroShimmerOptions;
}

/** Stops further calls and lets go of her tinted texture; `update` gives it her look anew. */
export interface HeroTextureHandle {
  (): void;
  update(hero: HeroArtSubject): void;
  /**
   * The sprite her textures go on (§5.5, #669): a stage hands it over once it
   * has made it, so a shimmer coat's sweep can be laid over it (a child of
   * the sprite, masked by her coat mask). A new sprite moves the sweep to it.
   */
  dress(sprite: Sprite): void;
}

export interface HeroShimmerOptions {
  /** A still sheen, no sweep; `reducedMotion()` unless a stage or test says otherwise. */
  still?: boolean;
  /** How the sweep moves (hero-shimmer-pixi.ts); a test passes its own. */
  ticker?: ShimmerOptions["ticker"];
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
  { load = pixiLoad, missing, texture = pixiTexture, shimmer: shimmerOptions = {} }: HeroTextureOptions = {},
): HeroTextureHandle {
  let live = true;
  let painted: Texture | null = null;
  let tinted = false;
  let slot: CoatSlot | null = null;
  let want: HeroCoatRequest | null = heroCoatOf(hero, place);
  const painting = heroPaintingUrl(hero, place);

  // Her shimmer (§5.5): laid over the sprite the stage dresses, once its mask is in.
  let sprite: Sprite | null = null;
  let sweep: string | null = heroShimmerOf(hero, place)?.mask ?? null;
  let layer: ShimmerLayer | null = null;
  let layerFor: { sprite: Sprite; mask: string } | null = null;
  const undress = (): void => {
    layer?.destroy();
    layer = null;
    layerFor = null;
  };
  const dressUp = (): void => {
    if (!live) return;
    if (layerFor && (layerFor.sprite !== sprite || layerFor.mask !== sweep)) undress();
    if (!sprite || !sweep || layerFor) return;
    const on = { sprite, mask: sweep };
    layerFor = on;
    void load(sweep)
      .then((mask) => {
        // Still wanted, on the same sprite: a stale load lays nothing.
        if (!live || layerFor !== on || on.sprite.destroyed) return;
        layer = shimmerLayer(on.sprite, mask, { still: shimmerOptions.still ?? reducedMotion(), ...(shimmerOptions.ticker !== undefined ? { ticker: shimmerOptions.ticker } : {}) });
      })
      .catch(() => {
        // No mask to clip by: no sweep, never a band over the whole figure.
        if (layerFor === on) layerFor = null;
      });
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
      sweep = heroShimmerOf(next, place)?.mask ?? null;
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
