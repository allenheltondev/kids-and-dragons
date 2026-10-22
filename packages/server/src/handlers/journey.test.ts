/**
 * A graph campaign, played through the real server (#194).
 *
 * The Rift Sampler (shared fixtures/rift-sampler.campaign.json) with a small
 * test chapter behind every node: each is the fixture chapter, renamed, with
 * three extra endings a test can warp to — a plain success, a setback, and
 * one that finds the lens (sets the `found_the_lens` journey flag). Nothing
 * here ships; it is the smallest content that exercises every transition.
 *
 * What is pinned is the contract of docs/campaigns/graph-campaigns.md §6 as
 * the table meets it: CONTINUE resumes the visit under way and never replays
 * one; an exit is chosen between chapters and only from where the party is;
 * the double tap, the retry and the second room are all answered without
 * counting anything twice; and the journey survives every evening on the
 * household's attempt row.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIntent, createRunState, JOURNEY_VERSION } from "@kad/shared";
import type { Campaign, Chapter, ClientIntent, StoryScene } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { Engine } from "../engine/port.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, T0, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };

function sampler(overrides: Partial<Campaign> = {}): Campaign {
  const campaign = JSON.parse(
    readFileSync(new URL("../../../shared/src/fixtures/rift-sampler.campaign.json", import.meta.url), "utf8"),
  ) as Campaign;
  return { ...campaign, ...overrides };
}

const ending = (narration: string, extra: Partial<StoryScene> = {}): StoryScene => ({
  type: "story",
  narration,
  choices: [],
  ...extra,
});

/** One small chapter per sampler chapter id. */
function samplerChapters(campaign: Campaign): Chapter[] {
  return campaign.chapters.map((id, i) => {
    const base = makeChapter();
    return {
      ...base,
      id,
      campaignId: campaign.id,
      index: i + 1,
      title: `Title of ${id}`,
      scenes: {
        ...base.scenes,
        scene_setback: ending("It went badly.", { outcome: "setback" }),
        scene_lens: ending("A glass lens, in the rubble.", {
          onEnter: [{ type: "setFlag", flag: "found_the_lens" }],
        }),
      },
    };
  });
}

const CREATION: ClientIntent = {
  type: "CREATE_CHARACTER",
  name: "Pip",
  species: "unicorn",
  class: "songkeeper",
  stats: { might: 1, quick: 1, clever: 0, heart: 1 },
};

async function world(campaign: Campaign = sampler(), players = 2) {
  const harness = makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ chapters: samplerChapters(campaign), campaigns: [campaign] }),
  });
  const seeded = await seedHousehold(harness, players);
  const attempt = async () => harness.repo.getCampaignProgress(seeded.householdId, campaign.id);
  return { harness, campaign, attempt, ...seeded };
}

