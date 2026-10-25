/**
 * Every `interaction` scene Riftlight authors, played the way phones play it.
 *
 * The route walkers (riftlight-test-support.ts) get through an interaction by
 * putting its prompt straight into the result phase and sending `continue`.
 * That is synthetic branch walking: it proves the story continues from each
 * authored outcome, not that the scene can be completed. This sends the real
 * `INTERACT` actions (start, stop, answer, support, adjust, catch and pass,
 * play, complete, assist, continue) through the engine, for each scene as
 * authored, at a table of one, two and four, and checks the story lands where
 * the scene says it should. The generic mechanics are covered by
 * packages/shared/src/interactions.test.ts; this is the chapters'
 * configurations: their targets, answers, swaps and options.
 */

import { describe, expect, it } from "vitest";
import type { InteractionScene } from "@kad/shared";
import { SIZES, act, landed, miss, open, promptOf, solve } from "./interaction-play.ts";
import { chapters } from "./riftlight-test-support.ts";

const interactionScenes = [...chapters.values()].flatMap((chapter) =>
  Object.entries(chapter.scenes)
    .filter((entry): entry is [string, InteractionScene] => entry[1].type === "interaction")
    .map(([sceneId, scene]) => ({ chapter, sceneId, scene })),
);

describe("Riftlight's interaction scenes, played with real actions", () => {
  it("has interaction scenes to play", () => {
    expect(interactionScenes.length).toBeGreaterThanOrEqual(40);
  });

  describe.each(SIZES)("at a table of %i", (size) => {
    it("completes every scene to success and continues where the scene says", () => {
      for (const { chapter, sceneId, scene } of interactionScenes) {
        const result = solve(chapter, open(chapter, sceneId, size));
        expect(promptOf(result).outcome, `${chapter.id}/${sceneId}`).toBe("success");
        const next = landed(chapter, result, promptOf(result).resolvedActorId ?? promptOf(result).actorId);
        expect(next.sceneId, `${chapter.id}/${sceneId}`).toBe(scene.onSuccess.goto);
      }
    });

    it("takes the untimed helping hand from any seat and continues", () => {
      for (const { chapter, sceneId, scene } of interactionScenes) {
        const opened = open(chapter, sceneId, size);
        const helper = promptOf(opened).playerIds.at(-1)!;
        const result = act(chapter, opened, { action: "assist" }, helper);
        expect(promptOf(result).outcome, `${chapter.id}/${sceneId}`).toBe("assisted");
        const next = landed(chapter, result, helper);
        expect(next.sceneId, `${chapter.id}/${sceneId}`).toBe((scene.onAssisted ?? scene.onSuccess).goto);
      }
    });

    it("continues down the failure branch after a real miss, where a miss is possible", () => {
      let missed = 0;
      for (const { chapter, sceneId, scene } of interactionScenes) {
        const result = miss(chapter, open(chapter, sceneId, size));
        if (result === null) continue;
        missed++;
        expect(promptOf(result).outcome, `${chapter.id}/${sceneId}`).toBe("failure");
        const next = landed(chapter, result, promptOf(result).resolvedActorId ?? promptOf(result).actorId);
        expect(next.sceneId, `${chapter.id}/${sceneId}`).toBe(scene.onFailure.goto);
      }
      expect(missed).toBeGreaterThan(0);
    });
  });
});
