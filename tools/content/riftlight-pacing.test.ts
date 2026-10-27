import { expect, it } from "vitest";
import { pacingReport, pacingEdges } from "../../packages/shared/src/chapter-pacing.ts";
import type { Chapter } from "@kad/shared";
import { chapters, allPaths } from "./riftlight-test-support.ts";

// Minimum activities on every finishing path; cycles are optional revisits.
function minimumActivities(chapter: Chapter, id = chapter.entry, seen = new Set<string>(), memo = new Map<string, number>()): number {
  if (seen.has(id)) return Infinity;
  if (memo.has(id)) return memo.get(id)!;
  const scene = chapter.scenes[id]!;
  const edges = pacingEdges(scene);
  const next = new Set(seen).add(id);
  const own = Number(scene.type === "interaction");
  const result = own + (edges.length ? Math.min(...edges.map(e => minimumActivities(chapter, e.to, next, memo))) : 0);
  memo.set(id, result);
  return result;
}

it.each(["stone-counters", "whale-road", "the-wrong-valley", "reading-room", "the-island-due-back"])("%s varies the required play without padding the chapter with rolls", { timeout: 20_000 }, id => {
  const chapter = chapters.get(`riftlight-${id}`)!;
  expect(minimumActivities(chapter)).toBeGreaterThanOrEqual(2);
  const kinds = new Set(Object.values(chapter.scenes).filter(s => s.type === "interaction").map(s => s.interaction.kind));
  expect(kinds.size).toBeGreaterThanOrEqual(2);
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
