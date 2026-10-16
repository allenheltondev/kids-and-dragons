import type { FieldGuide, WorldMap } from "@kad/shared";

/**
 * The art the adventure book shows offline, fetched once while there is a
 * signal so the service worker keeps it (it saves every fingerprinted file
 * that passes through it). Not saved at install, because it is most of a megabyte
 * per phone and only a phone that opens the book needs it.
 *
 *   - the realm painting and every level of the atlas's tiles — the map picks
 *     a level by screen size, so all of them, but not the close-zoom detail
 *     patches (several megabytes, and the map works without them);
 *   - the picture of everything the household has found.
 *
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

/**
 * Fetch `urls` through the service worker so it keeps them — the offline
 * book's art (above), the scenes ahead (prefetch.ts). A few at a time and
 * never ahead of the page's own requests: this is background work on a
 * phone, not a race. Nothing at all without a worker in charge of the page
 * (there would be nowhere to keep it), nor when the phone asks to save data.
 */
export async function warm(urls: readonly string[], lanes = 3): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker?.controller) return;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const queue = [...urls];
  const lane = async (): Promise<void> => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      await fetch(url, { priority: "low" } as RequestInit).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
}
