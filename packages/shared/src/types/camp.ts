/**
 * The crew's camp and each hero's kit, as stored (docs/camp.md §4, §9, §12).
 *
 * Two records with separate owners that never mix (§12.1):
 *
 *   - `CampRecord`: the crew's. `HH#<hhId>` / `CAMP` for the household's first
 *     crew (which has no `CREW#` row or id, architecture §4.5 "Crews") and
 *     `HH#<hhId>` / `CAMP#<crewId>` for each other crew.
 *   - `HeroKit`: one hero's, on her character (`Character.kit`, `CHAR#<charId>`),
 *     so it goes wherever she goes: any crew, any table, a move home (#251), and
 *     it is deleted with her.
 *
 * Both are **outside the commitment rule** (architecture §3.1): nothing here is
 * a provisional gain, so a failed or abandoned campaign never touches either.
 * Both are written only by the server, every write conditional on `revision`
 * (two rooms can reach one crew), and both are versioned like every permanent
 * stored shape (architecture §3.2): `migrateCamp`, `migrateKit` (camp-record.ts).
 *
 * Piece, hotspot, friend, style and color ids are content (`content/camp.json`,
 * #618), so they are plain strings here, named apart so a crew piece and a kit
 * piece cannot be confused in a signature even though both are strings.
 */

import type { ClassId, ClassRank, TierId } from "./domain.js";

/** A crew piece in the camp catalog (§4.3). Never a kit piece (§12.1). */
export type CampPieceId = string;
/** A shared hotspot: the banner pole, the cookfire, the awning (§4.2). Never a hero's tent. */
export type HotspotId = string;
/** A creature the crew befriended (§4.4). */
export type FriendId = string;
/** A piece in the kit catalog (§4.5, §5.4): its own ids, never a `CampPieceId` (§12.1). */
export type KitPieceId = string;
/**
 * A bedroll-and-pack style (`content/camp.json` → `kit.styles`; art
 * `assets/manifest.json` → `camp.kitStyles`). Chosen apart from the tent
 * (`TentStyleId`), since a milestone tent has no bedroll of its own (#618).
 */
export type KitStyleId = string;
/**
 * A tent style (`kit.tents`; art `camp.tentStyles`). The free ones share their
 * ids with the bedroll styles they were painted beside; a milestone tent is a
 * kit piece, unlocked into `HeroKit.unlocked` under this same id.
 */
export type TentStyleId = string;
/** A kit color (§4.5): the palette rule heroes already use. */
export type KitColorId = string;
/**
 * A stable award identity (§12.2): one per authored find or friend offer,
 * shared by every route into the same place, and never a scene id that an
 * editorial revision could change. A content update never resets a claim.
 */
export type RewardId = string;

/** The camp's frame (§4.1): bedrolls, tents, a bigger camp, a grand camp. */
export type FrameStage = 1 | 2 | 3 | 4;

/** How the crew came by one of its pieces (§4.3). */
export interface OwnedCampPiece {
  from: "found" | "bought" | "kept";
  /** The offer that gave it, for a find (§12.2). */
  rewardId?: RewardId;
  /**
   * The chapter-end visit that bought it (`CampShopView.visit`), for a piece
   * bought in the shop (§12.4). It makes a purchase once per visit on the
   * store's side too: a retried resolution finds the piece bought under its
   * own visit and charges nothing.
   */
  visit?: string;
  /** ISO. */
  at: string;
}

/** One of the crew's friends (§4.4), and the offer that brought them. */
export interface CampFriend {
  rewardId: RewardId;
  /** ISO. */
  at: string;
}

/** One receipt: when the claim landed, and in which run when there was one. */
export interface CampReceipt {
  /** ISO. */
  at: string;
  runId?: string;
}

/** A lucky drop's receipt (§5.2): which chapter it fell in, so the cap can count it. */
export interface LuckyDropReceipt extends CampReceipt {
  chapterId: string;
}

/**
 * What the crew has already been given, so nothing is given twice (§12.2).
 *
 * Inline on the camp record rather than one row per receipt. A claim is then
 * one conditional put of one item, with the reward in the same write, which is
 * atomic on its own, needs no TransactWriteItems (100 items, 4 MB) and cannot
 * half-land. The cost is item size, and it is bounded by content, not by play:
 * a chapter is paid once (`chapters`), an offer is claimed once (`rewards`), and
 * lucky drops are at most two per unpaid chapter and are pruned when the chapter
 * is paid (`payChapter`). At ~80 bytes a receipt, today's 42 chapters come to a
 * few KB, and 1,000 chapters to under 100 KB of DynamoDB's 400 KB item limit.
 */
