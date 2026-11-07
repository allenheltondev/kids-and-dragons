/**
 * Hero looks (docs/hero-looks.md §3): what a kid has chosen her hero to look
 * like, and the catalog she chooses from.
 *
 * `HeroLook` sits on the hero beside her kit (`Character.look`), never inside
 * `Appearance`: the appearance is the server's, and its accent is the
 * player's identity colour; the look is the kid's. Like the kit it is outside
 * the commitment rule (no campaign's end touches it), written only by the
 * server, and every write bumps `revision`.
 *
 * Absent until something is chosen: a hero with no `look` draws exactly as
 * before looks, and nothing is backfilled on write, so old heroes, saved runs
 * and the Gemfall gameplay digests do not move. Starter looks are implied by
 * the catalog (`unlock.from: "starter"`), never stored.
 *
 * Coat, nameplate and title ids are content (`content/looks.json`), so they
 * are plain strings here, named apart for the reader.
 */

import type { ClassId, ClassRank, SpeciesId, TierId } from "./domain.js";

/** A colour for her coloured region (§4, phase 2). The book calls this "Color". */
export type CoatId = string;
/** A nameplate frame (§7.2). "plain" is today's look. */
export type NameplateId = string;
/** A title, drawn under her name (§7.3). */
export type TitleId = string;
/** Any look in the catalog: a coat, a frame or a title. Ids are unique across all three. */
export type LookId = string;

/** The stored shape's version. */
export const LOOK_VERSION = 1;

/** `Character.look`: what she has chosen to look like (docs/hero-looks.md §3.1). */
export interface HeroLook {
  /** `LOOK_VERSION`. */
  v: number;
  /** Bumped by every write, from the table or the book (§3.2); a stale `LOOK_EDIT` is refused. */
  revision: number;
  /** Null: as painted. */
  coat: CoatId | null;
  /** Null: the plain plate. */
  nameplate: NameplateId | null;
  /** Null: no title line. */
  title: TitleId | null;
  /** Every look she holds beyond the free starters, with where it came from. */
  unlocked: Record<LookId, LookUnlock>;
}

/** A look she holds beyond the starters, and where it came from (§6). */
export interface LookUnlock {
  from: "starter" | "found" | "milestone";
  /** The find that gave it. */
  rewardId?: string;
  /** ISO; absent on a backfilled milestone. */
  at?: string;
  /** Where it came from, as the book says it: "Finished The Gemfall". */
  source?: string;
}

/**
 * A hero's look as the screens draw and edit it: what is stored, less the
 * receipts. On `ResolvedCharacter.look`, so it rides the party (the TV draws
 * every seated hero's nameplate from it) and the book's heroes. Present only
 * when she has a stored look.
 */
export interface HeroLookView {
  /** What a `LOOK_EDIT` names, so a stale one is refused. */
  revision: number;
  coat: CoatId | null;
  nameplate: NameplateId | null;
  title: TitleId | null;
  /** The ids she holds beyond the starters, sorted. */
  unlocked: LookId[];
}

// ---------------------------------------------------------------------------
// The catalog: content/looks.json
// ---------------------------------------------------------------------------

/**
 * How a look is had. A starter is free for every hero; every other kind is
 * granted by a receipt on her look (#669 grants them).
 */
export type LookUnlockRule =
  | { from: "starter" }
  /** A find in a chapter, given by a content effect. */
  | { from: "found" }
  /** Reaching an appearance tier. */
  | { from: "milestone"; tier: TierId }
  /** A class distinction. */
  | { from: "milestone"; classRank: { class: ClassId; rank: ClassRank } }
  /** Finishing a campaign, on any ending. */
  | { from: "milestone"; campaign: string }
  /** Her crew befriending one of the camp's friends (content/camp.json `friends`). */
  | { from: "milestone"; friend: string }
  /** A camp milestone. */
  | { from: "milestone"; camp: "firstFriend" | "fullCamp" };

/** A coat (phase 2, #666): a colour for one species' region, or a special effect. */
export interface CatalogCoat {
  id: CoatId;
  name: string;
  unlock: LookUnlockRule;
  /** The species whose region it colours; each species has its own set (§7.1). */
  species: SpeciesId[];
  /** sRGB hex. */
  color: string;
}

/** A nameplate frame (§7.2). */
export interface CatalogNameplate {
  id: NameplateId;
  name: string;
  unlock: LookUnlockRule;
  /**
   * Its painting, under `assets/` (UI art, #665). Absent for the plain plate,
   * which is the name as it has always been drawn. Drawn only once the art
   * manifest lists it as delivered (`nameplateFrames.ids`); until then the
   * plain plate stands in, and nothing is requested.
   */
  art?: string;
}

/** A title, drawn under her name (§7.3). */
export interface CatalogTitle {
  id: TitleId;
  /** As drawn: "the Bold", "Thornguard Master". */
  text: string;
  unlock: LookUnlockRule;
}

/** `content/looks.json`: the one catalog of coats, frames and titles (§3.1). */
export interface LookCatalog {
  coats: CatalogCoat[];
  nameplates: CatalogNameplate[];
  titles: CatalogTitle[];
}
