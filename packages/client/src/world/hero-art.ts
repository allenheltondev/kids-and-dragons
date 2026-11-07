/**
 * What a player's hero looks like here (docs/hero-looks.md §5.1, §9).
 *
 * Every surface that draws a player's hero asks this module for her painting,
 * so that her look (her colour, tinted into the painting, #666) cannot be
 * missed on one screen and shown on another. Nothing here picks a painting
 * anew: it wraps the four helpers in `art-paths.ts` and chooses between them
 * exactly as the surfaces did before it existed.
 *
 *   - `world`: the figure on a stage (the TV lineup, the combat board, the
 *     camp, the still stage, story interactions, minigames). A classed hero's
 *     class painting where one is commissioned, else her base painting
 *     (`characterWorldArtUrl`).
 *   - `portrait`: a still (phones, the book, arrivals). A classed hero's gear
 *     portrait, else her base painting (`characterPortraitArtUrl`).
 *
 * Her look is a request for the tinter (`heroCoatOf`): the painting, its
 * coat mask and how she is painted (her two colours, or gold). Her colours
 * are made only when one is of her species' own for its part **and** the
 * painting has a mask (coat-masks.ts); gold also on a cut-out painting with
 * no mask, whose alpha is her figure. Otherwise she draws as painted, and
 * nothing asks for a mask that is not there. Sparkles are an overlay, not
 * paint (`heroSparkleOf`). The tinted painting itself is the tinter's (hero-coat-cache.ts) and
 * reaches a surface only through `useHeroArt` / `HeroImage`
 * (hero-art-dom.tsx) or `loadHeroTexture` (hero-art-pixi.ts), which hold it
 * while it is drawn. `heroArtUrl` is the painting as painted: what a figure
 * is built from (a stage's figure key), and what draws until her colour is
 * ready. A new colour on the same painting is not a new figure: the stage
 * hands her look to the figure's handle (`update`) and keeps it.
 *
 * `heroBase` is the same hero drawn from her base painting, which every
 * family falls back to when its own painting is missing (CharacterPortrait
 * steps down to it on a 404). It keeps everything else about her, so the
 * fallback wears her colour too.
 *
 * Pure and Pixi-free like `art-paths.ts`, so screens and the service worker's
 * tests can import it. Not for character creation (a draft has no look yet),
 * non-player art (the cast, enemies, other creatures) or the service worker's
 * prefetch (`sw/`), which may call the helpers directly.
 * `hero-art.test.tsx` holds the line.
 */

import { coatPaintKey, coatPaintOf, lookSparkles } from "@kad/shared";
import type { CatalogCoat, CatalogSpecial, ClassId, CoatId, SpecialId, SpeciesId, TierId } from "@kad/shared";
import { coats as catalogCoats, specials as catalogSpecials } from "../../../../content/looks.json";
import { STARTING_TIER, characterPortraitArtUrl, characterWorldArtUrl } from "./art-paths";
import { coatMaskUrl, paintingIsCutOut } from "./coat-masks";
import type { TintPaint } from "./hero-coat-pass";

/** The two kinds of place a hero is drawn (§5.1). */
export type HeroArtPlace = "world" | "portrait";

export const HERO_ART_PLACES: readonly HeroArtPlace[] = ["world", "portrait"];

/** What paints her (content/looks.json `coats` and `specials`), as every screen reads it. */
export interface PaintCatalog {
  coats: CatalogCoat[];
  specials: CatalogSpecial[];
}

const COATS: PaintCatalog = { coats: catalogCoats as unknown as CatalogCoat[], specials: catalogSpecials as unknown as CatalogSpecial[] };

/**
 * The parts of a hero her painting is picked from. A `Character` is one, and
 * so is a `ResolvedCharacter` (the party's): both carry her look, whose `coat`
 * and `accent` are her two colours and `special` her special. So is a draft
 * or a hero shown at a tier she is growing into (`{ ...character, tier }`),
 * or wearing a colour on a shelf's tile (`{ ...hero, look: { ...look, accent } }`).
 */
export interface HeroArtSubject {
  readonly species: SpeciesId;
  /** Defaults to the tier every character starts at. */
  readonly tier?: TierId | undefined;
  readonly class?: ClassId | undefined;
  /** Her look; only its colours and special change her painting. Absent or null: as painted. */
  readonly look?:
    | {
        readonly coat?: CoatId | null | undefined;
        readonly accent?: CoatId | null | undefined;
        readonly special?: SpecialId | null | undefined;
      }
    | null
    | undefined;
}

/** The painting this hero is drawn from in `place`, as painted. */
export function heroPaintingUrl(hero: HeroArtSubject, place: HeroArtPlace): string {
  const tier = hero.tier ?? STARTING_TIER;
  return place === "world"
    ? characterWorldArtUrl(hero.species, tier, hero.class)
    : characterPortraitArtUrl(hero.species, tier, hero.class);
}

/**
 * The painting that draws this hero in `place`, as painted: what her figure
 * is built from and what shows until her colour is ready. A surface draws her
 * through `useHeroArt` / `HeroImage` / `loadHeroTexture`, which put her colour
 * on it.
 */
export function heroArtUrl(hero: HeroArtSubject, place: HeroArtPlace): string {
  return heroPaintingUrl(hero, place);
}