export interface CampReceipts {
  /** Claimed find and friend offers, by `rewardId`. */
  rewards: Record<RewardId, CampReceipt>;
  /** Chapters whose completion Dash Cash has been paid, by chapter id (§5.2). */
  chapters: Record<string, CampReceipt>;
  /**
   * Lucky drops paid, by `dropKey(runId, sceneId)`, for chapters not yet paid.
   * A retried, replayed or reconnected result finds its receipt and pays nothing.
   */
  drops: Record<string, LuckyDropReceipt>;
}

/** `HH#<hhId>` / `CAMP` or `CAMP#<crewId>`: the crew's camp (docs/camp.md §9). */
export interface CampRecord {
  /** The stored shape's version (`CAMP_VERSION`), stamped on the envelope too, as `FieldGuideRecord.v` is. */
  v: number;
  /** Bumped by every write; every write is conditional on the one read (§12.4). */
  revision: number;
  frameStage: FrameStage;
  /**
   * The distinct `growsCamp` campaigns the crew has finished, once each, in the
   * order they were first counted (§12.3). The frame is `1 + grownBy.length`,
   * capped at 4; past that each is a trophy.
   */
  grownBy: string[];
  /** Points the crew spends on the camp (§5.2). Never coins. */
  dashCash: number;
  owned: Record<CampPieceId, OwnedCampPiece>;
  /** Shared hotspots only; a hero's tent is in her kit (§4.2, §4.5). */
  placed: Record<HotspotId, CampPieceId>;
  friends: Record<FriendId, CampFriend>;
  /**
   * Each hero's buddy, by character id, from this crew's friends only (§4.4).
   * On the crew's record because a buddy names a crew friend (§12.1).
   */
  buddies: Record<string, FriendId>;
  /** Chapters the crew has been paid for; the shop opens at 2 (§5.3). */
  paidChapterCount: number;
  receipts: CampReceipts;
}

/** One kit piece a hero holds beyond the free catalog, and where it came from (§5.4). */
export interface KitUnlock {
  from: "catalog" | "found" | "milestone";
  /** The kit find's offer (§12.2). */
  rewardId?: RewardId;
  /**
   * ISO. Absent on a milestone backfilled from a tier or distinction the hero
   * already held (§12.3), whose moment nobody recorded.
   */
  at?: string;
}

/** `Character.kit`: one hero's tent, bedroll, pack and decorations (docs/camp.md §4.5). */
export interface HeroKit {
  /** The stored shape's version (`KIT_VERSION`). */
  v: number;
  /** Bumped by every kit write, from the table or the book (§7, §12.6); stale edits are refused. */
  revision: number;
  /**
   * Her bedroll and pack. Null until her kid picks one, which is the
   * first-session choice (§5.3). Until then the client draws the style its
   * id hash gives her (client `campKitStyle`), as it did before kits were
   * stored. That hash is only ever a fallback and is never written here, so a
   * hero nobody has chosen for keeps looking exactly as she always has.
   */
  style: KitStyleId | null;
  /**
   * Her tent (frame stage 2 and up, §4.1): a free catalog tent, or a
   * milestone tent she has unlocked. Null until her kid picks one, and the
   * client then draws the tent of her bedroll style. Since kit v2 (#618).
   */
  tent: TentStyleId | null;
  /** Null until her kid picks one (§5.3). */
  color: KitColorId | null;
  /** Personal decoration slots, two or three (§4.5). */
  slots: (KitPieceId | null)[];
  unlocked: Record<KitPieceId, KitUnlock>;
}

/**
 * `RunState.camp`: what the screens may show of the crew's camp, at the lobby,
 * a rest and the chapter's end, and never during scenes (§9). Read-only, and
 * slim: no receipts, no history.
 */
export interface CampView {
  /** The record's revision, which a later intent names so a stale one is refused (§12.4). */
  revision: number;
  frameStage: FrameStage;
  /** Finished `growsCamp` campaigns: the trophies. */
  grownBy: string[];
  dashCash: number;
  owned: CampPieceId[];
  placed: Record<HotspotId, CampPieceId>;
  friends: FriendId[];
  buddies: Record<string, FriendId>;
  /** The crew has been paid for two chapters (§5.3). */
  shopOpen: boolean;
}

