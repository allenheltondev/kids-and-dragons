/**
 * Dash Cash's numbers and the chapter-end shop's offer (#619, docs/camp.md
 * §5.2, §5.3, §12.4), held to the doc and to the shipped catalog.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { campPieceLabel, chapterPay, shopEligible, shopFor, shopIsOpen, shopOffer } from "./camp-shop.js";
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

  it("offers nothing when nothing is affordable, so no vote starts", () => {
    expect(shopOffer(catalog, camp({ dashCash: 4 }))).toEqual([]);
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
