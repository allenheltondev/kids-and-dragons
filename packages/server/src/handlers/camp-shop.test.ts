/**
 * The chapter-end shop and its vote (#619, docs/camp.md §5.3, §6.2, §12.4):
 * it opens at two paid chapters, the Practice Meadow's not counted, shows
 * pieces in the catalog's order, affordable or not, votes for what it can buy
 * by the choice-point rules, buys at most once a visit, and never overspends
 * or buys twice, however the resolution is retried or raced.
 */

import { describe, expect, it } from "vitest";
import { SAVE_DASH_CASH, shopVoting, storyTurnHolder } from "@kad/shared";
import type { CampRecord } from "@kad/shared";
import { mutateCamp, readCamp } from "./camp.ts";
import { buyPiece } from "./camp-shop.ts";
import { CATALOG, PRACTICE_CHAPTER, harnessFor, seeded, table, type Table } from "./camp-table.testing.ts";
import type { TestHarness } from "../test-support.ts";

/** The crew's camp as a test wants it before the chapter: paid for `paid` chapters, `dashCash` to spend. */
async function seedCamp(t: Table, harness: TestHarness, over: Partial<CampRecord>) {
  const written = await mutateCamp(t.householdId, null, (c) => seeded(c, over), harness.deps);
  expect(written.ok).toBe(true);
}

/** A table that has just finished the chapter, its crew paid for one chapter before with `dashCash` saved. */
async function atShop(dashCash: number, paid = 1) {
  const harness = harnessFor();
  const t = await table(harness);
  await seedCamp(t, harness, { paidChapterCount: paid, dashCash });
  await t.start();
  await t.goto("scene_ending");
  await t.send("p_1", { type: "ENDING_READ" });
  return { harness, t };
}

describe("when the shop opens (§5.3)", () => {
  it("stays shut before the crew has been paid for two chapters, and says so on the tally", async () => {
    const { t } = await atShop(10, 0);
    const s = await t.state();
    expect(s.campTally).toMatchObject({ shopOpen: false, balance: 12 });
    expect(s.campShop).toBeUndefined();
  });

  it("opens on the chapter that is the crew's second paid, with up to three pieces in order and the balance after", async () => {
    const { t } = await atShop(4);
    const shop = (await t.state()).campShop!;
    expect(shop.balance).toBe(6);
    expect(shop.options).toEqual([
      { pieceId: "shop_lantern_string", label: "Lantern string", price: 5, after: 1 },
      { pieceId: "shop_striped_awning", label: "Striped awning", price: 5, after: 1 },
      { pieceId: "shop_log_bench", label: "Log bench", price: 5, after: 1 },
    ]);
    expect(shop.votes).toEqual({});
    expect((await t.state()).campTally).toMatchObject({ shopOpen: true });
  });

  it("shows the pieces when nothing is affordable, with what each still needs, and starts no vote", async () => {
    const { t } = await atShop(0);
    const shop = (await t.state()).campShop!;
    expect(shop.balance).toBe(2);
    expect(shop.options).toEqual([
      { pieceId: "shop_lantern_string", label: "Lantern string", price: 5, after: 2, needs: 3 },
      { pieceId: "shop_striped_awning", label: "Striped awning", price: 5, after: 2, needs: 3 },
      { pieceId: "shop_log_bench", label: "Log bench", price: 5, after: 2, needs: 3 },
    ]);
    const refused = await t.attempt("p_1", { type: "CAMP_VOTE", visit: shop.visit, option: "shop_lantern_string" });
    expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    // With nothing to buy there is no vote, so not even saving is asked.
    const saved = await t.attempt("p_1", { type: "CAMP_VOTE", visit: shop.visit, option: SAVE_DASH_CASH });
    expect(saved).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect((await t.state()).campShop!.votes).toEqual({});
  });

  it("tells a crew whose only paid chapter was the Practice Meadow it is two chapters away, and one with the meadow and one more that it is one", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await mutateCamp(
      t.householdId,
      null,
      (c) => ({ ...c, receipts: { ...c.receipts, chapters: { [PRACTICE_CHAPTER]: { at: "2026-11-01T00:00:00.000Z" } } } }),
      harness.deps,
    );
    expect((await readCamp(t.householdId, null, harness.deps)).paidChapterCount).toBe(0);
    await t.start();
    await t.goto("scene_ending");
    // The meadow and this chapter: still shut, one chapter to go.
    const s = await t.state();
    expect(s.campTally).toMatchObject({ shopOpen: false, shopIn: 1, balance: 2 });
    expect(s.campTally?.uncounted).toBeUndefined();
    expect(s.campShop).toBeUndefined();
  });

  it("counts the Practice Meadow's own chapter end as paid but not toward the shop", async () => {
    const harness = harnessFor(CATALOG, { practice: true });
    const t = await table(harness, undefined, PRACTICE_CHAPTER);
    await t.start();
    await t.goto("scene_ending");
    const s = await t.state();
    expect(s.campTally).toMatchObject({ finished: 2, shopOpen: false, shopIn: 2, uncounted: true, balance: 2 });
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp).toMatchObject({ dashCash: 2, paidChapterCount: 0 });
  });
});

