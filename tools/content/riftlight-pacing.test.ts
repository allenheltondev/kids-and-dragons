import { expect, it } from "vitest";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { chapters, allPaths } from "./riftlight-test-support.ts";

// The old "without padding the chapter with rolls" cap (at most 6 checks) is gone: every Riftlight chapter
// was rebuilt with real dice in November 2026 (arc.md), and each chapter's own suite tests its consequences.

it("bridge investigation keeps its core discovery on every path", () => {
  const chapter = chapters.get("riftlight-buried-bridge")!;
  expect(chapter.estimatedMinutes).toBe(30);
  // The choices' consequences are walked through the engine in riftlight-buried-bridge.test.ts.
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
