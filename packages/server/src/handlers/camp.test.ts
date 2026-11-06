/**
 * The crew's camp and each hero's kit on the server (#617, docs/camp.md §9,
 * §12): reading, the conditional writes, receipts, migration, the commitment
 * rule, moving home and deleting.
 */

import { describe, expect, it, vi } from "vitest";
import { campView, emptyCamp, newCharacter, readKit, resolveCharacter } from "@kad/shared";
import type { Campaign, CampRecord, Character, Household, RunState } from "@kad/shared";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, stubEngine, T0, type TestHarness } from "../test-support.ts";
import type { CampaignProgressRecord, EventRecord } from "../store/repository.ts";
import type { MemoryRepository } from "../store/memory-repository.ts";
import { applyAction } from "./action.ts";
import {
  claimLuckyDrop,
  claimReward,
  forgetBuddies,
  mutateCamp,
  mutateKit,
  payChapter,
  readCamp,
} from "./camp.ts";
import { settleChapterCompletion } from "./progression.ts";
import { deleteKid, deleteOwnedHousehold } from "./retention.ts";
import { createRoom } from "./room.ts";

const AT = new Date(T0).toISOString();

function campaign(id: string, growsCamp: boolean): Campaign {
  return { id, title: id, blurb: "", chapters: ["bramblewood-01"], ...(growsCamp ? { growsCamp: true as const } : {}) };
}

/** Today's four campaigns as `growsCamp` sees them, and three more full ones to reach the cap. */
const CAMPAIGNS = [
  campaign("first-steps", false),
  campaign("gemfall", true),
  campaign("riftlight", true),
  campaign("the-hollow-crown", false),
  campaign("full-3", true),
  campaign("full-4", true),
  campaign("full-5", true),
];

function harness(): TestHarness {
  return makeHarness({ content: makeContent({ campaigns: CAMPAIGNS }) });
}

function attempt(campaignId: string, status: CampaignProgressRecord["status"], extra: Partial<CampaignProgressRecord> = {}): CampaignProgressRecord {
  return { householdId: "h_test", campaignId, status, setbacks: 0, updatedAt: AT, ...extra };
}

function hero(h: TestHarness, id: string, ownerPlayerId: string, householdId = "h_test"): Character {
  return newCharacter({
    id,
    householdId,
    ownerPlayerId,
    name: `Hero ${id}`,
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 0, quick: 1, clever: 0, heart: 2 },
    appearance: { palette: "dawn", accent: "gold" },
    rules: h.deps.content.rules(),
    now: AT,
  });
}

const addCash = (n: number) => (camp: CampRecord): CampRecord => ({ ...camp, dashCash: camp.dashCash + n });

/**
 * Holds the first `n` camp reads until all `n` have read, so `n` writers
 * start from the same revision: two rooms reaching one crew at once.
 */
function sameMoment(repo: MemoryRepository, n: number): void {
  const read = repo.getCamp.bind(repo);
  let arrived = 0;
  let release!: () => void;
  const everyone = new Promise<void>((resolve) => (release = resolve));
  vi.spyOn(repo, "getCamp").mockImplementation(async (householdId, crew) => {
    const camp = await read(householdId, crew);
    if (arrived < n) {
      arrived++;
      if (arrived === n) release();
      await everyone;
    }
    return camp;
  });
}

/** A crew row, as a lobby's commit writes one (crew.ts), on a throwaway run. */
async function makeCrew(h: TestHarness, householdId: string, crew: string): Promise<void> {
  const state = { runId: `r_${crew}`, seq: 0 } as unknown as RunState;
  await h.repo.putState(state);
  const committed = await h.repo.commit({
    runId: state.runId,
    expectedSeq: 0,
    state: { ...state, seq: 1 },
    event: { seq: 1, at: AT } as unknown as EventRecord,
    crew: { householdId, id: crew, name: `Crew ${crew}`, createdAt: AT },
  });
  expect(committed).toBe(true);
}

