import { expect, it } from "vitest";
import { chapters, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-buried-bridge")!;
const cases = ["rail", "sled"].flatMap(equipment => ["records", "path"].flatMap(priority =>
  ["local", "research"].flatMap(record => [1, 3].map(seats => ({ equipment, priority, record, seats })))));

it.each(cases)("$equipment / $priority / $record with $seats heroes has a full, consequential play arc", route => {
  let state = start(chapter, "manticore", "thornguard", {}, route.seats);
  const scenes = new Set<string>();
  const kinds = new Set<string>();
  let activities = 0;
  while (state.phase !== "chapter_complete") {
    expect(scenes.size).toBeLessThan(45);
    scenes.add(state.sceneId!);
    if (state.prompt?.kind === "interaction") {
      kinds.add(state.prompt.spec.kind);
      activities++;
      // A missed pulse / reconstructed note must not erase the old river clue.
      const miss = ["timing", "memory"].includes(state.prompt.spec.kind);
      state = finishInteraction(state, chapter, miss ? "failure" : "success");
    } else if (state.prompt?.kind === "choice") {
      const preferred: Record<string, string> = {
        orin: "keep", equipment: route.equipment, work: "class_brace",
        tide_turn: route.priority, record_decision: route.record,
      };
      state = send(state, { type: "CHOOSE", choiceId: preferred[state.sceneId!] ?? state.prompt.options[0]!.id }, chapter);
    } else state = send(state, { type: "ADVANCE" }, chapter);
  }
  expect(activities).toBeGreaterThanOrEqual(10);
  expect(kinds.size).toBeGreaterThanOrEqual(5);
  // Scene counts are not a duration proxy; ten activities remain even on the class shortcut.
  expect(state.flags.fragment_coast_learned).toBe(true);
  expect(state.flags.orin_chime_shared).not.toBe(true);
  for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string]).toBe(true);
  expect(scenes.has(route.equipment === "rail" ? "build_rail" : "build_sled")).toBe(true);
  expect(scenes.has(`${route.equipment}_${route.priority === "records" ? "lift" : "warning"}`)).toBe(true);
  expect(scenes.has(route.priority === "records" ? "path_repair" : "wet_notes")).toBe(true);
  expect(scenes.has(route.priority === "records" ? "wet_notes" : "path_repair")).toBe(false);
  expect(state.flags.bridge_drawings_dry).toBe(route.priority === "records");
  expect(state.flags.bridge_return_ready).toBe(true);
  expect(state.flags.bridge_local_copy_tested === true).toBe(route.record === "local");
  expect(state.flags.bridge_research_copy_sent === true).toBe(route.record === "research");
  expect(state.narration).toContain(route.record === "local" ? "People can learn from the high bank" : "work area is closed");
  expect(state.narration).toContain(route.priority === "records" ? "saved the original measurements" : "rebuilt a simpler drawing");
});
