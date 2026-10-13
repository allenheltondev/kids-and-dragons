/**
 * The world map — `content/world.json`.
 *
 * Generated from `canon/biomes.yaml` and `canon/locations.yaml` by
 * `npm run canon:world`, never edited: canon owns where a place is, and the
 * client only needs the coordinates and a name to draw the party standing on
 * it. The painting itself ships as an asset; this file is the key to it.
 *
 * Anchors use canon's own coordinate system — normalized to a 1000×1000
 * square, origin top-left, x east and y south (geography.yaml,
 * `world_metadata`). They are label anchors, not terrain: a marker drawn at
 * one lands on the place's name, which is what a map reader looks for.
 */

export interface WorldAnchor {
  /** 0–1000, west to east. */
  x: number;
  /** 0–1000, north to south. */
  y: number;
}

export interface WorldPlace {
  /** Canon id, `biome.<slug>` or `location.<slug>`. */
  id: string;
  /** What the map calls it. */
  title: string;
  kind: "biome" | "location";
  anchor: WorldAnchor;
  /**
   * The biome a location sits in, as a key of `places` — so a chapter set in
   * a settlement can also say which country it is in. Null for a biome.
   */
  parent: string | null;
}

export interface WorldMap {
  title: string;
  /** The painting, at the URL the client fetches it from, and its pixel size. */
  image: { src: string; width: number; height: number };
  /**
   * Every placed biome and location, keyed by the slug a chapter's `biome`
   * field uses (`exchange`, `sunward_fields`, `mount_red_sky`). Places canon
   * has not put on the map are absent rather than guessed at.
   */
  places: Record<string, WorldPlace>;
}
