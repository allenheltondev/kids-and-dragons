import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { validateChapter } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { SIZES, act, landed, miss, open, promptOf, solve } from "./interaction-play.ts";
import { send } from "./riftlight-test-support.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const chapters = read<{ chapters: string[] }>("content/campaigns/gemfall.json").chapters
  .map(id => read<Chapter>(`content/chapters/${id}.json`));
// Hashes taken from the shipped scenes on dabee9d8, before the pacing changes.
const contracts = read<Record<string, string>>("tools/content/fixtures/gemfall-retired-interactions.json");
const retired = chapters.flatMap(chapter => Object.entries(chapter.resumeInteractions ?? {})
  .map(([id, scene]) => ({ chapter, id, scene })));
const saved = (state: RunState): RunState => JSON.parse(JSON.stringify(state));

it("retains every shipped activity contract byte-for-byte in canonical JSON", () => {
  expect(Object.fromEntries(retired.map(({ chapter, id, scene }) => [
    `${chapter.id}/${id}`, createHash("sha256").update(JSON.stringify(scene)).digest("hex"),
  ]))).toEqual(contracts);
});

it.each(SIZES)("saved retired activities still finish, retry and accept help at %i seats", size => {
  for (const { chapter, id, scene } of retired) {
    const before = structuredClone(chapter);
    before.scenes[id] = scene;
    delete before.resumeInteractions;
    const opened = saved(open(before, id, size));
    const success = solve(chapter, opened);
    const helped = act(chapter, saved(opened), { action: "assist" }, promptOf(opened).playerIds.at(-1)!);
    const missed = miss(chapter, saved(opened));
    for (const result of [success, helped, ...(missed ? [missed] : [])]) {
      const actor = promptOf(result).resolvedActorId ?? promptOf(result).actorId;
      const actual = landed(chapter, saved(result), actor);
      const expected = landed(before, saved(result), actor);
      expect(actual.sceneId, `${chapter.id}/${id}`).toBe(expected.sceneId);
      expect(actual.flags).toEqual(expected.flags);
      expect(actual.party).toEqual(expected.party);
      expect(actual.coins).toBe(expected.coins);
      expect(actual.xpEarned).toBe(expected.xpEarned);
    }
    let retry = act(chapter, saved(success), { action: "retry" }, promptOf(success).actorId);
    retry = saved(retry);
    expect(promptOf(retry).attempt).toBe(promptOf(opened).attempt + 1);
    expect(promptOf(solve(chapter, retry)).outcome).toBe("success");
    expect(open(chapter, id, size).prompt?.kind).toBe("choice");
  }
}, 60_000);

it.each(SIZES)("ordinary responses show their reply before applying the conversation result at %i seats", size => {
  for (const { chapter, id, scene } of retired) {
    const current = chapter.scenes[id]!;
    if (current.type !== "choice_point") continue;
    for (const choice of current.choices) {
      let state = open(chapter, id, size);
      state = send(state, { type: "CHOOSE", choiceId: choice.id }, chapter);
      expect(state.sceneId).toBe(choice.goto);
      expect(state.narration).toContain(scene.interaction.kind === "play"
        ? (scene.interaction.options.find(option => option.id === choice.id)?.reaction ?? "") : "");
      state = send(state, { type: "CHOOSE", choiceId: "continue" }, chapter);
      const response = chapter.scenes[choice.goto]!;
      expect(state.sceneId).toBe("choices" in response ? response.choices![0]!.goto : undefined);
    }
  }
});

it("rejects archives without a replacement scene or a valid continuation", () => {
  const { chapter, id } = retired[0]!;
  const missing = structuredClone(chapter);
  delete missing.scenes[id];
  expect(validateChapter(missing).some(issue => issue.code === "BAD_INTERACTION")).toBe(true);
  const broken = structuredClone(chapter);
  broken.resumeInteractions![id]!.onSuccess.goto = "missing_scene";
  expect(validateChapter(broken).some(issue => issue.code === "BAD_INTERACTION")).toBe(true);
});