describe("reading a camp", () => {
  it("is an empty stage-1 camp before anything is written, and reading writes nothing", async () => {
    const h = harness();
    expect(await readCamp("h_test", null, h.deps)).toEqual(emptyCamp());
    expect(await h.repo.getCamp("h_test")).toBeNull();
  });

  it("keeps the first crew's camp and another crew's apart", async () => {
    const h = harness();
    await mutateCamp("h_test", null, addCash(3), h.deps);
    await mutateCamp("h_test", "cw_1", addCash(1), h.deps);
    expect((await readCamp("h_test", undefined, h.deps)).dashCash).toBe(3);
    expect((await readCamp("h_test", "cw_1", h.deps)).dashCash).toBe(1);
    // Neither key is a prefix of the first crew's campaign rows.
    expect(await h.repo.listCampaignProgress("h_test")).toEqual([]);
  });
});

describe("migration (§12.3)", () => {
  async function veteranCrew(h: TestHarness) {
    await h.repo.putCampaignProgress(attempt("first-steps", "complete"));
    await h.repo.putCampaignProgress(attempt("the-hollow-crown", "complete"));
    // Finished, then started again: the replay carries the completion.
    await h.repo.putCampaignProgress(attempt("gemfall", "active", { everCompleted: true }));
    await h.repo.putCampaignProgress(attempt("riftlight", "failed"));
    // Another crew's finish is its own.
    await h.repo.putCampaignProgress(attempt("riftlight", "complete", { crew: "cw_1" }));
  }

  it("derives the frame and trophies from finished growsCamp campaigns, with no back-pay", async () => {
    const h = harness();
    await veteranCrew(h);
    const camp = await readCamp("h_test", null, h.deps);
    expect(camp).toMatchObject({ frameStage: 2, grownBy: ["gemfall"], dashCash: 0, paidChapterCount: 0, revision: 0 });
    expect(await readCamp("h_test", "cw_1", h.deps)).toMatchObject({ frameStage: 2, grownBy: ["riftlight"] });
  });

  it("run twice gives the same camp, and so does writing it and reading it back", async () => {
    const h = harness();
    await veteranCrew(h);
    const first = await readCamp("h_test", null, h.deps);
    expect(await readCamp("h_test", null, h.deps)).toEqual(first);
    // The first write stores what was read; nothing grows twice.
    const written = await mutateCamp("h_test", null, (camp) => camp, h.deps);
    expect(written).toMatchObject({ ok: true, changed: true });
    const stored = await readCamp("h_test", null, h.deps);
    expect(stored).toEqual({ ...first, revision: 1 });
    expect(await readCamp("h_test", null, h.deps)).toEqual(stored);
    expect(await mutateCamp("h_test", null, () => null, h.deps)).toMatchObject({ ok: true, changed: false });
    expect(await readCamp("h_test", null, h.deps)).toEqual(stored);
  });

  it("reaches stage 3 when Gemfall and Riftlight are both finished, and a replay of either never moves it (#627)", async () => {
    const h = harness();
    await h.repo.putCampaignProgress(attempt("gemfall", "complete"));
    await h.repo.putCampaignProgress(attempt("riftlight", "complete"));
    const three = await readCamp("h_test", null, h.deps);
    expect(three).toMatchObject({ frameStage: 3, grownBy: ["gemfall", "riftlight"] });
    await mutateCamp("h_test", null, (camp) => camp, h.deps);
    // Both played again and finished again: still the stage-3 camp, counted once each.
    await h.repo.putCampaignProgress(attempt("gemfall", "complete", { everCompleted: true }));
    await h.repo.putCampaignProgress(attempt("riftlight", "active", { everCompleted: true }));
    expect(await readCamp("h_test", null, h.deps)).toMatchObject({ frameStage: 3, grownBy: ["gemfall", "riftlight"] });
    // A third full campaign is the grand camp.
    await h.repo.putCampaignProgress(attempt("full-3", "complete"));
    expect(await readCamp("h_test", null, h.deps)).toMatchObject({ frameStage: 4, grownBy: ["gemfall", "riftlight", "full-3"] });
  });

  it("grows once per campaign however often it is replayed, and stops at stage 4", async () => {
    const h = harness();
    await h.repo.putCampaignProgress(attempt("gemfall", "complete"));
    await mutateCamp("h_test", null, (camp) => camp, h.deps);
    await h.repo.putCampaignProgress(attempt("gemfall", "complete", { everCompleted: true }));
    expect(await readCamp("h_test", null, h.deps)).toMatchObject({ frameStage: 2, grownBy: ["gemfall"] });

    for (const id of ["riftlight", "full-3", "full-4", "full-5"]) await h.repo.putCampaignProgress(attempt(id, "complete"));
    const grand = await readCamp("h_test", null, h.deps);
    expect(grand.frameStage).toBe(4);
    // Past the grand camp, a finish is a trophy.
    expect(grand.grownBy).toEqual(["gemfall", "riftlight", "full-3", "full-4", "full-5"]);
  });
});

