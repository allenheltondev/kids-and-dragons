import type { WorldAtlas, WorldPlace, WorldRoute } from "@kad/shared";

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

/** A region's danger, said the way a child at the table would say it. */
export function dangerBadge(level: string | undefined, discovered: boolean): { icon: string; label: string } {
  if (!discovered) return { icon: "❔", label: "Danger: unknown…" };
  switch (level?.toLowerCase()) {
    case "none": return { icon: "🌼", label: "Peaceful" };
    case "low": return { icon: "🐾", label: "Mostly friendly" };
    case "moderate": return { icon: "⚔️", label: "Bring a buddy" };
    case "high": return { icon: "🔥", label: "Here be dragons" };
    case "legendary": return { icon: "🐉", label: "Legendary danger" };
    default: return { icon: "❓", label: "Nobody knows…" };
  }
}

/**
 * The household's explorer's trail: every place on the map it has found, in
 * the order it found them (ties by id, so the line never reshuffles).
 */
export function explorerTrail(places: Record<string, WorldPlace>, finds: Readonly<Record<string, { foundAt: string }>>): WorldPlace[] {
  return Object.values(places)
    .filter((place) => finds[place.id])
    .sort((a, b) => finds[a.id]!.foundAt.localeCompare(finds[b.id]!.foundAt) || a.id.localeCompare(b.id));
}

/**
 * A hand-drawn line through points in the 0–1000 frame: each leg bows a
 * little to alternating sides, the way a pen wanders on a paper map.
 */
export function wobblyPath(points: ReadonlyArray<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  const r = (n: number) => Math.round(n * 10) / 10;
  let d = `M${r(points[0]!.x)} ${r(points[0]!.y)}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const bow = (i % 2 ? 0.18 : -0.18);
    const cx = (a.x + b.x) / 2 - (b.y - a.y) * bow;
    const cy = (a.y + b.y) / 2 + (b.x - a.x) * bow;
    d += ` Q${r(cx)} ${r(cy)} ${r(b.x)} ${r(b.y)}`;
  }
  return d;
}