/** A room opened for the sampler, with one ready hero — one evening. */
async function room(harness: TestHarness, householdId: string, principal: DeviceIdentity) {
  const created = await createRoom({ householdId, mode: "party", campaignId: "rift-sampler" }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const joined = await joinRoom({ code, principal }, harness.deps);
  if (!joined.ok) throw new Error("join");
  const send = async (intent: ClientIntent) => {
    const seq = (await harness.repo.getState(runId))?.seq ?? 0;
    return applyAction({ runId, playerId: joined.value.playerId, seq, intent }, harness.deps);
  };
  const must = async (intent: ClientIntent) => {
    const response = await send(intent);
    expect(response.ok, `${intent.type}: ${JSON.stringify(response.ok ? null : response.error)}`).toBe(true);
    return response;
  };
  const state = async () => (await harness.repo.getState(runId))!;
  await must(CREATION);
  await must({ type: "READY", ready: true });
  return {
    runId,
    send,
    must,
    state,
    /** Plays the chapter under way to one of its endings. */
    finish: (sceneId = "scene_ending") => must({ type: "PLAYTEST_GOTO", sceneId }),
    /** The completion screen's button, then everyone ready again. */
    lobby: async () => {
      await must({ type: "ADVANCE" });
      await must({ type: "READY", ready: true });
    },
    /** Takes an exit from the visit the room's view shows. */
    exit: async (edgeId: string) => {
      const view = (await state()).campaign?.journey;
      return send({ type: "CHOOSE_EXIT", edgeId, visit: view?.visit ?? 0 });
    },
    xp: async () => {
      const id = (await state()).party[0]!.character.id;
      const stored = (await harness.repo.getCharacter(householdId, id))!;
      return (stored.provisional ?? stored.committed).xp;
    },
  };
}

describe("starting a graph campaign", () => {
  it("CONTINUE begins a fresh attempt at the entry, born holding its journey", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    // Before anything is played the lobby already shows the map's first place.
    expect((await a.state()).campaignOptions?.[0]?.journey).toMatchObject({
      node: "waystone",
      visit: 1,
      status: "playing",
      exits: [],
    });

    await a.must({ type: "CONTINUE_CAMPAIGN" });
    const run = await a.state();
    expect(run.chapterId).toBe("sampler-waystone");
    expect(run.journeyVisit).toEqual({ node: "waystone", visit: 1 });
    expect(await attempt()).toMatchObject({
      status: "active",
      attemptId: run.campaignAttemptId,
      journey: { version: JOURNEY_VERSION, node: "waystone", visit: 1, status: "playing", visits: { waystone: 1 } },
    });
  });

  it("only the journey's chapter may be started directly", async () => {
    const { harness, householdId, players } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    const refused = await a.send({ type: "START_CHAPTER", chapterId: "sampler-mill" });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? "" : refused.error?.message).toContain("sampler-waystone");
    expect((await a.state()).chapterId).toBeNull();
    await a.must({ type: "START_CHAPTER", chapterId: "sampler-waystone" });
  });

  it("an active attempt with no journey written yet starts fresh at the entry", async () => {
    const { harness, householdId, players, attempt } = await world();
    await harness.repo.putCampaignProgress({
      householdId,
      campaignId: "rift-sampler",
      status: "active",
      setbacks: 0,
      attemptId: "attempt-1",
      version: 3,
      updatedAt: new Date(T0).toISOString(),
    });
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    expect((await a.state()).chapterId).toBe("sampler-waystone");
    await a.finish();
    expect(await attempt()).toMatchObject({
      attemptId: "attempt-1",
      version: 4,
      journey: { node: "waystone", visit: 1, status: "choosing", completions: { waystone: 1 } },
    });
  });

  it("refuses a journey saved by a newer build, and leaves it exactly as it was", async () => {
    const { harness, householdId, players, attempt } = await world();
    const future = {
      householdId,
      campaignId: "rift-sampler",
      status: "active" as const,
      setbacks: 0,
      attemptId: "attempt-1",
      journey: { version: 2, node: "somewhere", visit: 4, status: "choosing", chapter: "x" } as never,
      version: 7,
      updatedAt: new Date(T0).toISOString(),
    };
    await harness.repo.putCampaignProgress(future);
    const a = await room(harness, householdId, players[0]!.principal);
    expect((await a.state()).campaignOptions?.[0]).toMatchObject({ next: null });
    expect((await a.state()).campaignOptions?.[0]?.journey).toBeUndefined();
    const refused = await a.send({ type: "CONTINUE_CAMPAIGN" });
    expect(refused.ok ? "" : refused.error?.message).toContain("version 2");
    expect(await attempt()).toEqual(future);
  });
});

