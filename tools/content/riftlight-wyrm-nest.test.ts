import { enterScene } from "@kad/shared";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { expect, it } from "vitest";
import { allPaths, chapters, start, context } from "./riftlight-test-support.ts";
const chapter = chapters.get("riftlight-wyrm-nest")!;
it.each([["kitsune", "starweaver"], ["manticore", "duskrunner"]] as const)("a %s %s can make room on every declared outcome", (species, cls) => {
  const { ends } = allPaths(chapter, species, cls);
  expect(ends.some(s => s.flags.wyrm_ally)).toBe(true);
  expect(ends.some(s => s.flags.wyrm_nest_kept)).toBe(true);
  expect(ends.some(s => !s.flags.wyrm_ally && !s.flags.wyrm_nest_kept)).toBe(true);
  for (const end of ends) {
    for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
    expect(end.chapterOutcome).toBe("success");
  }
});

it("the lost nest removes the unfinished shelf option and costs another building day", () => {
  const state = start(chapter, "kitsune", "starweaver", { wyrm_nest_kept: true });
  const next = enterScene(state, "shelves", context(chapter));
  expect(next.state.prompt).toMatchObject({ kind: "choice", options: [expect.objectContaining({ id: "plan_2" })] });
  expect(next.state.narration).toContain("only the broad table");
  expect(enterScene(state, "ending", context(chapter)).state.narration).toContain("give up their free morning");
  for (const scenario of pacingReport(chapter).scenarios) expect(scenario.shortest!.decisions).toBeGreaterThanOrEqual(14);
});
