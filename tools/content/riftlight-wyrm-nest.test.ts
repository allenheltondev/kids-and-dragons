import { expect, it } from "vitest";
import { allPaths, chapters } from "./riftlight-test-support.ts";
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
