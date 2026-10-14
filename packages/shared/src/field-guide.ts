/**
 * `content/field-guide.json` — what a player may read about the world.
 *
 * Canon is written for the people running the game: it holds secrets
 * (`hidden_truths`), guard rails for the storyteller (`canon_constraints`,
 * `agent_instructions`) and prompts for the generator (`common_story_uses`).
 * A child reading the field guide gets none of that. `tools/canon/field-guide.ts`
 * projects canon through an allow-list, so a field reaches this file only because
 * someone named it, and a field added to canon tomorrow stays private until
 * someone decides otherwise.
 *
 * The client reads this and never `@kad/canon` — see the note on the canon
 * package. These are plain interfaces for that reason: no Zod in the bundle.
 */

/**
 * How the UI groups entries. Coarser than canon's taxonomies on purpose: a
 * player does not know that Frogfolk are a `people` and Bigfoot a `species`.
 *
 *   creatures — every `creature.*`, fightable or bandless
 *   peoples   — playable species (`character.*`) and sapient peoples (`npc.*`)
 *   folk      — named individuals (`individual.*`), the people you meet by name
 *   places    — biomes and locations
 *   factions  — orders and groups, only those with lore to tell
 */
export type FieldGuideCategory = "creatures" | "peoples" | "folk" | "places" | "factions";

/** The canon taxonomy an entry came from, for a client that wants to filter finer. */
export type FieldGuideKind =
  | "creature"
  | "species"
  | "people"
  | "individual"
  | "biome"
  | "location"
  | "faction";

/** An opinion a creature or people holds, with the target's name resolved. */
export interface FieldGuideOpinion {
  /** Canon id of the thing liked or disliked. */
  of: string;
  title: string;
  because: string;
}

/** The reverse of an opinion: who holds one about this entry. */
export interface FieldGuideReverseOpinion {
  /** Canon id of the entity that holds the opinion. */
  of: string;
  title: string;
  because: string;
}

export interface FieldGuideLore {
  hook?: string;
  story: string;
  pastimes: string[];
  social?: string;
  likes: FieldGuideOpinion[];
  dislikes: FieldGuideOpinion[];
}

export interface FieldGuidePlaceRelationship {
  /** Canon id of the other place. */
  place: string;
  title: string;
  relationship: string;
}

/** Place lore as the realm broadly knows it — no `hidden_truths`, no tensions. */
export interface FieldGuidePlaceLore {
  origin: string;
  recorded_history?: string;
  cultural_significance?: string;
  common_beliefs: string[];
  disputed_beliefs: string[];
  regional_relationships: FieldGuidePlaceRelationship[];
}

/** A non-combat way past a creature. */
export interface FieldGuideTip {
  /** Matches the encounter resolution kind (e.g. `calm`, `distract`). */
  kind: string;
  text: string;
}

export interface FieldGuideEntry {
  /** Canon id, repeated from the key so an entry stands on its own. */
  id: string;
  category: FieldGuideCategory;
  kind: FieldGuideKind;
  title: string;
  short_description?: string;
  danger_level?: string;
  scale?: string;
  classification?: string;
  asset_id?: string;
  /** Site-absolute URL of the picture, present only when the file exists. */
  art?: string;
  /** Creatures and peoples. Absent when canon has not written any yet. */
  lore?: FieldGuideLore;
  /** Biomes and locations. Absent when canon has not written any yet. */
  place?: FieldGuidePlaceLore;
  /** Who in canon likes this entry. Present only when non-empty. */
  likedBy?: FieldGuideReverseOpinion[];
  dislikedBy?: FieldGuideReverseOpinion[];
  /** Creatures with an encounter block: ways past that are not a fight. */
  tips?: FieldGuideTip[];
}

export interface FieldGuide {
  version: number;
  /** Keyed by canon id, in a stable order: category, then id. */
  entries: Record<string, FieldGuideEntry>;
}
