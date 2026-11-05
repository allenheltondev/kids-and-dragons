/**
 * Dash Cash's pure rules (docs/camp.md §5.2, §5.3, §6.2, §12.4; #619): what a
 * chapter pays, how often a lucky drop comes up, and what the chapter-end
 * shop offers a crew. Shared so the server that spends and the screens that
 * show agree, and pure so a test can hold every number to the doc.
 *
 * Storage is the server's (`handlers/camp.ts`, `handlers/camp-pay.ts`,
 * `handlers/camp-shop.ts`); nothing here reads or writes a store.
 */

import { SHOP_OPENS_AT } from "./camp-record.js";

export { LUCKY_DROP_ODDS, luckyRoll } from "./camp-luck.js";
import type { CampCatalog, CampPieceId, CampRecord, CampShop, CampShopOption, FrameStage } from "./types/camp.js";

/** Finishing a chapter, any ending (§5.2, decided). */
export const CHAPTER_FINISH_PAY = 2;
/** Each optional objective met (§5.2). Goal steps pay nothing. */
export const OBJECTIVE_PAY = 1;
/** What the chapter-end shop shows at most, beside "Save our Dash Cash" (§12.4). */
export const SHOP_OFFER_SIZE = 3;

/** What finishing a chapter pays the crew, given how many optional objectives it met (§5.2). */
export function chapterPay(objectivesMet: number): number {
  return CHAPTER_FINISH_PAY + OBJECTIVE_PAY * Math.max(0, objectivesMet);
}

/** Whether the crew has been paid for enough chapters for the shop (§5.3). */
export function shopIsOpen(camp: Pick<CampRecord, "paidChapterCount">): boolean {
  return camp.paidChapterCount >= SHOP_OPENS_AT;
}

/**
 * A crew piece's name for the screens, from its catalog id until the catalog
 * names its pieces: `shop_striped_awning` reads "Striped awning".
 */
export function campPieceLabel(pieceId: CampPieceId): string {
  const words = pieceId.replace(/^(shop|find|kept|trophy)_/, "").split("_").filter((w) => w !== "");
  const text = words.join(" ");
  return text === "" ? pieceId : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The shop a crew at `stage` sees: the catalog's own list for that stage, or
 * the nearest below it, since a later stage may not have one written yet.
 */
export function shopFor(catalog: Pick<CampCatalog, "shops">, stage: FrameStage): CampShop | null {
  let best: CampShop | null = null;
  for (const shop of catalog.shops) {
    if (shop.stage <= stage && (best === null || shop.stage > best.stage)) best = shop;
  }
  return best;
}

/** A shop piece's price, or null for a piece the shop does not sell. */
export function shopPrice(catalog: Pick<CampCatalog, "crewPieces">, pieceId: CampPieceId): number | null {
  const piece = catalog.crewPieces.find((p) => p.id === pieceId);
  return piece && piece.group === "shop" ? piece.price : null;
}

/**
 * Whether the crew could buy this piece now, money aside (§12.4): its shop
 * lists it, its own stage has been reached (lower-stage pieces stay in later
 * shops), and the crew does not own it.
 */
export function shopEligible(
  catalog: Pick<CampCatalog, "crewPieces" | "shops">,
  camp: Pick<CampRecord, "frameStage" | "owned">,
  pieceId: CampPieceId,
): boolean {
  const shop = shopFor(catalog, camp.frameStage);
  if (!shop || !shop.pieces.includes(pieceId)) return false;
  const piece = catalog.crewPieces.find((p) => p.id === pieceId);
  if (!piece || piece.group !== "shop" || piece.stage > camp.frameStage) return false;
  return !Object.hasOwn(camp.owned, pieceId);
}

/**
 * What the chapter-end shop offers (§6.2, §12.4): up to `SHOP_OFFER_SIZE`
 * pieces the crew can buy, in the shop's own stable order, each with its price
 * and the balance after. Empty when nothing is affordable, which shows the
 * balance and starts no vote.
 */
export function shopOffer(
  catalog: Pick<CampCatalog, "crewPieces" | "shops">,
  camp: Pick<CampRecord, "frameStage" | "owned" | "dashCash">,
  limit = SHOP_OFFER_SIZE,
): CampShopOption[] {
  const shop = shopFor(catalog, camp.frameStage);
  if (!shop) return [];
  const options: CampShopOption[] = [];
  for (const pieceId of shop.pieces) {
    if (options.length >= limit) break;
    const price = shopPrice(catalog, pieceId);
    if (price === null || price > camp.dashCash || !shopEligible(catalog, camp, pieceId)) continue;
    options.push({ pieceId, label: campPieceLabel(pieceId), price, after: camp.dashCash - price });
  }
  return options;
}
