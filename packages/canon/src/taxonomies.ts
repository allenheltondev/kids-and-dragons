/**
 * The twelve canon taxonomies — docs/canon-contract.md §3 and §4.
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
 * enums, because those have to mean the same thing in all twelve.
 */

import { z } from "zod";
import { canonRef, edge, Slug } from "./ids.js";
import { PlaceLore } from "./lore.js";
import { Encounter } from "./encounter.js";
import { Mechanics, mechanicsProblems } from "./mechanics.js";
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

/**
 * What a place is on the map. Shared by `biome` and `location` since the D6
 * merge folded `geography.yaml`'s regions and sites into them.
 *
 * `map_provenance` is optional here and required on `biome`: every ecological
 * region is drawn, but a town authored in `locations.yaml` need never have been.
 *
 * `lore` here overrides the envelope's: a place's storyteller half is a past
 * and a reputation (`PlaceLore`), not a personality — see lore.ts.
 */
const Place = Envelope.extend({
  map_provenance: MapProvenance.optional(),
  map_anchor: MapAnchor.optional(),
  access: z.strictObject({ mode: Slug, fixed_routes: z.boolean() }).optional(),
  lore: PlaceLore.optional(),
});

/** Who and what lives in a place. A settlement has people; a whirlpool does not. */
const Inhabitants = z.strictObject({
  primary_peoples: edge("species", "people"),
  supporting_peoples: edge("species", "people"),
  cultural_orders: edge("faction", "people"),
  ambient_creatures: edge("creature"),
  dangerous_creatures: edge("creature"),
  legendary_beings: edge("creature"),
  supernatural_manifestations: edge("creature"),
  population_rule: z.string().optional(),
});

// ---------------------------------------------------------------------------
// biome — an ecological region: climate, wildlife, art, and its place on the map.
// ---------------------------------------------------------------------------

export const Biome = Place.extend({
  map_label: z.string().min(1),
  environment_type: Slug,
  climate: z.string(),
  danger_level: DangerLevel,
  parent_biome: canonRef("biome").optional(),

  // Absorbed from geography.yaml `regions` by the D6 merge.
  relative_position: Slug,
  borders: edge("biome"),
  /**
   * Direction → the thing in the way. D5 made these real references: the
   * Expanse is closed to the south by Mount Red Sky and to the east by the
   * Great River, and both are entities. They used to be free strings that
   * looked like ids, which is the worst of both.
   */
  barriers: z.record(z.string(), canonRef("biome", "location", "feature")).optional(),
  separated_from: z
    .array(z.strictObject({ region: canonRef("biome"), by: canonRef("feature") }))
    .default([]),
  contains_sites: edge("location"),
  contains_features: edge("feature"),
  nearby_sites: edge("location"),
  water_features: edge("feature"),
  /** A named sea. Not an entity — the map has no sea taxonomy (D5). */
  coast: Slug.optional(),

  /**
   * Already the reverse index an encounter generator needs — "what could
   * plausibly be in this fight". Required on a biome: an ecological region with
   * nothing living in it is a gap, not a fact.
   */
  inhabitants: Inhabitants,
  map_provenance: MapProvenance,

  relationships: z.strictObject({
    /** Named places inside this biome. One taxonomy since the D6 merge. */
    locations: edge("location", "route", "feature", "biome"),
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
    primary_locations: edge("biome", "location"),
    secondary_locations: edge("biome", "location"),
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
    primary_locations: edge("biome", "location"),
    creatures: edge("creature"),
    items: edge("item"),
  }),
  /** D9/D10 — what it does in a fight, and what it takes instead of one. */
  encounter: Encounter.optional(),
}).superRefine((creature, ctx) => {
  const dangerous = creature.classification !== "ambient_creature";
  const { encounter, danger_level: danger } = creature;

  // A creature that is not dangerous does not get a stat block. Meeting it is a
  // scene, not a fight, and numbers invite an author to start one.
  if (!dangerous && encounter) {
    ctx.addIssue({
      code: "custom",
      path: ["encounter"],
      message: `an ambient creature has no encounter block — remove it, or change its classification`,
    });
    return;
  }
  if (!encounter) {
    if (dangerous) {
      ctx.addIssue({
        code: "custom",
        path: ["encounter"],
        message: `a ${creature.classification} needs an encounter block (D9)`,
      });
    }
    return;
  }

  // The band/danger_level gate and the stat resolution live in
  // tools/canon/check.ts, which can read content/rules.json. This package
  // deliberately does not — see the `Band` doc in encounter.ts.

  // D10. The instruction in creatures.yaml says encounters should *usually*
  // permit more than combat; a dangerous creature with no way past it but a
  // fight is the exception, and should have to be one deliberately.
  if (encounter.resolutions.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["encounter", "resolutions"],
      message: `no way past this creature except fighting it — agent_instructions asks for at least one (D10)`,
    });
  }
});

