/**
 * Campaign prerequisites (#221): a campaign that declares `requires` cannot be
 * started until the household has a *completed* attempt at each campaign it
 * names, and one that declares nothing plays exactly as it always did.
 *
 * What satisfies it is the household's `CampaignProgressRecord`: `complete`
 * counts whichever ending the party reached (a loss ending completes and
 * commits its characters like a win), `failed` at the setback limit does not,
 * and neither does an attempt still under way. The refusal is the server's —
 * the lobby only shows the lock — so these drive the intents a client could
 * send, not the screens.
 */

import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, lobbyCampaign } from "@kad/shared";
import type { Campaign, Chapter, ClientIntent, RunState } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import type { CampaignProgressRecord } from "../store/repository.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { campaignLock, campaignView, joinOrStartAttempt, lockedRefusal, settleChapterCompletion } from "./progression.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };

function chapter(campaignId: string, id: string, index: number, title: string): Chapter {
  return { ...makeChapter(), campaignId, id, index, title };
}

const GEMS: Campaign = {
  id: "gems",
  title: "Gems",
  blurb: "Stones fall.",
  chapters: ["gems-01", "gems-02"],
};
const RIFT: Campaign = {
  id: "rift",
  title: "Rift",
  blurb: "The ground opens.",
  chapters: ["rift-01", "rift-02"],
  requires: ["gems"],
};
const CHAPTERS = [
  chapter("gems", "gems-01", 1, "Falling Stones"),
  chapter("gems", "gems-02", 2, "The Hum"),
  chapter("rift", "rift-01", 1, "The Crack"),
  chapter("rift", "rift-02", 2, "The Far Side"),
];

function harness(): TestHarness {
  return makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ chapters: CHAPTERS, campaigns: [GEMS, RIFT] }),
  });
}

const HERO = {
  type: "CREATE_CHARACTER",
  species: "unicorn",
  class: "songkeeper",
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  appearance: { palette: "meadow", accent: "#7FD4C1" },
} as const;

/** A household record for `campaignId`, in the given state. */
function attempt(
  householdId: string,
  campaignId: string,
  status: CampaignProgressRecord["status"],
  extra: Partial<CampaignProgressRecord> = {},
): CampaignProgressRecord {
  return {
    householdId,
    campaignId,
    status,
    setbacks: 0,
    lastIndex: status === "active" ? 1 : 2,
    attemptId: `${campaignId}:1`,
    version: 1,
    updatedAt: "2026-07-04T18:00:00.000Z",
    ...extra,
  };
}

/** A room for the seeded household, featuring `featured`, with `count` players seated and ready. */
async function lobby(h: TestHarness, featured: string, count = 1) {
  const { householdId, players } = await seedHousehold(h, count);
  const created = await createRoom({ householdId, mode: "travel", campaignId: featured }, h.deps);
  if (!created.ok) throw new Error(created.error.message);
  const { code, runId } = created.value;
  const state = async (): Promise<RunState> => (await h.repo.getState(runId))!;
  const send = async (playerId: string, intent: ClientIntent) =>
    applyAction({ runId, playerId, seq: (await state()).seq, intent }, h.deps);
  const ok = async (playerId: string, intent: ClientIntent) => {
    const response = await send(playerId, intent);
    expect(response.ok, JSON.stringify(response.ok ? null : response.error)).toBe(true);
  };
  for (const [i, player] of players.entries()) {
    await joinRoom({ code, principal: player.principal }, h.deps);
    await ok(player.principal.playerId, { ...HERO, name: `Hero ${String(i + 1)}` } as ClientIntent);
    await ok(player.principal.playerId, { type: "READY", ready: true });
  }
  return { householdId, runId, state, send, ok };
}

/** What the household's Gemfall-equivalent stood at, then a Rift room's Begin tap. */
async function tryBegin(h: TestHarness, seed: (householdId: string) => Promise<void>) {
  const { householdId } = await seedHousehold(h, 1);
  await seed(householdId);
  const room = await lobby(h, "rift");
  const response = await room.send("p_1", { type: "CONTINUE_CAMPAIGN" });
  return { ...room, householdId, response };
}

