/**
 * Matchups — docs/matchups.md is the design, this is the contract.
 *
 * A matchup is a small, readable reason one hero is better or worse than
 * another against a particular foe or problem: "Burst is strong against
 * thorn-hided things", "Bigfoot is loud, so sneaking is harder", "the wolves
 * trust unicorns". Every number is a roll bonus or penalty of 1 or 2, shown to
 * the table before and during the fight, and none of it locks anyone out: a
 * bad matchup is a worse roll, never a closed door, and a fight can be lost.
 *
 * The values live in `content/rules.json` under `matchups`; the shapes are here.
 */

import type { ClassId, SpeciesId } from "./domain.js";

/** A creature trait, a key of `MatchupRules.traits`: "thorny", "skittish", "armored", "flier". */
export type TraitId = string;

/** What a check scene is asking for, a key of `MatchupRules.checkTags`: "sneak", "force", "climb", "charm". */
export type CheckTagId = string;

export interface TraitDef {
  /** Field guide name, "Thorn-hided". */
  name: string;
  icon: string;
  /** One kid-sized sentence for the field guide: what it is and what it means for a fight. */
  text: string;
  /** Three to five words for the TV, "Burst works well." Kept short on purpose. */
  hint: string;
}

export interface CheckTagDef {
  name: string;
  /** What kind of doing it is, one phrase, for the field guide and the phone. */
  text: string;
}

/** Who an edge belongs to. Every key given must hold; an empty `hero` is anyone. */
export interface EdgeHero {
  species?: SpeciesId | SpeciesId[];
  class?: ClassId | ClassId[];
}

/**
 * Where an edge applies, from the hero's side of the table:
 *  - `attack`:  the hero swings at a foe (roll and/or damage).
 *  - `defend`:  a foe swings at the hero (the foe's roll, so a negative number protects).
 *  - `check`:   the hero rolls a check scene that carries the tag (roll).
 */
export type EdgeOn = "attack" | "defend" | "check";

export interface MatchupEdge {
  /** Stable id, unique in the table; the UI keys on it and tests name it. */
  id: string;
  /** Who it is true of. */
  hero: EdgeHero;
  on: EdgeOn;
  /** `attack`/`defend`: any of the foe's traits. `check`: unused, see `tag`. */
  foe?: TraitId | TraitId[];
  /** `attack`/`defend` only: restrict to these ability ids ("attack" is the plain swing, as in encounter.ts). */
  ability?: string | string[];
  /** `check` only: any of these check tags. */
  tag?: CheckTagId | CheckTagId[];
  /** Added to the d20 roll: the hero's own for `attack`/`check`, the foe's for `defend`. */
  roll?: number;
  /** `attack` only: added to damage on a hit (at least 1 still lands). */
  damage?: number;
  /**
   * The sentence the table reads, in the voice of the field guide, present
   * tense, no numbers in it: "Bramble Wall makes thorny things think twice."
   */
  text: string;
}

/**
 * How a creature's opinion of a species (canon `lore.likes` / `lore.dislikes`
 * of a `character.<species>`) moves the dice. The creature's attack roll
 * against a hero it likes is lower ("it holds back"); against one it dislikes,
 * higher ("it singles them out"). A check scene that `discovers` or `cast`s the
 * creature moves the hero's roll the other way round.
 */
export interface OpinionRules {
  likedFoeRoll: number;
  dislikedFoeRoll: number;
  likedCheckRoll: number;
  dislikedCheckRoll: number;
}

export interface MatchupRules {
  traits: Record<TraitId, TraitDef>;
  checkTags: Record<CheckTagId, CheckTagDef>;
  edges: MatchupEdge[];
  opinion: OpinionRules;
  /**
   * Campaign ids that play without matchups, byte for byte as they did before
   * them: Gemfall, which is pinned (`gemfall-compat.test.ts`). Everything else
   * has them on.
   */
  exemptCampaigns: string[];
}

/** One line of what is moving a roll, for the log, the TV and the phone. */
export interface MatchupNote {
  /** An edge id, or `opinion:liked` / `opinion:disliked`. */
  id: string;
  text: string;
  /** Roll and/or damage change, as applied. Positive helps the hero. */
  roll: number;
  damage: number;
}
