import { expect, it } from "vitest";
import { allPaths, chapters, start } from "./riftlight-test-support.ts";
const chapter = chapters.get("riftlight-squall-temple")!;
it("all encounter outcomes shelter the keepers, including a lost fight", () => {
  const { ends, visited } = allPaths(chapter, "manticore", "duskrunner");
  for (const id of ["pushed", "settled", "damaged"]) expect(visited.has(id)).toBe(true);
  for (const end of ends) for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
  expect(ends.some(s => s.flags.temple_damaged)).toBe(true);
  expect(ends.some(s => s.flags.temple_island_settled)).toBe(true);
});
it.each([false, true])("the warning changes the preparations on arrival: %s", warning => {
  const state = start(chapter, "manticore", "duskrunner", { island_warning_sent: warning });
  expect(state.narration.includes("already moved the heavy furniture")).toBe(warning);
  expect(state.narration.includes("furniture still waits")).toBe(!warning);
});