describe("the vote (§6.2, §12.4)", () => {
  it("waits for every seated player, then buys what most voted for, debiting and granting together", async () => {
    const { harness, t } = await atShop(10);
    const visit = (await t.state()).campShop!.visit;
    await t.send("p_1", { type: "CAMP_VOTE", visit, option: "shop_striped_awning" });
    expect((await t.state()).campShop!.result).toBeUndefined();
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(12);
    await t.send("p_2", { type: "CAMP_VOTE", visit, option: "shop_striped_awning" });
    const s = await t.state();
    expect(s.campShop!.result).toEqual({ kind: "bought", pieceId: "shop_striped_awning", label: "Striped awning" });
    expect(s.campShop!.balance).toBe(7);
    expect(s.camp).toMatchObject({ dashCash: 7, owned: expect.arrayContaining(["shop_striped_awning"]) });
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(7);
    expect(camp.owned["shop_striped_awning"]).toMatchObject({ from: "bought", visit });
  });

  it("refuses a vote for a piece the crew cannot afford yet, and buys only what it can", async () => {
    // 3 saved and 2 for this chapter: 5, one 5 short of the stage-2 pieces.
    const harness = harnessFor();
    const t = await table(harness);
    await seedCamp(t, harness, { paidChapterCount: 1, dashCash: 3, grownBy: ["gemfall"], frameStage: 2, owned: { shop_lantern_string: { from: "bought", at: "2026-11-01T00:00:00.000Z" }, shop_striped_awning: { from: "bought", at: "2026-11-01T00:00:00.000Z" } } });
    await t.start();
    await t.goto("scene_ending");
    await t.send("p_1", { type: "ENDING_READ" });
    const shop = (await t.state()).campShop!;
    expect(shop.options).toEqual([
      { pieceId: "shop_weathervane_pole", label: "Weathervane pole", price: 10, after: 5, needs: 5 },
      { pieceId: "shop_log_bench", label: "Log bench", price: 5, after: 0 },
      { pieceId: "shop_pinwheel_pole", label: "Pinwheel pole", price: 5, after: 0 },
    ]);
    const refused = await t.attempt("p_1", { type: "CAMP_VOTE", visit: shop.visit, option: "shop_weathervane_pole" });
    expect(refused).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect((await t.state()).campShop!.votes).toEqual({});
    await t.send("p_1", { type: "CAMP_VOTE", visit: shop.visit, option: "shop_log_bench" });
    await t.send("p_2", { type: "CAMP_VOTE", visit: shop.visit, option: "shop_log_bench" });
    expect((await t.state()).campShop!.result).toMatchObject({ kind: "bought", pieceId: "shop_log_bench" });
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(0);
  });

  it("breaks a tie toward the story turn marker", async () => {
    const { harness, t } = await atShop(10);
    const s0 = await t.state();
    const visit = s0.campShop!.visit;
    const holder = storyTurnHolder(s0)!.playerId;
    const other = holder === "p_1" ? "p_2" : "p_1";
    await t.send(other, { type: "CAMP_VOTE", visit, option: "shop_log_bench" });
    await t.send(holder, { type: "CAMP_VOTE", visit, option: "shop_lantern_string" });
    expect((await t.state()).campShop!.result).toMatchObject({ kind: "bought", pieceId: "shop_lantern_string" });
    expect((await readCamp(t.householdId, null, harness.deps)).owned["shop_log_bench"]).toBeUndefined();
  });

  it("saves the Dash Cash when the table votes to", async () => {
    const { harness, t } = await atShop(10);
    const visit = (await t.state()).campShop!.visit;
    await t.send("p_1", { type: "CAMP_VOTE", visit, option: SAVE_DASH_CASH });
    await t.send("p_2", { type: "CAMP_VOTE", visit, option: SAVE_DASH_CASH });
    expect((await t.state()).campShop!.result).toEqual({ kind: "saved" });
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(12);
  });

  it("does not wait on a player who stepped away without voting", async () => {
    const { harness, t } = await atShop(10);
    const s = await t.state();
    await harness.repo.putState({ ...s, party: s.party.map((m) => (m.playerId === "p_2" ? { ...m, connected: false } : m)) });
    await t.send("p_1", { type: "CAMP_VOTE", visit: s.campShop!.visit, option: "shop_log_bench" });
    expect((await t.state()).campShop!.result).toMatchObject({ kind: "bought", pieceId: "shop_log_bench" });
  });

  it("buys at most once a visit", async () => {
    const { harness, t } = await atShop(20);
    const visit = (await t.state()).campShop!.visit;
    await t.send("p_1", { type: "CAMP_VOTE", visit, option: "shop_lantern_string" });
    await t.send("p_2", { type: "CAMP_VOTE", visit, option: "shop_lantern_string" });
    const again = await t.attempt("p_1", { type: "CAMP_VOTE", visit, option: "shop_log_bench" });
    expect(again.ok).toBe(false);
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(17);
    expect(Object.keys(camp.owned)).toEqual(["shop_lantern_string"]);
  });

  it("is cancelled by leaving the summary, without spending, and a vote after it is refused as stale", async () => {
    const { harness, t } = await atShop(10);
    const visit = (await t.state()).campShop!.visit;
    await t.send("p_1", { type: "CAMP_VOTE", visit, option: "shop_lantern_string" });
    await t.send("p_1", { type: "READY", ready: true });
    await t.send("p_2", { type: "READY", ready: true });
    const lobby = await t.state();
    expect(lobby.phase).toBe("lobby");
    expect(lobby.campShop).toBeUndefined();
    const late = await t.attempt("p_2", { type: "CAMP_VOTE", visit, option: "shop_lantern_string" });
    expect(late).toMatchObject({ ok: false, error: { code: "STALE_DECISION" } });
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(12);
    expect(camp.owned).toEqual({});
  });

  it("refuses a vote naming another visit as stale", async () => {
    const { t } = await atShop(10);
    const refused = await t.attempt("p_1", { type: "CAMP_VOTE", visit: "run:other:1", option: "shop_lantern_string" });
    expect(refused).toMatchObject({ ok: false, error: { code: "STALE_DECISION" } });
    const malformed = await t.attempt("p_1", { type: "CAMP_VOTE", visit: 7, option: "x" } as never);
    expect(malformed).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
  });

  it("refreshes the offer without spending when another table spent first", async () => {
    const { harness, t } = await atShop(4);
    const visit = (await t.state()).campShop!.visit;
    await t.send("p_1", { type: "CAMP_VOTE", visit, option: "shop_lantern_string" });
    // Another room reaching this crew buys the lantern string and spends down.
    await mutateCamp(
      t.householdId,
      null,
      (c) => ({ ...c, dashCash: c.dashCash - 5, owned: { ...c.owned, shop_lantern_string: { from: "bought", visit: "elsewhere", at: "2026-11-05T00:00:00.000Z" } } }),
      harness.deps,
    );
    await t.send("p_2", { type: "CAMP_VOTE", visit, option: "shop_lantern_string" });
    const shop = (await t.state()).campShop!;
    expect(shop.result).toBeUndefined();
    expect(shop.refreshed).toBe(true);
    expect(shop.balance).toBe(1);
    // What is left, none of it affordable now: shown, and no vote.
    expect(shop.options.map((o) => [o.pieceId, o.needs])).toEqual([
      ["shop_striped_awning", 4],
      ["shop_log_bench", 4],
      ["shop_pinwheel_pole", 4],
    ]);
    expect(shopVoting(shop)).toBe(false);
    expect(shop.votes).toEqual({});
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(1);
  });
});