// ---------------------------------------------------------------------------
// The catalog: content/camp.json (#618)
// ---------------------------------------------------------------------------

/**
 * A kind of shared hotspot a crew piece stands at (§4.2). Where each kind
 * stands at each frame stage is art (`assets/manifest.json` →
 * `camp.frames[].hotspots`).
 */
export type CampHotspotKind = "cookfire" | "awning" | "lanterns" | "friends_corner" | "banner_pole" | "trophy";

/**
 * One authored offer of a find or a friend (§12.2): its stable `rewardId`
 * and the chapter that hands it over. Every way into that chapter that offers
 * it names this one id, so it is given once whichever way the party came.
 */
export interface CampOffer {
  rewardId: RewardId;
  chapter: string;
}

interface CatalogCrewPieceBase {
  /** The manifest crew piece (`camp.crewPieces[].id`) this is. */
  id: CampPieceId;
  hotspot: CampHotspotKind;
}

/**
 * A crew piece in the catalog (§4.3): where it comes from, and for a shop
 * piece what it costs. Never a kit piece (§12.1).
 *
 *   - `frame`: comes with a frame stage (the stage-2 cookfire).
 *   - `kept`: something the game already gives the crew (its banner).
 *   - `find`: a chapter hands it over (`findForCamp`), through one of `offers`.
 *   - `shop`: bought with Dash Cash (§5.2), from `stage`'s shop on.
 *   - `trophy`: for finishing `campaign`.
 */
export type CatalogCrewPiece =
  | (CatalogCrewPieceBase & { group: "frame"; stage: FrameStage })
  | (CatalogCrewPieceBase & { group: "kept" })
  | (CatalogCrewPieceBase & { group: "find"; offers: CampOffer[] })
  | (CatalogCrewPieceBase & { group: "shop"; stage: FrameStage; price: number })
  | (CatalogCrewPieceBase & { group: "trophy"; campaign: string });

/**
 * What the chapter-end shop offers at one frame stage (§12.4), in its stable
 * order. A list prices pieces of its own stage or lower, and every lower-stage
 * piece stays in later shops.
 */
export interface CampShop {
  stage: FrameStage;
  pieces: CampPieceId[];
}

/** A decoration in the kit catalog (§4.5, §5.4). Kit pieces, never crew pieces (§12.1). */
export type CatalogDecoration =
  | { id: KitPieceId; group: "catalog" }
  | { id: KitPieceId; group: "find"; offers: CampOffer[] }
  | { id: KitPieceId; group: "milestone" };

/** A tent style in the kit catalog. A milestone tent is a kit piece (`milestones.tiers`). */
export interface CatalogTent {
  id: TentStyleId;
  group: "catalog" | "milestone";
}

/** Every hero's free kit catalog (§5.4), and the kit pieces earned beyond it. */
export interface KitCatalog {
  /** Bedroll-and-pack styles, all free. */
  styles: { id: KitStyleId }[];
  /**
   * Where kit colors come from. `playerColors`: a `KitColorId` is a player
   * color pair's `palette` name (shared `PLAYER_COLORS`), and null is the
   * hero's own `appearance.accent`, the palette rule heroes already use.
   */
  colors: { from: "playerColors" };
  tents: CatalogTent[];
  decorations: CatalogDecoration[];
}

/** A creature the crew can befriend (§4.4), and what it does when a kid taps it. */
export interface CatalogFriend {
  id: FriendId;
  /** Its figure, as a chapter's `cast` names it (`entities/<id>`, `cast/<id>`). */
  figure: string;
  name: string;
  /** Where it is befriended; a scene of that chapter casts `figure`. */
  offers: CampOffer[];
  /** What it says or does when tapped, one at a time. */
  reactions: string[];
}

/** `content/camp.json`: what the camp *is*. What it looks like is the manifest's `camp`. */
export interface CampCatalog {
  crewPieces: CatalogCrewPiece[];
  shops: CampShop[];
  kit: KitCatalog;
  /**
   * Which tent each appearance tier unlocks and which decoration each class
   * distinction does (§5.4). Shared `MILESTONE_KIT_PIECES` is its copy.
   */
  milestones: {
    tiers: Partial<Record<TierId, TentStyleId>>;
    distinctions: Record<ClassId, Record<Exclude<ClassRank, "none">, KitPieceId>>;
  };
  friends: CatalogFriend[];
}

// ---------------------------------------------------------------------------
// Finds during play (§5.1, §5.4, §12.2)
// ---------------------------------------------------------------------------

