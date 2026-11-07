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

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ImgHTMLAttributes, ReactElement } from "react";
import { reducedMotion } from "../a11y/prefs";
import { heroCoatOf, heroPaintingUrl, heroShimmerOf, type HeroArtPlace, type HeroArtSubject, type HeroCoatRequest } from "./hero-art";
import "./hero-shimmer.css";
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
 * through, so it draws exactly the `<img>` it replaces. A shimmer coat (§5.5)
 * adds its sweep as a sibling laid over the image (`ShimmerOver`), out of the
 * flow, so the layout around it does not move.
 */
export function HeroImage({ hero, place, ...img }: HeroImageProps): ReactElement {
  const src = useHeroArt(hero, place);
  const shimmer = heroShimmerOf(hero, place);
  const ref = useRef<HTMLImageElement | null>(null);
  if (!shimmer) return <img src={src} {...img} />;
  return (
    <>
      <img ref={ref} src={src} {...img} />
      <ShimmerOver target={ref} mask={shimmer.mask} />
    </>
  );
}

/** The CSS a shimmer needs: its mask, as a custom property the stylesheet reads. */
export function shimmerStyle(mask: string, extra: Record<string, string> = {}): CSSProperties {
  return { "--hero-shimmer-mask": `url("${mask}")`, ...extra } as CSSProperties;
}

/** The shimmer's class: still under reduced motion, as the stylesheet's own queries also say. */
export function shimmerClass(extra = ""): string {
  return `hero-shimmer${reducedMotion() ? " hero-shimmer--still" : ""}${extra ? ` ${extra}` : ""}`;
}

/** The mask's size and place, matched to how the image fits its own box (`object-fit`, `object-position`). */
function maskFit(img: HTMLImageElement): Record<string, string> {
  const style = getComputedStyle(img);
  const fit = style.objectFit;
  const size = fit === "cover" ? "cover" : fit === "fill" || fit === "" ? "100% 100%" : "contain";
  return { "--hero-shimmer-mask-size": size, "--hero-shimmer-mask-position": style.objectPosition || "50% 50%" };
}

/**
 * A shimmer coat's sweep laid over an image it is not inside (§5.5): placed
 * on the image's box by measurement, clipped by her coat mask fitted as the
 * image fits its painting, and moved again whenever the image's box changes.
 * Never in the flow, never taking a tap.
 */
export function ShimmerOver({ target, mask }: { target: { readonly current: HTMLImageElement | null }; mask: string }): ReactElement {
  const self = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const img = target.current;
    const over = self.current;
    if (!img || !over) return undefined;
    // Placed by hand, not by React: a measure puts it at 0,0 first, and a
    // re-render must never undo that by "restoring" a value it thinks is set.
    const place = (): void => {
      over.style.left = "0px";
      over.style.top = "0px";
      const origin = over.getBoundingClientRect();
      const at = img.getBoundingClientRect();
      over.style.left = `${String(at.left - origin.left)}px`;
      over.style.top = `${String(at.top - origin.top)}px`;
      over.style.width = `${String(at.width)}px`;
      over.style.height = `${String(at.height)}px`;
      for (const [name, value] of Object.entries(maskFit(img))) over.style.setProperty(name, value);
    };
    place();
    img.addEventListener("load", place);
    const watch = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    watch?.observe(img);
    window.addEventListener("resize", place);
    return () => {
      img.removeEventListener("load", place);
      watch?.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [target, mask]);
  return (
    <span ref={self} aria-hidden="true" className={shimmerClass("hero-shimmer--over")} data-shimmer-mask={mask} style={shimmerStyle(mask)} />
  );
}