describe("buying under concurrency (§12.4)", () => {
  async function crew(dashCash: number) {
    const harness = harnessFor();
    const t = await table(harness);
    await seedCamp(t, harness, { paidChapterCount: 2, dashCash });
    return { harness, t };
  }

  it("lets only one of two tables racing for the last of the Dash Cash buy, and never overspends", async () => {
    const { harness, t } = await crew(7);
    const [a, b] = await Promise.all([
      buyPiece(t.householdId, null, "visit-a", "shop_lantern_string", CATALOG, harness.deps),
      buyPiece(t.householdId, null, "visit-b", "shop_striped_awning", CATALOG, harness.deps),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["bought", "refresh"]);
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(2);
    expect(Object.keys(camp.owned)).toHaveLength(1);
  });

  it("never buys one piece twice", async () => {
    const { harness, t } = await crew(20);
    const results = await Promise.all([
      buyPiece(t.householdId, null, "visit-a", "shop_log_bench", CATALOG, harness.deps),
      buyPiece(t.householdId, null, "visit-b", "shop_log_bench", CATALOG, harness.deps),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["bought", "refresh"]);
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(15);
  });

  it("charges a retried resolution of one visit once", async () => {
    const { harness, t } = await crew(20);
    const results = await Promise.all([
      buyPiece(t.householdId, null, "visit-a", "shop_log_bench", CATALOG, harness.deps),
      buyPiece(t.householdId, null, "visit-a", "shop_log_bench", CATALOG, harness.deps),
    ]);
    expect(results.map((r) => r.kind)).toEqual(["bought", "bought"]);
    const retried = await buyPiece(t.householdId, null, "visit-a", "shop_pinwheel_pole", CATALOG, harness.deps);
    expect(retried).toMatchObject({ kind: "bought", pieceId: "shop_log_bench" });
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(15);
    expect(Object.keys(camp.owned)).toEqual(["shop_log_bench"]);
  });
});