describe("a locked campaign", () => {
  it("is shown with its reason but cannot be started, with no completed prerequisite", async () => {
    const h = harness();
    const { state, send } = await lobby(h, "rift");

    const view = (await state()).campaignOptions?.[0];
    expect(view).toMatchObject({
      id: "rift",
      title: "Rift",
      locked: { requires: ["gems"], reason: "Finish Gems first" },
    });
    // The screens follow the lobby's pick, so the TV says it too.
    expect((await state()).campaign?.locked?.reason).toBe("Finish Gems first");

    const begin = await send("p_1", { type: "CONTINUE_CAMPAIGN" });
    expect(begin).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(begin.ok ? "" : begin.error?.message).toContain("Finish Gems first");
    expect((await state()).chapterId).toBeNull();
  });

  it("refuses a chapter start sent straight to the server, not just a Begin tap", async () => {
    const h = harness();
    const { state, send } = await lobby(h, "rift");
    for (const chapterId of ["rift-01", "rift-02"]) {
      const response = await send("p_1", { type: "START_CHAPTER", chapterId });
      expect(response, chapterId).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
      expect(response.ok ? "" : response.error?.message).toContain("Finish Gems first");
    }
    expect((await state()).chapterId).toBeNull();
    expect(await h.repo.getCampaignProgress("h_test", "rift")).toBeNull();
  });

  it("stays locked when the prerequisite attempt failed at the setback limit", async () => {
    const h = harness();
    const { response, state } = await tryBegin(h, (id) =>
      h.repo.putCampaignProgress(attempt(id, "gems", "failed", { setbacks: 3 })),
    );
    expect(response).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect((await state()).chapterId).toBeNull();
  });

  it("stays locked while the prerequisite is only part-way through (an abandoned attempt)", async () => {
    const h = harness();
    const { response, state } = await tryBegin(h, (id) =>
      h.repo.putCampaignProgress(attempt(id, "gems", "active")),
    );
    // Gems, part-way through, is the only campaign the lobby offers (continuing
    // is not choosing), so it is no vote: Begin picks it up.
    expect(response.ok).toBe(true);
    expect((await state()).campaignId).toBe("gems");
    expect((await state()).campaignOptions?.map((o) => o.id)).toEqual(["gems"]);
  });

  it("stays locked when only some other household finished the prerequisite", async () => {
    const h = harness();
    const { response } = await tryBegin(h, () =>
      h.repo.putCampaignProgress(attempt("h_neighbour", "gems", "complete")),
    );
    expect(response).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
  });

  it("cannot be voted for, so a vote cannot win a Begin the server would refuse", async () => {
    const h = harness();
    const { householdId } = await seedHousehold(h, 1);
    // Something else is under way, so the lobby offers that alone.
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "active"));
    const { state, send, ok } = await lobby(h, "rift");
    expect((await state()).campaignOptions?.map((o) => [o.id, o.locked !== undefined])).toEqual([["gems", false]]);

    const vote = await send("p_1", { type: "VOTE_CAMPAIGN", campaignId: "rift" });
    expect(vote).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });

    await ok("p_1", { type: "CONTINUE_CAMPAIGN" });
    expect((await state()).chapterId).toBe("gems-02");
  });
});

describe("an unlocked campaign", () => {
  it("starts once the household has a completed attempt at the prerequisite", async () => {
    const h = harness();
    const { response, state, householdId } = await tryBegin(h, (id) =>
      h.repo.putCampaignProgress(attempt(id, "gems", "complete")),
    );
    expect(response.ok).toBe(true);
    expect((await state()).chapterId).toBe("rift-01");
    expect((await state()).campaign?.locked).toBeUndefined();
    expect((await h.repo.getCampaignProgress(householdId, "rift"))?.status).toBe("active");
  });

  it("shows no lock in the lobby once it is met", async () => {
    const h = harness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "complete"));
    const { state } = await lobby(h, "rift");
    expect((await state()).campaignOptions?.[0]).not.toHaveProperty("locked");
  });

  // Both endings are real settlements, not hand-written rows: the final beat
  // of Gems is completed as a success and as a setback (the Last Ring), and
  // each stores the `complete` record that unlocks Rift.
  it.each([
    ["a win ending", "success"],
    ["a loss ending, like The Last Ring", "setback"],
  ] as const)("starts after %s of the prerequisite", async (_name, outcome) => {
    const h = harness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "active", { attemptId: "a_1" }));
    const finished = {
      runId: "r_1",
      campaignId: "gems",
      campaignAttemptId: "a_1",
      chapterId: "gems-02",
      sceneId: "scene_ending",
      chapterOutcome: outcome,
      bonuses: [],
      xpEarned: 150,
      flags: {},
      party: [],
    } as unknown as Parameters<typeof settleChapterCompletion>[0];
    const settlement = await settleChapterCompletion(finished, h.deps, householdId);
    expect(settlement.campaignProgress).toMatchObject({ campaignId: "gems", status: "complete" });
    await h.repo.putCampaignProgress(settlement.campaignProgress!);

    const room = await lobby(h, "rift");
    expect((await room.send("p_1", { type: "CONTINUE_CAMPAIGN" })).ok).toBe(true);
    expect((await room.state()).chapterId).toBe("rift-01");
  });

  it("is not taken back mid-story when the household replays the prerequisite", async () => {
    // Replaying Gems writes a new active attempt over its `complete` record.
    // A Rift attempt already under way is the household's to finish.
    const h = harness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "active", { lastIndex: 0 }));
    await h.repo.putCampaignProgress(
      attempt(householdId, "rift", "active", { attemptId: "r_a", lastIndex: 1, updatedAt: "2026-07-05T18:00:00.000Z" }),
    );
    const room = await lobby(h, "rift");
    // The one played most recently is the one offered, and it is not locked.
    expect((await room.state()).campaignOptions?.map((o) => o.id)).toEqual(["rift"]);
    expect((await room.state()).campaignOptions?.[0]).not.toHaveProperty("locked");
    await room.ok("p_1", { type: "CONTINUE_CAMPAIGN" });
    expect((await room.state()).chapterId).toBe("rift-02");
  });
});

