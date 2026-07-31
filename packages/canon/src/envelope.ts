/**
 * The envelope every canon entity satisfies — docs/canon-contract.md §2.
 *
 * This is what makes a *generic* registry, a generic DynamoDB row and a generic
 * `canon_get` tool possible: twelve taxonomies, one guaranteed shape at the
 * top of each. A consumer that only needs "id, title, what is this, is it
 * settled" never has to know which taxonomy it is holding.
 *
 * Objects are **strict**. An unrecognised key is a typo or an undeclared field,
 * and both should stop the build rather than be silently dropped — a schema
 * that quietly ignores `visual_identtiy` is worse than no schema, because the
 * art brief downstream is now missing a field nobody will notice.
 */

import { z } from "zod";
import { CanonId, Slug } from "./ids.js";

/**
 * D1 — one vocabulary for all twelve taxonomies.
 *
 * `intentionally_undefined` is the load-bearing one and the reason this is not
 * a boolean: it marks a protected mystery or an open design slot, and
 * `agent_instructions` leans on it to say "this gap is deliberate, do not fill
 * it." A generator that cannot tell "we haven't decided" from "there is nothing
 * here" will invent something.
 */
export const CanonStatus = z.enum([
  "confirmed",
  "newly_defined",
  "intentionally_undefined",
]);
export type CanonStatus = z.infer<typeof CanonStatus>;

/**
 * How we know a mapped place exists. Geography only.
 *
 * Split out of `canon_status` by D1: these five answer "how do we know this
 * place is there" — it is drawn, it is labelled, it is merely implied by
 * adjacency — which is a question about the source map, not about canon
 * standing. A place can be `map_implied` and still `confirmed` canon.
 */
export const MapProvenance = z.enum([
  "map_canonical",
  "map_canonical_and_biome_matched",
  "map_visible_name_pending",
  "map_implied",
  "visible_unlabeled_feature",
]);
export type MapProvenance = z.infer<typeof MapProvenance>;

/**
 * Rough physical size, smallest first. Descriptive only — the grid footprint an
 * encounter needs is a separate mechanical field (D9), because `medium_to_large`
 * does not tell `EnemySpec` whether a thing occupies one tile or four.
 */
export const Scale = z.enum([
  "tiny",
  "tiny_to_small",
  "small",
  "small_to_medium",
  "medium",
  "medium_to_large",
  "large",
  "very_large",
  "colossal",
  "variable",
]);

export const DangerLevel = z.enum([
  "none",
  "low",
  "moderate",
  "high",
  "legendary",
  "unknown",
]);

export const Sapience = z.enum([
  "animal",
  "semi_sapient",
  "sapient",
  /** Differs between individuals of a kind — a wisp may or may not talk. */
  "variable",
  "unknown",
]);

/**
 * The fields every entity carries.
 *
 * `asset_id` is optional because not every taxonomy has art (a route does not),
 * but where it exists it is **the** join key to `assets/` and `content/` — D3
 * deleted the four rival "other name" fields precisely so there is one.
 */
export const Envelope = z.strictObject({
  id: CanonId,
  title: z.string().min(1),
  asset_id: Slug.optional(),
  canon_status: CanonStatus,
  tags: z.array(Slug).default([]),
  featured: z.boolean().default(false),

  short_description: z.string().min(1).optional(),
  /** Feeds docs/asset-brief.md. */
  visual_identity: z.string().optional(),
  standard_behavior: z.string().optional(),
  /** The "never do this" line — the most load-bearing field for generation. */
  canon_constraints: z.string().optional(),
  common_story_uses: z.string().optional(),
  canon_note: z.string().optional(),
  notes: z.array(z.string()).default([]),
});

export type Envelope = z.infer<typeof Envelope>;
