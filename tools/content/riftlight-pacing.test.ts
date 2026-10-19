import { expect, it } from "vitest";
import { pacingReport, predictMinutes } from "../../packages/shared/src/chapter-pacing.ts";
import { chapters, allPaths } from "./riftlight-test-support.ts";

it.each(["stone-counters", "whale-road", "buried-bridge", "the-wrong-valley", "reading-room"])("%s has substantial play on its shortest path, not just optional branches", (id) => {
  const report = pacingReport(chapters.get(`riftlight-${id}`)!);
  for (const scenario of report.scenarios) {
    const shortest = scenario.shortest!;
    expect(shortest, scenario.scenario.id).not.toBeNull();
    expect(shortest.decisions).toBeGreaterThanOrEqual(14);
    expect(shortest.checks).toBeGreaterThanOrEqual(6);
    // Uncalibrated planning estimate, using the LOWER narration bound. Never a family observation.
    expect(predictMinutes({ ...shortest, words: shortest.wordsMin })).toBeGreaterThanOrEqual(30);
    expect(predictMinutes(scenario.typical!)).toBeLessThanOrEqual(40);
  }
});

it("the longer paths preserve the party's chosen priorities rather than silently promising help", () => {
  for (const [id, flag] of [["stone-counters", "stone_route_priority"], ["whale-road", "sky_followup_promised"]]) {
    const { ends } = allPaths(chapters.get(`riftlight-${id}`)!, "manticore", "duskrunner");
    expect(ends.some((s) => s.flags[flag!] === true), id).toBe(true);
    expect(ends.some((s) => s.flags[flag!] === false), id).toBe(true);
  }
});