describe("between chapters: the exit choice", () => {
  it("a completed visit turns to the exit choice, and CONTINUE waits for one", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();

    expect((await attempt())?.journey).toMatchObject({
      node: "waystone",
      visit: 1,
      status: "choosing",
      completions: { waystone: 1 },
      outcomes: { waystone: "success" },
      chaptersCompleted: ["sampler-waystone"],
    });
    const view = (await a.state()).campaign!;
    expect(view.next).toBeNull();
    expect(view.journey?.exits.map((e) => [e.edge, e.label, e.available])).toEqual([
      ["to-orchard", "Down to the orchard", true],
      ["to-quarry", "Up the quarry road", true],
    ]);

    await a.lobby();
    const refused = await a.send({ type: "CONTINUE_CAMPAIGN" });
    expect(refused.ok ? "" : refused.error?.message).toContain("has not chosen a way on");
  });

  it("CHOOSE_EXIT moves the journey, and CONTINUE then plays where it leads", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    // From the completion screen itself.
    await a.must({ type: "CHOOSE_EXIT", edgeId: "to-orchard", visit: 1 });

    expect((await attempt())?.journey).toMatchObject({
      node: "orchard",
      visit: 1,
      status: "playing",
      chapter: "sampler-orchard",
      traversed: { "to-orchard": 1 },
      lastExit: { node: "waystone", visit: 1, edge: "to-orchard" },
    });
    expect((await a.state()).campaign?.journey).toMatchObject({ node: "orchard", status: "playing" });
    expect((await a.state()).campaign?.next).toMatchObject({ title: "Title of sampler-orchard" });

    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    expect(await a.state()).toMatchObject({
      chapterId: "sampler-orchard",
      journeyVisit: { node: "orchard", visit: 1 },
    });
  });

  it("the double tap crosses once: the repeat is answered, not applied", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    await a.must({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 });
    const after = (await attempt())!;
    const seq = (await a.state()).seq;

    const again = await a.send({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 });
    expect(again).toEqual({ ok: true, seq });
    expect(await attempt()).toEqual(after);
    expect(after.journey?.traversed).toEqual({ "to-quarry": 1 });
  });

  it("refuses an exit mid-chapter, before the visit is done, and from a visit it has left", async () => {
    const { harness, householdId, players } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    const midChapter = await a.send({ type: "CHOOSE_EXIT", edgeId: "to-orchard", visit: 1 });
    expect(midChapter.ok ? "" : midChapter.error?.message).toContain("between chapters");

    await a.finish();
    await a.must({ type: "CHOOSE_EXIT", edgeId: "to-orchard", visit: 1 });
    // The orchard has not been played yet: no leaving it.
    const playing = await a.send({ type: "CHOOSE_EXIT", edgeId: "orchard-to-mill", visit: 1 });
    expect(playing.ok ? "" : playing.error?.message).toContain("has not been finished");
    // A screen still showing the waystone offers its other road.
    const stale = await a.send({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 });
    expect(stale).toMatchObject({ ok: false, error: { code: "ILLEGAL" } });
    const unknown = await a.send({ type: "CHOOSE_EXIT", edgeId: "to-the-moon", visit: 1 });
    expect(unknown).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("refuses a blocked exit with its reason", async () => {
    const { harness, householdId, players } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    await a.must({ type: "CHOOSE_EXIT", edgeId: "to-orchard", visit: 1 });
    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    const door = (await a.state()).campaign?.journey?.exits.find((e) => e.edge === "orchard-to-tower");
    expect(door).toMatchObject({ available: false, reason: "locked" });
    const refused = await a.exit("orchard-to-tower");
    expect(refused.ok ? "" : refused.error?.message).toContain("locked");
  });
});

