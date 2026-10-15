/**
 * The playable vertical slice of graph navigation (#195), through the real
 * server: a branch, a revisit that finds a place changed, and a crossing that
 * cannot be undone - walked the way the phones walk it.
 *
 * What the phones draw is `CampaignView.journey`, so that is what every step
 * here reads; and what a tap sends is `CHOOSE_EXIT` followed (unless the way
 * leads through a "pass") by `CONTINUE_CAMPAIGN`, so that is what every step
 * here sends. The panel's own states are tested in
 * `packages/client/src/screens/journey-panel.test.tsx`; this holds the data
 * under them to the contract: nothing unexplored is named, blocked and spent
 * ways say why, `changed` appears exactly when the place will differ, and the
 * map remembers where the party has been.
 *
 * The helpers are `journey.test.ts`'s, trimmed to what a walk needs (a test
 * file cannot be imported without running it).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { Campaign, Chapter, ClientIntent, JourneyView, StoryScene } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };

function sampler(): Campaign {
  return JSON.parse(
    readFileSync(new URL("../../../shared/src/fixtures/rift-sampler.campaign.json", import.meta.url), "utf8"),
  ) as Campaign;
}

const ending = (narration: string, extra: Partial<StoryScene> = {}): StoryScene => ({
  type: "story",
  narration,
  choices: [],
  ...extra,
});

function samplerChapters(campaign: Campaign): Chapter[] {
  return campaign.chapters.map((id, i) => {
    const base = makeChapter();
    return {
      ...base,
      id,
      campaignId: campaign.id,
      index: i + 1,
      // A chapter's own title is the story beat's name - exactly what an
      // unexplored place must not give away.
      title: `Secret of ${id}`,
      scenes: { ...base.scenes, scene_setback: ending("It went badly.", { outcome: "setback" }) },
    };
  });
}

async function party() {
  const campaign = sampler();
  const harness = makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ chapters: samplerChapters(campaign), campaigns: [campaign] }),
  });
  const seeded = await seedHousehold(harness, 1);
  const created = await createRoom(
    { householdId: seeded.householdId, mode: "party", campaignId: campaign.id },
    harness.deps,
  );
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  const joined = await joinRoom({ code, principal: seeded.players[0]!.principal }, harness.deps);
  if (!joined.ok) throw new Error("join");

  const must = async (intent: ClientIntent) => {
    const seq = (await harness.repo.getState(runId))?.seq ?? 0;
    const response = await applyAction({ runId, playerId: joined.value.playerId, seq, intent }, harness.deps);
    expect(response.ok, `${intent.type}: ${JSON.stringify(response.ok ? null : response.error)}`).toBe(true);
  };
  const state = async () => (await harness.repo.getState(runId))!;
  await must({
    type: "CREATE_CHARACTER",
    name: "Pip",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
  });
  await must({ type: "READY", ready: true });

  /** What the lobby shows: the journey as the phones draw it. */
  const map = async (): Promise<JourneyView> => (await state()).campaign!.journey!;
  return {
    must,
    state,
    map,
    finish: (scene = "scene_ending") => must({ type: "PLAYTEST_GOTO", sceneId: scene }),
    /** The lobby tap: CHOOSE_EXIT, then CONTINUE unless the way is a pass-through. */
    go: async (edge: string) => {
      const view = await map();
      const way = view.exits.find((e) => e.edge === edge);
      if (!way) throw new Error(`the map does not offer "${edge}": ${view.exits.map((e) => e.edge).join(", ")}`);
      await must({ type: "ADVANCE" });
      await must({ type: "READY", ready: true });
      await must({ type: "CHOOSE_EXIT", edgeId: edge, visit: view.visit, campaignId: campaign.id });
      if (way.arrival !== "pass") await must({ type: "CONTINUE_CAMPAIGN", campaignId: campaign.id });
    },
  };
}

