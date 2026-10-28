import { expect, it } from "vitest";
import { applyIntent, enterScene } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

type Outcome = "success" | "failure" | "assisted";
const scored = new Set(["timing", "precision", "memory", "tracking", "sequence"]);
const option = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);
function walk(chapter: Chapter, initial: RunState, choose: (s: RunState) => string | undefined, result: (s: RunState) => Outcome) {
  let state = initial;
  const trace = new Map<string, RunState>();
  const kinds = new Set<string>();
  let activities = 0;
  for (let step = 0; state.phase !== "chapter_complete"; step++) {
    expect(step).toBeLessThan(120);
    trace.set(state.sceneId!, structuredClone(state));
    if (state.prompt?.kind === "interaction") {
      activities++; kinds.add(state.prompt.spec.kind);
      state = finishInteraction(state, chapter, result(state));
    } else if (state.prompt?.kind === "choice") {
      const id = choose(state) ?? state.prompt.options[0]!.id;
      expect(option(state, id), `${chapter.id}/${state.sceneId}: ${id}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
    } else if (state.prompt?.kind === "roll") state = send(state, { type: "ROLL" }, chapter);
    else state = send(state, { type: "ADVANCE" }, chapter);
  }
  trace.set(state.sceneId!, state);
  for (const goal of chapter.goal!.steps) expect(state.flags[goal.flag as string]).toBe(true);
  expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
  expect(chapter.estimatedMinutes).toBe(30);
  return { state, trace, activities, kinds };
}
const room = chapters.get("riftlight-reading-room")!;
const readingRoutes = [true, false].flatMap(close => (["success", "failure", "assisted"] as const).flatMap(evidence =>
  [true, false].flatMap(filed => [true, false].flatMap(share => [1, 2, 4].map(seats => ({ close, evidence, filed, share, seats }))))));
it.each(readingRoutes)("reading: close $close / $evidence / filed $filed / share $share / $seats seats", route => {
  const independent = route.evidence === "success";
  const result = walk(room, start(room, "manticore", "duskrunner", {}, route.seats), s => {
    const picks: Record<string, string> = {
      support_ice: route.close ? "option_1" : "option_2", first_memory: "option_1",
      second_view: route.close ? "close" : "compare_notes", what_matches: independent ? "option_1" : "keeper",
      catalog_test: "option_1", sliding_tray: route.close ? "option_1" : "dry",
      record_choice: route.share ? route.filed ? "publish" : "staff_copy" : "option_2",
      teach_back: route.share ? route.filed ? "posted" : "staff" : "option_1",
    };
    return picks[s.sceneId!];
  }, s => {
    if (["close_view", "second_view_prepared_check"].includes(s.sceneId!)) return route.evidence;
    if (s.sceneId === "catalog_test_1_check") return route.filed ? "success" : "failure";
    return "success";
  });
  expect(result.trace.has("close_view")).toBe(route.close);
  expect(result.trace.has("dry_slips")).toBe(!route.close);
  expect(result.trace.has("sliding_tray_1_check")).toBe(route.close);
  expect(option(result.trace.get("second_view")!, "close")).toBe(route.close);
  expect(option(result.trace.get("sliding_tray")!, "dry")).toBe(!route.close);
  expect(result.state.flags.memory_independent_reading).toBe(independent);
  expect(option(result.trace.get("what_matches")!, "option_1")).toBe(independent);
  expect(result.state.flags.memory_keeper_endorsed).toBe(!independent);
  expect(result.state.flags.memory_notes_shared).toBe(route.share);
  expect(result.state.flags.memory_guide_published).toBe(route.share && route.filed);
  expect(result.trace.has("teach_live")).toBe(!route.share);
  expect(result.trace.has("teach_posted")).toBe(route.share && route.filed);
  expect(result.trace.has("teach_staff")).toBe(route.share && !route.filed);
  expect(result.state.flags.memory_visitor_independent === true).toBe(route.share && route.filed);
  expect(result.state.flags.fragment_paths_learned).toBe(true);
  if (!route.share) expect(result.state.narration).toContain("No copy of your private account is filed");

});
const island = chapters.get("riftlight-the-island-due-back")!;
const islandRoutes = ["letters", "station"].flatMap(priority => ["borrow", "batches"].flatMap(kit =>
  (["success", "failure", "assisted"] as const).flatMap(evidence => [true, false].flatMap(share => [1, 2, 4].map(seats => ({ priority, kit, evidence, share, seats }))))));
it.each(islandRoutes)("island: $priority / $kit / $evidence / share $share / $seats seats", route => {
  const result = walk(island, start(island, "manticore", "duskrunner", { sky_followup_promised: true, whales_guided: true }, route.seats), s => {
    if (s.sceneId === "record" && !s.flags.whale_report_delivered) return "whale_report";
    if (s.sceneId === "dispatch") return option(s, "station") ? "station" : option(s, "messenger") ? "messenger" : "hand";
    const picks: Record<string, string> = {
      priority: route.priority === "letters" ? "option_1" : "option_2", landing: "option_1", landing_recovery: route.kit,
      carving: route.kit === "borrow" ? "option_1" : "frame", comparison: "option_1", comparison_recovery: "keeper",
      record: route.share ? "option_1" : "option_2", departure: "option_1", return_load: route.kit === "borrow" ? "light" : "crew",
    };
    return picks[s.sceneId!];
  }, s => {
    if (s.sceneId === "landing_1_check") return "failure";
    if (["carving_1_check", "carving_frame", "comparison_1_check"].includes(s.sceneId!)) return route.evidence;
    return "success";
  });
  const independent = route.evidence === "success";
  expect(result.state.flags.island_light_kit).toBe(route.kit === "borrow");
  expect(result.state.flags.island_relay_delayed).toBe(route.kit === "batches");
  expect(option(result.trace.get("carving")!, "frame")).toBe(route.kit === "batches");
  expect(result.trace.has("return_light")).toBe(route.kit === "borrow");
  expect(result.trace.has("return_kit")).toBe(route.kit === "batches");
  expect(result.state.flags.island_land_match).toBe(independent);
  expect(result.state.flags.island_carving_clear).toBe(independent);
  expect(result.trace.has("comparison_recover_scale_done")).toBe(!independent);
  expect(result.state.flags.island_record_shared).toBe(route.share);
  expect(result.state.flags.whale_report_delivered).toBe(true);
  expect(result.state.flags.island_warning_sent).toBe(true);
  expect(result.state.flags.fragment_sky_learned).toBe(true);
  const dispatch = result.trace.get("dispatch")!;
  expect(option(dispatch, "station")).toBe(route.priority === "station" && route.kit === "borrow");
  expect(option(dispatch, "messenger")).toBe(route.priority === "letters" && route.kit === "borrow");
  expect(result.trace.has("message_frame")).toBe(route.priority === "station" && route.kit === "borrow");
  expect(result.trace.has("message_messenger")).toBe(route.priority === "letters" && route.kit === "borrow");
  expect(result.trace.has("message_pack")).toBe(route.kit === "batches");
  expect(result.trace.has("message_hand")).toBe(route.kit === "batches");
  if (!route.share) expect(result.trace.get("return")!.narration).toContain("private sketch");
  const reveal = independent ? "comparison_1_done" : "comparison_recover_scale_done";
  for (const [id, state] of result.trace) {
    if (id === reveal) break;
    expect(state.narration, id).not.toMatch(/land was joined|joined land|joined stretch|ground all the way across/i);
  }

});
it("a published guide can need help on a later reading without inventing independent success", () => {
  const result = walk(room, start(room, "kitsune", "starweaver"), s => {
    const picks: Record<string, string> = { first_memory: "option_1", second_view: "compare_notes", what_matches: "option_1", record_choice: "publish", teach_back: "posted" };
    return picks[s.sceneId!];
  }, s => s.sceneId === "teach_posted" ? "failure" : "success");
  expect(result.state.flags.memory_guide_published).toBe(true);
  expect(result.trace.has("teach_staff")).toBe(true);
  expect(result.state.flags.memory_visitor_independent).not.toBe(true);
  expect(result.state.flags.showed_the_newcomer).toBe(true);
});
it("the close-view class aid and complete island kit change actual near-edge outcomes", () => {
  for (const [chapter, ordinary, supported] of [[room, "close_view", "close_view_attuned"], [island, "carving_1_check", "carving_frame"]] as const) {
    const outcomes = [];
    for (const scene of [ordinary, supported]) {
      let state = enterScene(start(chapter, "kitsune", "starweaver"), scene, context(chapter)).state;
      if (state.prompt?.kind !== "interaction") throw new Error("Expected interaction");
      const actor = state.prompt.actorId;
      const base = { openedSeq: state.prompt.openedSeq, attempt: state.prompt.attempt };
      const started = applyIntent(state, { playerId: actor, intent: { type: "INTERACT", ...base, action: "start", relaxed: false } }, context(chapter));
      expect(started.error).toBeUndefined(); state = started.state;
      const stopped = applyIntent(state, { playerId: actor, intent: { type: "INTERACT", ...base, action: "stop", position: .75 } }, context(chapter));
      expect(stopped.error).toBeUndefined();
      if (stopped.state.prompt?.kind !== "interaction") throw new Error("Expected result");
      outcomes.push(stopped.state.prompt.outcome);
    }
    expect(outcomes).toEqual(["failure", "success"]);
  }
});
it("Thornguard saves the landing-centering job but still plays the island's discovery", () => {
  const result = walk(island, start(island, "bigfoot", "thornguard"), s => s.sceneId === "landing" ? "landing_brace" : undefined, () => "success");
  expect(result.trace.has("landing_1_check")).toBe(false);
  expect(result.trace.has("landing_1_done")).toBe(true);
  expect(result.trace.has("comparison_1_check")).toBe(true);
  expect(result.state.flags.fragment_sky_learned).toBe(true);
});
