import { expect, it } from "vitest";
import { applyIntent, enterScene } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

type Outcome = "success" | "failure" | "assisted";
const preferred = (state: RunState, options: Record<string, string>) => options[state.sceneId!];
const scored = new Set(["timing", "precision", "memory", "tracking", "sequence"]);
function walk(chapter: Chapter, initial: RunState, choose: (s: RunState) => string | undefined, outcome: (s: RunState) => Outcome) {
  let state = initial;
  const visited = new Set<string>();
  const kinds = new Set<string>();
  const scenes: Record<string, RunState> = {};
  let activities = 0;
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps).toBeLessThan(90);
    visited.add(state.sceneId!);
    scenes[state.sceneId!] = structuredClone(state);
    if (state.prompt?.kind === "interaction") {
      activities++;
      kinds.add(state.prompt.spec.kind);
      state = finishInteraction(state, chapter, outcome(state));
    } else if (state.prompt?.kind === "choice") {
      state = send(state, { type: "CHOOSE", choiceId: choose(state) ?? state.prompt.options[0]!.id }, chapter);
    } else if (state.prompt?.kind === "roll") state = send(state, { type: "ROLL" }, chapter, outcome(state) === "failure" ? 1 : 20);
    else throw new Error(`Unexpected ${chapter.id}/${state.sceneId}: ${state.prompt?.kind}`);
  }
  for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string]).toBe(true);
  expect(chapter.estimatedMinutes).toBe(30);
  return { state, visited, kinds, activities, scenes };
}
const whale = chapters.get("riftlight-whale-road")!;
const whaleRoutes = ["shelter", "view"].flatMap(site => ["note", "arms"].flatMap(greeting =>
  ["guide", "consider"].flatMap(ending => [1, 2, 4].flatMap(seats => [false, true].map(misses => ({ site, greeting, ending, seats, misses }))))));
it.each(whaleRoutes)("whales: $site / $greeting / $ending / $seats seats / misses $misses changes the jobs", route => {
  const result = walk(whale, start(whale, "manticore", "duskrunner", {}, route.seats), s => preferred(s, {
    keeper_lesson: route.greeting, waiting_place: route.site,
    handoff_sky: route.site === "view" ? "direct" : "relay", sky_repair: "report",
    opening_decision: route.ending, guide: route.greeting,
  }), s => route.misses && (s.prompt?.kind === "roll" || s.prompt?.kind === "interaction" && scored.has(s.prompt.spec.kind)) ? "failure" : "success");
  expect(result.state.flags.whale_open_view).toBe(route.site === "view");
  expect(result.state.flags.whale_signal_sung).toBe(route.greeting === "note");
  expect(result.visited.has("view_setup")).toBe(route.site === "view");
  expect(result.visited.has("shelter_setup")).toBe(route.site === "shelter");
  expect(result.visited.has("signal_memory")).toBe(route.site === "view");
  expect(result.visited.has("signal_relay")).toBe(route.site === "shelter" || route.misses);
  expect(result.visited.has("keeper_points")).toBe(route.misses);
  expect(result.visited.has("quiet_wait")).toBe(route.misses);
  expect(result.state.flags.whales_guided === true).toBe(route.ending === "guide");
  expect(result.visited.has("guide_note")).toBe(route.ending === "guide" && route.greeting === "note");
  expect(result.visited.has("guide_arms")).toBe(route.ending === "guide" && route.greeting === "arms");
  expect(result.visited.has("guide_wait")).toBe(route.ending === "guide" && route.greeting === "note" && route.misses);
  expect(result.state.flags.sky_followup_promised).toBe(true);

});
// The wrong valley's routes are played in riftlight-wrong-valley.test.ts since its November 2026 rewrite.
it("songkeeper widening changes the result of an actual near-edge action", () => {
  for (const [chapter, ordinary, helped, species, cls] of [
    [whale, "note_practice", "songkeeper_practice", "unicorn", "songkeeper"],
  ] as const) {
    const outcomes = [];
    for (const scene of [ordinary, helped]) {
      let state = enterScene(start(chapter, species, cls), scene, context(chapter)).state;
      if (state.prompt?.kind !== "interaction") throw new Error("Expected interaction");
      const base = { openedSeq: state.prompt.openedSeq, attempt: state.prompt.attempt };
      const actor = state.prompt.actorId;
      let result = applyIntent(state, { playerId: actor, intent: { type: "INTERACT", ...base, action: "start", relaxed: false } }, context(chapter));
      expect(result.error).toBeUndefined(); state = result.state;
      result = applyIntent(state, { playerId: actor, intent: { type: "INTERACT", ...base, action: "stop", position: .75 } }, context(chapter));
      expect(result.error).toBeUndefined();
      if (result.state.prompt?.kind !== "interaction") throw new Error("Expected interaction result");
      outcomes.push(result.state.prompt.outcome);
    }
    expect(outcomes).toEqual(["failure", "success"]);
  }
});