/**
 * One find handed over this chapter (`RunState.campFinds`), as the engine
 * recorded it when a `findForCamp` or `findForKit` effect applied: enough for
 * the phones' "For the camp!" and for the chapter's end to say what was found.
 * Whether it was new is the store's to say (`ServerMessage.campClaims`): the
 * server claims it right after the step that recorded it commits, so it is
 * saved when found, never at the chapter's end.
 */
export interface CampFind {
  kind: "camp" | "kit";
  pieceId: CampPieceId | KitPieceId;
  rewardId: RewardId;
  /** The scene the effect applied in. */
  sceneId: string;
  /** A kit find's recipients: the heroes seated when it was found, by character id. */
  heroes?: string[];
}

/**
 * What claiming one find did (`ServerMessage.campClaims`, live only).
 * `piece`: the crew owns it now. `dashCash`: the crew already owned it from
 * another reward, so it got 1 Dash Cash instead. `kit`: `heroes` got their own
 * copy (none, when every one already had it). `none`: this crew had already
 * claimed the reward, so nothing was given.
 */
export interface CampClaimResult {
  rewardId: RewardId;
  kind: "camp" | "kit";
  pieceId: string;
  result: "piece" | "dashCash" | "kit" | "none";
  heroes?: string[];
}

// ---------------------------------------------------------------------------
// Dash Cash at the chapter's end, lucky drops and the shop (§5.2, §6.2, §12.4; #619)
// ---------------------------------------------------------------------------

/**
 * A lucky drop the engine rolled (§5.2): 1 Dash Cash after a mini-game the
 * party succeeded at (`game`) or a fight it won (`fight`), at the scene it
 * happened in. The engine only records it; whether it pays is the store's to
 * say (`claimLuckyDrop`: never twice, never in a paid chapter, at most
 * `LUCKY_DROPS_PER_CHAPTER` a chapter across every attempt).
 */
export interface LuckyDrop {
  sceneId: string;
  kind: "game" | "fight";
}

/**
 * `RunState.campLuck`: the chapter's lucky-drop rolls, as the engine made
 * them with the step's seeded rng, so replaying the log rolls the same.
 * `rolled` is every scene a roll was made at (once a chapter each, so a
 * retried game cannot roll again); `drops` the rolls that came up.
 */
export interface CampLuck {
  rolled: string[];
  drops: LuckyDrop[];
}

/**
 * `RunState.campTally`: the chapter's Dash Cash as its end counts it in
 * (§5.2), snapshotted by the server when the chapter ends. `replay` is a
 * chapter this crew had already been paid for, which pays nothing again.
 */
export interface CampTally {
  /** 2 for finishing, any ending; 0 on a replay. */
  finished: number;
  /** 1 for each optional objective met; 0 on a replay. */
  objectives: number;
  /** Lucky drops that paid this chapter (in the balance from the moment they landed). */
  drops: number;
  replay: boolean;
  /** The crew's Dash Cash once this chapter is paid. */
  balance: number;
  /** The crew has been paid for enough chapters for the shop (§5.3). */
  shopOpen: boolean;
}

/** "Save our Dash Cash": the shop vote's always-free option (§6.2). */
export const SAVE_DASH_CASH = "save";

/** One piece the chapter-end shop offers (§12.4): its price and the balance after. */
export interface CampShopOption {
  pieceId: CampPieceId;
  label: string;
  price: number;
  after: number;
}

/**
 * `RunState.campShop`: the chapter-end shop and its vote (§6.2, §12.4), one
 * per chapter-end visit. Present only on a chapter's summary, and only once
 * the shop is open; gone the moment the table leaves it, which cancels the
 * vote without spending anything.
 *
 * `options` is empty when nothing is affordable: the balance shows and no
 * vote starts. `votes` is playerId → a piece id or `SAVE_DASH_CASH`, counted
 * by the choice-point rules (`tallyVotes`). `result` is what the vote decided,
 * at most one purchase a visit; `refreshed` says the offer was rebuilt
 * because another table reaching this crew spent first.
 */
export interface CampShopView {
  /** This chapter-end visit's id: a `CAMP_VOTE` naming another is stale. */
  visit: string;
  balance: number;
  options: CampShopOption[];
  votes: Record<string, string>;
  result?: { kind: "bought"; pieceId: CampPieceId; label: string } | { kind: "saved" };
  refreshed?: true;
}
