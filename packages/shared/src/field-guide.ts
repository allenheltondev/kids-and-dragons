import type { ClassId, RulesContent, SpeciesId } from "./types/domain.js";
import type { MatchupEdge } from "./types/matchups.js";
import { edgesAgainst, edgesForHero } from "./matchups.js";

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
 *   classes   — the four playable classes (`class.*`); an entry shows once a hero
 *               wears the class or the party has been to its class place
 *   folk      — named individuals (`individual.*`), the people you meet by name
 *   places    — biomes and locations
 *   factions  — orders and groups, only those with lore to tell
 */
export type FieldGuideCategory = "creatures" | "peoples" | "classes" | "folk" | "places" | "factions";

/** The canon taxonomy an entry came from, for a client that wants to filter finer. */
export type FieldGuideKind =
  | "creature"
  | "species"
  | "people"
  | "individual"
  | "biome"
  | "location"
  | "faction"
  | "class";

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

/** One distinction a class awards, with the move it unlocks. */
export interface FieldGuideDistinction {
  rank: "apprentice" | "expert" | "master";
  move: string;
}

/**
 * What a class entry adds to the guide (`class.*`). `home` is the class place
 * that teaches it, as a canon id. The title is carried so the detail screen can
 * link it, but the screen draws it only once the party has found that place:
 * until then the link reads "???" (FieldGuideDetail's EntryLink).
 */
export interface FieldGuideClass {
  /** Canon `role` slug, e.g. `front_line`. */
  role: string;
  /** What a hero wears to be this class, e.g. "a thorn bracer". */
  gear: string;
  /** Canon id of the class place. */
  home: string;
  homeTitle: string;
  distinctions: FieldGuideDistinction[];
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
  /** Classes only: the role, the gear, the three distinctions and the place that teaches it. */
  class?: FieldGuideClass;
  /** Who in canon likes this entry. Present only when non-empty. */
  likedBy?: FieldGuideReverseOpinion[];
  dislikedBy?: FieldGuideReverseOpinion[];
  /** Creatures with an encounter block: ways past that are not a fight. */
  tips?: FieldGuideTip[];
  /**
   * Creatures with a stat line: up to two trait ids, keys of `rules.matchups.traits`
   * (docs/matchups.md). The client draws them only once the entry is discovered.
   */
  traits?: string[];
}

export interface FieldGuide {
  version: number;
  /** Keyed by canon id, in a stable order: category, then id. */
  entries: Record<string, FieldGuideEntry>;
}

/** One line of "good against it" or "careful", in the words of the rule. */
export interface GuideMatchupLine {
  id: string;
  text: string;
}

export interface GuideTrait {
  id: string;
  name: string;
  icon: string;
  text: string;
}

export interface CreatureMatchups {
  traits: GuideTrait[];
  /** Playable species names this creature likes / dislikes (canon `lore`). */
  likes: string[];
  dislikes: string[];
  good: GuideMatchupLine[];
  careful: GuideMatchupLine[];
}

/** Which way an edge pushes from the hero's side: above 0 helps, below hurts. Pairings always help. */
export function edgeHelps(edge: MatchupEdge): number {
  const roll = edge.on === "defend" ? -(edge.roll ?? 0) : (edge.roll ?? 0);
  return roll + (edge.damage ?? 0);
}

const speciesOf = (ref: { of: string }): string | undefined =>
  ref.of.startsWith("character.") ? ref.of.slice("character.".length) : undefined;

/**
 * What the "Fighting it" section of a creature page shows, or null when the
 * creature has no traits and no opinion of a playable species (or the rules
 * have no matchups). Pure; the client only decides whether the page is unlocked.
 */
export function creatureMatchups(rules: RulesContent | null | undefined, entry: FieldGuideEntry): CreatureMatchups | null {
  const table = rules?.matchups;
  if (!rules || !table || entry.kind !== "creature") return null;
  const traitIds = (entry.traits ?? []).filter((id) => table.traits[id] !== undefined);
  const names = (refs: { of: string }[] | undefined): string[] =>
    (refs ?? []).flatMap((ref) => {
      const id = speciesOf(ref);
      const name = id === undefined ? undefined : (rules.species as Record<string, { name: string } | undefined>)[id]?.name;
      return name === undefined ? [] : [name];
    });
  const likes = names(entry.lore?.likes);
  const dislikes = names(entry.lore?.dislikes);
  if (traitIds.length === 0 && likes.length === 0 && dislikes.length === 0) return null;
  const edges = edgesAgainst(rules, traitIds);
  const line = (edge: MatchupEdge): GuideMatchupLine => ({ id: edge.id, text: edge.text });
  return {
    traits: traitIds.map((id) => ({ id, name: table.traits[id]!.name, icon: table.traits[id]!.icon, text: table.traits[id]!.text })),
    likes,
    dislikes,
    good: edges.filter((e) => edgeHelps(e) > 0).map(line),
    careful: edges.filter((e) => edgeHelps(e) < 0).map(line),
  };
}

export interface SpeciesMatchups {
  good: GuideMatchupLine[];
  watch: GuideMatchupLine[];
}

/** "Good at" and "Watch out" for a playable species page (`character.<id>`); null for any other entry or no edges. */
export function speciesMatchups(rules: RulesContent | null | undefined, entryId: string): SpeciesMatchups | null {
  const species = entryId.startsWith("character.") ? entryId.slice("character.".length) : undefined;
  if (!rules?.matchups || species === undefined || !(rules.species as Record<string, unknown>)[species]) return null;
  const seen = new Map<string, MatchupEdge>();
  for (const klass of Object.keys(rules.classes)) {
    for (const edge of edgesForHero(rules, { species: species as SpeciesId, class: klass as ClassId })) {
      const own = [edge.hero.species].flat().includes(species as SpeciesId);
      if (own && !seen.has(edge.id)) seen.set(edge.id, edge);
    }
  }
  const edges = [...seen.values()];
  const line = (edge: MatchupEdge): GuideMatchupLine => ({ id: edge.id, text: edge.text });
  const good = edges.filter((e) => edgeHelps(e) > 0).map(line);
  const watch = edges.filter((e) => edgeHelps(e) < 0).map(line);
  return good.length === 0 && watch.length === 0 ? null : { good, watch };
}

/**
 * "Good at" and "Watch out" for a class page (`class.<id>`), pairings with a
 * species included (they always help); null for any other entry or no edges.
 */
export function classMatchups(rules: RulesContent | null | undefined, entryId: string): SpeciesMatchups | null {
  const klass = entryId.startsWith("class.") ? entryId.slice("class.".length) : undefined;
  if (!rules?.matchups || klass === undefined || !(rules.classes as Record<string, unknown>)[klass]) return null;
  const edges = rules.matchups.edges.filter((edge) => [edge.hero.class ?? []].flat().includes(klass as ClassId));
  const line = (edge: MatchupEdge): GuideMatchupLine => ({ id: edge.id, text: edge.text });
  const good = edges.filter((e) => edgeHelps(e) > 0).map(line);
  const watch = edges.filter((e) => edgeHelps(e) < 0).map(line);
  return good.length === 0 && watch.length === 0 ? null : { good, watch };
}
