/**
 * Lore — the storyteller's half of an entity.
 *
 * The envelope's prose fields answer operational questions: what does it look
 * like (`visual_identity`), what does it usually do (`standard_behavior`), what
 * must a generator never do (`canon_constraints`). None of them answers the
 * question a table actually asks, which is "who *are* these guys?" — where they
 * come from, what they do on a day nothing attacks them, and how they feel
 * about the neighbours.
 *
 * That is what `lore` holds, and the shape is deliberate:
 *
 *   - `story` is required once a `lore` block exists. A lore block with no
 *     story is a mood board, and the envelope already has one of those.
 *   - `likes` and `dislikes` point at real entities via `canonRef`, so the
 *     registry validates every opinion and indexes it both ways. "Silver
 *     otters like frogfolk" is an edge, which means a frogfolk page can list
 *     who likes *them* without anyone authoring the reverse sentence.
 *   - `because` is required on every opinion. An unexplained dislike reads as
 *     species-level prejudice, which `agent_instructions` forbids in all
 *     twelve files. A dislike with a reason is a story hook; the reason is
 *     the part a chapter can use.
 *
 * Opinions are about *kinds*, not verdicts: a people can dislike boggart
 * bargaining and still owe one a favour. The prose fields carry the nuance;
 * the refs carry the graph.
 */

import { z } from "zod";
import { canonRef } from "./ids.js";

/**
 * One opinion about another kind of creature or people (or, rarely, a named
 * individual or a faction — a legend dragon is entitled to opinions about the
 * Skywardens specifically).
 */
export const LoreOpinion = z.strictObject({
  of: canonRef("creature", "species", "people", "individual", "faction"),
  /** The reason, and the story hook. Never optional — see the header. */
  because: z.string().min(1),
});
export type LoreOpinion = z.infer<typeof LoreOpinion>;

export const Lore = z.strictObject({
  /** One line that makes a reader want the rest. The wiki leads with it. */
  hook: z.string().min(1).optional(),
  /**
   * Who they are and how they came to be this way — the paragraph a game
   * master reads before playing one. Prose, in-world, no mechanics.
   */
  story: z.string().min(1),
  /** What they do for fun. Each entry is one pastime, concrete enough to see. */
  pastimes: z.array(z.string().min(1)).default([]),
  /** How they engage with strangers, neighbours and each other. */
  social: z.string().optional(),
  likes: z.array(LoreOpinion).default([]),
  dislikes: z.array(LoreOpinion).default([]),
});
export type Lore = z.infer<typeof Lore>;

/**
 * Place lore — the storyteller's half of somewhere, rather than someone.
 *
 * A people has a story and opinions; a place has a past and a reputation, and
 * the two need different fields. The load-bearing split here is
 * **who knows what**:
 *
 *   - `origin`, `recorded_history`, `cultural_significance` are what the realm
 *     broadly agrees on. In-world common knowledge.
 *   - `common_beliefs` and `disputed_beliefs` are what people *say*, which is
 *     allowed to be wrong — a superstition is canon about the believers, not
 *     about the place.
 *   - `hidden_truths` is creator canon nobody in-world generally knows. A
 *     generator may build toward one; an NPC must not recite one. On a
 *     protected mystery (`canon_status: intentionally_undefined`) the list
 *     stays empty — an authored secret would quietly close the design slot
 *     that status exists to hold open.
 *
 * `regional_relationships` follows the same rule as `LoreOpinion`: the `place`
 * is a `canonRef`, so every relationship is a validated, reverse-indexed edge —
 * "who has history with the marsh" is a registry query — and the prose carries
 * the part a chapter can actually use.
 */
export const RegionalRelationship = z.strictObject({
  place: canonRef("biome", "location", "feature", "route"),
  /** How the two depend on, fear, or affect one another. Never optional. */
  relationship: z.string().min(1),
});
export type RegionalRelationship = z.infer<typeof RegionalRelationship>;

export const PlaceLore = z.strictObject({
  /** The established or commonly accepted origin of the place. */
  origin: z.string().min(1),
  /** Important events that shaped its present identity. */
  recorded_history: z.string().min(1).optional(),
  /** What the place means to nearby peoples and the wider realm. */
  cultural_significance: z.string().min(1).optional(),
  /** Beliefs held by most people — including regional superstitions and sayings. */
  common_beliefs: z.array(z.string().min(1)).default([]),
  /** Theories some groups accept and others reject. Deliberately unresolved. */
  disputed_beliefs: z.array(z.string().min(1)).default([]),
  /** Canon known to the creator but not generally known in-world. */
  hidden_truths: z.array(z.string().min(1)).default([]),
  regional_relationships: z.array(RegionalRelationship).default([]),
  /** Unresolved political, ecological, magical, or economic pressures. */
  current_tensions: z.array(z.string().min(1)).default([]),
  /** Story seeds arising from the place's past. */
  historical_hooks: z.array(z.string().min(1)).default([]),
});
export type PlaceLore = z.infer<typeof PlaceLore>;
