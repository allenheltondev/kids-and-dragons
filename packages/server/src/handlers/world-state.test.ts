/**
 * World state (#198), played through the real server.
 *
 * The Ash Wyrm Sampler (shared fixtures/world-state.campaign.json) with a
 * small test chapter behind every node — the journey.test.ts harness, bent to
 * this fixture: each chapter has a plain success ending, a setback, and an
 * ending that befriends the river folk (sets the `befriended_river_folk`
 * journey flag, which the village's completion rule turns into a favour).
 *
 * What is pinned is the persistence half of the contract: the world a party
 * changes is stored on *its* attempt row, in the same conditional commit as
 * the rest of the journey, survives every evening, and shows on the lobby —
 * while the campaign content every household shares is never written, and a
 * fresh attempt (this household's next one, or another household's first)
 * starts from the world as the author wrote it.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { Campaign, Chapter, ClientIntent, StoryScene } from "@kad/shared";
import type { DeviceIdentity } from "../identity.ts";
import type { Engine } from "../engine/port.ts";
import type { ContentStore } from "../content/loader.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold, type TestHarness } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };

function wyrm(): Campaign {
  return JSON.parse(
    readFileSync(new URL("../../../shared/src/fixtures/world-state.campaign.json", import.meta.url), "utf8"),
  ) as Campaign;
}

const ending = (narration: string, extra: Partial<StoryScene> = {}): StoryScene => ({
  type: "story",
  narration,
  choices: [],
  ...extra,
});

function wyrmChapters(campaign: Campaign): Chapter[] {
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
        scene_befriend: ending("The river folk wave you across.", {
          onEnter: [{ type: "setFlag", flag: "befriended_river_folk" }],
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

/** One household, on its own store, playing from `content` — which households share. */
async function household(content: ContentStore) {
  const harness = makeHarness({ engine: realEngine, playtest: true, content });
  const seeded = await seedHousehold(harness, 1);
  const attempt = async () => harness.repo.getCampaignProgress(seeded.householdId, "world-state-sampler");
  return { harness, attempt, ...seeded };
}

/** A room opened for the Ash Wyrm Sampler, with one ready hero — one evening. */
async function room(harness: TestHarness, householdId: string, principal: DeviceIdentity) {
  const created = await createRoom({ householdId, mode: "party", campaignId: "world-state-sampler" }, harness.deps);
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
  const view = async () => (await state()).campaign ?? (await state()).campaignOptions?.[0];
  return {
    state,
    must,
    view,
    /** Begins the journey's next chapter and plays it to the given ending. */
    play: async (sceneId = "scene_ending") => {
      await must({ type: "CONTINUE_CAMPAIGN" });
      const chapterId = (await state()).chapterId;
      await must({ type: "PLAYTEST_GOTO", sceneId });
      return chapterId;
    },
    /** From the completion screen: take an exit, back to the lobby, everyone ready. */
    exit: async (edgeId: string) => {
      const visit = (await state()).campaign?.journey?.visit ?? 0;
      await must({ type: "CHOOSE_EXIT", edgeId, visit });
      await must({ type: "ADVANCE" });
      await must({ type: "READY", ready: true });
    },
  };
}

const valuesOf = (facts: { id: string; value: unknown }[] | undefined) =>
  Object.fromEntries((facts ?? []).map((fact) => [fact.id, fact.value]));

