/**
 * The content tools' list of story-interaction kinds that can fail (cohesion.mjs FAILABLE_KINDS,
 * which the route walker and the `shape` screen trust) agrees with the real engine: for one
 * shipped Riftlight game of every kind (including saved activities), real start/stop/answer/support/adjust/catch/pass/play
 * actions can produce a failure exactly when the list says so (PR #606 review).
 */
import { enterScene, type Chapter } from "@kad/shared";
import { expect, it } from "vitest";
import { FAILABLE_KINDS } from "./cohesion.mjs";
import { chapters, context, finishInteraction, start } from "./riftlight-test-support.ts";

const samples = new Map<string, { chapter: Chapter; sceneId: string }>();
for (const chapter of chapters.values()) for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
  if (scene.type === "interaction" && !samples.has(scene.interaction.kind)) samples.set(scene.interaction.kind, { chapter, sceneId });
}
// The last split-role ladder is now a timing game. Still exercise cooperation:
// old saves retain that shipped activity and the engine must classify it correctly.
for (const chapter of chapters.values()) for (const [sceneId, scene] of Object.entries(chapter.resumeInteractions ?? {})) {
  if (samples.has(scene.interaction.kind)) continue;
  const before = structuredClone(chapter);
  before.scenes[sceneId] = scene;
  delete before.resumeInteractions;
  samples.set(scene.interaction.kind, { chapter: before, sceneId });
}

it("Riftlight's active and saved games cover every kind the walker reasons about", () => {
  expect([...samples.keys()].sort()).toEqual(expect.arrayContaining([...FAILABLE_KINDS].sort()));
});

it.each([...samples])("%s can fail in the real engine exactly when FAILABLE_KINDS says so", (kind, { chapter, sceneId }) => {
  const opened = enterScene(start(chapter, "manticore", "duskrunner", {}, 2), sceneId, context(chapter)).state;
  const fail = () => finishInteraction(opened, chapter, "failure");
  if (FAILABLE_KINDS.has(kind)) expect(fail().sceneId).toBe(chapter.scenes[sceneId]!.type === "interaction" ? (chapter.scenes[sceneId] as { onFailure: { goto: string } }).onFailure.goto : "");
  else expect(fail).toThrow();
  expect(finishInteraction(opened, chapter, "success").sceneId).toBeDefined();
});
