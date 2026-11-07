/**
 * What a player's hero looks like here (docs/hero-looks.md §5.1, §9).
 *
 * Every surface that draws a player's hero asks this module for her painting,
 * so that her look (#666: her colour, tinted into the painting) cannot be
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
 * `heroBase` is the same hero drawn from her base painting, which every
 * family falls back to when its own painting is missing (CharacterPortrait
 * steps down to it on a 404). It keeps everything else about her, so the
 * fallback wears her look too once #666 gives her one.
 *
 * Pure and Pixi-free like `art-paths.ts`, so screens and the service worker's
 * tests can import it. The DOM side is `hero-art-dom.tsx` (`useHeroArt`,
 * `HeroImage`); the Pixi side is `hero-art-pixi.ts` (`loadHeroTexture`).
 *
 * Not for character creation (a draft has no look yet), non-player art (the
 * cast, enemies, other creatures) or the service worker's prefetch (`sw/`),
 * which may call the helpers directly. `hero-art.test.ts` holds the line.
 */

import type { ClassId, SpeciesId, TierId } from "@kad/shared";
import { STARTING_TIER, characterPortraitArtUrl, characterWorldArtUrl } from "./art-paths";

/** The two kinds of place a hero is drawn (§5.1). */
export type HeroArtPlace = "world" | "portrait";

export const HERO_ART_PLACES: readonly HeroArtPlace[] = ["world", "portrait"];

/**
 * The parts of a hero her painting is picked from. A `Character` is one; so
 * is a draft or a hero shown at a tier she is growing into
 * (`{ ...character, tier }`). #666 adds her look here, and every caller that
 * passes a whole character carries it without another change.
 */
export interface HeroArtSubject {
  readonly species: SpeciesId;
  /** Defaults to the tier every character starts at. */
  readonly tier?: TierId | undefined;
  readonly class?: ClassId | undefined;
}

/** The painting this hero is drawn from in `place`, as painted. */
export function heroPaintingUrl(hero: HeroArtSubject, place: HeroArtPlace): string {
  const tier = hero.tier ?? STARTING_TIER;
  return place === "world"
    ? characterWorldArtUrl(hero.species, tier, hero.class)
    : characterPortraitArtUrl(hero.species, tier, hero.class);
}

/**
 * The URL that draws this hero in `place`. Today it is her painting as
 * painted; #666 returns her tinted painting where it has a mask, which is why
 * surfaces call this (or `useHeroArt` / `loadHeroTexture`) and never the
 * helpers.
 */
export function heroArtUrl(hero: HeroArtSubject, place: HeroArtPlace): string {
  return heroPaintingUrl(hero, place);
}

/** The same hero, drawn from her base painting: every family's fallback. */
export function heroBase<H extends HeroArtSubject>(hero: H): Omit<H, "class"> & { readonly class: undefined } {
  return { ...hero, class: undefined };
}
