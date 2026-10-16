import type { FieldGuide, WorldMap } from "@kad/shared";

/**
 * The art the adventure book shows offline, fetched once while there is a
 * signal so the service worker keeps it (its "image" strategy saves whatever
 * passes through it). Not saved at install, because it is most of a megabyte
 * per phone and only a phone that opens the book needs it.
 *
 *   - the realm painting and every level of the atlas's tiles — the map picks
 *     a level by screen size, so all of them, but not the close-zoom detail
 *     patches (several megabytes, and the map works without them);
 *   - the picture of everything the household has found.
 *
 * Nothing happens without a worker in charge of the page: fetching for a
 * cache that does not exist would only spend the data.
 */
export function offlineArtFor(
  world: WorldMap | null,
  guide: FieldGuide | null,
  found: readonly string[],
): string[] {
  const urls = new Set<string>();
  if (world) {
    urls.add(world.image.src);
    for (const level of world.atlas?.levels ?? []) for (const tile of level.tiles) urls.add(tile.src);
  }
  if (guide) {
    for (const id of found) {
      const art = guide.entries[id]?.art;
      if (art) urls.add(art);
    }
  }
  return [...urls];
}

export async function warmOfflineArt(urls: readonly string[]): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  // A few at a time: this is background work on a phone, not a race.
  const queue = [...urls];
  const lane = async (): Promise<void> => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      await fetch(url).catch(() => undefined);
    }
  };
  await Promise.all([lane(), lane(), lane()]);
}
