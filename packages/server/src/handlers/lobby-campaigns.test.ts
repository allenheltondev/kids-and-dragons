/**
 * Picking an adventure in the lobby, and whose lobby it is.
 *
 * Two things a Party Mode evening needs that a single hardcoded campaign and a
 * TV-owned household could not give it:
 *
 *  - The room belongs to the household of the first phone that joins, not to
 *    whichever screen opened it (`RoomRecord.claimable`). A new TV, or a TV
 *    whose storage was cleared, must not lock the family out of its own
 *    campaigns and heroes.
 *  - The lobby offers every campaign the household has part-way through, and
 *    the party votes when there is more than one (`lobbyCampaign`). One option
 *    is picked without a vote.
 */

import { describe, expect, it, vi } from "vitest";
import { applyIntent, createRunState, lobbyCampaign } from "@kad/shared";
import type { Campaign, Chapter, ClientIntent } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createGuestHousehold } from "./account.ts";
import { createRoom, joinRoom, settleRoom } from "./room.ts";

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
const CROWN: Campaign = {
  id: "crown",
  title: "Crown",
  blurb: "A crown goes missing.",
  chapters: ["crown-01", "crown-02"],
};
const CHAPTERS = [
  chapter("gems", "gems-01", 1, "Falling Stones"),
  chapter("gems", "gems-02", 2, "The Hum"),
  chapter("crown", "crown-01", 1, "The Shrine"),
  chapter("crown", "crown-02", 2, "The Wood"),
];

function harness(): TestHarness {
  return makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ chapters: CHAPTERS, campaigns: [GEMS, CROWN] }),
  });
}

const HERO = {
  type: "CREATE_CHARACTER",
  species: "unicorn",
  class: "songkeeper",
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  appearance: { palette: "meadow", accent: "#7FD4C1" },
} as const;

/** A room for the seeded household, with `count` players seated and ready. */
async function lobby(h: TestHarness, featured: string, count: number) {
  // The same household and players every time it is called: a second room is
  // the same family's next evening.
  const { householdId, players } = await seedHousehold(h, count);
  const created = await createRoom({ householdId, mode: "travel", campaignId: featured }, h.deps);
  if (!created.ok) throw new Error(created.error.message);
  const { code, runId } = created.value;
  const state = async () => (await h.repo.getState(runId))!;
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
  return { code, runId, householdId, state, send, ok };
}

