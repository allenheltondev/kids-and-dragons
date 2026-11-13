import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { type Chapter, type RunState, type InteractionPrompt } from "@kad/shared";
import { act, landed, miss, open, promptOf, solve, SIZES } from "./interaction-play";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const review = read<{ chapter: string; scene: string; decision: string }[]>("docs/reviews/mini-game-708-remaining.json");
const chapters = new Map(review.map(row => [row.chapter, read<Chapter>(`content/chapters/${row.chapter}.json`)]));
const saved = <T>(state: T): T => JSON.parse(JSON.stringify(state));
const finish = (chapter: Chapter, state: RunState) => landed(chapter, saved(state), promptOf(state).resolvedActorId ?? promptOf(state).actorId);

it("retains the original Riftlight and practice contracts byte-for-byte", () => {
  const originals = read<Record<string, string>>("tools/content/fixtures/mini-game-708-originals.json");
  for (const [key, hash] of Object.entries(originals)) {
    const [chapter, scene] = key.split("/");
    expect(createHash("sha256").update(JSON.stringify(chapters.get(chapter!)!.resumeInteractions![scene!]!)).digest("hex"), key).toBe(hash);
  }
});

function failure(chapter: Chapter, opened: RunState): RunState {
  const failed = miss(chapter, saved(opened), true);
  if (failed) return failed;
  // Reversing a palindromic memory answer is not a miss. Send a different full pattern.
  const spec = promptOf(opened).spec;
  if (spec.kind !== "memory") throw Error("Expected a failable activity");
  let state = act(chapter, saved(opened), { action: "start", relaxed: false, rulesVersion: 2 }, promptOf(opened).actorId);
  while (promptOf(state).phase === "active") {
    const p = promptOf(state);
    const wrong = spec.answer.map(id => spec.options.find(option => option.id !== id)!.id);
    state = act(chapter, state, { action: "commit", round: p.challenge!.round, answer: wrong }, p.actorId, 60_000);
  }
  return state;
}

it.each(SIZES)("all 36 remaining activities support success, help and real failure at %i seats", size => {
  expect(review).toHaveLength(36);
  for (const row of review) {
    const chapter = chapters.get(row.chapter)!;
    const opened = open(chapter, row.scene, size);
    const won = solve(chapter, saved(opened));
    const helped = act(chapter, saved(opened), { action: "assist" }, promptOf(opened).playerIds.at(-1)!);
    const lost = failure(chapter, opened);
    expect(promptOf(won).outcome).toBe("success");
    expect(promptOf(helped).outcome).toBe("assisted");
    expect(promptOf(lost).outcome).toBe("failure");
    for (const result of [won, helped, lost]) expect(finish(chapter, result).sceneId).not.toBe(row.scene);
    const success = finish(chapter, won), help = finish(chapter, helped), loss = finish(chapter, lost);
    if (row.decision === "retain-gentle" || row.scene === "interaction_roots") {
      expect(loss.party.map(p => p.hp)).toEqual(opened.party.map(p => p.hp));
    } else if (row.scene === "interaction_letters" || row.scene === "interaction_newcomer_load") {
      expect(success.coins).toBe((opened.coins ?? 0) + 1);
      expect(help.coins).toBe((opened.coins ?? 0) + 1);
      expect(loss.coins).toBe(opened.coins);
    } else if (row.scene === "interaction_crossing_signal") {
      expect(success.flags.crossing_signal_known).toBe(true);
      expect(help.flags.crossing_signal_known).toBe(true);
      expect(loss.flags.crossing_signal_known).not.toBe(true);
      expect(success.prompt).toMatchObject({ kind: "choice", options: expect.arrayContaining([expect.objectContaining({ id: "warden_signal" })]) });
      expect(loss.prompt).toMatchObject({ kind: "choice", options: expect.not.arrayContaining([expect.objectContaining({ id: "warden_signal" })]) });
    } else if (row.scene === "surge_check") {
      expect(loss.flags.kettle_lost).toBe(true);
      expect(success.flags.kettle_lost).not.toBe(true);
      expect(loss.narration).toContain("after her kettle");
    } else if (row.scene === "turnip_relay") {
      expect(loss.flags.counters_turnips_lost).toBe(true);
      expect(loss.sceneId).toBe("past");
      expect(success.sceneId).toBe("past_slow");
    } else {
      // Costs land only after continuation, once, and never down a fragile hero.
      expect(lost.party.map(p => p.hp)).toEqual(opened.party.map(p => p.hp));
      expect(loss.party.map(p => p.hp)).toEqual(opened.party.map(p => p.hp - 1));
      expect(success.party.map(p => p.hp)).toEqual(opened.party.map(p => p.hp));
      const fragile = { ...opened, party: opened.party.map(p => ({ ...p, hp: 1 })) };
      expect(finish(chapter, failure(chapter, fragile)).party.every(p => p.hp === 1 && !p.down)).toBe(true);
    }
    const retry = act(chapter, saved(lost), { action: "retry" }, promptOf(lost).actorId);
    expect(promptOf(retry).attempt).toBe(promptOf(opened).attempt + 1);
    expect(finish(chapter, solve(chapter, retry)).party.map(p => p.hp)).toEqual(opened.party.map(p => p.hp));
  }
}, 60_000);

it.each(SIZES)("all revised serialized attempts retain their shipped outcomes and controls at %i seats", size => {
  for (const row of review.filter(row => row.decision === "revised")) {
    const current = chapters.get(row.chapter)!, before = structuredClone(current);
    before.scenes[row.scene] = before.resumeInteractions![row.scene]!;
    delete before.resumeInteractions;
    const opened = saved(open(before, row.scene, size));
    // Storage may reorder a spec's keys; archive selection must remain canonical.
    promptOf(opened).spec = Object.fromEntries(Object.entries(promptOf(opened).spec).reverse()) as InteractionPrompt["spec"];
    for (const result of [solve(current, saved(opened)), failure(current, saved(opened)), act(current, saved(opened), { action: "assist" }, promptOf(opened).actorId)]) {
      const actual = finish(current, result), expected = finish(before, result);
      expect(actual.sceneId, `${row.chapter}/${row.scene}`).toBe(expected.sceneId);
      expect(actual.party).toEqual(expected.party);
      expect(actual.flags).toEqual(expected.flags);
      expect(actual.coins).toBe(expected.coins);
    }
    const retried = act(current, saved(opened), { action: "assist" }, promptOf(opened).actorId);
    expect(promptOf(act(current, retried, { action: "retry" }, promptOf(retried).actorId)).spec).toEqual(current.resumeInteractions![row.scene]!.interaction);
  }
}, 60_000);