describe("world state on the household's attempt", () => {
  it("is written by a chapter's completion, stored on the attempt, and changes the place on the way back", async () => {
    const campaign = wyrm();
    const content = makeContent({ chapters: wyrmChapters(campaign), campaigns: [campaign] });
    const { harness, householdId, players, attempt } = await household(content);
    const a = await room(harness, householdId, players[0]!.principal);

    // Before anything: the world as the author wrote it, on the lobby.
    expect(valuesOf((await a.view())?.journey?.facts)).toEqual({
      "mill-village": "standing",
      "ash-wyrm": "sleeping",
      "river-folk": 0,
      "scorched-orchard": false,
    });

    expect(await a.play()).toBe("ws-crossroads");
    await a.exit("to-village");
    expect(await a.play("scene_befriend")).toBe("ws-village");
    expect((await attempt())?.journey?.facts).toEqual({ "river-folk": 1 });
    await a.exit("village-to-crossroads"); // the hub is passed through: choosing again
    await a.exit("to-lair");
    expect(await a.play("scene_setback")).toBe("ws-lair");

    expect((await attempt())?.journey?.facts).toEqual({
      "river-folk": 1,
      "ash-wyrm": "raging",
      "mill-village": "displaced",
      "scorched-orchard": true,
    });
    expect(valuesOf((await a.state()).campaign?.journey?.facts)).toMatchObject({
      "mill-village": "displaced",
      "ash-wyrm": "raging",
    });
    // The hidden route fact never reaches a phone.
    expect((await a.state()).campaign?.journey?.facts?.map((f) => f.id)).not.toContain("ford-path");

    await a.exit("lair-to-crossroads");
    await a.exit("to-village");
    // The same place, a different encounter: not the standing village again.
    expect(await a.play()).toBe("ws-village-displaced");
  });

  it("survives the evening: a new room resumes the same world", async () => {
    const campaign = wyrm();
    const content = makeContent({ chapters: wyrmChapters(campaign), campaigns: [campaign] });
    const { harness, householdId, players, attempt } = await household(content);
    const monday = await room(harness, householdId, players[0]!.principal);
    await monday.play();
    await monday.exit("to-lair");
    await monday.play("scene_setback");
    await monday.exit("lair-to-crossroads");
    const stored = (await attempt())!;

    const thursday = await room(harness, householdId, players[0]!.principal);
    expect(valuesOf((await thursday.view())?.journey?.facts)).toMatchObject({ "ash-wyrm": "raging" });
    await thursday.exit("to-lair");
    expect(await thursday.play()).toBe("ws-lair-raging");
    expect((await attempt())?.journey?.facts).toMatchObject({ ...stored.journey?.facts, "ash-wyrm": "cleared", "mill-village": "restored" });
  });

  it("belongs to the attempt alone: the content is never written, and a fresh attempt or another household starts as authored", async () => {
    const campaign = wyrm();
    const content = makeContent({ chapters: wyrmChapters(campaign), campaigns: [campaign] });
    const authored = structuredClone(content.campaign("world-state-sampler"));
    const first = await household(content);
    const a = await room(first.harness, first.householdId, first.players[0]!.principal);
    await a.play();
    await a.exit("to-lair");
    await a.play("scene_setback");
    await a.exit("lair-to-crossroads");
    await a.exit("to-lair");
    await a.play(); // the wyrm is cleared, the village restored
    await a.exit("lair-to-crossroads");
    await a.exit("to-high-pass");
    await a.play();
    expect((await first.attempt())).toMatchObject({ status: "complete", journey: { ending: "high-pass" } });

    // Nothing the party did touched what every household shares.
    expect(content.campaign("world-state-sampler")).toEqual(authored);
    expect(content.graph("world-state-sampler")?.facts["mill-village"]).toEqual(authored!.graph!.facts!["mill-village"]);

    // Another household, same content: the world as authored.
    const second = await household(content);
    const b = await room(second.harness, second.householdId, second.players[0]!.principal);
    expect(valuesOf((await b.view())?.journey?.facts)).toMatchObject({ "mill-village": "standing", "ash-wyrm": "sleeping" });

    // This household's next attempt: the world as authored too.
    await a.must({ type: "ADVANCE" });
    await a.must({ type: "READY", ready: true });
    expect(await a.play()).toBe("ws-crossroads");
    const replay = (await first.attempt())!;
    expect(replay.status).toBe("active");
    expect(replay.journey).not.toHaveProperty("facts");
    await a.exit("to-village");
    expect(await a.play()).toBe("ws-village");
  });
});