describe("replaying the prerequisite (#221, `everCompleted`)", () => {
  it("does not re-lock: complete, then a replay starts, and Rift is still open", async () => {
    const h = harness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "complete"));

    // An evening of Gems again: the start replaces the complete row with an
    // active one, and that row remembers the completion.
    const replay = await lobby(h, "gems");
    await replay.ok("p_1", { type: "CONTINUE_CAMPAIGN" });
    expect((await replay.state()).chapterId).toBe("gems-01");
    const row = await h.repo.getCampaignProgress(householdId, "gems");
    expect(row).toMatchObject({ status: "active", lastIndex: 0, everCompleted: true });

    // A Rift room: Gems is under way and is what the lobby offers; Rift is not
    // locked, it is just not what the table is continuing.
    const rift = await lobby(h, "rift");
    const options = (await rift.state()).campaignOptions ?? [];
    expect(options.map((o) => [o.id, o.locked !== undefined])).toEqual([["gems", false]]);
  });

  it("is kept through a replay that then fails, and by the attempt after it", async () => {
    const h = harness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(
      attempt(householdId, "gems", "active", { attemptId: "a_2", setbacks: 2, everCompleted: true }),
    );
    const finished = {
      runId: "r_1",
      campaignId: "gems",
      campaignAttemptId: "a_2",
      chapterId: "gems-02",
      sceneId: "scene_ending",
      chapterOutcome: "setback",
      bonuses: [],
      xpEarned: 50,
      flags: {},
      party: [],
    } as unknown as Parameters<typeof settleChapterCompletion>[0];
    const settlement = await settleChapterCompletion(finished, h.deps, householdId);
    expect(settlement.campaignProgress).toMatchObject({ status: "failed", everCompleted: true });
    expect(campaignLock(RIFT, [settlement.campaignProgress!], h.deps)).toBeNull();

    const next = joinOrStartAttempt(settlement.campaignProgress!, householdId, "gems", "r_2", "2026-07-05T18:00:00.000Z");
    expect(next.startedAttempt?.attempt).toMatchObject({ status: "active", everCompleted: true });
  });

  it("is never set by failed or abandoned history: the replay of a failure stays locked", () => {
    const deps = harness().deps;
    for (const previous of [attempt("h_test", "gems", "failed", { setbacks: 3 }), attempt("h_test", "gems", "active")]) {
      const started = joinOrStartAttempt(previous, "h_test", "gems", "r_2", "2026-07-05T18:00:00.000Z");
      const row = started.startedAttempt?.attempt ?? previous;
      expect(row, previous.status).not.toHaveProperty("everCompleted");
      expect(campaignLock(RIFT, [row], deps), previous.status).not.toBeNull();
    }
  });

  it("reads a legacy complete row, written before the field, as completed", () => {
    const deps = harness().deps;
    const legacy = attempt("h_test", "gems", "complete");
    expect(legacy).not.toHaveProperty("everCompleted");
    expect(campaignLock(RIFT, [legacy], deps)).toBeNull();
  });

  it("writes nothing new on a first attempt, or on the row a completion leaves", async () => {
    // A campaign's first attempt and its finished row are exactly the shape
    // they always were (Gemfall's settlement digests pin both).
    const first = joinOrStartAttempt(null, "h_test", "gems", "r_1", "2026-07-04T18:00:00.000Z");
    expect(first.startedAttempt?.attempt).not.toHaveProperty("everCompleted");

    const h = harness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "active", { attemptId: "a_1" }));
    const finished = {
      runId: "r_1",
      campaignId: "gems",
      campaignAttemptId: "a_1",
      chapterId: "gems-02",
      sceneId: "scene_ending",
      chapterOutcome: "success",
      bonuses: [],
      xpEarned: 150,
      flags: {},
      party: [],
    } as unknown as Parameters<typeof settleChapterCompletion>[0];
    const settlement = await settleChapterCompletion(finished, h.deps, householdId);
    expect(settlement.campaignProgress?.status).toBe("complete");
    expect(settlement.campaignProgress).not.toHaveProperty("everCompleted");
  });
});