describe("safe writes (§12.4): two rooms, one crew", () => {
  it("resolves concurrent writes through revision: both land, neither is overwritten", async () => {
    const h = harness();
    sameMoment(h.repo, 2);
    const put = vi.spyOn(h.repo, "putCamp");
    const [a, b] = await Promise.all([
      mutateCamp("h_test", null, addCash(2), h.deps),
      mutateCamp("h_test", null, (camp) => ({ ...camp, placed: { ...camp.placed, banner: "banner_otter" } }), h.deps),
    ]);
    expect(a.ok && b.ok).toBe(true);
    // Three puts: one lost the race on the same read, re-read and landed.
    expect(put).toHaveBeenCalledTimes(3);
    expect(await readCamp("h_test", null, h.deps)).toMatchObject({ revision: 2, dashCash: 2, placed: { banner: "banner_otter" } });
  });

  it("refuses a stale write at the store, and a stale intent before it", async () => {
    const h = harness();
    await mutateCamp("h_test", null, addCash(5), h.deps);
    await mutateCamp("h_test", null, addCash(1), h.deps);
    const now = await readCamp("h_test", null, h.deps);
    expect(now.revision).toBe(2);

    // A writer holding revision 1, and a new-row write where a row exists.
    expect(await h.repo.putCamp({ householdId: "h_test", camp: { ...now, dashCash: 0 }, expectedRevision: 1 })).toBe(false);
    expect(await h.repo.putCamp({ householdId: "h_test", camp: { ...now, dashCash: 0 }, expectedRevision: null })).toBe(false);

    // A phone that saw revision 1 buys nothing.
    const spend = (camp: CampRecord) => ({ ...camp, dashCash: camp.dashCash - 5 });
    expect(await mutateCamp("h_test", null, spend, h.deps, { expectedRevision: 1 })).toMatchObject({ ok: false, reason: "stale" });
    expect(await readCamp("h_test", null, h.deps)).toEqual(now);
    expect(await mutateCamp("h_test", null, spend, h.deps, { expectedRevision: 2 })).toMatchObject({ ok: true, changed: true });
    expect((await readCamp("h_test", null, h.deps)).dashCash).toBe(1);
  });

  it("a losing intent that named its revision is refused, not re-applied", async () => {
    const h = harness();
    sameMoment(h.repo, 2);
    const buy = (camp: CampRecord) => ({ ...camp, owned: { ...camp.owned, [`kettle_${camp.revision}`]: { from: "bought" as const, at: AT } } });
    const results = await Promise.all([
      mutateCamp("h_test", null, buy, h.deps, { expectedRevision: 0 }),
      mutateCamp("h_test", null, buy, h.deps, { expectedRevision: 0 }),
    ]);
    expect(results.map((r) => (r.ok ? "ok" : r.reason)).sort()).toEqual(["ok", "stale"]);
    expect(Object.keys((await readCamp("h_test", null, h.deps)).owned)).toEqual(["kettle_0"]);
  });
});

