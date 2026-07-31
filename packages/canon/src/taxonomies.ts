/**
 * The thirteen canon taxonomies — docs/canon-contract.md §3 and §4.
 *
 * Each is `Envelope.extend({...})`, so everything generic (the registry, the
 * DynamoDB row, `canon_get`) works against any of them without knowing which.
 *
 * ---------------------------------------------------------------------------
 * EDGES ARE DECLARED HERE, AND THAT IS THE POINT (§4)
 *
 * The relationship type system used to be `RELATIONSHIP_KEY_TO_PREFIX`, a
 * private constant inside `tools/wiki/canon-parser.ts` — ~35 field names mapped
 * to id prefixes, in a tool only the wiki ran. That map *was* the schema.
 *
 * Every `edge(...)` below replaces one of its rows. Referential integrity
 * becomes a registry pass rather than a bespoke resolver, the reverse index
 * falls out for free, and the migration to prefixed ids (D2) was only possible
 * because these declarations disambiguate: `enchanted_woods` is both a
 * `biome.*` and a `geography.*`, and only the *field* knows which one a
 * creature's `primary_locations` means.
 *
 * ---------------------------------------------------------------------------
 * OPEN VOCABULARIES ARE SLUGS, NOT ENUMS
 *
 * `kind`, `relative_position`, `environment_type` and friends are `Slug` here
 * rather than `z.enum([...])`, and are instead checked against the *file's own*
 * `controlled_values` block by `parse.ts`. Two reasons: those vocabularies grow
 * with every elaboration pass, and this makes `controlled_values` load-bearing
 * documentation instead of decorative documentation. Adding a `kind` means
 * defining it, in the file, where an author will read it.
 *
 * Cross-file invariants (`canon_status`, `danger_level`, `sapience`) stay real
 * enums, because those have to mean the same thing in all thirteen.
 */

import { z } from "zod";
import { canonRef, edge, Slug } from "./ids.js";
import {
  CanonStatus,
  DangerLevel,
  Envelope,
  MapProvenance,
  Sapience,
  Scale,
} from "./envelope.js";

export { CanonStatus, MapProvenance };

/** `{ x, y }` against the illustrated map. See `world_metadata.coordinate_system`. */
const MapAnchor = z.strictObject({ x: z.number(), y: z.number() });

// ---------------------------------------------------------------------------
// biome — the ecological + art view of a place. 17 entries, 1:1 with assets/biomes/.
// ---------------------------------------------------------------------------

export const Biome = Envelope.extend({
  /**
   * The map entity this biome dresses. Optional: `biome.open_sea` surrounds
   * the illustrated map rather than appearing on it, and inventing a region
   * with a map anchor for it would be worse than admitting it has none.
   *
   * A `site` as often as a `region`: five
   * biomes (MossHome, Mount Red Sky, The Exchange, Stone Crossing, Skullwater
   * Cave) are named places inside a wider region rather than regions of their
   * own — which is D6's ownership question showing up as a union type.
   */
  geography_id: canonRef("region", "site").optional(),
  map_label: z.string().min(1),
  environment_type: Slug,
  climate: z.string(),
  danger_level: DangerLevel,
  parent_biome: canonRef("biome").optional(),

  /**
   * Who and what lives here — already the reverse index an encounter generator
   * needs ("what could plausibly be in this fight"). `population_rule` is prose
   * sitting among seven edge arrays; D11 proposes lifting it to the envelope.
   */
  inhabitants: z.strictObject({
    primary_peoples: edge("species", "people"),
    supporting_peoples: edge("species", "people"),
    cultural_orders: edge("faction", "people"),
    ambient_creatures: edge("creature"),
    dangerous_creatures: edge("creature"),
    legendary_beings: edge("creature"),
    supernatural_manifestations: edge("creature"),
    population_rule: z.string().optional(),
  }),

  relationships: z.strictObject({
    /**
     * Named places inside this biome. `site` as well as `location` — the two
     * share the `location.` prefix but are different taxonomies (one authored
     * in locations.yaml, one in geography.yaml), which is exactly the ambiguity
     * D6 exists to settle. Until it is, both are legal here.
     */
    locations: edge("location", "site", "route", "feature", "biome"),
    factions: edge("faction"),
    items: edge("item"),
  }),
});

