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
import { SHARED_EDITS_PER_MOMENT, growCamp, hotspotsAt, readKit, shownAt } from "@kad/shared";
import type { CampRecord, ClientIntent, RestSetting, RunState } from "@kad/shared";
import { joinRoom } from "./room.ts";
import { CAMP_WRITE_ATTEMPTS, mutateCamp, readCamp } from "./camp.ts";
import { CATALOG, harnessFor, racedCommits, seeded, table, type Table } from "./camp-table.testing.ts";
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
  const written = await mutateCamp(t.householdId, null, (c) => seeded(c, over), harness.deps);
  expect(written.ok).toBe(true);
}

/** Two heroes seated in the lobby, at a stage-2 camp (one finished full campaign) that owns two awnings. */
async function lobby(options: { restSetting?: RestSetting } = {}): Promise<{ harness: TestHarness; t: Table; heroes: { p1: string; p2: string } }> {
  const harness = harnessFor(CATALOG, options);
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
    // Her row has a kit only for the crew she was seated with (#629): nothing picked.
    expect((await harness.repo.getCharacter(t.householdId, heroes.p2))?.kit).toMatchObject({ revision: 0, style: null, tent: null, crews: [t.householdId] });
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

  it("can change, and so can the shared spots, at a rest whose scene is outdoors (§3.2, #625)", async () => {
    const { t, heroes } = await lobby({ restSetting: "outdoor" });
    await t.send("p_1", { type: "READY", ready: true });
    await t.send("p_2", { type: "READY", ready: true });
    await t.send("p_1", { type: "START_CHAPTER", chapterId: "bramblewood-01" });
    await t.goto("scene_camp");
    const s = await t.state();
    expect(s.campMoment).toMatchObject({ kind: "rest", outdoor: true, changes: {} });
    await t.send("p_1", { type: "KIT_EDIT", characterId: heroes.p1, revision: 0, style: "patched" });
    await t.send("p_2", place(s, "awning", "shop_striped_awning"));
    expect((await t.state()).camp?.placed).toMatchObject({ awning: "shop_striped_awning" });
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

  it("have no awning yet at a stage-1 camp", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.send("p_1", hero("Sparklehoof", "unicorn", "songkeeper"));
    const s = await t.state();
    expect(s.camp?.frameStage).toBe(1);
    expect((await t.attempt("p_1", place(s, "awning", "shop_striped_awning"))).error?.message).toContain("not in your camp yet");
  });

  it("put the first finds up at a stage-1 camp, and keep them up when the camp grows (§4.1, §5.3)", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await seedCamp(t, harness, {
      owned: {
        find_picnic_blanket: { from: "found", rewardId: "first-steps-01.picnic_blanket", at: "2026-11-01T00:00:00.000Z" },
        find_wagon_lantern: { from: "found", rewardId: "gemfall-01.wagon_lantern", at: "2026-11-01T00:00:00.000Z" },
        shop_pinwheel_pole: { from: "bought", at: "2026-11-01T00:00:00.000Z" },
      },
    });
    await t.send("p_1", hero("Sparklehoof", "unicorn", "songkeeper"));
    await t.send("p_2", hero("Thistle", "bigfoot", "thornguard"));
    let s = await t.state();
    expect(s.camp?.frameStage).toBe(1);
    await t.send("p_1", place(s, "lanterns", "find_wagon_lantern"));
    s = await t.state();
    await t.send("p_2", place(s, "friends_corner", "find_picnic_blanket"));
    s = await t.state();
    const placed = { lanterns: "find_wagon_lantern", friends_corner: "find_picnic_blanket" };
    expect(s.camp?.placed).toEqual(placed);
    // The banner pole is there too, showing the crew banner until somebody picks the pinwheel.
    expect(s.camp?.placed.banner_pole).toBeUndefined();

    // The crew finishes Gemfall: the camp grows to stage 2, and every pick stays on the
    // hotspot of the same id, which the stage-2 frame lays out in its own place.
    const grown = await mutateCamp(t.householdId, null, (c) => growCamp(c, ["gemfall"]), harness.deps);
    expect(grown.ok).toBe(true);
    const after = await readCamp(t.householdId, null, harness.deps);
    expect(after.frameStage).toBe(2);
    expect(after.placed).toEqual(placed);
    const stage2 = hotspotsAt(CATALOG.hotspots, 2);
    for (const [id, piece] of Object.entries(placed)) {
      const spot = stage2.find((h) => h.id === id)!;
      expect(shownAt(spot, after.placed), id).toBe(piece);
    }
  });
});

