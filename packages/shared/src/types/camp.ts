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

/** A crew piece in the camp catalog (§4.3). Never a kit piece (§12.1). */
export type CampPieceId = string;
/** A shared hotspot: the banner pole, the cookfire, the awning (§4.2). Never a hero's tent. */
export type HotspotId = string;
/** A creature the crew befriended (§4.4). */
export type FriendId = string;
/** A piece in the kit catalog (§4.5, §5.4): its own ids, never a `CampPieceId` (§12.1). */
export type KitPieceId = string;
/** A tent, bedroll and pack style, chosen together (§4.5). */
export type KitStyleId = string;
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
  /** Null until her kid picks one, which is the first-session choice (§5.3). */
  style: KitStyleId | null;
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
