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
import { applyIntent, createRunState } from "@kad/shared";
import type { Campaign, Chapter, ClientIntent, RunState } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import type { CampaignProgressRecord } from "../store/repository.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { campaignLock, campaignView, settleChapterCompletion } from "./progression.ts";
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
    const { response } = await tryBegin(h, (id) =>
      h.repo.putCampaignProgress(attempt(id, "gems", "active")),
    );
    expect(response).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
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
    // Something else is under way, so the lobby offers two campaigns.
    await h.repo.putCampaignProgress(attempt(householdId, "gems", "active"));
    const { state, send, ok } = await lobby(h, "rift");
    expect((await state()).campaignOptions?.map((o) => [o.id, o.locked !== undefined])).toEqual([
      ["rift", true],
      ["gems", false],
    ]);

    const vote = await send("p_1", { type: "VOTE_CAMPAIGN", campaignId: "rift" });
    expect(vote).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    expect(vote.ok ? "" : vote.error?.message).toContain("Finish Gems first");

    await ok("p_1", { type: "VOTE_CAMPAIGN", campaignId: "gems" });
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
    await h.repo.putCampaignProgress(attempt(householdId, "rift", "active", { attemptId: "r_a", lastIndex: 1 }));
    const room = await lobby(h, "rift");
    expect((await room.state()).campaignOptions?.[0]).not.toHaveProperty("locked");
    // Two campaigns under way, so the table votes for the one it wants.
    await room.ok("p_1", { type: "VOTE_CAMPAIGN", campaignId: "rift" });
    await room.ok("p_1", { type: "CONTINUE_CAMPAIGN" });
    expect((await room.state()).chapterId).toBe("rift-02");
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
