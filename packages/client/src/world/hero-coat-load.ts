/**
 * The tinter, loaded when a hero first needs it (docs/hero-looks.md §5.3):
 * a hero with a colour, on a painting with a mask. Until then nothing of it
 * is fetched, so it is never in the first paint, and a household whose
 * paintings have no masks yet never loads it at all.
 */

export type HeroCoatsModule = typeof import("./hero-coat-cache");

let loaded: HeroCoatsModule | null = null;
let loading: Promise<HeroCoatsModule> | null = null;

/** The tinter's cache module, loaded on first need. */
export function loadHeroCoats(): Promise<HeroCoatsModule> {
  loading ??= import("./hero-coat-cache").then((m) => (loaded = m));
  return loading;
}

/** The tinter's module if something has already loaded it, for a first render that can use a ready tint. */
export function heroCoatsLoaded(): HeroCoatsModule | null {
  return loaded;
}