describe("receipts (§12.2)", () => {
  const wreath = (camp: CampRecord): CampRecord => ({
    ...camp,
    owned: { ...camp.owned, pinecone_wreath: { from: "found", rewardId: "meadow_wreath", at: AT } },
  });

  it("claims a reward once: the second claim applies nothing", async () => {
    const h = harness();
    const first = await claimReward("h_test", null, "meadow_wreath", wreath, h.deps, { runId: "r_1" });
    expect(first).toMatchObject({ ok: true, value: { claimed: true } });
    const again = await claimReward("h_test", null, "meadow_wreath", addCash(1), h.deps);
    expect(again).toMatchObject({ ok: true, changed: false, value: { claimed: false, refused: "claimed" } });
    const camp = await readCamp("h_test", null, h.deps);
    expect(camp.dashCash).toBe(0);
    expect(Object.keys(camp.owned)).toEqual(["pinecone_wreath"]);
    expect(camp.receipts.rewards).toEqual({ meadow_wreath: { at: AT, runId: "r_1" } });
    expect(camp.revision).toBe(1);
  });

  it("claims a reward once under concurrency: three rooms, one claim", async () => {
    const h = harness();
    sameMoment(h.repo, 3);
    const results = await Promise.all(
      [0, 1, 2].map(() => claimReward("h_test", null, "duck_feather", addCash(1), h.deps)),
    );
    expect(results.filter((r) => r.ok && r.value.claimed)).toHaveLength(1);
    expect(results.every((r) => r.ok)).toBe(true);
    const camp = await readCamp("h_test", null, h.deps);
    expect(camp.dashCash).toBe(1);
    expect(camp.revision).toBe(1);
  });

  it("pays a chapter once, counts it for the shop, and prunes its lucky drops", async () => {
    const h = harness();
    const drop = { runId: "r_1", sceneId: "fight_bridge", chapterId: "riftlight-ashspan-bridge" };
    expect(await claimLuckyDrop("h_test", null, drop, addCash(1), h.deps)).toMatchObject({ value: { claimed: true } });
    // A retried, replayed or reconnected result pays nothing.
    expect(await claimLuckyDrop("h_test", null, drop, addCash(1), h.deps)).toMatchObject({ value: { refused: "claimed" } });
    expect(await claimLuckyDrop("h_test", null, { ...drop, sceneId: "game_ice" }, addCash(1), h.deps)).toMatchObject({ value: { claimed: true } });
    // At most two in a chapter.
    expect(await claimLuckyDrop("h_test", null, { ...drop, sceneId: "fight_end" }, addCash(1), h.deps)).toMatchObject({ value: { refused: "cap" } });

    expect(await payChapter("h_test", null, drop.chapterId, addCash(2), h.deps)).toMatchObject({ value: { claimed: true } });
    expect(await payChapter("h_test", null, drop.chapterId, addCash(2), h.deps)).toMatchObject({ value: { refused: "claimed" } });
    // None in a chapter already paid for.
    expect(await claimLuckyDrop("h_test", null, { ...drop, runId: "r_2" }, addCash(1), h.deps)).toMatchObject({ value: { refused: "paid" } });

    const camp = await readCamp("h_test", null, h.deps);
    expect(camp).toMatchObject({ dashCash: 4, paidChapterCount: 1 });
    expect(camp.receipts.drops).toEqual({});
    expect(Object.keys(camp.receipts.chapters)).toEqual([drop.chapterId]);
  });

  it("counts every attempt at a chapter toward its cap of 2, an abandoned one included (docs/camp.md §11)", async () => {
    const h = harness();
    const chapterId = "riftlight-ashspan-bridge";
    // One drop in an evening that was abandoned before the chapter's end, so nothing was paid.
    expect(await claimLuckyDrop("h_test", null, { runId: "r_abandoned", sceneId: "fight_bridge", chapterId }, addCash(1), h.deps)).toMatchObject({ value: { claimed: true } });
    // The chapter again, another evening, another run: one more drop is all it has left.
    expect(await claimLuckyDrop("h_test", null, { runId: "r_again", sceneId: "fight_bridge", chapterId }, addCash(1), h.deps)).toMatchObject({ value: { claimed: true } });
    expect(await claimLuckyDrop("h_test", null, { runId: "r_again", sceneId: "game_ice", chapterId }, addCash(1), h.deps)).toMatchObject({ value: { refused: "cap" } });
    // Another chapter has its own two.
    expect(await claimLuckyDrop("h_test", null, { runId: "r_again", sceneId: "x", chapterId: "riftlight-washout" }, addCash(1), h.deps)).toMatchObject({ value: { claimed: true } });
    expect((await readCamp("h_test", null, h.deps)).dashCash).toBe(3);
  });
});

