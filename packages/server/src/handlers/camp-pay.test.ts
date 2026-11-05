/**
 * Dash Cash during play and at the chapter's end (#619, docs/camp.md §5.2,
 * §12.2): the chapter's pay, lucky drops saved as they land, and the
 * chapter-end sweep of finds whose claim failed.
 */

import { describe, expect, it, vi } from "vitest";
import { dropKey } from "@kad/shared";
import type { Effect, RunState, StoryScene } from "@kad/shared";
import { applyOps } from "../json-patch.ts";
import { makeContent, makeHarness } from "../test-support.ts";
import { mutateCamp, readCamp } from "./camp.ts";
import { CHAPTER, harnessFor, payingChapter, table, type Table } from "./camp-table.testing.ts";
import { applyIntent, createRunState } from "@kad/shared";
import type { TestHarness } from "../test-support.ts";

const AT = "2026-11-05T00:00:00.000Z";

/** Ring the bell at the clearing, hitting it, with every draw of this step's rng at `draw`. */
async function ringBell(t: Table, harness: TestHarness, draw: number) {
  await t.goto("scene_bell");
  const prompt = (await t.state()).prompt;
  if (prompt?.kind !== "interaction") throw new Error("no game");
  const actor = prompt.actorId ?? "p_1";
  await t.send(actor, { type: "INTERACT", openedSeq: prompt.openedSeq, attempt: prompt.attempt, action: "start", relaxed: false });
  const honest = harness.deps.rng;
  harness.deps.rng = () => ({ next: () => draw });
  const s = (await t.state()).prompt as typeof prompt;
  const message = await t.send(actor, { type: "INTERACT", openedSeq: s.openedSeq, attempt: s.attempt, action: "stop", position: 0.5 });
  harness.deps.rng = honest;
  return message;
}

describe("the chapter's pay (§5.2)", () => {
  it("pays 2 for finishing, once, and shows it on the summary", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.start();
    await t.goto("scene_ending");
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(2);
    expect(camp.paidChapterCount).toBe(1);
    expect(camp.receipts.chapters[CHAPTER]).toMatchObject({ runId: t.runId });
    const s = await t.state();
    expect(s.campTally).toEqual({ finished: 2, objectives: 0, drops: 0, replay: false, balance: 2, shopOpen: false });
    // The camp's view is on the summary, with the balance after.
    expect(s.camp).toMatchObject({ dashCash: 2, shopOpen: false });
    // Not open yet: no shop.
    expect(s.campShop).toBeUndefined();
  });

  it("adds 1 for each optional objective met, and nothing for goal steps", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.start();
    // The shrine sets found_shrine: an objective and a goal step both.
    await t.goto("scene_shrine");
    await t.goto("scene_ridge");
    // The low road ticks the goal's other step; the high road's objective is missed.
    const ridge = (await t.state()).prompt;
    expect(ridge?.kind).toBe("choice");
    await t.send("p_1", { type: "CHOOSE", choiceId: "low" });
    await t.send("p_2", { type: "CHOOSE", choiceId: "low" });
    const s = await t.state();
    expect(s.phase).toBe("chapter_complete");
    expect(s.campTally).toMatchObject({ finished: 2, objectives: 1, balance: 3 });
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(3);
  });

  it("still pays for finishing on a setback ending", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.start();
    await t.goto("scene_setback");
    const s = await t.state();
    expect(s.chapterOutcome).toBe("setback");
    expect(s.campTally).toMatchObject({ finished: 2, objectives: 0, replay: false, balance: 2 });
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(2);
  });

  it("pays nothing for a replay, objectives missed the first time included", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.start();
    await t.goto("scene_ending");
    await t.leave();
    await t.start();
    await t.goto("scene_shrine");
    await t.goto("scene_ending");
    const s = await t.state();
    expect(s.campTally).toEqual({ finished: 0, objectives: 0, drops: 0, replay: true, balance: 2, shopOpen: false });
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(2);
    expect(camp.paidChapterCount).toBe(1);
  });

  it("drops the tally and keeps the camp's view in the lobby, and takes the view away when a scene opens", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.start();
    await t.goto("scene_ending");
    await t.leave();
    const lobby = await t.state();
    expect(lobby.campTally).toBeUndefined();
    expect(lobby.camp?.dashCash).toBe(2);
    await t.start();
    expect((await t.state()).camp).toBeUndefined();
  });
});