describe("a walk through the map", () => {
  it("the mill's return floods the orchard and opens the door; the replay pays no XP", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    const play = async (edge?: string) => {
      if (edge) expect((await a.exit(edge)).ok).toBe(true);
      await a.lobby();
      await a.must({ type: "CONTINUE_CAMPAIGN" });
      await a.finish();
    };
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    await play("to-orchard");
    await play("orchard-to-mill");
    // Back along the stream: the wheel turns, the orchard floods.
    expect((await a.exit("mill-to-orchard")).ok).toBe(true);
    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    expect(await a.state()).toMatchObject({
      chapterId: "sampler-orchard-flooded",
      journeyVisit: { node: "orchard", visit: 2 },
      flags: { mill_wheel_turning: true },
    });
    await a.finish();
    expect((await a.state()).xpEarned).toBeGreaterThan(0);
    const door = (await a.state()).campaign?.journey?.exits.find((e) => e.edge === "orchard-to-tower");
    expect(door).toMatchObject({ available: true });
    expect((await a.state()).campaign?.journey?.exits.map((e) => e.edge)).not.toContain("orchard-to-mill");

    // Out to the hub — a pass: straight to the choice, nothing to play.
    expect((await a.exit("orchard-to-waystone")).ok).toBe(true);
    expect((await attempt())?.journey).toMatchObject({ node: "waystone", visit: 2, status: "choosing" });
    expect((await attempt())?.journey?.completions?.waystone).toBe(1);
    // And back down to the flooded orchard: a replay of a chapter already paid.
    const xpBefore = await a.xp();
    await play("to-orchard");
    expect((await a.state()).chapterId).toBe("sampler-orchard-flooded");
    expect((await a.state()).xpEarned).toBe(0);
    expect(await a.xp()).toBe(xpBefore);
    expect((await harness.repo.listChapterProgress(a.runId)).find((p) => p.chapterId === "sampler-orchard-flooded"))
      .toMatchObject({ xpEarned: 0 });
    expect((await attempt())?.journey).toMatchObject({
      visits: { waystone: 2, orchard: 3, mill: 1 },
      completions: { waystone: 1, orchard: 3, mill: 1 },
    });
  });

  it("a chapter's choice becomes a journey flag that opens a way, and the next chapter is seeded with it", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    await a.must({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 });
    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish("scene_lens");
    expect((await attempt())?.journey?.flags).toEqual({ found_the_lens: true });
    const climb = (await a.state()).campaign?.journey?.exits.find((e) => e.edge === "quarry-to-tower");
    expect(climb).toMatchObject({ available: true, label: "Climb to the tower" });

    expect((await a.exit("quarry-to-tower")).ok).toBe(true);
    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    expect(await a.state()).toMatchObject({ chapterId: "sampler-tower", flags: { found_the_lens: true } });
  });

  it("an ending completes the attempt, and the next CONTINUE starts a fresh map", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    await a.must({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 });
    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish("scene_setback");
    expect((await a.exit("quarry-to-home")).ok).toBe(true);
    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    expect((await a.state()).chapterId).toBe("sampler-long-road-home");
    await a.finish();

    const done = (await attempt())!;
    expect(done).toMatchObject({
      status: "complete",
      setbacks: 1,
      journey: { status: "ended", ending: "long-road-home", node: "long-road-home" },
    });
    const view = (await a.state()).campaign!;
    expect(view).toMatchObject({ ended: "complete", next: { title: "Title of sampler-waystone" } });
    expect(view.journey?.reachedEnding).toEqual({ node: "long-road-home", title: "The Long Road Home" });
    // An ended journey goes nowhere.
    const refused = await a.send({ type: "CHOOSE_EXIT", edgeId: "to-orchard", visit: 1 });
    expect(refused.ok).toBe(false);

    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    const replay = (await attempt())!;
    expect(replay.attemptId).not.toBe(done.attemptId);
    expect(replay.journey).toMatchObject({ node: "waystone", visit: 1, status: "playing", visits: { waystone: 1 } });
    expect(replay.journey?.chaptersCompleted).toBeUndefined();
  });

  it("a replayed map pays a hero nothing for a chapter the last attempt paid her (#408)", async () => {
    const { harness, householdId, players } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    await a.must({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 });
    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish("scene_setback");
    expect((await a.exit("quarry-to-home")).ok).toBe(true);
    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    expect((await a.state()).campaign?.ended).toBe("complete");
    const veteran = (await a.state()).party[0]!.character.id;
    const earned = await a.xp();

    // A new attempt: the same first chapter, the same hero.
    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    expect(await a.xp()).toBe(earned);
    expect((await a.state()).xpAlreadyPaid).toEqual([veteran]);
    // The chapter's worth still stands for anyone it has not paid.
    expect((await a.state()).xpEarned).toBeGreaterThan(0);
    // And the replay goes on as a story: the map moves, only the XP is held back.
    expect((await a.state()).campaign?.journey).toMatchObject({ node: "waystone", status: "choosing" });
  });

  it("a failed attempt does not spend a chapter's first payment: the next attempt pays it (#408)", async () => {
    const { harness, householdId, players } = await world(sampler({ setbackLimit: 1 }));
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish("scene_setback");
    expect((await a.state()).campaign?.ended).toBe("failed");
    expect(await a.xp()).toBe(0);

    await a.lobby();
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    expect(await a.xp()).toBeGreaterThan(0);
    expect((await a.state()).xpAlreadyPaid).toBeUndefined();
  });

  it("the setback limit fails the attempt wherever the party is", async () => {
    const { harness, householdId, players, attempt } = await world(sampler({ setbackLimit: 1 }));
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish("scene_setback");
    expect(await attempt()).toMatchObject({ status: "failed", setbacks: 1, journey: { node: "waystone" } });
    expect((await a.state()).campaign?.ended).toBe("failed");
  });
});

