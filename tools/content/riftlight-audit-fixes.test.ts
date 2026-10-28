import { expect, it } from "vitest";
import { enterScene } from "@kad/shared";
import { chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

it("the convergence interaction holds the screen cord and listens to the chime", () => {
  const c = chapters.get("riftlight-convergence")!;
  expect(c.scenes.count_check).toMatchObject({ type: "interaction", interaction: {
    kind: "cooperate", supportLabel: "Hold the screen cord", actionLabel: "Record the held-cord note",
  } });
  const opened = enterScene(start(c, "manticore", "duskrunner"), "count_check", context(c)).state;
  const held = finishInteraction(opened, c);
  expect(held.sceneId).toBe("cord_release");
  expect(c.scenes.cord_release).toMatchObject({ type: "interaction", interaction: { actionLabel: "Release the screen cord" } });
  const compared = finishInteraction(held, c);
  expect(compared.sceneId).toBe("lesson");
  expect(compared.flags.converge_cord_compared).toBe(true);
});

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
