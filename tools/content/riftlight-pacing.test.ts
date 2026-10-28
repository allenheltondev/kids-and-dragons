import { expect, it } from "vitest";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { chapters, allPaths } from "./riftlight-test-support.ts";

it.each(["stone-counters", "whale-road", "the-wrong-valley", "reading-room", "the-island-due-back"])("%s varies the required play without padding the chapter with rolls", { timeout: 20_000 }, id => {
  const chapter = chapters.get(`riftlight-${id}`)!;

  for (const { shortest } of pacingReport(chapter).scenarios) {
    expect(shortest).not.toBeNull();
    expect(shortest!.checks).toBeLessThanOrEqual(6);
    expect(shortest!.longestReadingRun).toBeLessThanOrEqual(5);
  }
});

it("bridge investigation keeps its core discovery on every path", () => {
  const chapter = chapters.get("riftlight-buried-bridge")!;
  expect(chapter.estimatedMinutes).toBe(30);
  expect(Object.values(chapter.scenes).some(s => s.type === "check")).toBe(false);
  // Flag-dependent equipment routes are covered through the engine in bridge-play.
  for (const end of allPaths(chapter, "manticore", "duskrunner").ends) {
    for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
    expect(end.flags.fragment_coast_learned).toBe(true);
  }
});

it("the longer paths preserve the party's chosen priorities", () => {
  for (const [id, flag] of [["stone-counters", "stone_route_priority"], ["whale-road", "sky_followup_promised"]]) {
    const { ends } = allPaths(chapters.get(`riftlight-${id}`)!, "manticore", "duskrunner");
    expect(ends.some(s => s.flags[flag!] === true), id).toBe(true);
    expect(ends.some(s => s.flags[flag!] === false), id).toBe(true);
  }
});