// ---------------------------------------------------------------------------
// people — sapient peoples, not individuals. See D8 on named characters.
// ---------------------------------------------------------------------------

export const People = Envelope.extend({
  classification: z.enum(["supporting_people", "cultural_order"]),
  sapience: Sapience,
  scale: Scale,
  /**
   * How this people generally sounds — D8. Prose, and about the *kind*, not a
   * person: "unhurried, states things as facts, never asks a question twice."
   *
   * The live layer voices NPCs from a cached prefix (architecture §6.3), and
   * before this the only voicing anywhere was a chapter's `llmHints.npcVoices`,
   * which is thrown away when the chapter ends. A people-level register means a
   * frogfolk met in chapter one and a frogfolk met in chapter six sound like
   * the same civilisation without anyone re-authoring it.
   */
  speech_register: z.string().optional(),
  relationships: z.strictObject({
    primary_locations: edge("biome", "location"),
    secondary_locations: edge("biome", "location"),
    creatures: edge("creature"),
    items: edge("item"),
  }),
});

// ---------------------------------------------------------------------------
// individual — one named person, owned by a place. D8.
// ---------------------------------------------------------------------------

/**
 * A named individual the world has, as opposed to one a chapter borrows.
 *
 * **The defining rule is `home`, and it is required.** An individual is canon
 * because a location owns them — they are in the town whether or not a chapter
 * is running, and the next chapter set there finds them still standing behind
 * the same counter. Someone who is merely "there at this point in chapter two"
 * is not this; they are the chapter's, and they live in its
 * `llmHints.npcVoices` where they can be forgotten afterward, which is the
 * same split D7 draws between `canon/items.yaml` and a chapter's `props`.
 *
 * Making `home` required rather than optional is what stops that line eroding.
 * There is no way to author a canon individual belonging to nowhere, so the
 * question "should this be canon?" is answered by "can you name the place that
 * would miss them?"
 */
export const Individual = Envelope.extend({
  /** The location that owns them. The whole taxonomy hangs off this. */
  home: canonRef("location"),
  /** Which people they are one of. Absent for a one-of-a-kind. */
  people: canonRef("species", "people").optional(),
  /** What they do where they live — `innkeeper`, `hedge_keeper`, `ferryman`. */
  role: Slug,
  /**
   * Third person, as the game will use them. Authored rather than inferred:
   * nothing about a name tells you this, and getting it wrong at the table is
   * the kind of small unkindness worth spending a field to avoid.
   */
  pronouns: z.string().min(1),
  /** How *this* person talks, over and above their people's register. */
  speech_register: z.string().optional(),
  relationships: z.strictObject({
    /** Places they turn up that are not home. */
    haunts: edge("biome", "location"),
    people: edge("individual"),
    factions: edge("faction"),
    creatures: edge("creature"),
    items: edge("item"),
    quests: edge("quest"),
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
    territory: edge("biome", "location"),
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
    found_in: edge("biome", "location"),
    dropped_by: edge("creature"),
    factions: edge("faction"),
    quests: edge("quest"),
  }),
  /**
   * D7 — what the item does in a child's hands. Optional on purpose: canon
   * holds things that exist in the world without existing in anybody's bag,
   * and `mechanics` is exactly the line between the two. Present means this
   * item projects into `content/items.json`.
   */
  mechanics: Mechanics.optional(),
}).superRefine((item, ctx) => {
  if (!item.mechanics) return;
  for (const message of mechanicsProblems(item.mechanics)) {
    ctx.addIssue({ code: "custom", path: ["mechanics"], message });
  }
});

