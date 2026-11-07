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
 * Her colour is a request for the tinter (`heroCoatOf`): the painting, its
 * coat mask and how the coat is painted. It is made only when she has a
 * colour of her species' own **and** the painting has a mask (coat-masks.ts);
 * otherwise she draws as painted, and nothing asks for a mask that is not
 * there. The tinted painting itself is the tinter's (hero-coat-cache.ts) and
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

import { coatPaintKey, coatPaintOf, speciesCoat } from "@kad/shared";
import type { CatalogCoat, ClassId, CoatId, CoatPaint, SpeciesId, TierId } from "@kad/shared";
import { coats as catalogCoats } from "../../../../content/looks.json";
import { STARTING_TIER, characterPortraitArtUrl, characterWorldArtUrl } from "./art-paths";
import { coatMaskUrl } from "./coat-masks";

/** The two kinds of place a hero is drawn (§5.1). */
export type HeroArtPlace = "world" | "portrait";

export const HERO_ART_PLACES: readonly HeroArtPlace[] = ["world", "portrait"];

/** The catalog's colours (content/looks.json `coats`), as every screen reads them. */
const COATS: { coats: CatalogCoat[] } = { coats: catalogCoats as unknown as CatalogCoat[] };

/**
 * The parts of a hero her painting is picked from. A `Character` is one, and
 * so is a `ResolvedCharacter` (the party's): both carry her look, whose `coat`
 * is her colour. So is a draft or a hero shown at a tier she is growing into
 * (`{ ...character, tier }`), or wearing a colour on a shelf's tile
 * (`{ ...hero, look: { coat } }`).
 */
export interface HeroArtSubject {
  readonly species: SpeciesId;
  /** Defaults to the tier every character starts at. */
  readonly tier?: TierId | undefined;
  readonly class?: ClassId | undefined;
  /** Her look; only its colour changes her painting. Absent or null: as painted. */
  readonly look?: { readonly coat?: CoatId | null | undefined } | null | undefined;
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

/** One tint the tinter can make: a painting, its mask, and the coat's paint (§5.1). */
export interface HeroCoatRequest {
  painting: string;
  mask: string;
  paint: CoatPaint;
  /** Its identity in the tinter's cache: the painting and the paint. */
  key: string;
}

/**
 * Her colour in `place`, as a request for the tinter, or null to draw her as
 * painted: no colour chosen, a colour that is not her species' (or that the
 * catalog no longer has), or a painting with no mask yet.
 */
export function heroCoatOf(hero: HeroArtSubject, place: HeroArtPlace, catalog: { coats: CatalogCoat[] } = COATS): HeroCoatRequest | null {
  const coat = speciesCoat(catalog, hero.species, hero.look?.coat);
  if (!coat) return null;
  const painting = heroPaintingUrl(hero, place);
  const mask = coatMaskUrl(painting);
  if (!mask) return null;
  const paint = coatPaintOf(coat);
  return { painting, mask, paint, key: `${painting}|${coatPaintKey(paint)}` };
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