describe("sessions, rooms and races", () => {
  it("a new evening resumes the visit under way: same visit, same chapter, nothing counted", async () => {
    const { harness, householdId, players, attempt } = await world();
    const monday = await room(harness, householdId, players[0]!.principal);
    await monday.must({ type: "CONTINUE_CAMPAIGN" });
    await monday.finish();
    await monday.must({ type: "CHOOSE_EXIT", edgeId: "to-orchard", visit: 1 });
    await monday.lobby();
    await monday.must({ type: "CONTINUE_CAMPAIGN" });
    const before = (await attempt())!;
    // Monday stops mid-chapter. Thursday opens a new room.
    const thursday = await room(harness, householdId, players[1]!.principal);
    await thursday.must({ type: "CONTINUE_CAMPAIGN" });
    expect(await thursday.state()).toMatchObject({
      chapterId: "sampler-orchard",
      journeyVisit: { node: "orchard", visit: 1 },
    });
    expect(await attempt()).toEqual(before);
  });

  it("two rooms finishing one visit count it once; the slower one is told it earned nothing", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    const b = await room(harness, householdId, players[1]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await b.must({ type: "CONTINUE_CAMPAIGN" });
    expect((await b.state()).journeyVisit).toEqual({ node: "waystone", visit: 1 });

    await a.finish();
    const settled = (await attempt())!;
    const xpBefore = await b.xp();
    await b.finish();
    expect((await b.state()).phase).toBe("chapter_complete");
    expect((await b.state()).xpEarned).toBe(0);
    expect(await b.xp()).toBe(xpBefore);
    expect(await attempt()).toEqual(settled);
    expect(settled.journey?.completions).toEqual({ waystone: 1 });
  });

  it("two completions racing on the attempt's version: one lands, the other's retry is a duplicate", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    const b = await room(harness, householdId, players[1]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await b.must({ type: "CONTINUE_CAMPAIGN" });
    const version = (await attempt())!.version!;

    const [ra, rb] = await Promise.all([
      a.send({ type: "PLAYTEST_GOTO", sceneId: "scene_ending" }),
      b.send({ type: "PLAYTEST_GOTO", sceneId: "scene_ending" }),
    ]);
    // Both read the same attempt version; the store let exactly one write it.
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const loser = ra.ok ? b : a;
    expect((ra.ok ? rb : ra).error?.code).toBe("STALE_SEQ");
    expect((await attempt())!.version).toBe(version + 1);

    // The loser resyncs and tries again: the visit is already complete.
    const xpBefore = await loser.xp();
    await loser.finish();
    expect((await loser.state()).xpEarned).toBe(0);
    expect(await loser.xp()).toBe(xpBefore);
    expect((await attempt())!.journey?.completions).toEqual({ waystone: 1 });
    expect((await attempt())!.version).toBe(version + 1);
  });

  it("two phones taking different exits at once: one way is taken, never both", async () => {
    const { harness, householdId, players, attempt } = await world();
    const a = await room(harness, householdId, players[0]!.principal);
    const b = await room(harness, householdId, players[1]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();

    const [ra, rb] = await Promise.all([
      a.send({ type: "CHOOSE_EXIT", edgeId: "to-orchard", visit: 1 }),
      b.send({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 }),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const journey = (await attempt())!.journey!;
    expect(Object.keys(journey.traversed ?? {})).toHaveLength(1);
    expect(journey.visits).toMatchObject({ waystone: 1 });
    expect(journey.visit).toBe(1);
  });
});

/**
 * The sampler with its quarry road made a rift (#196): single-use, and
 * nobody knows where it leads until they have been.
 */
function riftSampler(): Campaign {
  const campaign = sampler();
  const graph = structuredClone(campaign.graph!);
  const { once: _once, ...road } = graph.edges["to-quarry"]!;
  graph.edges["to-quarry"] = { ...road, blocked: "shown", rift: { uses: 1, reveal: "when-crossed" } };
  return { ...campaign, graph };
}

describe("rifts (#196)", () => {
  it("the screens are told a rift is there, but not where it goes", async () => {
    const { harness, householdId, players } = await world(riftSampler());
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    const exit = (await a.state()).campaign?.journey?.exits.find((e) => e.edge === "to-quarry");
    expect(exit).toEqual({
      edge: "to-quarry",
      to: "",
      kind: "forward",
      label: "Up the quarry road",
      available: true,
      arrival: "new",
      rift: { status: "open", usesLeft: 1 },
      hiddenDestination: true,
    });
    expect(JSON.stringify((await a.state()).campaign?.journey)).not.toContain("Title of sampler-quarry");
  });

  it("a single-use crossing is one party move: the double tap is answered, not a second crossing", async () => {
    const { harness, householdId, players, attempt } = await world(riftSampler());
    const a = await room(harness, householdId, players[0]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    await a.must({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 });
    const after = (await attempt())!;
    expect(after.journey?.rifts).toEqual({ "to-quarry": { status: "consumed", crossings: 1, revealed: true } });

    const seq = (await a.state()).seq;
    expect(await a.send({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 })).toEqual({ ok: true, seq });
    expect(await attempt()).toEqual(after);
  });

  it("two phones crossing the same single-use rift at once cross it once", async () => {
    const { harness, householdId, players, attempt } = await world(riftSampler());
    const a = await room(harness, householdId, players[0]!.principal);
    const b = await room(harness, householdId, players[1]!.principal);
    await a.must({ type: "CONTINUE_CAMPAIGN" });
    await a.finish();
    const [ra, rb] = await Promise.all([
      a.send({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 }),
      b.send({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 }),
    ]);
    expect(ra.ok || rb.ok).toBe(true);
    // Whoever lost the write retries, and meets the crossing as a duplicate.
    const loser = ra.ok ? b : a;
    expect((await loser.send({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 })).ok).toBe(true);
    expect((await attempt())!.journey).toMatchObject({
      node: "quarry",
      traversed: { "to-quarry": 1 },
      rifts: { "to-quarry": { status: "consumed", crossings: 1 } },
    });
  });

  it("a session resumed after the crossing finds the rift used up — and knows now where it led", async () => {
    const { harness, householdId, players } = await world(riftSampler());
    const monday = await room(harness, householdId, players[0]!.principal);
    await monday.must({ type: "CONTINUE_CAMPAIGN" });
    await monday.finish();
    await monday.must({ type: "CHOOSE_EXIT", edgeId: "to-quarry", visit: 1 });

    // Thursday: a new room plays the quarry and walks back to the waystone.
    const thursday = await room(harness, householdId, players[1]!.principal);
    await thursday.must({ type: "CONTINUE_CAMPAIGN" });
    expect((await thursday.state()).chapterId).toBe("sampler-quarry");
    await thursday.finish();
    expect((await thursday.exit("quarry-to-waystone")).ok).toBe(true);
    const exit = (await thursday.state()).campaign?.journey?.exits.find((e) => e.edge === "to-quarry");
    expect(exit).toMatchObject({
      to: "quarry",
      available: false,
      reason: "rift-consumed",
      rift: { status: "consumed" },
    });
    expect(exit).not.toHaveProperty("hiddenDestination");
    const refused = await thursday.exit("to-quarry");
    expect(refused.ok ? "" : refused.error?.message).toContain("rift-consumed");
  });
});