describe("a change that does not land (#645)", () => {
  /** p_2 readying up in the same moment: a real action on the seq the change read, landing first. */
  const readyFirst = (harness: TestHarness, t: Table, seq: number) => () =>
    applyAction({ runId: t.runId, playerId: "p_2", seq, intent: { type: "READY", ready: true } }, harness.deps);
  /** Somebody else writing the camp in between (another table, a claim after its own commit). */
  const nudge = (harness: TestHarness, t: Table) => () =>
    mutateCamp(t.householdId, null, (c) => ({ ...c, dashCash: c.dashCash + 1 }), harness.deps);

  it("CAMP_PLACE beaten to its seq by READY is applied once, on the step after it", async () => {
    const { harness, t } = await lobby();
    const s = await t.state();
    const raced = racedCommits(harness, readyFirst(harness, t, s.seq));
    // Its guard is its moment, not the run's seq: read afresh, it lands after the READY.
    const landed = await applyAction({ runId: t.runId, playerId: "p_1", seq: s.seq, intent: place(s, "awning", "shop_striped_awning") }, raced.deps);
    expect(landed).toMatchObject({ ok: true, seq: s.seq + 2 });
    expect(raced.commits()).toBe(2);
    expect((await readCamp(t.householdId, null, harness.deps)).placed).toEqual({ awning: "shop_striped_awning" });
    const after = await t.state();
    expect(after.party.find((m) => m.playerId === "p_2")?.ready).toBe(true);
    expect(after.camp?.placed).toEqual({ awning: "shop_striped_awning" });
    // Her one change this moment, spent once.
    expect(after.campMoment?.changes["p_1"]).toHaveLength(1);
  });

  it("CAMP_UNDO beaten to its seq by READY is applied once, on the step after it", async () => {
    const { harness, t } = await lobby();
    await t.send("p_1", place(await t.state(), "awning", "shop_striped_awning"));
    const s = await t.state();
    expect((await readCamp(t.householdId, null, harness.deps)).placed).toEqual({ awning: "shop_striped_awning" });
    const raced = racedCommits(harness, readyFirst(harness, t, s.seq));
    const landed = await applyAction({ runId: t.runId, playerId: "p_1", seq: s.seq, intent: undo(s) }, raced.deps);
    expect(landed).toMatchObject({ ok: true, seq: s.seq + 2 });
    expect((await readCamp(t.householdId, null, harness.deps)).placed).toEqual({});
    const after = await t.state();
    expect(after.party.find((m) => m.playerId === "p_2")?.ready).toBe(true);
    expect(after.campMoment?.changes["p_1"] ?? []).toHaveLength(0);
  });

  it("KIT_EDIT beaten to its seq by READY is applied on the step after it, once", async () => {
    const { harness, t, heroes } = await lobby();
    const s = await t.state();
    const row = await harness.repo.getCharacter(t.householdId, heroes.p1);
    expect(row?.kit).toMatchObject({ revision: 0, style: null });
    const raced = racedCommits(harness, readyFirst(harness, t, s.seq));
    // Her own kit: the revision it names is what makes it stale, never the run's seq, so a
    // step landing first sends nobody round again. It is read afresh and lands after it.
    const landed = await applyAction(
      { runId: t.runId, playerId: "p_1", seq: s.seq, intent: { type: "KIT_EDIT", characterId: heroes.p1, revision: 0, style: "quilted" } },
      raced.deps,
    );
    expect(landed).toMatchObject({ ok: true, seq: s.seq + 2 });
    expect(raced.commits()).toBe(2);
    const after = await t.state();
    expect(after.seq).toBe(s.seq + 2);
    expect(after.party.find((m) => m.playerId === "p_2")?.ready).toBe(true);
    expect(after.kits?.[heroes.p1]).toMatchObject({ revision: 1, style: "quilted" });
    expect((await harness.repo.getCharacter(t.householdId, heroes.p1))?.kit).toMatchObject({ revision: 1, style: "quilted" });
  });

  it("KIT_EDIT and LOOK_EDIT made on an older seq still land: their revision is their guard", async () => {
    const { harness, t, heroes } = await lobby();
    const s = await t.state();
    await t.send("p_2", { type: "READY", ready: true });
    const kit = await applyAction(
      { runId: t.runId, playerId: "p_1", seq: s.seq, intent: { type: "KIT_EDIT", characterId: heroes.p1, revision: 0, style: "quilted" } },
      harness.deps,
    );
    expect(kit).toMatchObject({ ok: true, seq: s.seq + 2 });
    const look = await applyAction(
      { runId: t.runId, playerId: "p_1", seq: s.seq, intent: { type: "LOOK_EDIT", characterId: heroes.p1, revision: 0, title: "the_bold" } },
      harness.deps,
    );
    expect(look).toMatchObject({ ok: true, seq: s.seq + 3 });
    // A stale revision is still refused, whatever seq it came with.
    const stale = await applyAction(
      { runId: t.runId, playerId: "p_1", seq: s.seq + 3, intent: { type: "KIT_EDIT", characterId: heroes.p1, revision: 0, style: "patched" } },
      harness.deps,
    );
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).not.toBe("STALE_SEQ");
    expect((await t.state()).kits?.[heroes.p1]).toMatchObject({ revision: 1, style: "quilted" });
  });

  it("refuses a placement whose camp keeps moving underneath it: nothing lands and the run stays at its seq", async () => {
    const { harness, t } = await lobby();
    const s = await t.state();
    const before = await readCamp(t.householdId, null, harness.deps);
    // The camp moves between every read and commit, every time this change tries.
    const raced = racedCommits(harness, nudge(harness, t), Infinity);
    const lost = await applyAction({ runId: t.runId, playerId: "p_1", seq: s.seq, intent: place(s, "awning", "shop_striped_awning") }, raced.deps);
    expect(lost).toMatchObject({ ok: false, seq: s.seq, error: { code: "STALE_SEQ" } });
    expect(raced.commits()).toBe(CAMP_WRITE_ATTEMPTS);
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.placed).toEqual({});
    expect(camp.dashCash).toBe(before.dashCash + CAMP_WRITE_ATTEMPTS);
    expect(camp.revision).toBe(before.revision + CAMP_WRITE_ATTEMPTS);
    const after = await t.state();
    expect(after.seq).toBe(s.seq);
    expect(after.campMoment).toEqual(s.campMoment);
    expect(after.camp?.placed).toEqual({});
    expect(await harness.repo.listEvents(t.runId, s.seq)).toEqual([]);
  });

  it("applies a placement again, on the camp as it now stands, when the camp moved on once", async () => {
    const { harness, t } = await lobby();
    const s = await t.state();
    const before = await readCamp(t.householdId, null, harness.deps);
    const raced = racedCommits(harness, nudge(harness, t));
    const landed = await applyAction({ runId: t.runId, playerId: "p_1", seq: s.seq, intent: place(s, "awning", "shop_striped_awning") }, raced.deps);
    expect(landed).toMatchObject({ ok: true, seq: s.seq + 1 });
    expect(raced.commits()).toBe(2);
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp).toMatchObject({ placed: { awning: "shop_striped_awning" }, dashCash: before.dashCash + 1, revision: before.revision + 2 });
    const after = await t.state();
    expect(after.campMoment?.changes["p_1"]).toHaveLength(1);
    expect(after.camp).toMatchObject({ placed: { awning: "shop_striped_awning" }, dashCash: camp.dashCash });
  });
});
