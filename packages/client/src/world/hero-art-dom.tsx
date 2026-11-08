/**
 * A player's hero in the DOM (docs/hero-looks.md §5.1): `useHeroArt` and the
 * `<img>` built on it.
 *
 * The hook hands back her painting as painted first and, when her look paints
 * her (her colours on a masked painting, or gold), re-renders with the
 * tinter's object URL once its pass is done (hero-coat-cache.ts). While the
 * image is mounted the hook holds that entry (a `CoatSlot`), so it is never
 * evicted out from under it; on unmount it lets go. A new look keeps the old
 * one showing until the new one is ready, and an older look never shows after
 * a newer one.
 *
 * So a caller treats the URL as one that may change under it, and reads it
 * through the hook on every render rather than caching it. The tinter is
 * loaded only when a hero needs it, never with the first paint; nothing here
 * imports Pixi.
 *
 * A sparkle special (§5.5) is an element laid over her image **in the
 * image's own box**: `HeroImage` wraps the image and the sparkles in one
 * grid cell (`.hero-sparkle-host`), which takes the image's class and style,
 * so whatever moves, scales or animates her moves the sparkles with her, and
 * nothing is measured or placed by hand. `CharacterPortrait` lays them in its
 * own grid cell the same way.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ImgHTMLAttributes, ReactElement } from "react";
import { reducedMotion } from "../a11y/prefs";
import { heroCoatOf, heroPaintingUrl, heroSparkleOf, type HeroArtPlace, type HeroArtSubject, type HeroCoatRequest, type HeroSparkle } from "./hero-art";
import "./hero-sparkle.css";
import type { CoatSlot } from "./hero-coat-cache";
import { heroCoatsLoaded, loadHeroCoats, type HeroCoatsModule as Coats } from "./hero-coat-load";

interface Hold {
  live: boolean;
  slot: CoatSlot | null;
  want: HeroCoatRequest | null;
}

/**
 * The tinter's object URL for `request` as of this render, held while
 * mounted, or null while it is not ready (or for no request). The last one
 * shown for the same painting stays until a new one is ready.
 */
function useTintUrl(request: HeroCoatRequest | null): string | null {
  return useTint(request).url;
}

/**
 * `useTintUrl`, plus whether her colour is still on its way: asked for, not ready, not failed, and
 * nothing of an earlier look on this painting to keep showing. A surface that would rather wait
 * than show her uncoloured (the book's look page) holds its image back while this is true.
 */
function useTint(request: HeroCoatRequest | null): { url: string | null; pending: boolean } {
  const key = request?.key ?? null;
  const [shown, setShown] = useState<{ key: string; url: string } | null>(null);
  const hold = useRef<Hold | null>(null);
  // A pass that fails shows null again, which setShown alone would not re-render: the hold on her image must end.
  const [, settle] = useState(0);

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
        if (!h.live) return;
        setShown(entry ? { key: entry.key, url: entry.url() } : null);
        settle((n) => n + 1);
      });
      h.slot.want(h.want);
    };
    const now = heroCoatsLoaded();
    if (now) start(now);
    else void loadHeroCoats().then(start, () => undefined);
    // `request` is read through its key: a new object every render, the same tint.
  }, [key]);

  if (request === null) return { url: null, pending: false };
  if (shown?.key === request.key) return { url: shown.url, pending: false };
  // A look already tinted (another surface, an earlier visit) shows at once; the effect pins it.
  const cache = heroCoatsLoaded()?.heroCoats();
  const ready = cache?.peek(request.key);
  if (ready) return { url: ready.url(), pending: false };
  // Her last look on this painting stays until the new one is ready; another painting's never shows.
  if (shown !== null && shown.key.startsWith(`${request.painting}|`)) return { url: shown.url, pending: false };
  // A colour that cannot be made draws as painted, for good (hero-coat-cache.ts).
  return { url: null, pending: !cache?.hasFailed(request.key) };
}

/**
 * The URL that draws `hero` in `place`, as of this render. `tinted: false` draws her as painted
 * and holds nothing: for an image kept mounted but not shown (CharacterPortrait's fallback).
 */
export function useHeroArt(hero: HeroArtSubject, place: HeroArtPlace, tinted = true): string {
  return useHeroArtState(hero, place, tinted).src;
}

