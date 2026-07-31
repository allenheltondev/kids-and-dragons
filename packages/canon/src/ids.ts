/**
 * Canon identity — docs/canon-contract.md §5.
 *
 * Every canon id is `<taxonomy-prefix>.<slug>`, in the files themselves. That
 * is decision D2, and it is stronger than "normalize on read" for one reason
 * worth stating: **taxonomy is derivable from an id alone**. `canon.get()`
 * needs no second argument, a DynamoDB key can be computed without a lookup,
 * and an agent handed `creature.glassback_crab` knows what it is holding.
 *
 * The price was a migration of 195 references, paid once. The benefit is that
 * nothing downstream carries resolution logic — `CanonRef` is a string shape
 * plus a registry membership check, and that is all it will ever be.
 */

import { z } from "zod";

/**
 * Lower snake, no leading/trailing/double underscore. D12 made this one regex
 * for the whole corpus: ids, `asset_id`, and tags (which were kebab).
 */
export const SLUG_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const Slug = z.string().regex(SLUG_RE, "must be lower snake_case");

/**
 * The thirteen taxonomies, and the id prefix each one owns.
 *
 * Note two shared prefixes, both deliberate. `geography.yaml`'s `sites` are
 * `location.*` because a site *is* a location — the file it happens to live in
 * is not part of its identity (D6 leaves the ownership split open; this table
 * is what makes either answer a data change). And `character.*` is the playable
 * species from `characters.yaml`, distinct from `npc.*` peoples.
 */
export const TAXONOMY_PREFIX = {
  biome: "biome",
  species: "character",
  creature: "creature",
  people: "npc",
  faction: "faction",
  item: "item",
  location: "location",
  quest: "quest",
  campaign: "campaign",
  region: "geography",
  site: "location",
  feature: "feature",
  route: "route",
} as const satisfies Record<string, string>;

export type Taxonomy = keyof typeof TAXONOMY_PREFIX;
export type IdPrefix = (typeof TAXONOMY_PREFIX)[Taxonomy];

export const TAXONOMIES = Object.keys(TAXONOMY_PREFIX) as Taxonomy[];

/** Every prefix in use, deduplicated (`location` is claimed by two taxonomies). */
export const ID_PREFIXES = [...new Set(Object.values(TAXONOMY_PREFIX))] as IdPrefix[];

const ID_RE = new RegExp(`^(${ID_PREFIXES.join("|")})\\.[a-z0-9]+(?:_[a-z0-9]+)*$`);

export const CanonId = z.string().regex(ID_RE, "must be `<prefix>.<slug>`");

/** The prefix half of an id. Cheap enough to call in a loop. */
export function prefixOf(id: string): IdPrefix | null {
  const dot = id.indexOf(".");
  if (dot < 0) return null;
  const head = id.slice(0, dot) as IdPrefix;
  return ID_PREFIXES.includes(head) ? head : null;
}

/** `creature.glassback_crab` → `glassback_crab`. */
export function slugOf(id: string): string {
  const dot = id.indexOf(".");
  return dot < 0 ? id : id.slice(dot + 1);
}

/**
 * A reference to another entity, tagged with the taxonomies it may point at.
 *
 * Deliberately just `z.string()` at parse time. Every check that matters —
 * is it a well-formed id, does the target exist, is the target's taxonomy one
 * this field allows — happens in the registry, where the answer is knowable.
 *
 * The reason is blast radius. A ref regex here makes one bad reference fail the
 * *whole entity*, which drops it from the registry, which makes every entity
 * pointing at it look broken too: one typo in `biome.enchanted_woods` produced
 * twenty errors in files nobody had touched. Checking refs against the built
 * registry gives exactly one error per bad reference, and checks something
 * stronger than a prefix — that the target is really a biome, not merely a
 * string starting with `biome.`.
 */
export function canonRef(...to: Taxonomy[]) {
  return z.string().describe(`${REF_MARK}${to.join("|")}`);
}

/** How the registry recognises an edge field. See `canonRef`. */
export const REF_MARK = "ref:";

/** The taxonomies a `canonRef` field accepts, read back off its description. */
export function refTargets(description: string | undefined): Taxonomy[] | null {
  if (!description?.startsWith(REF_MARK)) return null;
  return description.slice(REF_MARK.length).split("|") as Taxonomy[];
}

/** An edge field: a list of refs, defaulting to empty. */
export function edge(...to: Taxonomy[]) {
  return z.array(canonRef(...to)).default([]);
}