describe("what opens the shop (§5.3): the Practice Meadow does not count", () => {
  const chapter = (id: string, campaignId: string) => ({ ...makeChapter(), id, campaignId });
  function shopHarness(): TestHarness {
    return makeHarness({
      content: makeContent({
        campaigns: [{ ...campaign("first-steps", false), chapters: ["first-steps-01"], tutorial: true }, ...CAMPAIGNS.slice(1)],
        chapters: [chapter("first-steps-01", "first-steps"), makeChapter(), chapter("gemfall-01", "gemfall")],
      }),
    });
  }

  it("keeps the shop shut for a crew paid for the Practice Meadow and one other chapter, and still pays the meadow", async () => {
    const h = shopHarness();
    await payChapter("h_test", null, "first-steps-01", addCash(2), h.deps);
    await payChapter("h_test", null, "bramblewood-01", addCash(2), h.deps);
    const camp = await readCamp("h_test", null, h.deps);
    expect(camp).toMatchObject({ dashCash: 4, paidChapterCount: 1 });
    expect(Object.keys(camp.receipts.chapters).sort()).toEqual(["bramblewood-01", "first-steps-01"]);
    expect(campView(camp).shopOpen).toBe(false);
  });

  it("opens it at two chapters of campaigns that are not a tutorial, The Hollow Crown's counting", async () => {
    const h = shopHarness();
    await payChapter("h_test", null, "bramblewood-01", addCash(2), h.deps);
    await payChapter("h_test", null, "gemfall-01", addCash(2), h.deps);
    const camp = await readCamp("h_test", null, h.deps);
    expect(camp.paidChapterCount).toBe(2);
    expect(campView(camp).shopOpen).toBe(true);
  });

  it("corrects an existing crew's stored count from its receipts, the same however often it is read and written", async () => {
    const h = shopHarness();
    // Stored before the meadow stopped counting: two receipts, counted 2, the shop open.
    const before: CampRecord = {
      ...emptyCamp(),
      dashCash: 4,
      paidChapterCount: 2,
      receipts: { rewards: {}, chapters: { "first-steps-01": { at: AT }, "bramblewood-01": { at: AT } }, drops: {} },
    };
    expect(await h.repo.putCamp({ householdId: "h_test", camp: before, expectedRevision: null })).toBe(true);
    const read = await readCamp("h_test", null, h.deps);
    expect(read).toMatchObject({ paidChapterCount: 1, dashCash: 4 });
    expect(await readCamp("h_test", null, h.deps)).toEqual(read);
    await mutateCamp("h_test", null, (camp) => camp, h.deps);
    expect((await h.repo.getCamp("h_test"))?.paidChapterCount).toBe(1);
    expect(await readCamp("h_test", null, h.deps)).toEqual({ ...read, revision: read.revision + 1 });
    // A count that undercounts (a chapter paid without one) is put right too.
    await mutateCamp("h_test", null, (camp) => ({ ...camp, paidChapterCount: 0 }), h.deps);
    expect((await readCamp("h_test", null, h.deps)).paidChapterCount).toBe(1);
    // And the next real chapter opens the shop.
    await payChapter("h_test", null, "gemfall-01", addCash(2), h.deps);
    expect(campView(await readCamp("h_test", null, h.deps)).shopOpen).toBe(true);
  });
});