export const Location = Place.extend({
  location_type: Slug,
  /** The biome this place sits in. The defining field of the taxonomy (D6). */
  parent_biome: canonRef("biome"),

  // Absorbed from geography.yaml `sites` by the D6 merge. All optional: a town
  // authored in locations.yaml need never have been drawn on the map.
  map_label: z.string().min(1).optional(),
  climate: z.string().optional(),
  danger_level: DangerLevel.optional(),
  relative_position: Slug.optional(),
  adjacent_to: edge("biome", "location"),
  access_from: edge("biome", "location"),
  connects: edge("biome", "location"),
  coast_near: edge("biome"),
  coast: Slug.optional(),
  spans: canonRef("feature").optional(),
  /** A settlement has people; a whirlpool does not. Same shape as a biome's. */
  inhabitants: Inhabitants.optional(),

  relationships: z.strictObject({
    biome: edge("biome"),
    /** Places inside this one — the Exchange's docks, a cave's deeper rooms. */
    locations: edge("location", "route", "feature", "biome"),
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
    /**
     * Same target set as Biome/Location `locations`: campaigns whose plot
     * hangs on a river or a bridge (Gemfall's routed middle) get to say so
     * in the graph, so "which campaigns depend on this crossing" is a query.
     */
    locations: edge("location", "route", "feature", "biome"),
    creatures: edge("creature"),
    factions: edge("faction"),
    items: edge("item"),
    quests: edge("quest"),
  }),
});

// ---------------------------------------------------------------------------
// geography — what is left after the D6 merge: the things that are neither an
// ecological region nor a place inside one. Rivers and roads.
//
// `map_provenance` is the D1 split: how we know the place is there (drawn,
// labelled, merely implied), which is a fact about the source map and not
// about canon standing. A place can be `map_implied` and `confirmed` both.
// ---------------------------------------------------------------------------

const Mapped = Place.extend({
  kind: Slug,
  map_provenance: MapProvenance,
});

export const Feature = Mapped.extend({
  contained_by: canonRef("biome").optional(),
  source: canonRef("feature").optional(),
  parent: canonRef("feature").optional(),
  flow_direction: Slug.optional(),
  reaches: edge("biome"),
  crossings: edge("route"),
  mouth: z
    .strictObject({
      map_anchor: MapAnchor.optional(),
      between: edge("biome"),
      /** A river mouth can have a landmark sitting in it (the Bone Yard). */
      near: edge("biome", "location"),
    })
    .optional(),
  outlet: Slug.optional(),
});

export const Route = Mapped.extend({
  connects: edge("biome", "location"),
  crosses: canonRef("feature").optional(),
  via: canonRef("location").optional(),
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
  individual: Individual,
  faction: Faction,
  item: Item,
  location: Location,
  quest: Quest,
  campaign: Campaign,
  feature: Feature,
  route: Route,
} as const;

export type CanonEntity =
  | z.infer<typeof Biome>
  | z.infer<typeof Species>
  | z.infer<typeof Creature>
  | z.infer<typeof People>
  | z.infer<typeof Individual>
  | z.infer<typeof Faction>
  | z.infer<typeof Item>
  | z.infer<typeof Location>
  | z.infer<typeof Quest>
  | z.infer<typeof Campaign>
  | z.infer<typeof Feature>
  | z.infer<typeof Route>;

export type Biome = z.infer<typeof Biome>;
export type Species = z.infer<typeof Species>;
export type Creature = z.infer<typeof Creature>;
export type People = z.infer<typeof People>;
export type Individual = z.infer<typeof Individual>;
export type Faction = z.infer<typeof Faction>;
export type Item = z.infer<typeof Item>;
export type Location = z.infer<typeof Location>;
export type Quest = z.infer<typeof Quest>;
export type Campaign = z.infer<typeof Campaign>;
export type Feature = z.infer<typeof Feature>;
export type Route = z.infer<typeof Route>;
