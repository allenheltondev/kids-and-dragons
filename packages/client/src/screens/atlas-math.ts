import type { WorldAnchor, WorldAtlas, WorldBounds, WorldPlace, WorldRoute } from "@kad/shared";

/** Transform the realm frame into a regional frame; never clamp outsiders. */
export function regionalAnchor(anchor: WorldAnchor, bounds: WorldBounds): WorldAnchor | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const x = (anchor.x - bounds.x) / bounds.width;
  const y = (anchor.y - bounds.y) / bounds.height;
  return x < 0 || x > 1 || y < 0 || y > 1 ? null : { x: x * 1000, y: y * 1000 };
}

/** Choose the smallest level that can supply the displayed pixels. */
export function atlasLevel(atlas: WorldAtlas, targetWidth: number): WorldAtlas["levels"][number] {
  const levels = [...atlas.levels].sort((a, b) => a.image.width - b.image.width);
  const level = levels.find((candidate) => candidate.image.width >= targetWidth) ?? levels.at(-1);
  if (!level) throw new Error("An atlas needs at least one level");
  return level;
}

/** Route endpoints and named crossings must be known before a course is shown. */
export function visibleMapRoutes(routes: WorldRoute[], places: Record<string, WorldPlace>, discovered: ReadonlySet<string>): WorldRoute[] {
  const known = new Set(visibleMapPlaces(places, discovered).map((place) => place.id));
  return routes.filter((route) => route.connects.every((id) => known.has(id)) && (!route.via || known.has(route.via)));
}

/** Geography is orientation; specific places are revealed by the household. */
export function visibleMapPlaces(places: Record<string, WorldPlace>, discovered: ReadonlySet<string>): WorldPlace[] {
  return Object.values(places).filter((place) => place.kind === "biome" || discovered.has(place.id));
}
