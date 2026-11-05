/**
 * The camp at the table (#620, docs/camp.md §4.5, §6.1, §12.1, §12.5, §13.1):
 * kit edits are the hero's own player's alone; shared hotspot changes are
 * counted per player, not per device, in a downtime moment the server names;
 * Undo gives back only your own latest change; a piece first owned this
 * chapter is placed for free; racing picks resolve through the revision; a
 * change from a moment the table has left is stale; and an indoor rest has
 * no shared hotspots at all.
 */

import { describe, expect, it } from "vitest";
import { SHARED_EDITS_PER_MOMENT, readKit } from "@kad/shared";
import type { CampRecord, ClientIntent, RunState } from "@kad/shared";
import { joinRoom } from "./room.ts";
import { mutateCamp, readCamp } from "./camp.ts";
import { harnessFor, table, type Table } from "./camp-table.testing.ts";
import type { TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";

const hero = (name: string, species: "unicorn" | "bigfoot", cls: "songkeeper" | "thornguard"): ClientIntent => ({
  type: "CREATE_CHARACTER",
  name,
  species,
  class: cls,
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  appearance: { palette: "meadow", accent: "#7FD4C1" },
});

async function seedCamp(t: Table, harness: TestHarness, over: Partial<CampRecord>): Promise<void> {
  const written = await mutateCamp(t.householdId, null, (c) => ({ ...c, ...over }), harness.deps);
  expect(written.ok).toBe(true);
}

/** Two heroes seated in the lobby, at a stage-2 camp (one finished full campaign) that owns two awnings. */
async function lobby(): Promise<{ harness: TestHarness; t: Table; heroes: { p1: string; p2: string } }> {
  const harness = harnessFor();
  const t = await table(harness);
  await seedCamp(t, harness, {
    grownBy: ["gemfall"],
    frameStage: 2,
    owned: {
      shop_striped_awning: { from: "bought", at: "2026-11-01T00:00:00.000Z" },
      find_noodle_awning: { from: "found", rewardId: "riftlight-exchange-rift.noodle_awning", at: "2026-11-01T00:00:00.000Z" },
      shop_lantern_string: { from: "bought", at: "2026-11-01T00:00:00.000Z" },
    },
  });
  await t.send("p_1", hero("Sparklehoof", "unicorn", "songkeeper"));
  await t.send("p_2", hero("Thistle", "bigfoot", "thornguard"));
  const party = (await t.state()).party;
  return { harness, t, heroes: { p1: party[0]!.character.id, p2: party[1]!.character.id } };
}

const place = (s: RunState, hotspot: string, piece: string | null): ClientIntent => ({ type: "CAMP_PLACE", moment: s.campMoment!.id, hotspot, piece });
const undo = (s: RunState): ClientIntent => ({ type: "CAMP_UNDO", moment: s.campMoment!.id });

describe("a hero's kit (§4.5, §12.1)", () => {
  it("is read into the lobby for each seated hero, unchosen until her kid picks", async () => {
    const { t, heroes } = await lobby();
    const s = await t.state();
    expect(s.campMoment).toMatchObject({ kind: "lobby", outdoor: true, changes: {} });
    expect(s.kits?.[heroes.p1]).toEqual({ revision: 0, style: null, tent: null, color: null, slots: [null, null], unlocked: [] });
    expect(Object.keys(s.kits ?? {}).sort()).toEqual([heroes.p1, heroes.p2].sort());
  });

  it("is changed only by the hero's own player, with no limit, and stored on her row", async () => {
    const { harness, t, heroes } = await lobby();
    const refused = await t.attempt("p_2", { type: "KIT_EDIT", characterId: heroes.p1, revision: 0, style: "quilted" });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe("FORBIDDEN");

    await t.send("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: 0, style: "quilted", tent: "patched", color: "rose" });
    await t.send("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: 1, slots: ["deco_bunting", "deco_pinwheel"] });
    await t.send("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: 2, color: null });
    const s = await t.state();
    expect(s.kits?.[heroes.p1]).toMatchObject({ revision: 3, style: "quilted", tent: "patched", color: null, slots: ["deco_bunting", "deco_pinwheel"] });
    const row = await harness.repo.getCharacter(t.householdId, heroes.p1);
    expect(readKit(row!)).toMatchObject({ style: "quilted", tent: "patched", slots: ["deco_bunting", "deco_pinwheel"] });
    // Her friend's hero is untouched: nobody chose for her, so she keeps her hash.
    expect(s.kits?.[heroes.p2]).toMatchObject({ style: null, tent: null, revision: 0 });
    expect((await harness.repo.getCharacter(t.householdId, heroes.p2))?.kit).toBeUndefined();
  });

  it("refuses a stale revision, a crew piece, a locked milestone tent and a duplicate decoration", async () => {
    const { t, heroes } = await lobby();
    await t.send("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: 0, style: "rolled" });
    const stale = await t.attempt("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: 0, style: "patched" });
    expect(stale.error?.code).toBe("STALE_DECISION");
    const crew = await t.attempt("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: 1, slots: ["shop_log_bench", null] });
    expect(crew.error?.message).toContain("not hers to hang");
    const locked = await t.attempt("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: 1, tent: "mythic" });
    expect(locked.error?.message).toContain("not hers to pick");
    const twice = await t.attempt("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: 1, slots: ["deco_lantern", "deco_lantern"] });
    expect(twice.error?.message).toContain("one slot");
    const malformed = await t.attempt("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: -1, style: "rolled" } as ClientIntent);
    expect(malformed.ok).toBe(false);
  });

  it("can change at an indoor rest, where shared spots cannot", async () => {
    const { t, heroes } = await lobby();
    await t.send("p_1", { type: "READY", ready: true });
    await t.send("p_2", { type: "READY", ready: true });
    await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    expect((await t.state()).kits).toBeUndefined();
    await t.goto("scene_camp");
    const s = await t.state();
    expect(s.campMoment).toMatchObject({ kind: "rest", outdoor: false });
    expect(s.camp?.frameStage).toBe(2);
    expect(s.kits?.[heroes.p1]).toBeDefined();
    await t.send("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: 0, style: "patched" });
    const shared = await t.attempt("p_1", place(s, "awning", "shop_striped_awning"));
    expect(shared.ok).toBe(false);
    expect(shared.error?.message).toContain("full camp");
  });
});

describe("shared hotspots (§6.1, §12.5)", () => {
  it(`allow ${String(SHARED_EDITS_PER_MOMENT)} change a player a moment, counted per player`, async () => {
    const { harness, t } = await lobby();
    let s = await t.state();
    await t.send("p_1", place(s, "awning", "shop_striped_awning"));
    s = await t.state();
    expect(s.camp?.placed).toEqual({ awning: "shop_striped_awning" });
    const again = await t.attempt("p_1", place(s, "lanterns", "shop_lantern_string"));
    expect(again.ok).toBe(false);
    expect(again.error?.message).toContain("camp change for now");
    // Her friend has a change of her own.
    await t.send("p_2", place(s, "lanterns", "shop_lantern_string"));
    expect((await readCamp(t.householdId, null, harness.deps)).placed).toEqual({ awning: "shop_striped_awning", lanterns: "shop_lantern_string" });
  });

  it("are not reset by a second phone or a reconnect", async () => {
    const { harness, t } = await lobby();
    const s = await t.state();
    await t.send("p_1", place(s, "awning", "shop_striped_awning"));
    // The same kid on a second phone, then the first phone coming back.
    const { deviceId } = await harness.identity.issueDeviceToken({ householdId: t.householdId, playerId: "p_1" });
    const code = s.roomCode;
    expect((await joinRoom({ code, principal: { deviceId, householdId: t.householdId, playerId: "p_1" } }, harness.deps)).ok).toBe(true);
    const s2 = await t.state();
    expect(s2.campMoment?.id).toBe(s.campMoment?.id);
    const refused = await t.attempt("p_1", place(s2, "awning", "find_noodle_awning"));
    expect(refused.error?.message).toContain("camp change for now");
  });

  it("refuse a piece the crew does not own, the wrong hotspot, a trophy spot and a kit piece", async () => {
    const { t } = await lobby();
    const s = await t.state();
    expect((await t.attempt("p_1", place(s, "awning", "shop_patchwork_awning"))).error?.message).toContain("does not go there");
    expect((await t.attempt("p_1", place(s, "lanterns", "shop_striped_awning"))).error?.message).toContain("does not go there");
    expect((await t.attempt("p_1", place(s, "trophy_1", "trophy_gemfall"))).error?.message).toContain("Trophies");
    expect((await t.attempt("p_1", place(s, "awning", "deco_bunting"))).error?.message).toContain("does not go there");
    // Invalid changes do not count: the real one still lands.
    await t.send("p_1", place(s, "awning", "shop_striped_awning"));
  });

  it("Undo gives the change back, and only for your own latest change", async () => {
    const { t } = await lobby();
    let s = await t.state();
    await t.send("p_1", place(s, "awning", "shop_striped_awning"));
    s = await t.state();
    await t.send("p_1", undo(s));
    s = await t.state();
    expect(s.camp?.placed).toEqual({});
    expect(s.campMoment?.changes["p_1"]).toEqual([]);
    // Given back: she can change again.
    await t.send("p_1", place(s, "awning", "find_noodle_awning"));
    s = await t.state();
    // Her friend picks over it; her Undo would undo his pick, so it is refused.
    await t.send("p_2", place(s, "awning", "shop_striped_awning"));
    s = await t.state();
    const refused = await t.attempt("p_1", undo(s));
    expect(refused.ok).toBe(false);
    expect(refused.error?.message).toContain("changed that spot");
    expect(s.camp?.placed).toEqual({ awning: "shop_striped_awning" });
    // Nobody can undo what they never did.
    expect((await t.attempt("p_2", undo(s))).ok).toBe(true);
    expect((await t.state()).camp?.placed).toEqual({ awning: "find_noodle_awning" });
  });

  it("resolve picks racing from two tables through the revision: both land, the later wins", async () => {
    const { harness, t } = await lobby();
    const before = await readCamp(t.householdId, null, harness.deps);
    const runA = t.runId;
    const sA = await t.state();
    // This table's pick, and another table reaching the same crew at the same moment.
    const [a, b] = await Promise.all([
      applyAction({ runId: runA, playerId: "p_1", seq: sA.seq, intent: place(sA, "awning", "shop_striped_awning") }, harness.deps),
      mutateCamp(t.householdId, null, (c) => ({ ...c, placed: { ...c.placed, awning: "find_noodle_awning" } }), harness.deps),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const after = await readCamp(t.householdId, null, harness.deps);
    expect(after.revision).toBe(before.revision + 2);
    expect(["shop_striped_awning", "find_noodle_awning"]).toContain(after.placed["awning"]);
  });

  it("refuse a change from a moment the table has left", async () => {
    const { t } = await lobby();
    const lobbyState = await t.state();
    await t.send("p_1", { type: "READY", ready: true });
    await t.send("p_2", { type: "READY", ready: true });
    await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    expect((await t.state()).campMoment).toBeUndefined();
    await t.goto("scene_ending");
    const end = await t.state();
    expect(end.campMoment?.kind).toBe("chapterEnd");
    expect(end.campMoment?.id).not.toBe(lobbyState.campMoment?.id);
    const stale = await t.attempt("p_1", place(lobbyState, "awning", "shop_striped_awning"));
    expect(stale.error?.code).toBe("STALE_DECISION");
    // The chapter end is a moment of its own, with a fresh count.
    await t.send("p_1", place(end, "awning", "shop_striped_awning"));
  });

  it("place a piece first owned this chapter for free at the chapter's end", async () => {
    const { harness, t } = await lobby();
    await seedCamp(t, harness, { paidChapterCount: 1, dashCash: 8 });
    await t.send("p_1", { type: "READY", ready: true });
    await t.send("p_2", { type: "READY", ready: true });
    await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    await t.goto("scene_ending");
    await t.send("p_1", { type: "ENDING_READ" });
    const shop = (await t.state()).campShop!;
    const pick = shop.options.find((o) => o.pieceId === "shop_weathervane_pole")!;
    expect(pick).toBeDefined();
    await t.send("p_1", { type: "CAMP_VOTE", visit: shop.visit, option: pick.pieceId });
    await t.send("p_2", { type: "CAMP_VOTE", visit: shop.visit, option: pick.pieceId });
    let s = await t.state();
    expect(s.campShop?.result).toMatchObject({ kind: "bought", pieceId: "shop_weathervane_pole" });
    // Nothing went up on its own: the banner pole still shows the crew banner (§12.5).
    expect(s.camp?.placed).toEqual({});
    await t.send("p_1", place(s, "banner_pole", "shop_weathervane_pole"));
    s = await t.state();
    expect(s.campMoment?.changes["p_1"]).toEqual([{ hotspot: "banner_pole", before: null, after: "shop_weathervane_pole", counted: false }]);
    // Still her change to make.
    await t.send("p_1", place(s, "awning", "shop_striped_awning"));
    expect((await t.state()).camp?.placed).toEqual({ banner_pole: "shop_weathervane_pole", awning: "shop_striped_awning" });
  });

  it("have none at a stage-1 camp", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.send("p_1", hero("Sparklehoof", "unicorn", "songkeeper"));
    const s = await t.state();
    expect(s.camp?.frameStage).toBe(1);
    expect((await t.attempt("p_1", place(s, "awning", "shop_striped_awning"))).error?.message).toContain("not in your camp yet");
  });
});
