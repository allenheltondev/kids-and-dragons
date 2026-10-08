/**
 * `RunState.campaign` — what the lobby and the completion screen are told.
 *
 * The table could not see where it was in a campaign (the lobby only ever said
 * "Begin the adventure"), and the chapter that finished eight weeks of play
 * said "Chapter finished!" like any other. The server knows both; this pins
 * that it says so, through real rooms and real chapters.
 */

import { describe, expect, it } from "vitest";
import { applyIntent, createRunState } from "@kad/shared";
import type { Campaign, Chapter, ClientIntent } from "@kad/shared";
import type { Engine } from "../engine/port.ts";
import { makeChapter } from "../../../shared/src/test-fixtures.ts";
import { makeContent, makeHarness, seedHousehold } from "../test-support.ts";
import { applyAction } from "./action.ts";
import { createRoom, joinRoom } from "./room.ts";

const realEngine: Engine = { applyIntent, createRunState };

function chapter(id: string, index: number, title: string, setback = false): Chapter {
  const base = makeChapter();
  const scenes = structuredClone(base.scenes);
  if (setback) (scenes.scene_ending as { outcome?: string }).outcome = "setback";
  return { ...base, id, index, title, scenes };
}

async function table(campaign: Campaign, chapters: Chapter[]) {
  const harness = makeHarness({
    engine: realEngine,
    playtest: true,
    content: makeContent({ chapters, campaigns: [campaign] }),
  });
  const { householdId, players } = await seedHousehold(harness, 1);
  const created = await createRoom({ householdId, mode: "travel", campaignId: campaign.id }, harness.deps);
  if (!created.ok) throw new Error("room");
  const { code, runId } = created.value;
  await joinRoom({ code, principal: players[0]!.principal }, harness.deps);
  const state = async () => (await harness.repo.getState(runId))!;
  const send = async (intent: ClientIntent) => {
    const response = await applyAction({ runId, playerId: "p_1", seq: (await state()).seq, intent }, harness.deps);
    expect(response.ok, JSON.stringify(response.ok ? null : response.error)).toBe(true);
  };
  await send({
    type: "CREATE_CHARACTER",
    name: "Pip",
    species: "unicorn",
    class: "songkeeper",
    stats: { might: 1, quick: 1, clever: 0, heart: 1 },
    appearance: { palette: "meadow", accent: "#7FD4C1" },
  } as ClientIntent);
  /** One evening: ready up, continue the campaign, play to the ending. */
  const playChapter = async () => {
    await send({ type: "READY", ready: true });
    await send({ type: "CONTINUE_CAMPAIGN", campaignId: campaign.id });
    expect((await state()).campaign?.ended).toBeUndefined();
    await send({ type: "PLAYTEST_GOTO", sceneId: "scene_ending" });
    expect((await state()).phase).toBe("chapter_complete");
  };
  const toLobby = () => send({ type: "ADVANCE" });
  return { state, playChapter, toLobby };
}

const TWO: Campaign = {
  id: "the-hollow-crown",
  title: "The Hollow Crown",
  blurb: "Two chapters.",
  chapters: ["bramblewood-01", "bramblewood-02"],
};

describe("the campaign, as the table sees it", () => {
  it("tells a new room's lobby which chapter is first", async () => {
    const { state } = await table(TWO, [chapter("bramblewood-01", 1, "The Path"), chapter("bramblewood-02", 2, "The Door")]);
    expect((await state()).campaign).toEqual({
      id: "the-hollow-crown",
      title: "The Hollow Crown",
      chapters: 2,
      next: { index: 1, title: "The Path" },
    });
  });

  it("moves on to the next chapter after one finishes", async () => {
    const { state, playChapter } = await table(TWO, [
      chapter("bramblewood-01", 1, "The Path"),
      chapter("bramblewood-02", 2, "The Door"),
    ]);
    await playChapter();
    expect((await state()).campaign).toMatchObject({ next: { index: 2, title: "The Door" } });
    expect((await state()).campaign?.ended).toBeUndefined();
  });

  it("says the campaign is complete when its last chapter finishes, and offers it again", async () => {
    const { state, playChapter, toLobby } = await table(TWO, [
      chapter("bramblewood-01", 1, "The Path"),
      chapter("bramblewood-02", 2, "The Door"),
    ]);
    await playChapter();
    await toLobby();
    await playChapter();
    expect((await state()).campaign).toMatchObject({ ended: "complete", next: { index: 1, title: "The Path" } });

    // The moment passes when the next chapter starts.
    await toLobby();
    await playChapter();
  });

  it("says the campaign failed when the setback limit is reached", async () => {
    const { state, playChapter } = await table({ ...TWO, setbackLimit: 1 }, [
      chapter("bramblewood-01", 1, "The Path", true),
      chapter("bramblewood-02", 2, "The Door"),
    ]);
    await playChapter();
    expect((await state()).campaign).toMatchObject({ ended: "failed", next: { index: 1 } });
  });
});