describe("the kit", () => {
  it("is written on the hero, conditional on her row, keeping her claim, and refuses a stale edit", async () => {
    const h = harness();
    const pip = hero(h, "c_pip", "p_1");
    await h.repo.putCharacter({ ...pip, provisional: { ...pip.committed, runId: "r_live" } });
    const picked = await mutateKit("h_test", "c_pip", (kit) => ({ ...kit, style: "quilted", color: "berry" }), h.deps);
    expect(picked).toMatchObject({ ok: true, value: { revision: 1, style: "quilted" } });
    const stored = await h.repo.getCharacter("h_test", "c_pip");
    expect(stored?.provisional?.runId).toBe("r_live");
    expect(stored?.kit).toMatchObject({ revision: 1, style: "quilted", color: "berry" });

    expect(await mutateKit("h_test", "c_pip", (kit) => ({ ...kit, color: "moss" }), h.deps, { expectedRevision: 0 })).toMatchObject({
      ok: false,
      reason: "stale",
    });
    expect(await mutateKit("h_test", "c_nobody", (kit) => kit, h.deps)).toEqual({ ok: false, reason: "missing" });
  });

  it("resolves a kit edit racing a run's write to the hero by re-reading, never overwriting", async () => {
    const h = harness();
    await h.repo.putCharacter(hero(h, "c_pip", "p_1"));
    const read = h.repo.getCharacter.bind(h.repo);
    let raced = false;
    vi.spyOn(h.repo, "getCharacter").mockImplementation(async (householdId, id) => {
      const row = await read(householdId, id);
      if (!raced && row) {
        // A run writes her XP between the kit's read and its write.
        raced = true;
        await h.repo.writeCharacter({
          character: { ...row, committed: { ...row.committed, xp: 50 } },
          expectedVersion: row.version ?? 0,
          expectedClaim: null,
        });
      }
      return row;
    });
    expect(await mutateKit("h_test", "c_pip", (kit) => ({ ...kit, style: "quilted" }), h.deps)).toMatchObject({ ok: true });
    const stored = await read("h_test", "c_pip");
    expect(stored?.committed.xp).toBe(50);
    expect(stored?.kit?.style).toBe("quilted");
  });

  it("goes with the hero to another crew and when she moves home (#251)", async () => {
    const h = harness();
    await h.repo.putHousehold({ id: "h_test", displayName: "Club", ownerSub: "sub", guest: false, createdAt: AT });
    await h.repo.putHousehold({ id: "h_home", displayName: "Home", ownerSub: "sub_home", guest: false, createdAt: AT });
    await h.repo.putPlayer({ id: "p_1", householdId: "h_test", displayName: "Ada", color: "#7FD4C1" });
    await h.repo.putCharacter(hero(h, "c_pip", "p_1"));
    await mutateKit("h_test", "c_pip", (kit) => ({ ...kit, style: "quilted", unlocked: { ...kit.unlocked, feather: { from: "found", rewardId: "duck_feather", at: AT } } }), h.deps);
    const kit = readKit((await h.repo.getCharacter("h_test", "c_pip"))!);

    // Seated with another crew: the crew's claim moves, the kit does not.
    const row = (await h.repo.getCharacter("h_test", "c_pip"))!;
    await h.repo.writeCharacter({
      character: { ...row, provisional: { ...row.committed, runId: "r_crew2" } },
      expectedVersion: row.version ?? 0,
      expectedClaim: null,
    });
    await mutateCamp("h_test", "cw_2", (camp) => ({ ...camp, dashCash: 1 }), h.deps);
    expect(readKit((await h.repo.getCharacter("h_test", "c_pip"))!)).toEqual(kit);

    // Home.
    const transfer = { code: "MOVEHERNOW", householdId: "h_test", playerId: "p_1", createdBy: "sub", createdAt: AT, expiresAt: new Date(T0 + 86_400_000).toISOString(), ttl: Math.floor((T0 + 86_400_000) / 1000) };
    expect(await h.repo.putTransferCodeIfAbsent(transfer)).toBe(true);
    const move = await h.repo.readProfileMove("h_test", "p_1");
    expect(await h.repo.moveProfile({ move: move!, code: "MOVEHERNOW", nowIso: AT, to: { householdId: "h_home" }, forwardTtl: Math.floor(T0 / 1000) + 3600 })).toBe("moved");
    const moved = await h.repo.getCharacter("h_home", "c_pip");
    expect(moved?.householdId).toBe("h_home");
    expect(readKit(moved!)).toEqual(kit);
  });

  it("reads with the milestone pieces of the tiers and distinctions she holds", async () => {
    const h = harness();
    const pip = hero(h, "c_pip", "p_1");
    const veteran: Character = {
      ...pip,
      committed: { ...pip.committed, tier: "radiant", mastery: { songkeeper: { rank: "apprentice", deeds: {} } } },
    };
    await h.repo.putCharacter(veteran);
    const kit = readKit((await h.repo.getCharacter("h_test", "c_pip"))!);
    expect(Object.keys(kit.unlocked).sort()).toEqual(["deco_songkeeper_apprentice", "radiant", "sworn"]);
    expect(kit.unlocked["sworn"]).toEqual({ from: "milestone" });
    expect(readKit(veteran)).toEqual(kit);
  });
});