/** `useHeroArt`, and whether her colour is still being made (`pending`), for a surface that waits for it. */
export function useHeroArtState(hero: HeroArtSubject, place: HeroArtPlace, tinted = true): { src: string; pending: boolean } {
  const painted = heroPaintingUrl(hero, place);
  const { url, pending } = useTint(tinted ? heroCoatOf(hero, place) : null);
  return { src: url ?? painted, pending };
}

export type HeroImageProps = {
  hero: HeroArtSubject;
  place: HeroArtPlace;
  /** Draw nothing until her colour is ready, rather than her painting first (the look page: no flash of the wrong colour). */
  holdUntilTinted?: boolean;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

/**
 * An `<img>` of a player's hero, for the lists that draw one per hero (a hook
 * cannot be called in a `.map`). Every other attribute passes straight
 * through, so it draws exactly the `<img>` it replaces.
 *
 * With a sparkle special (§5.5) it is a `.hero-sparkle-host` instead: one
 * grid cell holding the image and the sparkles over it, wearing the image's
 * `className` and `style` (its place, its size, its animation), so the two
 * can never come apart. The image inside fills the host and fits its painting
 * as the host's class says (`object-fit` and `object-position`, inherited).
 * Stylesheets that reach a hero's image by element (`> img`) reach the host
 * too (`.hero-sparkle-host`).
 */
export function HeroImage({ hero, place, className, style, holdUntilTinted = false, ...img }: HeroImageProps): ReactElement {
  const { src, pending } = useHeroArtState(hero, place);
  const sparkle = heroSparkleOf(hero, place);
  const held = holdUntilTinted && pending;
  const shown: CSSProperties | undefined = holdUntilTinted ? { ...style, opacity: held ? 0 : 1, transition: "opacity 160ms ease-out" } : style;
  if (!sparkle) return <img src={src} className={className} style={shown} {...img} />;
  return (
    <span className={`hero-sparkle-host${className ? ` ${className}` : ""}`} style={shown} data-testid="hero-sparkle-host">
      <img src={src} className="hero-sparkle-host__img" {...img} />
      <HeroSparkles sparkle={sparkle} fitFrom="host" />
    </span>
  );
}

/** The sparkles' class: still under reduced motion, as the stylesheet's own queries also say. */
export function sparkleClass(extra = ""): string {
  return `hero-sparkle${reducedMotion() ? " hero-sparkle--still" : ""}${extra ? ` ${extra}` : ""}`;
}

/** The CSS sparkles need: their clip, as a custom property the stylesheet reads. */
export function sparkleStyle(clip: string, extra: Record<string, string> = {}): CSSProperties {
  return { "--hero-sparkle-mask": `url("${clip}")`, ...extra } as CSSProperties;
}

/**
 * Sparkles over her figure (§5.5), as an element for a grid cell shared with
 * her image: clipped by her painting's own alpha on a cut-out, or by her
 * figure the tinter makes from an opaque portrait's mask (nothing shows until
 * it is ready). `fitFrom: "host"` reads how the clip fits from the host it
 * sits in (`object-fit`, `object-position`), so it fits as the image does;
 * otherwise the stylesheet around it says (CharacterPortrait).
 */
export function HeroSparkles({ sparkle, className = "", fitFrom }: { sparkle: HeroSparkle; className?: string; fitFrom?: "host" }): ReactElement | null {
  const figure = useTintUrl(sparkle.figure);
  const clip = sparkle.figure ? figure : sparkle.painting;
  const self = useRef<HTMLSpanElement | null>(null);
  useLayoutEffect(() => {
    const over = self.current;
    const host = over?.parentElement;
    if (fitFrom !== "host" || !over || !host || typeof getComputedStyle !== "function") return;
    // How it fits, not where it is: the place is the grid cell's, never measured.
    const s = getComputedStyle(host);
    const fit = s.objectFit;
    over.style.setProperty("--hero-sparkle-mask-size", fit === "cover" ? "cover" : fit === "fill" ? "100% 100%" : "contain");
    if (s.objectPosition) over.style.setProperty("--hero-sparkle-mask-position", s.objectPosition);
  }, [fitFrom, clip]);
  if (!clip) return null;
  return <span ref={self} aria-hidden="true" className={sparkleClass(className)} data-sparkle-clip={clip} style={sparkleStyle(clip)} />;
}
