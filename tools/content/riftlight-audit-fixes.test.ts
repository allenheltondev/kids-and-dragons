import { expect, it } from "vitest";
import { enterScene } from "@kad/shared";
import { chapters, context, send, start } from "./riftlight-test-support.ts";

it("a promised whale report can actually be delivered without publishing the stone sketch", () => {
  const c = chapters.get("riftlight-the-island-due-back")!;
  const reportState = (promised: boolean) => enterScene(start(c, "manticore", "duskrunner", {
    sky_followup_promised: promised, memory_notes_shared: false, island_record_shared: false,
  }), "record", context(c)).state;
  const absent = reportState(false);
  expect(absent.prompt?.kind === "choice" && absent.prompt.options.some(q => q.id === "whale_report")).toBe(false);
  const offered = reportState(true);
  expect(offered.prompt?.kind === "choice" && offered.prompt.options.some(q => q.id === "whale_report")).toBe(true);
  const handoff = send(offered, { type: "CHOOSE", choiceId: "whale_report" }, c);
  const done = send(handoff, { type: "CHOOSE", choiceId: "continue" }, c);
  expect(done.flags.whale_report_delivered).toBe(true);
  expect(done.flags.island_record_shared).toBe(false);
  expect(done.prompt?.kind === "choice" && done.prompt.options.some(q => q.id === "whale_report")).toBe(false);
  const departure = enterScene(done, "departure", context(c)).state;
  expect(departure.narration).toContain("report you promised");
});

it("the island conclusion stays in the world", () => {
  const c = chapters.get("riftlight-the-island-due-back")!;
  expect(c.scenes.rest!.narration).not.toContain("development preview");
});