// ---------------------------------------------------------------------------
// species — the six playable peoples. Mirrors rules.json + assets/manifest.json.
// ---------------------------------------------------------------------------

export const Species = Envelope.extend({
  scale: Scale,
  /** The part the accent colour sits on — see assets/manifest.json `signature`. */
  signature_part: z.enum(["horn", "mane", "tail", "wings"]),
  bipedal: z.boolean(),
  relationships: z.strictObject({
    primary_locations: edge("biome"),
    secondary_locations: edge("biome"),
    creatures: edge("creature"),
    items: edge("item"),
  }),
});

// ---------------------------------------------------------------------------
// creature — non-playable fauna. The taxonomy encounter generation reads.
// ---------------------------------------------------------------------------

export const CreatureClassification = z.enum([
  "ambient_creature",
  "dangerous_creature",
  "supernatural_manifestation",
  "legendary_beast",
]);

export const Creature = Envelope.extend({
  classification: CreatureClassification,
  sapience: Sapience,
  scale: Scale,
  danger_level: DangerLevel,
  relationships: z.strictObject({
    primary_locations: edge("biome"),
    creatures: edge("creature"),
    items: edge("item"),
  }),
  // `encounter` (stats, ai, xp, footprint, resolutions) lands here — D9/D10.
});

// ---------------------------------------------------------------------------
// people — sapient peoples, not individuals. See D8 on named characters.
// ---------------------------------------------------------------------------

export const People = Envelope.extend({
  classification: z.enum(["supporting_people", "cultural_order"]),
  sapience: Sapience,
  scale: Scale,
  relationships: z.strictObject({
    primary_locations: edge("biome"),
    secondary_locations: edge("biome"),
    creatures: edge("creature"),
    items: edge("item"),
  }),
});

// ---------------------------------------------------------------------------
// faction, item, location, quest, campaign
// ---------------------------------------------------------------------------

export const Faction = Envelope.extend({
  faction_type: Slug,
  alignment: Slug,
  relationships: z.strictObject({
    headquarters: edge("location"),
    territory: edge("biome", "region"),
    /** Free text: membership is not canon (`agent_instructions`), so not refs. */
    members: z.array(z.string()).default([]),
    enemies: edge("faction"),
    items: edge("item"),
    quests: edge("quest"),
    campaigns: edge("campaign"),
  }),
});

export const Item = Envelope.extend({
  category: Slug,
  rarity: Slug,
  acquisition: z.string(),
  relationships: z.strictObject({
    found_in: edge("biome"),
    dropped_by: edge("creature"),
    factions: edge("faction"),
    quests: edge("quest"),
  }),
  // `mechanics` (kind, icon, effect) lands here when D7 is ruled.
});

export const Location = Envelope.extend({
  location_type: Slug,
  parent_biome: canonRef("biome"),
  relationships: z.strictObject({
    biome: edge("biome"),
    creatures: edge("creature"),
    factions: edge("faction"),
    items: edge("item"),
    quests: edge("quest"),
    campaigns: edge("campaign"),
  }),
});

export const Quest = Envelope.extend({
  quest_type: Slug,
  difficulty: Slug,
  /** Prose today. D-note: these must eventually map onto `ChapterObjective`. */
  objectives: z.array(z.string()).default([]),
  rewards: z.array(z.string()).default([]),
  relationships: z.strictObject({
    locations: edge("location", "biome"),
    creatures: edge("creature"),
    factions: edge("faction"),
    items: edge("item"),
    campaigns: edge("campaign"),
  }),
});

export const Campaign = Envelope.extend({
  campaign_type: Slug,
  chapter_count: z.number().int().positive(),
  relationships: z.strictObject({
    biomes: edge("biome"),
    locations: edge("location", "biome"),
    creatures: edge("creature"),
    factions: edge("faction"),
    items: edge("item"),
    quests: edge("quest"),
  }),
});

