import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { balanceTarget, pullNeeded, pullTarget, type Chapter } from "@kad/shared";
import { act, landed, miss, open, promptOf, solve, SIZES } from "./interaction-play";

const chapter: Chapter = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../content/chapters/gemfall-07l.json"), "utf8"));
const games = ["interaction_set_table", "interaction_box_slide", "interaction_tether_team"];
const saved = <T>(state: T): T => JSON.parse(JSON.stringify(state));

it.each(SIZES)("7L's revised games earn their outcomes at %i seats, including real misses and assistance", size => {
  for (const id of games) {
    const opened = open(chapter, id, size), actor = promptOf(opened).actorId;
    const success = landed(chapter, saved(solve(chapter, saved(opened))), actor);
    const helped = landed(chapter, act(chapter, saved(opened), { action: "assist" }, actor), actor);
    const failed = miss(chapter, saved(opened), true)!;
    expect(promptOf(failed).outcome).toBe("failure");
    // Story costs apply on continuation, once, rather than on each recoverable slip.
    expect(failed.party.map(p => p.hp)).toEqual(opened.party.map(p => p.hp));
    const loss = landed(chapter, saved(failed), actor);
    if (id === "interaction_tether_team") {
      for (const won of [success, helped]) {
        expect(won.flags.clock_steady).toBe(true);
        expect(won.party.some(p => p.character.questItems.includes("facet_caravan"))).toBe(true);
      }
      expect(loss.sceneId).toBe("scene_tether_slips");
      expect(loss.flags.clock_late).toBe(true);
      expect(loss.flags.tether_tested).not.toBe(true);
      expect(loss.party.some(p => p.character.questItems.includes("facet_caravan"))).toBe(false);
    } else {
      expect(loss.party.map(p => p.hp)).toEqual(opened.party.map(p => p.hp - 1));
      expect(success.party.map(p => p.hp)).toEqual(opened.party.map(p => p.hp));
      expect(helped.party.map(p => p.hp)).toEqual(opened.party.map(p => p.hp));
      const fragile = { ...opened, party: opened.party.map(p => ({ ...p, hp: 1 })) };
      const bruised = miss(chapter, fragile, true)!;
      expect(landed(chapter, bruised, actor).party.every(p => p.hp === 1 && !p.down)).toBe(true);
    }
    // An old serialized v2 attempt retains exactly the shipped outcome contract.
    const before = structuredClone(chapter);
    before.scenes[id] = before.resumeInteractions![id]!;
    delete before.resumeInteractions;
    const old = saved(open(before, id, size));
    Object.assign(promptOf(old), { spec: Object.fromEntries(Object.entries(promptOf(old).spec).reverse()) });
    const oldMiss = miss(chapter, old, true)!;
    const resumed = landed(chapter, saved(oldMiss), promptOf(oldMiss).actorId);
    expect(resumed.party.map(p => p.hp)).toEqual(old.party.map(p => p.hp));
    if (id === "interaction_tether_team") {
      expect(resumed.flags.clock_steady).toBe(true);
      expect(resumed.party.some(p => p.character.questItems.includes("facet_caravan"))).toBe(true);
    }
  }
});

it.each(SIZES)("a table slip at %i seats can be corrected before it becomes a story cost", size => {
  let state = open(chapter, "interaction_set_table", size);
  const actor = promptOf(state).actorId, players = promptOf(state).playerIds;
  state = act(chapter, state, { action: "start", relaxed: false, rulesVersion: 2 }, actor);
  for (const player of players) state = act(chapter, state, { action: "adjust", round: 0, direction: "up", steps: 4 }, player);
  state = act(chapter, state, { action: "commit", round: 0 }, actor);
  expect(promptOf(state).challenge).toMatchObject({ progress: 0, round: 1 });
  expect(promptOf(state).challenge!.strain).toBeGreaterThan(0);
  while (promptOf(state).phase === "active") {
    const p = promptOf(state), round = p.challenge!.round;
    for (const player of players) {
      const delta = Math.round((balanceTarget(p) - (promptOf(state).levels?.[player] ?? 0)) * 4);
      if (delta) state = act(chapter, state, { action: "adjust", round, direction: delta > 0 ? "up" : "down", steps: Math.abs(delta) }, player);
    }
    state = saved(act(chapter, state, { action: "commit", round }, actor));
  }
  expect(promptOf(state).outcome).toBe("success");
});

it.each([2, 4])("%i friends can compensate a gentle pull, then recover a jerk without losing work", size => {
  let state = open(chapter, "interaction_tether_team", size);
  const actor = promptOf(state).actorId, players = promptOf(state).playerIds;
  state = act(chapter, state, { action: "start", relaxed: false, rulesVersion: 2 }, actor);
  state = act(chapter, state, { action: "commit", round: 0, position: .3 }, players[0]!);
  expect(pullNeeded(promptOf(state), players)).toBeGreaterThan(pullTarget(promptOf(state)));
  for (const player of players.slice(1)) state = act(chapter, state, { action: "commit", round: 0, position: .4 + .1 / (size - 1) }, player);
  expect(promptOf(state).challenge!.progress).toBe(1);
  for (const player of players) state = act(chapter, state, { action: "commit", round: 1, position: 1 }, player);
  expect(promptOf(state).challenge!.progress).toBe(1);
  expect(promptOf(state).challenge!.strain).toBeGreaterThan(0);
  while (promptOf(state).phase === "active") {
    const p = promptOf(state), round = p.challenge!.round;
    for (const player of players) state = act(chapter, state, { action: "commit", round, position: pullTarget(p) }, player);
    state = saved(state);
  }
  expect(promptOf(state).outcome).toBe("success");
});

it("resumes an old partially committed shared pull with its original reward contract", () => {
  const id = "interaction_tether_team", before = structuredClone(chapter);
  before.scenes[id] = before.resumeInteractions![id]!;
  delete before.resumeInteractions;
  let state = open(before, id, 2);
  const actor = promptOf(state).actorId, players = promptOf(state).playerIds;
  state = act(before, state, { action: "start", relaxed: false, rulesVersion: 2 }, actor);
  state = saved(act(before, state, { action: "commit", round: 0, position: .4 }, players[0]!));
  state = act(chapter, state, { action: "commit", round: 0, position: .4 }, players[1]!);
  expect(promptOf(state).challenge!.progress).toBe(1);
  while (promptOf(state).phase === "active") {
    const round = promptOf(state).challenge!.round;
    for (const player of players) state = act(chapter, state, { action: "commit", round, position: 1 }, player);
    state = saved(state);
  }
  expect(promptOf(state).outcome).toBe("failure");
  const resumed = landed(chapter, state, actor);
  expect(resumed.flags.clock_steady).toBe(true);
  expect(resumed.party.some(p => p.character.questItems.includes("facet_caravan"))).toBe(true);
});
