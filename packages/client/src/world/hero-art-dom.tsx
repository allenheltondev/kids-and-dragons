/**
 * A player's hero in the DOM (docs/hero-looks.md §5.1): `useHeroArt` and the
 * `<img>` built on it.
 *
 * The hook hands back her painting as painted first and, when she has a
 * colour and the painting a mask, re-renders with the tinter's object URL
 * once its pass is done (hero-coat-cache.ts). While the image is mounted the
 * hook holds that entry (a `CoatSlot`), so it is never evicted out from under
 * it; on unmount it lets go. A new colour keeps the old one showing until the
 * new one is ready, and an older colour never shows after a newer one.
 *
 * So a caller treats the URL as one that may change under it, and reads it
 * through the hook on every render rather than caching it. The tinter is
 * loaded only when a hero needs it, never with the first paint; nothing here
 * imports Pixi.
 */

import { useEffect, useRef, useState } from "react";
import type { ImgHTMLAttributes, ReactElement } from "react";
import { heroCoatOf, heroPaintingUrl, type HeroArtPlace, type HeroArtSubject, type HeroCoatRequest } from "./hero-art";
import type { CoatSlot } from "./hero-coat-cache";
import { heroCoatsLoaded, loadHeroCoats, type HeroCoatsModule as Coats } from "./hero-coat-load";

interface Hold {
  live: boolean;
  slot: CoatSlot | null;
  want: HeroCoatRequest | null;
}

/**
 * The URL that draws `hero` in `place`, as of this render. `tinted: false` draws her as painted
 * and holds nothing: for an image kept mounted but not shown (CharacterPortrait's fallback).
 */
export function useHeroArt(hero: HeroArtSubject, place: HeroArtPlace, tinted = true): string {
  const painted = heroPaintingUrl(hero, place);
  const request = tinted ? heroCoatOf(hero, place) : null;
  const key = request?.key ?? null;
  const [shown, setShown] = useState<{ key: string; url: string } | null>(null);
  const hold = useRef<Hold | null>(null);

  // The slot lives as long as the image: made when first needed, closed on unmount.
  useEffect(() => {
    const h: Hold = { live: true, slot: null, want: null };
    hold.current = h;
    return () => {
      h.live = false;
      h.slot?.close();
      h.slot = null;
    };
  }, []);

  useEffect(() => {
    const h = hold.current;
    if (!h) return;
    h.want = request;
    if (h.slot) {
      h.slot.want(request);
      return;
    }
    if (!request) return;
    const start = (m: Coats): void => {
      if (!h.live || h.slot) return;
      h.slot = m.heroCoats().slot((entry) => {
        if (h.live) setShown(entry ? { key: entry.key, url: entry.url() } : null);
      });
      h.slot.want(h.want);
    };
    const now = heroCoatsLoaded();
    if (now) start(now);
    else void loadHeroCoats().then(start, () => undefined);
    // `request` is read through its key: a new object every render, the same tint.
  }, [key]);

  if (request === null) return painted;
  if (shown?.key === request.key) return shown.url;
  // A colour already tinted (another surface, an earlier visit) shows at once; the effect pins it.
  const ready = heroCoatsLoaded()?.heroCoats().peek(request.key);
  if (ready) return ready.url();
  // Her last colour on this painting stays until the new one is ready; another painting's never shows.
  if (shown !== null && shown.key.startsWith(`${request.painting}|`)) return shown.url;
  return painted;
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