/** One pass the tinter can make: a painting, its mask, and what to paint (§5.1). */
export interface HeroCoatRequest {
  painting: string;
  /** Her RGB coat mask; null for gold on a cut-out with no mask, read by its own alpha. */
  mask: string | null;
  paint: TintPaint;
  /** Its identity in the tinter's cache: the painting and the paint (both colours, or the gold). */
  key: string;
}

/**
 * Her look in `place`, as a request for the tinter, or null to draw her as
 * painted. Gold (a gilded special) is on her figure, whatever her colours: by
 * the mask's blue channel, or on a cut-out painting with no mask yet by its
 * own alpha; an opaque gear portrait with no mask draws as painted. Her two
 * colours need the mask: none chosen, none of her species' for that part, or
 * no mask, and she draws as painted.
 */
export function heroCoatOf(hero: HeroArtSubject, place: HeroArtPlace, catalog: PaintCatalog = COATS): HeroCoatRequest | null {
  const paint = coatPaintOf(catalog, hero.species, hero.look);
  if (!paint) return null;
  const painting = heroPaintingUrl(hero, place);
  const mask = coatMaskUrl(painting);
  if (!mask && !(paint.kind === "gilded" && paintingIsCutOut(painting))) return null;
  return { painting, mask, paint, key: `${painting}|${coatPaintKey(paint)}` };
}

/** Where her sparkles may show: her painting's own alpha (`figure: null`), or her figure made from its mask. */
export interface HeroSparkle {
  painting: string;
  figure: HeroCoatRequest | null;
}

/**
 * Her sparkles (§5.5): what the overlay is clipped by, or null when she wears
 * no sparkle special or the painting cannot say where she is. Sparkles go
 * over her whole figure: on a cut-out painting its own alpha is her figure
 * (`figure: null`: clipped by the painting, mask or none); on an opaque gear
 * portrait only its mask's blue channel is, made an alpha mask by the tinter
 * (`figure`, a request); with no mask there, no sparkles. On the TV
 * (hero-art-pixi.ts) the overlay is a child of her sprite, clipped by its own
 * alpha; in the DOM (hero-art-dom.tsx) an element in the image's own box.
 */
export function heroSparkleOf(hero: HeroArtSubject, place: HeroArtPlace, catalog: PaintCatalog = COATS): HeroSparkle | null {
  if (!lookSparkles(catalog, hero.look)) return null;
  const painting = heroPaintingUrl(hero, place);
  if (paintingIsCutOut(painting)) return { painting, figure: null };
  const mask = coatMaskUrl(painting);
  if (!mask) return null;
  return { painting, figure: { painting, mask, paint: { kind: "figure" }, key: `${mask}|figure` } };
}

/**
 * The sparkles' timing (§5.5): each twinkles on its own beat, so the figure
 * is never all lit or all dark at once. The DOM's keyframes (hero-sparkle.css)
 * keep to the same period.
 */
export const SPARKLE = {
  /** How many twinkle over her on the TV. */
  count: 18,
  /** One twinkle, in ms. */
  periodMs: 2400,
  /** A sparkle's size, as a share of the figure's width. */
  size: 0.045,
  /** How bright a sparkle is at rest, under reduced motion. */
  still: 0.55,
} as const;

/**
 * How bright sparkle `i` is at `t` ms, 0..1: a soft twinkle, each on its own
 * phase. `still` (reduced motion): the same steady glow for every one, never
 * moving.
 */
export function sparkleAt(t: number, i: number, still = false): number {
  if (still) return SPARKLE.still;
  const phase = ((i * 0.618034) % 1) * SPARKLE.periodMs;
  const into = (((t + phase) % SPARKLE.periodMs) + SPARKLE.periodMs) % SPARKLE.periodMs;
  const s = Math.sin((into / SPARKLE.periodMs) * Math.PI);
  return s * s * s;
}

/** Where sparkle `i` sits, as shares of the figure's box: spread evenly, the same everywhere. */
export function sparklePlace(i: number): { x: number; y: number } {
  // A golden-angle scatter over the middle of the canvas, where a figure stands.
  const r = Math.sqrt((i + 0.5) / SPARKLE.count);
  const a = i * 2.399963;
  return { x: 0.5 + 0.38 * r * Math.cos(a), y: 0.55 + 0.4 * r * Math.sin(a) };
}

/**
 * Every file that draws this hero, for saving offline (§5.4): her world
 * figure, her portrait and her base painting (the fallback), each with its
 * coat mask where it has one. Whatever colour she wears, or picks later with
 * no signal, is then made from what the phone already has.
 */
export function heroOfflineArt(hero: HeroArtSubject): string[] {
  const urls = new Set<string>();
  for (const subject of [hero, heroBase(hero)]) {
    for (const place of HERO_ART_PLACES) {
      const painting = heroPaintingUrl(subject, place);
      urls.add(painting);
      const mask = coatMaskUrl(painting);
      if (mask) urls.add(mask);
    }
  }
  return [...urls];
}

/** The same hero, drawn from her base painting: every family's fallback. */
export function heroBase<H extends HeroArtSubject>(hero: H): Omit<H, "class"> & { readonly class: undefined } {
  return { ...hero, class: undefined };
}
