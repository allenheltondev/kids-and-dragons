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
  /**
   * Where each of those came from, as the book says it ("Finished The
   * Gemfall"). The book's copy only (`lookView(look, { sources: true })`);
   * never on the party, where nothing reads it.
   */
  sources?: Record<LookId, string>;
}

/**
 * One look find handed over this chapter (`RunState.lookFinds`), as the
 * engine recorded it when a `findLook` applied: the looks, the reward, and
 * who was seated, since each of them gets her own copy and the table may
 * change before the server writes them.
 */
export interface LookFind {
  looks: LookId[];
  rewardId: string;
  sceneId: string;
  heroes: string[];
}

/**
 * A look a step gave one hero (`ServerMessage.lookUnlocks`, #669), live only
 * and never in the log: told once on her own phone, where her kit's news is
 * (client kit-news.ts). The receipt is already on her row when this is sent.
 */
export interface LookUnlockNews {
  characterId: string;
  lookId: LookId;
  kind: "coat" | "nameplate" | "title";
  /**
   * What earned it, which says when it is told: after the transformation
   * (`tier`), after the rank-up moment (`rank`), otherwise at once.
   */
  cause: "tier" | "rank" | "campaign" | "camp" | "found";
}

// ---------------------------------------------------------------------------
// The catalog: content/looks.json
// ---------------------------------------------------------------------------

/**
 * How a look is had. A starter is free for every hero; every other kind is
 * granted by a receipt on her look (#669; shared look-unlocks.ts): a find by
 * the `findLook` chapter effect, a milestone when it lands, and on read for a
 * hero who already holds it.
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
  /** A camp milestone: her crew's first friend, or its grand camp (frame stage 4, docs/camp.md §4.1). */
  | { from: "milestone"; camp: "firstFriend" | "fullCamp" };

/**
 * A coat (phase 2, #666): a colour for one species' region (§4.2, §7.1). The
 * kid sees it on the **Color** shelf; the code says `coat` whichever part of
 * her it colours.
 *
 * Every coat has a `color`: the plain colour, and the base of a special coat.
 * The special coats (§5.5, #669) are an `effect` added beside it, mapped to a
 * new member of `CoatPaint` below, so a build that does not know an effect
 * still draws the coat in its plain colour.
 */
export interface CatalogCoat {
  id: CoatId;
  name: string;
  unlock: LookUnlockRule;
  /** The species whose region it colours; each species has its own set (§7.1). */
  species: SpeciesId[];
  /** sRGB hex: the coat's colour, and the base of a special coat. */
  color: string;
  /** A special coat (§5.5, #669): absent for a plain one. A build that does not know it draws `color` plain. */
  effect?: CoatEffect;
}

/**
 * What makes a special coat special (§5.5), drawn in code from the region
 * mask, with no new art:
 *
 *   - `two-tone`: the region's lighter half takes `color`, its darker half
 *     `dark`, with a soft step between. A still image.
 *   - `shimmer`: a slow highlight sweeping across the region every few
 *     seconds, over a plain coat (or a two-tone one, given `dark`). The sweep
 *     is an overlay masked by the region (client hero-shimmer.ts), never the
 *     tinter's; under reduced motion it is a still sheen.
 */
export type CoatEffect = { kind: "two-tone"; dark: string } | { kind: "shimmer"; dark?: string };

/**
 * How a coat is painted, as the tinter reads it (client world/hero-coat.ts,
 * tools/art/coat.py). `plain`: the region takes `color` by the §5.2 colour
 * swap. `two-tone` (#669): each pixel takes the swap to `color` above the
 * region's mean lightness and to `dark` below it, mixed across a soft step.
 * A shimmer coat paints as one of these; its sweep is an overlay, not paint.
 * Each kind has its own cache key (`coatPaintKey`).
 */
export type CoatPaint = { kind: "plain"; color: string } | { kind: "two-tone"; color: string; dark: string };

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