describe("the lobby's campaigns", () => {
  it("offers only the room's campaign to a household with nothing under way, and needs no vote", async () => {
    const h = harness();
    const { state, ok } = await lobby(h, "gems", 1);
    expect((await state()).campaignOptions?.map((o) => o.id)).toEqual(["gems"]);

    // The only option is picked for the table: Begin starts it straight away.
    await ok("p_1", { type: "CONTINUE_CAMPAIGN" });
    expect((await state()).chapterId).toBe("gems-01");
  });

  it("offers a campaign the household started on another evening, where it left off", async () => {
    const h = harness();
    // One evening of Crown...
    const first = await lobby(h, "crown", 2);
    await first.ok("p_1", { type: "CONTINUE_CAMPAIGN" });
    await first.ok("p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_ending" });

    // ...and the next room is opened for Gems, as the launch campaign always is.
    const second = await lobby(h, "gems", 2);
    const options = (await second.state()).campaignOptions ?? [];
    expect(options.map((o) => [o.id, o.next?.index])).toEqual([
      ["gems", 1],
      ["crown", 2],
    ]);
  });

  it("rests the picker on the campaign in progress, not the room's own", async () => {
    const h = harness();
    const first = await lobby(h, "crown", 2);
    await first.ok("p_1", { type: "CONTINUE_CAMPAIGN" });
    await first.ok("p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_ending" });

    const second = await lobby(h, "gems", 2);
    const state = await second.state();
    expect(state.campaignOptions?.map((o) => o.id)).toEqual(["gems", "crown"]);
    expect(state.campaign?.id).toBe("crown");
    expect(lobbyCampaign(state).leader?.id).toBe("crown");
  });

  it("waits for every seat to vote, then plays the vote's pick", async () => {
    const h = harness();
    const first = await lobby(h, "crown", 2);
    await first.ok("p_1", { type: "CONTINUE_CAMPAIGN" });
    await first.ok("p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_ending" });

    const { state, send, ok } = await lobby(h, "gems", 2);
    const early = await send("p_1", { type: "CONTINUE_CAMPAIGN" });
    expect(early.ok).toBe(false);

    await ok("p_1", { type: "VOTE_CAMPAIGN", campaignId: "crown" });
    // The screens follow the leader.
    expect((await state()).campaign?.id).toBe("crown");
    expect((await send("p_2", { type: "CONTINUE_CAMPAIGN" })).ok).toBe(false);

    await ok("p_2", { type: "VOTE_CAMPAIGN", campaignId: "crown" });
    // The tapper's campaignId is not the decision; the vote is.
    await ok("p_2", { type: "CONTINUE_CAMPAIGN", campaignId: "gems" });
    expect((await state()).chapterId).toBe("crown-02");
    expect((await state()).campaignVotes).toEqual({});
  });

  it("breaks a tie toward the story turn marker", async () => {
    const h = harness();
    const first = await lobby(h, "crown", 2);
    await first.ok("p_1", { type: "CONTINUE_CAMPAIGN" });
    await first.ok("p_1", { type: "PLAYTEST_GOTO", sceneId: "scene_ending" });

    const { state, ok } = await lobby(h, "gems", 2);
    await ok("p_1", { type: "VOTE_CAMPAIGN", campaignId: "gems" });
    await ok("p_2", { type: "VOTE_CAMPAIGN", campaignId: "crown" });
    await ok("p_2", { type: "CONTINUE_CAMPAIGN" });
    expect((await state()).chapterId).toBe("gems-01");
  });

  it("leads, before anybody votes, with the campaign the screens already show", () => {
    // Back in the lobby after a chapter of Crown, `campaign` names Crown. The
    // phones and the TV say Crown, so the decision must not quietly read Gems.
    const view = (id: string) => ({ id, title: id, chapters: 2, next: { index: 2, title: "x" } });
    const state = {
      ...createRunState({ runId: "r", roomCode: "ABCD", mode: "party", now: "2026-10-13T00:00:00.000Z" }),
      campaignOptions: [view("gems"), view("crown")],
      campaign: view("crown"),
    };
    expect(lobbyCampaign(state).leader?.id).toBe("crown");
    expect(lobbyCampaign({ ...state, campaign: null }).leader?.id).toBe("gems");
  });

  it("refuses a vote for a campaign the room does not offer", async () => {
    const h = harness();
    const { send } = await lobby(h, "gems", 1);
    const response = await send("p_1", { type: "VOTE_CAMPAIGN", campaignId: "crown" });
    expect(response.ok).toBe(false);
  });
});

