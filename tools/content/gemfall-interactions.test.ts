/**
 * Every `interaction` scene Gemfall authors, played the way phones play it
 * (see interaction-play.ts and riftlight-interactions.test.ts): the real
 * INTERACT actions at a table of one, two and four, then the untimed helping
 * hand and, where a miss is possible, a real miss.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Campaign, Chapter, InteractionScene } from "@kad/shared";
import { SIZES, act, landed, miss, open, promptOf, solve } from "./interaction-play.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8")) as T;
const campaign = read<Campaign>("content/campaigns/gemfall.json");
const chapters = campaign.chapters.map((id) => read<Chapter>(`content/chapters/${id}.json`));

const interactionScenes = chapters.flatMap((chapter) =>
  Object.entries(chapter.scenes)
    .filter((entry): entry is [string, InteractionScene] => entry[1].type === "interaction")
    .map(([sceneId, scene]) => ({ chapter, sceneId, scene })),
);

describe("Gemfall's interaction scenes, played with real actions", () => {
  it("has interaction scenes to play", () => {
    expect(interactionScenes.length).toBeGreaterThan(0);
  });

  describe.each(SIZES)("at a table of %i", (size) => {
    it("completes every scene to success and continues where the scene says", () => {
      for (const { chapter, sceneId, scene } of interactionScenes) {
        const result = solve(chapter, open(chapter, sceneId, size));
        expect(promptOf(result).outcome, `${chapter.id}/${sceneId}`).toBe("success");
        const next = landed(chapter, result, promptOf(result).resolvedActorId ?? promptOf(result).actorId);
        expect(next.sceneId, `${chapter.id}/${sceneId}`).toBe(scene.onSuccess.goto);
      }
    }, 60_000);

    it("takes the untimed helping hand from any seat and continues", () => {
      for (const { chapter, sceneId, scene } of interactionScenes) {
        const opened = open(chapter, sceneId, size);
        const helper = promptOf(opened).playerIds.at(-1)!;
        const result = act(chapter, opened, { action: "assist" }, helper);
        expect(promptOf(result).outcome, `${chapter.id}/${sceneId}`).toBe("assisted");
        const next = landed(chapter, result, helper);
        expect(next.sceneId, `${chapter.id}/${sceneId}`).toBe((scene.onAssisted ?? scene.onSuccess).goto);
      }
    }, 60_000);

    it("continues down the failure branch after a real miss, where a miss is possible", () => {
      for (const { chapter, sceneId, scene } of interactionScenes) {
        const result = miss(chapter, open(chapter, sceneId, size));
        if (result === null) continue;
        expect(promptOf(result).outcome, `${chapter.id}/${sceneId}`).toBe("failure");
        const next = landed(chapter, result, promptOf(result).resolvedActorId ?? promptOf(result).actorId);
        expect(next.sceneId, `${chapter.id}/${sceneId}`).toBe(scene.onFailure.goto);
      }
    }, 60_000);
  });
});
