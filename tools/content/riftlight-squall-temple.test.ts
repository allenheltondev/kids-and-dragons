import { enterScene } from "@kad/shared";
import { expect, it } from "vitest";
import { allPaths, chapters, start, context } from "./riftlight-test-support.ts";
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

it("keeps a delayed letter courier separate from the temple rescue messenger", () => {
  const state = start(chapter, "kitsune", "starweaver", { island_messages_saved: true, island_relay_delayed: true });
  const next = enterScene(state, "messages", context(chapter));
  expect(next.state.narration).toContain("still finishing the delayed letter relay");
  expect(next.state.narration).not.toContain("offers to relay");
  expect(next.state.narration).toContain("temple's own griffin messenger");
  expect(chapter.scenes.repair_1).toMatchObject({ choices: [expect.objectContaining({ goto: "plan" })] });
  expect(chapter.scenes.pushed).toMatchObject({ choices: [expect.objectContaining({ goto: "record" })] });
});
