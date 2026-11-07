/**
 * A player's hero in the DOM (docs/hero-looks.md §5.1): `useHeroArt` and the
 * `<img>` built on it.
 *
 * Today the hook returns `heroArtUrl(hero, place)`, her painting as painted.
 * #666 makes it the tinter's object URL: the hook will hand back the painted
 * URL first and re-render with the tinted one when its pass is done (and hold
 * the cache entry while mounted, §5.3). So a caller treats the URL as one that
 * may change under it, and reads it through the hook on every render rather
 * than caching it. Nothing here imports Pixi.
 */

import type { ImgHTMLAttributes, ReactElement } from "react";
import { heroArtUrl, type HeroArtPlace, type HeroArtSubject } from "./hero-art";

/** The URL that draws `hero` in `place`, as of this render. */
export function useHeroArt(hero: HeroArtSubject, place: HeroArtPlace): string {
  return heroArtUrl(hero, place);
}

export type HeroImageProps = {
  hero: HeroArtSubject;
  place: HeroArtPlace;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

/**
 * An `<img>` of a player's hero, for the lists that draw one per hero (a hook
 * cannot be called in a `.map`). Every other attribute passes straight
 * through, so it draws exactly the `<img>` it replaces.
 */
export function HeroImage({ hero, place, ...img }: HeroImageProps): ReactElement {
  const src = useHeroArt(hero, place);
  return <img src={src} {...img} />;
}