describe("a walk through the Rift Sampler as the phones see it", () => {
  it("branches, revisits a changed place, and crosses a one-way road", async () => {
    const walk = await party();
    await walk.must({ type: "CONTINUE_CAMPAIGN" });
    await walk.finish();

    // --- the first fork: two unexplored ways, one of them a one-time road ---
    const fork = await walk.map();
    expect(fork).toMatchObject({ node: "waystone", status: "choosing" });
    expect(fork.exits.map((e) => [e.edge, e.arrival, e.once ?? false])).toEqual([
      ["to-orchard", "new", false],
      ["to-quarry", "new", true],
    ]);
    expect(fork.places).toEqual([
      { node: "waystone", title: "The Waystone", visits: 1, completed: true, here: true },
    ]);
    // Nothing further down the map is named, and no story beat's title leaks.
    expect(JSON.stringify(fork)).not.toMatch(/mill|tower|dawn|home|Secret of/i);

    // --- branch: the orchard, then a side trip to the mill ---
    await walk.go("to-orchard");
    await walk.finish();
    const orchard = await walk.map();
    expect(orchard.exits.map((e) => [e.edge, e.available, e.reason ?? null, e.arrival])).toEqual([
      ["orchard-to-mill", true, null, "new"],
      ["orchard-to-waystone", true, null, "pass"],
      // Drawn because the author said so, and blocked without saying what opens it.
      ["orchard-to-tower", false, "locked", "new"],
    ]);

    await walk.go("orchard-to-mill");
    await walk.finish();

    // --- revisit: the way back to the orchard will find it changed ---
    const mill = await walk.map();
    expect(mill.exits).toHaveLength(1);
    expect(mill.exits[0]).toMatchObject({ edge: "mill-to-orchard", arrival: "replay", changed: true });
    // ...and says nothing about how.
    expect(JSON.stringify(mill)).not.toMatch(/flooded/);

    await walk.go("mill-to-orchard");
    expect(await walk.state()).toMatchObject({ chapterId: "sampler-orchard-flooded" });
    await walk.finish();
    const flooded = await walk.map();
    // The mill is finished for good, so its way is gone; the tower door opened.
    expect(flooded.exits.map((e) => e.edge)).toEqual(["orchard-to-waystone", "orchard-to-tower"]);
    expect(flooded.exits.find((e) => e.edge === "orchard-to-tower")).toMatchObject({ available: true });
    // Played now, the orchard is just the orchard: no longer news.
    expect(flooded.exits.some((e) => e.changed)).toBe(false);
    expect(flooded.places?.map((p) => [p.node, p.visits])).toEqual([
      ["waystone", 1],
      ["orchard", 2],
      ["mill", 1],
    ]);

    // --- the hub is a pass-through: back to a choice, nothing to play ---
    await walk.go("orchard-to-waystone");
    const hub = await walk.map();
    expect(hub).toMatchObject({ node: "waystone", visit: 2, status: "choosing" });
    expect(hub.exits.find((e) => e.edge === "to-orchard")).toMatchObject({ arrival: "replay" });
    expect(hub.places?.find((p) => p.node === "waystone")).toMatchObject({ visits: 2, here: true });

    // --- the one-time road, and then the road with no way back ---
    await walk.go("to-quarry");
    await walk.finish("scene_setback");
    const quarry = await walk.map();
    const home = quarry.exits.find((e) => e.edge === "quarry-to-home");
    expect(home).toMatchObject({ irreversible: true, available: true, label: "Take the long road home" });
    expect(quarry.exits.map((e) => e.edge)).not.toContain("quarry-to-tower");

    await walk.go("quarry-to-home");
    await walk.finish();
    const done = await walk.map();
    expect(done).toMatchObject({
      status: "ended",
      exits: [],
      reachedEnding: { node: "long-road-home", title: "The Long Road Home" },
    });
    // The whole walk is remembered, in the map's own order.
    expect(done.places?.map((p) => p.node)).toEqual(["waystone", "orchard", "mill", "quarry", "long-road-home"]);
  });

  it("a one-time road is gone once taken: back at the hub it is no longer offered", async () => {
    const walk = await party();
    await walk.must({ type: "CONTINUE_CAMPAIGN" });
    await walk.finish();
    await walk.go("to-quarry");
    await walk.finish();
    await walk.go("quarry-to-waystone");
    const hub = await walk.map();
    expect(hub).toMatchObject({ node: "waystone", visit: 2, status: "choosing" });
    // Spent, and authored hidden: it does not appear as a dead end.
    expect(hub.exits.map((e) => e.edge)).toEqual(["to-orchard"]);
  });
});
