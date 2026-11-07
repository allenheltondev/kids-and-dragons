/**
 * A player's hero on a Pixi stage (docs/hero-looks.md §5.1): the texture side
 * of `hero-art.ts`, for the story lineup (scene.ts), the combat board
 * (board.ts) and the camp (camp.ts).
 *
 * The texture is handed to a callback rather than returned, because it is not
 * one texture for the life of a figure. Today `use` is called once, with her
 * painting as painted. #666 calls it again with her tinted texture once the
 * tinter's pass is done (the hero draws as painted until then, §5.3), so a
 * stage writes `use` to put whatever texture it is given on her sprite. The
 * returned function stops further calls: a stage calls it when the figure is
 * torn down or rebuilt, and #666 lets go of the tinted texture's cache entry
 * there too.
 *
 * A painting that fails to load never calls `use`: the stage keeps its "art
 * pending" placeholder, as it always has, and `missing` (if given) is told, so
 * a stage that hides its placeholder while art loads can show it at once.
 */

import { Assets, type Texture } from "pixi.js";
import { heroArtUrl, type HeroArtPlace, type HeroArtSubject } from "./hero-art";

export type TextureLoader = (url: string) => Promise<Texture>;

const pixiLoad: TextureLoader = (url) => Assets.load<Texture>(url);

export interface HeroTextureOptions {
  /** How a texture is loaded; Pixi's `Assets.load` unless a stage or test says otherwise. */
  load?: TextureLoader;
  /** Told when her painting cannot be loaded (after `use` throws, too, as a `.catch` would be). */
  missing?: () => void;
}

/** Puts `hero` in `place` on a Pixi stage: `use` gets each texture she is drawn with. */
export function loadHeroTexture(
  hero: HeroArtSubject,
  place: HeroArtPlace,
  use: (texture: Texture) => void,
  { load = pixiLoad, missing }: HeroTextureOptions = {},
): () => void {
  let live = true;
  void load(heroArtUrl(hero, place))
    .then((texture) => {
      if (live) use(texture);
    })
    .catch(() => {
      // Keep the placeholder: a missing painting must never blank the stage.
      if (live) missing?.();
    });
  return () => {
    live = false;
  };
}