describe("outside the commitment rule", () => {
  it("a failed campaign keeps every camp and kit gain, and grows nothing", async () => {
    const h = makeHarness({
      content: makeContent({
        chapters: [makeChapter(), { ...makeChapter(), id: "bramblewood-02", index: 2 }],
        campaigns: [{ ...campaign("the-hollow-crown", true), chapters: ["bramblewood-01", "bramblewood-02"] }],
      }),
    });
    const { householdId, players } = await seedHousehold(h, 1);
    const playerId = players[0]!.principal.playerId;
    const pip = hero(h, "c_pip", playerId, householdId);
    await h.repo.putCharacter(pip);
    await mutateKit(householdId, "c_pip", (kit) => ({ ...kit, style: "quilted", slots: ["feather", null], unlocked: { feather: { from: "found", at: AT } } }), h.deps);
    await claimReward(householdId, null, "meadow_wreath", (camp) => ({ ...addCash(3)(camp), owned: { wreath: { from: "found", rewardId: "meadow_wreath", at: AT } } }), h.deps);
    const campBefore = await readCamp(householdId, null, h.deps);
    const kitBefore = readKit((await h.repo.getCharacter(householdId, "c_pip"))!);

    // The third setback of the attempt fails the campaign.
    await h.repo.putCampaignProgress({ householdId, campaignId: "the-hollow-crown", status: "active", setbacks: 2, updatedAt: AT });
    const stored = (await h.repo.getCharacter(householdId, "c_pip"))!;
    const rules = h.deps.content.rules();
    const state = {
      runId: "r_1",
      campaignId: "the-hollow-crown",
      chapterId: makeChapter().id,
      chapterOutcome: "setback",
      bonuses: [],
      xpEarned: 150,
      party: [{ character: resolveCharacter(stored, rules, h.deps.content.items()), playerId, hp: 10, down: false, connected: true, ready: false }],
    } as unknown as RunState;
    const settlement = await settleChapterCompletion(state, h.deps, householdId);
    expect(settlement.campaignProgress).toMatchObject({ status: "failed" });
    for (const write of settlement.characters) expect(await h.repo.writeCharacter(write)).toBe(true);
    await h.repo.putCampaignProgress(settlement.campaignProgress!);

    const after = (await h.repo.getCharacter(householdId, "c_pip"))!;
    expect(after.souvenirs).toHaveLength(1);
    expect(readKit(after)).toEqual(kitBefore);
    expect(await readCamp(householdId, null, h.deps)).toEqual(campBefore);
    expect(campBefore).toMatchObject({ frameStage: 1, dashCash: 3 });
  });
});

describe("the run state's camp view", () => {
  it("is on the lobby, and goes when a chapter starts", async () => {
    const h = makeHarness({
      content: makeContent({ campaigns: CAMPAIGNS }),
      engine: stubEngine((state) => ({ state: { ...state, chapterId: "bramblewood-01", phase: "scene" } })),
    });
    const { householdId, players } = await seedHousehold(h, 1);
    await mutateCamp(householdId, null, addCash(4), h.deps);
    await payChapter(householdId, null, "a", (c) => c, h.deps);
    await payChapter(householdId, null, "b", (c) => c, h.deps);
    const room = await createRoom({ householdId, mode: "party" }, h.deps);
    if (!room.ok) throw new Error("no room");
    const lobby = await h.repo.getState(room.value.runId);
    expect(lobby?.camp).toEqual({
      revision: 3,
      frameStage: 1,
      grownBy: [],
      dashCash: 4,
      owned: [],
      placed: {},
      friends: [],
      shopOpen: true,
    });
    expect(lobby?.camp).not.toHaveProperty("receipts");

    const player = players[0]!.principal;
    expect(await applyAction({ runId: room.value.runId, playerId: player.playerId, seq: 0, intent: { type: "CHOOSE", choiceId: "go" }, principal: player }, h.deps)).toMatchObject({ ok: true });
    expect((await h.repo.getState(room.value.runId))?.camp).toBeUndefined();
  });
});

