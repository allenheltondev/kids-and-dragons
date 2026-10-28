import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { applyIntent, validateChapter } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { SIZES, act, landed, miss, open, promptOf, solve } from "./interaction-play.ts";
import { context, send } from "./riftlight-test-support.ts";

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
    if (!("choices" in current) || current.choices.length < 2) continue;
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

const councils = new Set([
  "interaction_purpose_council", "interaction_quiet_council", "interaction_verdict_council",
]);
const conversations = retired.filter(({ chapter, id }) => {
  const scene = chapter.scenes[id]!;
  return "choices" in scene && scene.choices.length > 1;
});

it.each(conversations)("$chapter.id/$id only requires collective voting for a council", ({ chapter, id }) => {
  const state = open(chapter, id, 4);
  const prompt = state.prompt;
  expect(prompt?.kind).toBe("choice");
  if (prompt?.kind !== "choice") throw new Error("Expected a conversation");
  const playerId = prompt.forPlayerIds[0]!;
  const choice = prompt.options[0]!;
  const result = applyIntent(state, { playerId, intent: { type: "CHOOSE", choiceId: choice.id } }, context(chapter));
  expect(result.error).toBeUndefined();
  if (councils.has(id)) {
    expect(prompt.vote).toBe(true);
    expect(prompt.forPlayerIds).toHaveLength(4);
    expect(result.state.sceneId).toBe(id);
    expect(result.state.prompt?.kind === "choice" && result.state.prompt.votes).toEqual({ [playerId]: choice.id });
  } else {
    expect(prompt.vote).toBe(false);
    expect(prompt.forPlayerIds).toEqual([playerId]);
    const scene = chapter.scenes[id]!;
    if (!("choices" in scene)) throw new Error("Expected story choices");
    expect(result.state.sceneId).toBe(scene.choices.find(option => option.id === choice.id)!.goto);
    // The character reply also continues with one phone, without a group vote.
    const reply = result.state.prompt;
    if (reply?.kind !== "choice") throw new Error("Expected a reply continuation");
    expect(reply.vote).toBe(false);
    const next = applyIntent(result.state, {
      playerId: reply.forPlayerIds[0]!, intent: { type: "CHOOSE", choiceId: "continue" },
    }, context(chapter));
    expect(next.error).toBeUndefined();
    expect(next.state.sceneId).not.toBe(result.state.sceneId);
  }
});