describe("lucky drops (§5.2, §12.2)", () => {
  it("saves a drop the moment its game is won, with its receipt, and tells the screens", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.start();
    const message = await ringBell(t, harness, 0);
    expect(message.campDrops).toEqual([{ sceneId: "scene_bell", kind: "game" }]);
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(1);
    expect(camp.receipts.drops[dropKey(t.runId, "scene_bell")]).toMatchObject({ chapterId: CHAPTER, runId: t.runId });
  });

  it("shows nothing for a roll that did not come up", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.start();
    const message = await ringBell(t, harness, 0.99);
    expect(message.campDrops).toBeUndefined();
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(0);
  });

  it("is counted in the chapter's tally, and the chapter's pay closes the chapter to drops", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.start();
    await ringBell(t, harness, 0);
    const s0 = await t.state();
    // The bell's success went on to the ending when the party continued.
    const prompt = s0.prompt;
    if (prompt?.kind !== "interaction") throw new Error("no game");
    await t.send(prompt.resolvedActorId ?? "p_1", { type: "INTERACT", openedSeq: prompt.openedSeq, attempt: prompt.attempt, action: "continue" });
    const s = await t.state();
    expect(s.phase).toBe("chapter_complete");
    expect(s.campTally).toMatchObject({ finished: 2, drops: 1, balance: 3 });
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.dashCash).toBe(3);
    // Pruned with the pay: a paid chapter drops nothing more.
    expect(Object.keys(camp.receipts.drops)).toEqual([]);
  });

  it("pays none in a chapter the crew was already paid for", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await mutateCamp(t.householdId, null, (c) => ({ ...c, receipts: { ...c.receipts, chapters: { [CHAPTER]: { at: AT } } } }), harness.deps);
    await t.start();
    const message = await ringBell(t, harness, 0);
    expect(message.campDrops).toBeUndefined();
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(0);
  });

  it("pays at most 2 a chapter, counting every attempt at it", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    // Two drops from an earlier, abandoned attempt in another room.
    await mutateCamp(
      t.householdId,
      null,
      (c) => ({
        ...c,
        dashCash: 2,
        receipts: {
          ...c.receipts,
          drops: {
            [dropKey("run_old", "a")]: { at: AT, runId: "run_old", chapterId: CHAPTER },
            [dropKey("run_old", "b")]: { at: AT, runId: "run_old", chapterId: CHAPTER },
          },
        },
      }),
      harness.deps,
    );
    await t.start();
    const message = await ringBell(t, harness, 0);
    expect(message.campDrops).toBeUndefined();
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(2);
  });

  it("is rebuilt exactly by replaying the event log, which writes nothing", async () => {
    const harness = harnessFor();
    const t = await table(harness);
    await t.start();
    const atStart = await t.state();
    await ringBell(t, harness, 0);
    const camp = await harness.repo.getCamp(t.householdId);
    const put = vi.spyOn(harness.repo, "putCamp");
    // What a reconnect does: the log's patches since what the phone held, in order.
    const events = await harness.repo.listEvents(t.runId, atStart.seq);
    const replayed = events.reduce<RunState>((s, e) => applyOps(s, e.patch) as RunState, structuredClone(atStart));
    const now = await t.state();
    expect(replayed.campLuck).toEqual({ rolled: ["scene_bell"], drops: [{ sceneId: "scene_bell", kind: "game" }] });
    expect(replayed.campLuck).toEqual(now.campLuck);
    // The drop is not in the log's messages: a replay never sparkles or pays again.
    expect(events.every((e) => !("campDrops" in e))).toBe(true);
    expect(put).not.toHaveBeenCalled();
    expect(await harness.repo.getCamp(t.householdId)).toEqual(camp);
  });
});

describe("the chapter-end sweep (§12.2)", () => {
  it("re-claims a find whose claim failed when it was found, exactly once", async () => {
    const chapter = payingChapter();
    const find: Effect = { type: "findForCamp", pieceId: "find_noodle_awning", rewardId: "bramblewood-01.awning" };
    (chapter.scenes["scene_shrine"] as StoryScene).onEnter!.push(find);
    const harness = makeHarness({
      engine: { applyIntent, createRunState },
      content: makeContent({ chapters: [chapter] }),
      playtest: true,
    });
    const t = await table(harness);
    await t.start();
    // The store refuses every write while the find is claimed: the claim fails.
    const put = vi.spyOn(harness.repo, "putCamp").mockResolvedValue(false);
    const found = await t.goto("scene_shrine");
    expect(found.campClaims).toEqual([{ rewardId: "bramblewood-01.awning", kind: "camp", pieceId: "find_noodle_awning", result: "none" }]);
    expect((await readCamp(t.householdId, null, harness.deps)).owned["find_noodle_awning"]).toBeUndefined();
    put.mockRestore();
    // The chapter's end sweeps it up.
    const ended = await t.goto("scene_ending");
    expect(ended.campClaims).toEqual([{ rewardId: "bramblewood-01.awning", kind: "camp", pieceId: "find_noodle_awning", result: "piece" }]);
    const camp = await readCamp(t.householdId, null, harness.deps);
    expect(camp.owned["find_noodle_awning"]).toMatchObject({ from: "found" });
    // 2 for finishing, 1 for the shrine objective, and nothing for the find, which was new.
    expect(camp.dashCash).toBe(3);
    // Once: a replay's sweep finds the receipt, and pays no duplicate Dash Cash.
    await t.leave();
    await t.start();
    await t.goto("scene_shrine");
    const again = await t.goto("scene_ending");
    expect(again.campClaims ?? []).toEqual([]);
    expect((await readCamp(t.householdId, null, harness.deps)).dashCash).toBe(3);
  });
});

