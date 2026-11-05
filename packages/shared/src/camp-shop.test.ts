/**
 * Dash Cash's numbers and the chapter-end shop's offer (#619, docs/camp.md
 * §5.2, §5.3, §12.4), held to the doc and to the shipped catalog.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  campPieceLabel,
  chapterPay,
  countsTowardShop,
  paidShopChapters,
  shopEligible,
  shopFor,
  shopIsOpen,
  shopOffer,
  shopOpensIn,
  shopOptionVotable,
  shopVoting,
} from "./camp-shop.js";
import { emptyCamp } from "./camp-record.js";
import type { CampCatalog, CampRecord } from "./types/camp.js";

const catalog = JSON.parse(readFileSync(new URL("../../../content/camp.json", import.meta.url), "utf8")) as CampCatalog;

const camp = (over: Partial<CampRecord> = {}): CampRecord => ({ ...emptyCamp(), ...over });
const owned = (...ids: string[]): CampRecord["owned"] =>
  Object.fromEntries(ids.map((id) => [id, { from: "bought" as const, at: "2026-11-05T00:00:00.000Z" }]));

describe("what a chapter pays (§5.2)", () => {
  it("is 2 for finishing and 1 for each optional objective", () => {
    expect(chapterPay(0)).toBe(2);
    expect(chapterPay(1)).toBe(3);
    expect(chapterPay(3)).toBe(5);
  });
});

describe("the shop (§5.3, §12.4)", () => {
  it("opens once the crew has been paid for two chapters", () => {
    expect(shopIsOpen(camp({ paidChapterCount: 0 }))).toBe(false);
    expect(shopIsOpen(camp({ paidChapterCount: 1 }))).toBe(false);
    expect(shopIsOpen(camp({ paidChapterCount: 2 }))).toBe(true);
    expect([0, 1, 2, 3].map((n) => shopOpensIn(camp({ paidChapterCount: n })))).toEqual([2, 1, 0, 0]);
  });

  it("counts paid chapters from their receipts, a tutorial campaign's left out", () => {
    expect(countsTowardShop({ tutorial: true })).toBe(false);
    expect(countsTowardShop({})).toBe(true);
    expect(countsTowardShop(null)).toBe(true);
    const receipts = { "first-steps-01": {}, "bramblewood-01": {}, "gemfall-01": {} };
    const counts = (id: string) => id !== "first-steps-01";
    expect(paidShopChapters(receipts, counts)).toBe(2);
    expect(paidShopChapters({ "first-steps-01": {}, "bramblewood-01": {} }, counts)).toBe(1);
  });

  it("offers up to three affordable, unowned pieces in the catalog's own order, with the balance after", () => {
    const offer = shopOffer(catalog, camp({ dashCash: 6 }));
    expect(offer.map((o) => o.pieceId)).toEqual(["shop_lantern_string", "shop_striped_awning", "shop_log_bench"]);
    expect(offer[0]).toEqual({ pieceId: "shop_lantern_string", label: "Lantern string", price: 5, after: 1 });
  });

  it("skips what the crew owns, and keeps the order for the rest", () => {
    const offer = shopOffer(catalog, camp({ dashCash: 20, owned: owned("shop_striped_awning") }));
    expect(offer.map((o) => o.pieceId)).toEqual(["shop_lantern_string", "shop_log_bench", "shop_pinwheel_pole"]);
  });

  it("shows pieces the crew cannot afford yet with what they still need, never votable, and starts no vote when none is affordable", () => {
    const offer = shopOffer(catalog, camp({ dashCash: 2 }));
    expect(offer).toEqual([
      { pieceId: "shop_lantern_string", label: "Lantern string", price: 5, after: 2, needs: 3 },
      { pieceId: "shop_striped_awning", label: "Striped awning", price: 5, after: 2, needs: 3 },
      { pieceId: "shop_log_bench", label: "Log bench", price: 5, after: 2, needs: 3 },
    ]);
    expect(offer.some(shopOptionVotable)).toBe(false);
    expect(shopVoting({ options: offer })).toBe(false);
    expect(shopVoting({ options: shopOffer(catalog, camp({ dashCash: 5 })) })).toBe(true);
    expect(shopVoting({ options: shopOffer(catalog, camp({ dashCash: 5 })), result: { kind: "saved" } })).toBe(false);
    expect(shopVoting(undefined)).toBe(false);
  });

  it("prefers affordable pieces when more are eligible than fit, then the cheapest out of reach, shown in catalog order", () => {
    // Stage 2's first three in catalog order (12, 10, 12) are all out of reach at 5; the 5s are not.
    const five = shopOffer(catalog, camp({ frameStage: 2, grownBy: ["gemfall"], dashCash: 5 }));
    expect(five.map((o) => o.pieceId)).toEqual(["shop_lantern_string", "shop_striped_awning", "shop_log_bench"]);
    expect(five.every(shopOptionVotable)).toBe(true);
    // Two affordable (the weathervane, the pinwheel), and the cheapest of the rest (the kettle, before the patchwork awning by order).
    const ten = shopOffer(catalog, camp({ frameStage: 2, grownBy: ["gemfall"], dashCash: 10, owned: owned("shop_lantern_string", "shop_striped_awning", "shop_log_bench") }));
    expect(ten).toEqual([
      { pieceId: "shop_kettle_cookfire", label: "Kettle cookfire", price: 12, after: 10, needs: 2 },
      { pieceId: "shop_weathervane_pole", label: "Weathervane pole", price: 10, after: 0 },
      { pieceId: "shop_pinwheel_pole", label: "Pinwheel pole", price: 5, after: 5 },
    ]);
    // Nothing affordable: the cheapest three, for the crew to look forward to.
    const none = shopOffer(catalog, camp({ frameStage: 2, grownBy: ["gemfall"], dashCash: 0 }));
    expect(none.map((o) => [o.pieceId, o.needs])).toEqual([
      ["shop_lantern_string", 5],
      ["shop_striped_awning", 5],
      ["shop_log_bench", 5],
    ]);
  });

  it("shows every eligible piece when three or fewer are, affordable or not", () => {
    const offer = shopOffer(catalog, camp({ dashCash: 5, owned: owned("shop_lantern_string", "shop_striped_awning") }));
    expect(offer.map((o) => [o.pieceId, o.needs])).toEqual([
      ["shop_log_bench", undefined],
      ["shop_pinwheel_pole", undefined],
    ]);
  });

  it("never sells a later stage's piece early, and keeps lower-stage pieces in later shops", () => {
    expect(shopEligible(catalog, camp({ frameStage: 1 }), "shop_kettle_cookfire")).toBe(false);
    const stage2 = camp({ frameStage: 2, grownBy: ["gemfall"], dashCash: 5 });
    expect(shopOffer(catalog, stage2).map((o) => o.pieceId)).toEqual(["shop_lantern_string", "shop_striped_awning", "shop_log_bench"]);
    const rich = camp({ frameStage: 2, grownBy: ["gemfall"], dashCash: 50 });
    expect(shopOffer(catalog, rich).map((o) => o.pieceId)).toEqual(["shop_kettle_cookfire", "shop_weathervane_pole", "shop_patchwork_awning"]);
  });

  it("uses the nearest shop below a stage that has none of its own", () => {
    expect(shopFor(catalog, 4)?.stage).toBe(2);
    expect(shopFor(catalog, 1)?.stage).toBe(1);
  });

  it("names pieces from their ids", () => {
    expect(campPieceLabel("shop_friends_hammock")).toBe("Friends hammock");
    expect(campPieceLabel("find_wagon_lantern")).toBe("Wagon lantern");
  });
});