// ---------------------------------------------------------------------------
// geography — four taxonomies in one file: the map graph.
//
// `map_provenance` is the D1 split: how we know the place is there (drawn,
// labelled, merely implied), which is a fact about the source map and not
// about canon standing. A place can be `map_implied` and `confirmed` both.
// ---------------------------------------------------------------------------

const Mapped = Envelope.extend({
  kind: Slug,
  map_provenance: MapProvenance,
  map_anchor: MapAnchor.optional(),
});

export const Region = Mapped.extend({
  biome_id: canonRef("biome"),
  relative_position: Slug,
  borders: edge("region"),
  /** Direction → barrier name. Free text: D5 — these look like refs and are not. */
  barriers: z.record(z.string(), z.string()).optional(),
  separated_from: z
    .array(z.strictObject({ region: canonRef("region"), by: canonRef("feature") }))
    .default([]),
  access: z.strictObject({ mode: Slug, fixed_routes: z.boolean() }).optional(),
  contains_sites: edge("site"),
  contains_features: edge("feature"),
  nearby_sites: edge("site"),
  water_features: edge("feature"),
  /** A named sea. Not an entity — the map has no sea taxonomy yet (D5). */
  coast: Slug.optional(),
});

export const Site = Mapped.extend({
  /** Which biome's art dresses this site — the join to assets/biomes/. */
  art_biome_id: canonRef("biome"),
  contained_by: canonRef("region").optional(),
  adjacent_to: edge("region", "site"),
  access_from: edge("region", "site"),
  connects: edge("region", "site"),
  spans: canonRef("feature").optional(),
  relative_position: Slug.optional(),
  coast_near: edge("region"),
  coast: Slug.optional(),
  access: z.strictObject({ mode: Slug, fixed_routes: z.boolean() }).optional(),
});

export const Feature = Mapped.extend({
  contained_by: canonRef("region").optional(),
  source: canonRef("feature").optional(),
  parent: canonRef("feature").optional(),
  flow_direction: Slug.optional(),
  reaches: edge("region"),
  crossings: edge("route"),
  mouth: z
    .strictObject({
      map_anchor: MapAnchor.optional(),
      between: edge("region"),
      near: edge("region"),
    })
    .optional(),
  outlet: Slug.optional(),
});

export const Route = Mapped.extend({
  connects: edge("region", "site"),
  crosses: canonRef("feature").optional(),
  via: canonRef("site").optional(),
  travel_modes: z.array(Slug).default([]),
  constraints: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// The table every generic consumer reads.
// ---------------------------------------------------------------------------

export const SCHEMAS = {
  biome: Biome,
  species: Species,
  creature: Creature,
  people: People,
  faction: Faction,
  item: Item,
  location: Location,
  quest: Quest,
  campaign: Campaign,
  region: Region,
  site: Site,
  feature: Feature,
  route: Route,
} as const;

export type CanonEntity =
  | z.infer<typeof Biome>
  | z.infer<typeof Species>
  | z.infer<typeof Creature>
  | z.infer<typeof People>
  | z.infer<typeof Faction>
  | z.infer<typeof Item>
  | z.infer<typeof Location>
  | z.infer<typeof Quest>
  | z.infer<typeof Campaign>
  | z.infer<typeof Region>
  | z.infer<typeof Site>
  | z.infer<typeof Feature>
  | z.infer<typeof Route>;

export type Biome = z.infer<typeof Biome>;
export type Species = z.infer<typeof Species>;
export type Creature = z.infer<typeof Creature>;
export type People = z.infer<typeof People>;
export type Faction = z.infer<typeof Faction>;
export type Item = z.infer<typeof Item>;
export type Location = z.infer<typeof Location>;
export type Quest = z.infer<typeof Quest>;
export type Campaign = z.infer<typeof Campaign>;
export type Region = z.infer<typeof Region>;
export type Site = z.infer<typeof Site>;
export type Feature = z.infer<typeof Feature>;
export type Route = z.infer<typeof Route>;
