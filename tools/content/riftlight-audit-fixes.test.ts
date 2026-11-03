import { expect, it } from "vitest";
import { enterScene } from "@kad/shared";
import { chapters, context, finishInteraction, start } from "./riftlight-test-support.ts";

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