describe("a TV's room belongs to the first phone that joins", () => {
  async function tvRoom(h: TestHarness) {
    const tv = await createGuestHousehold({ displayName: "Host" }, h.deps);
    const created = await createRoom(
      { householdId: tv.principal.householdId, mode: "party", campaignId: "gems", claimable: true },
      h.deps,
    );
    if (!created.ok) throw new Error(created.error.message);
    return { tvHousehold: tv.principal.householdId, ...created.value };
  }

  it("moves the room, and its run, into a returning family's household", async () => {
    const h = harness();
    const { householdId, players } = await seedHousehold(h, 1);
    await h.repo.putCampaignProgress({
      householdId,
      campaignId: "gems",
      status: "active",
      setbacks: 0,
      lastIndex: 1,
      attemptId: "a_1",
      version: 1,
      updatedAt: new Date(h.clock.now()).toISOString(),
    });
    const { code, runId, tvHousehold } = await tvRoom(h);
    // Opened under the TV's household, which knows nothing of the family.
    expect((await h.repo.getState(runId))?.campaign?.next?.index).toBe(1);

    const joined = await joinRoom({ code, principal: players[0]!.principal }, h.deps);
    expect(joined.ok).toBe(true);

    const room = await h.repo.getRoom(code);
    expect(room?.householdId).toBe(householdId);
    expect(room?.claimable).toBeUndefined();
    expect((await h.repo.getRun(runId))?.householdId).toBe(householdId);
    expect(await h.repo.listRuns(tvHousehold)).toEqual([]);
    // The lobby now speaks for the family: chapter 2 is next.
    expect((await h.repo.getState(runId))?.campaign?.next?.index).toBe(2);
  });

  it("repairs the lobby on the next join when the refresh after a claim fails", async () => {
    // The claim and the lobby refresh are two writes, and only the first is
    // guarded by the room being claimable. A refresh that fails after the
    // claim has landed must not leave the family looking at the TV's lobby
    // for the rest of the evening.
    const h = harness();
    const { householdId, players } = await seedHousehold(h, 2);
    await h.repo.putCampaignProgress({
      householdId,
      campaignId: "crown",
      status: "active",
      setbacks: 0,
      lastIndex: 1,
      attemptId: "a_1",
      version: 1,
      updatedAt: new Date(h.clock.now()).toISOString(),
    });
    const { code, runId } = await tvRoom(h);

    const lookup = vi
      .spyOn(h.repo, "listCampaignProgress")
      .mockRejectedValueOnce(new Error("store hiccup"));
    await expect(joinRoom({ code, principal: players[0]!.principal }, h.deps)).rejects.toThrow(
      "store hiccup",
    );
    // The claim landed; the lobby did not.
    expect((await h.repo.getRoom(code))?.claimable).toBeUndefined();
    expect((await h.repo.getState(runId))?.campaignOptions?.map((o) => o.id)).toEqual(["gems"]);

    // A retry — or the next phone — puts it right.
    lookup.mockRestore();
    expect((await joinRoom({ code, principal: players[1]!.principal }, h.deps)).ok).toBe(true);
    const state = await h.repo.getState(runId);
    expect(state?.campaignOptions?.map((o) => [o.id, o.next?.index])).toEqual([
      ["gems", 1],
      ["crown", 2],
    ]);
    expect((await h.repo.getRun(runId))?.lobbyFor).toBe(householdId);
    // The household id stays off the wire: every screen, the TV included, reads this.
    expect(JSON.stringify(state)).not.toContain(householdId);

    // And once it is right, a join changes nothing but the roster (#263), and
    // a rejoin not even that. The first phone's join above threw before it
    // was seated, so this is its first.
    await joinRoom({ code, principal: players[0]!.principal }, h.deps);
    const seq = (await h.repo.getState(runId))?.seq;
    expect(seq).toBe((state?.seq ?? 0) + 1);
    await joinRoom({ code, principal: players[0]!.principal }, h.deps);
    expect((await h.repo.getState(runId))?.seq).toBe(seq);
  });

  it("is not claimed by a device whose player is gone", async () => {
    const h = harness();
    const { players } = await seedHousehold(h, 1);
    const { code } = await tvRoom(h);
    const ghost = { ...players[0]!.principal, playerId: "p_gone" };

    const refused = await joinRoom({ code, principal: ghost }, h.deps);
    expect(refused.ok ? null : refused.error.code).toBe("NOT_FOUND");
    expect((await h.repo.getRoom(code))?.claimable).toBe(true);
  });

  it("is settled by the first join, so a second household is still turned away", async () => {
    const h = harness();
    const { players } = await seedHousehold(h, 1);
    const stranger = await createGuestHousehold({ displayName: "Visitor" }, h.deps);
    const { code } = await tvRoom(h);

    expect((await joinRoom({ code, principal: players[0]!.principal }, h.deps)).ok).toBe(true);
    const refused = await joinRoom({ code, principal: stranger.principal }, h.deps);
    expect(refused.ok ? null : refused.error.code).toBe("FORBIDDEN");
  });

  it("stays with the TV's household when a brand-new phone settles it first", async () => {
    const h = harness();
    const { players } = await seedHousehold(h, 1);
    const { code, tvHousehold } = await tvRoom(h);
    const room = (await h.repo.getRoom(code))!;

    // What the join route does for a phone with no binding, before it makes
    // a player for it.
    const settled = await settleRoom(room, room.householdId, h.deps);
    expect(settled.ok && settled.value?.householdId).toBe(tvHousehold);

    const refused = await joinRoom({ code, principal: players[0]!.principal }, h.deps);
    expect(refused.ok ? null : refused.error.code).toBe("FORBIDDEN");
  });

  it("never moves a room a phone opened", async () => {
    const h = harness();
    const { householdId } = await seedHousehold(h, 1);
    const stranger = await createGuestHousehold({ displayName: "Visitor" }, h.deps);
    const created = await createRoom({ householdId, mode: "party", campaignId: "gems" }, h.deps);
    if (!created.ok) throw new Error(created.error.message);

    const refused = await joinRoom({ code: created.value.code, principal: stranger.principal }, h.deps);
    expect(refused.ok ? null : refused.error.code).toBe("FORBIDDEN");
  });
});