describe("deleting (#252)", () => {
  function household(id: string): Household {
    return { id, displayName: id, ownerSub: `sub_${id}`, guest: false, createdAt: AT };
  }

  it("a kid's delete takes her kit, buddies and all, with her hero, and leaves the camps (#624)", async () => {
    const h = harness();
    await h.repo.putHousehold(household("h_test"));
    await h.repo.putHousehold(household("h_friend"));
    await h.repo.putPlayer({ id: "p_ada", householdId: "h_test", displayName: "Ada", color: "#7FD4C1" });
    await h.repo.putPlayer({ id: "p_bo", householdId: "h_test", displayName: "Bo", color: "#7FD4C1" });
    await h.repo.putCharacter(hero(h, "c_ada", "p_ada"));
    await h.repo.putCharacter(hero(h, "c_bo", "p_bo"));
    // Her buddies are on her kit (#624): here, at another crew, and at a table she visited.
    await mutateKit("h_test", "c_ada", (kit) => ({ ...kit, style: "quilted", buddies: { h_test: "bun", "h_test#cw_1": "kid_goat", h_friend: "duckling" } }), h.deps);
    await mutateKit("h_test", "c_bo", (kit) => ({ ...kit, buddies: { h_test: "bun" } }), h.deps);
    await makeCrew(h, "h_test", "cw_1");
    await mutateCamp("h_test", null, (camp) => ({ ...camp, dashCash: 2 }), h.deps);
    await h.repo.putVisit("p_ada", "h_friend", AT);
    await mutateCamp("h_friend", null, (camp) => ({ ...camp, dashCash: 1 }), h.deps);

    expect(await deleteKid(household("h_test"), "p_ada", h.deps)).toMatchObject({ ok: true, value: { cleanupPending: false } });

    expect(await h.repo.getCharacter("h_test", "c_ada")).toBeNull();
    expect(readKit((await h.repo.getCharacter("h_test", "c_bo"))!).buddies).toEqual({ h_test: "bun" });
    expect(await readCamp("h_test", null, h.deps)).toMatchObject({ dashCash: 2 });
    expect(await h.repo.getCamp("h_friend")).not.toBeNull();
  });

  it("a household's delete takes every crew's camp", async () => {
    const h = harness();
    await h.repo.putHousehold(household("h_test"));
    await makeCrew(h, "h_test", "cw_1");
    await mutateCamp("h_test", null, addCash(1), h.deps);
    await mutateCamp("h_test", "cw_1", addCash(1), h.deps);
    expect(await deleteOwnedHousehold(household("h_test"), "sub_h_test", h.deps)).toMatchObject({ ok: true });
    expect(await h.repo.getCamp("h_test")).toBeNull();
    expect(await h.repo.getCamp("h_test", "cw_1")).toBeNull();
  });

  it("a move home takes only the old household's buddies off her kit, and writes nothing else (#624)", async () => {
    const h = harness();
    await h.repo.putHousehold(household("h_test"));
    await h.repo.putPlayer({ id: "p_ada", householdId: "h_test", displayName: "Ada", color: "#7FD4C1" });
    await h.repo.putCharacter(hero(h, "c_ada", "p_ada"));
    await mutateKit("h_test", "c_ada", (kit) => ({ ...kit, buddies: { h_old: "bun", "h_old#cw_1": "kid_goat", h_friend: "duckling" } }), h.deps);
    const put = vi.spyOn(h.repo, "putCamp");
    await forgetBuddies("h_test", ["c_ada", "c_gone"], "h_old", h.deps);
    expect(readKit((await h.repo.getCharacter("h_test", "c_ada"))!).buddies).toEqual({ h_friend: "duckling" });
    expect(put).not.toHaveBeenCalled();
    // Nothing left to take off: no write.
    const write = vi.spyOn(h.repo, "writeCharacter");
    await forgetBuddies("h_test", ["c_ada"], "h_old", h.deps);
    expect(write).not.toHaveBeenCalled();
  });
});