describe("the lobby's default pick skips a locked campaign (#221)", () => {
  it("leads with an unlocked campaign before anybody votes", async () => {
    const h = harness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "active"));
    const { state } = await lobby(h, "rift");
    const s = await state();
    // Rift is the room's campaign, and locked, but Gems is under way: it is the
    // only one offered, and the pick.
    expect(s.campaignOptions?.map((o) => o.id)).toEqual(["gems"]);
    expect(s.campaign?.id).toBe("gems");
    expect(lobbyCampaign(s).leader?.id).toBe("gems");
  });

  it("keeps the old behaviour when every option is locked", () => {
    const view = (id: string, locked: boolean) => ({
      id,
      title: id,
      chapters: 2,
      next: { index: 1, title: "x" },
      ...(locked ? { locked: { requires: ["gems"], reason: "Finish Gems first" } } : {}),
    });
    const base = createRunState({ runId: "r", roomCode: "ABCD", mode: "party", now: "2026-10-13T00:00:00.000Z" });
    const allLocked = { ...base, campaignOptions: [view("a", true), view("b", true)], campaign: view("b", true) };
    expect(lobbyCampaign(allLocked).leader?.id).toBe("b");
    expect(lobbyCampaign({ ...allLocked, campaign: null }).leader?.id).toBe("a");
    // And with no lock anywhere, exactly as before: the shown one, else the first.
    const none = { ...base, campaignOptions: [view("a", false), view("b", false)], campaign: view("b", false) };
    expect(lobbyCampaign(none).leader?.id).toBe("b");
    expect(lobbyCampaign({ ...none, campaign: null }).leader?.id).toBe("a");
  });
});

describe("a listed sequel", () => {
  function listedHarness(): TestHarness {
    return makeHarness({
      engine: realEngine,
      playtest: true,
      content: makeContent({ chapters: CHAPTERS, campaigns: [GEMS, { ...RIFT, listed: true }] }),
    });
  }

  it("is offered beside the room's campaign, locked, without making the table vote", async () => {
    const h = listedHarness();
    const { state, send } = await lobby(h, "gems", 2);
    const s = await state();
    expect(s.campaignOptions?.map((o) => o.id)).toEqual(["gems", "rift"]);
    expect(s.campaignOptions?.[1]?.locked?.reason).toBe("Finish Gems first");
    // One campaign it could start is no question: Begin plays it, no vote.
    expect(lobbyCampaign(s)).toMatchObject({ contested: false, waitingOn: [] });
    expect(lobbyCampaign(s).leader?.id).toBe("gems");
    expect((await send("p_1", { type: "CONTINUE_CAMPAIGN" })).ok).toBe(true);
    expect((await state()).campaignId).toBe("gems");
  });

  it("becomes a real choice once the prerequisite is finished", async () => {
    const h = listedHarness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "complete"));
    const { state, send } = await lobby(h, "gems");
    const s = await state();
    expect(s.campaignOptions?.find((o) => o.id === "rift")?.locked).toBeUndefined();
    expect(lobbyCampaign(s).contested).toBe(true);
    expect((await send("p_1", { type: "VOTE_CAMPAIGN", campaignId: "rift" })).ok).toBe(true);
    expect((await send("p_1", { type: "CONTINUE_CAMPAIGN" })).ok).toBe(true);
    expect((await state()).campaignId).toBe("rift");
  });

  it("is offered once, not again as a campaign under way", async () => {
    const h = listedHarness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "complete"));
    await h.repo.putCampaignProgress(attempt(householdId, "rift", "active"));
    const { state } = await lobby(h, "gems");
    expect((await state()).campaignOptions?.map((o) => o.id)).toEqual(["rift"]);
  });

  it("is not offered without `listed`, as before", async () => {
    const h = harness();
    const { state } = await lobby(h, "gems");
    expect((await state()).campaignOptions?.map((o) => o.id)).toEqual(["gems"]);
  });
});

