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
const valley = chapters.get("riftlight-the-wrong-valley")!;
const valleyRoutes = ["tools", "people"].flatMap(priority => [1, 2].flatMap(crossing =>
  [1, 2, 4].flatMap(seats => [false, true].flatMap(misses => [false, true].map(workerHelp => ({ priority, crossing, seats, misses, workerHelp }))))));
it.each(valleyRoutes)("valley: $priority / crossing $crossing / $seats seats / misses $misses / worker help $workerHelp", route => {
  const result = walk(valley, start(valley, "manticore", "songkeeper", {}, route.seats), s => preferred(s, {
    bundle_plan: route.priority, crossing_choice: `option_${route.crossing}`,
    return_water: route.workerHelp ? "workers" : route.priority === "tools" ? "worker" : "tools",
    tell_together: route.misses ? "landmarks" : "sequence",
  }), s => route.misses && (s.prompt?.kind === "roll" || s.prompt?.kind === "interaction" && scored.has(s.prompt.spec.kind)) ? "failure" : "success");
  const high = route.misses ? route.crossing === 1 : route.crossing === 2;
  expect(result.state.flags.valley_crossed_high).toBe(high);
  expect(result.visited.has("high_recovery")).toBe(route.crossing === 1 && route.misses);
  expect(result.visited.has("low_recovery")).toBe(route.crossing === 2 && route.misses);
  expect(result.visited.has("tools_tie")).toBe(route.priority === "tools");
  expect(result.visited.has("people_line")).toBe(route.priority === "people");
  expect(result.visited.has("worker_beacon")).toBe(route.priority === "tools" && !route.workerHelp);
  expect(result.visited.has("tool_recover")).toBe(route.priority === "people" && !route.workerHelp);
  expect(result.visited.has("repair_gear")).toBe(route.workerHelp);
  const dry = route.priority === "tools" || (!route.misses && !route.workerHelp);
  expect(result.state.flags.valley_tools_dry).toBe(dry);
  expect(result.state.narration.includes("kit is dry")).toBe(dry);
  expect(result.state.narration.includes("clean and dry the wet kit")).toBe(!dry);
  expect(result.state.flags.valley_record_detailed).toBe(!route.misses);
  expect(result.state.flags.wrong_valley_witnessed).toBe(true);
  const recovering = result.scenes.return_water!;
  if (recovering.prompt?.kind !== "choice") throw new Error("Expected recovery choice");
  expect(recovering.prompt.options.some(o => o.id === "worker")).toBe(route.priority === "tools");
  expect(recovering.prompt.options.some(o => o.id === "tools")).toBe(route.priority === "people");
  const account = result.scenes.tell_together!;
  if (account.prompt?.kind !== "choice") throw new Error("Expected account choice");
  expect(account.prompt.options.some(o => o.id === "sequence")).toBe(!route.misses);

});
it("songkeeper and duskrunner widening change the result of an actual near-edge action", () => {
  for (const [chapter, ordinary, helped, species, cls] of [
    [whale, "note_practice", "songkeeper_practice", "unicorn", "songkeeper"],
    [valley, "tools_hoist", "tools_hoist_assisted", "manticore", "duskrunner"],
    [valley, "tool_recover", "tool_recover_assisted", "manticore", "duskrunner"],
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
it.each([1, 2, 4])("thornguard saves a support job without skipping the valley's return, at %i seats", seats => {
  const result = walk(valley, start(valley, "bigfoot", "thornguard", {}, seats), s => preferred(s, {
    bundle_plan: "thornguard", crossing_choice: "option_1", return_water: "tools", tell_together: "sequence",
  }), () => "assisted");
  expect(result.visited.has("people_braced")).toBe(true);
  expect(result.visited.has("people_line")).toBe(false);
  expect(result.visited.has("people_signal")).toBe(true);
  expect(result.visited.has("return_observation")).toBe(true);
  expect(result.state.flags.valley_tools_dry).toBe(true);
});