describe("a coming-soon teaser", () => {
  const TEASER: Campaign = { id: "rift", title: "Rift", blurb: "The ground opens.", chapters: [], requires: ["gems"], listed: true, comingSoon: true };
  function teaserHarness(): TestHarness {
    return makeHarness({
      engine: realEngine,
      playtest: true,
      content: makeContent({ chapters: CHAPTERS.filter((c) => c.campaignId === "gems"), campaigns: [GEMS, TEASER] }),
    });
  }

  it("is listed beside the room's campaign, locked until the prerequisite is finished", async () => {
    const h = teaserHarness();
    const { state, send } = await lobby(h, "gems");
    const s = await state();
    expect(s.campaignOptions?.map((o) => o.id)).toEqual(["gems", "rift"]);
    expect(s.campaignOptions?.[1]?.locked?.reason).toBe("Finish Gems first");
    expect(lobbyCampaign(s).contested).toBe(false);
    expect((await send("p_1", { type: "CONTINUE_CAMPAIGN" })).ok).toBe(true);
    expect((await state()).campaignId).toBe("gems");
  });

  it("then says it is coming soon, and still cannot be voted for or started", async () => {
    const h = teaserHarness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "complete"));
    const { state, send } = await lobby(h, "gems");
    expect((await state()).campaignOptions?.[1]?.locked).toEqual({ requires: [], reason: "Coming soon" });
    expect(lobbyCampaign(await state()).contested).toBe(false);
    expect(await send("p_1", { type: "VOTE_CAMPAIGN", campaignId: "rift" })).toMatchObject({ ok: false });
    // Begin is the lobby's pick, not the tapper's: it plays Gems again.
    expect((await send("p_1", { type: "CONTINUE_CAMPAIGN", campaignId: "rift" })).ok).toBe(true);
    expect((await state()).campaignId).toBe("gems");
    expect(await h.repo.getCampaignProgress(householdId, "rift")).toBeNull();
    // And the server's own refusal, whatever intent reached it.
    expect(await lockedRefusal(TEASER, householdId, h.deps)).toBe('"Rift" is locked: Coming soon');
  });
});

describe("campaigns without `requires` behave as before", () => {
  it("start with no record at all and carry no lock on their view", async () => {
    const h = harness();
    const { state, send } = await lobby(h, "gems");
    const view = (await state()).campaignOptions?.[0];
    expect(view).not.toHaveProperty("locked");
    expect(Object.keys(view!).sort()).toEqual(["blurb", "chapters", "id", "next", "title"]);

    expect((await send("p_1", { type: "CONTINUE_CAMPAIGN" })).ok).toBe(true);
    expect((await state()).chapterId).toBe("gems-01");
  });

  it("start again after a failed attempt of their own", async () => {
    const h = harness();
    const { householdId } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "failed", { setbacks: 3 }));
    const { state, send } = await lobby(h, "gems");
    expect((await send("p_1", { type: "CONTINUE_CAMPAIGN" })).ok).toBe(true);
    expect((await state()).chapterId).toBe("gems-01");
  });

  it("are never locked, whatever the household has or has not finished", () => {
    const deps = harness().deps;
    const records = [attempt("h", "other", "failed")];
    expect(campaignLock(GEMS, records, deps)).toBeNull();
    expect(campaignLock({ ...GEMS, requires: [] }, records, deps)).toBeNull();
    expect(campaignView(GEMS, null, deps)).not.toHaveProperty("locked");
  });

  it("an empty `requires` is no prerequisite either", async () => {
    const h = makeHarness({
      engine: realEngine,
      playtest: true,
      content: makeContent({ chapters: CHAPTERS, campaigns: [{ ...GEMS, requires: [] }, RIFT] }),
    });
    const { send } = await lobby(h, "gems");
    expect((await send("p_1", { type: "CONTINUE_CAMPAIGN" })).ok).toBe(true);
  });
});

describe("the lock's reason", () => {
  it("names every unmet prerequisite by its display title", () => {
    const deps = makeHarness({
      content: makeContent({
        campaigns: [
          { ...GEMS, title: "Gemfall" },
          { ...GEMS, id: "ember", title: "Ember Road" },
          { ...RIFT, requires: ["gems", "ember"] },
        ],
      }),
    }).deps;
    const rift = deps.content.campaign("rift")!;
    expect(campaignLock(rift, [], deps)?.reason).toBe("Finish Gemfall and Ember Road first");
    // Only what is still unmet is named.
    expect(campaignLock(rift, [attempt("h", "gems", "complete")], deps)).toEqual({
      requires: ["ember"],
      reason: "Finish Ember Road first",
    });
    expect(campaignLock(rift, [attempt("h", "gems", "complete"), attempt("h", "ember", "complete")], deps)).toBeNull();
  });
});
