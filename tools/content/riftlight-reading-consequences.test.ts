import { expect, it } from "vitest";
import { chapters, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-reading-room")!;

it.each([
  { name: "prepared ridge evidence becomes a visitor guide", method: "compare_notes", claim: "option_1", record: "publish", face: 20, independent: true, signed: false, published: true },
  { name: "rock evidence remains private", method: "option_2", claim: "option_1", record: "option_2", face: 20, independent: true, signed: false, published: false },
  { name: "incomplete evidence produces a signed staff-guided copy", method: "option_1", claim: "keeper", record: "staff_copy", face: 1, independent: false, signed: true, published: false },
  { name: "an incomplete private account never becomes a citation", method: "option_1", claim: "option_2", record: "option_2", face: 1, independent: false, signed: false, published: false },
])("$name through a complete engine-played route", (route) => {
  let state = start(chapter, "manticore", "duskrunner");
  const seen = new Map<string, string>();
  let steps = 0;
  while (state.phase !== "chapter_complete") {
    expect(++steps).toBeLessThan(150);
    seen.set(state.sceneId!, state.narration);
    if (state.prompt?.kind === "choice") {
      const options = state.prompt.options;
      if (state.sceneId === "what_matches") {
        expect(options.some((o) => o.id === "option_1")).toBe(route.independent);
      }
      if (state.sceneId === "record_choice") {
        expect(options.some((o) => o.id === "publish")).toBe(route.face === 20);
        expect(options.some((o) => o.id === "staff_copy")).toBe(route.face === 1);
      }
      const preferred: Record<string, string> = {
        first_memory: route.method === "compare_notes" ? "option_1" : "option_2",
        second_view: route.method,
        what_matches: route.claim,
        catalog_test: route.signed ? "endorsed" : "option_1",
        record_choice: route.record,
      };
      const id = preferred[state.sceneId!] ?? options[0]!.id;
      expect(options.some((o) => o.id === id), state.sceneId ?? undefined).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, route.face);
    } else if (state.prompt?.kind === "interaction") {
      const canMiss = ["timing", "precision", "tracking", "memory", "sequence"].includes(state.prompt.spec.kind);
      state = finishInteraction(state, chapter, canMiss && route.face === 1 ? "failure" : "success");
    } else state = send(state, { type: "ADVANCE" }, chapter);
  }
  expect(state.flags.memory_independent_reading).toBe(route.independent);
  expect(state.flags.memory_keeper_endorsed).toBe(route.signed);
  expect(state.flags.memory_account_cited).toBe(route.claim === "option_1");
  expect(state.flags.memory_rock_sequence).toBe(route.independent && route.method === "option_2");
  expect(state.flags.memory_guide_published).toBe(route.published);
  expect(state.flags.memory_notes_shared).toBe(route.record !== "option_2");
  expect(state.flags.fragment_paths_learned).toBe(true);
  expect(seen.has("second_view_prepared")).toBe(route.method === "compare_notes");
  expect(seen.has("catalog_endorsed")).toBe(route.signed);
  expect(seen.has("record_publish")).toBe(route.published);
  expect(seen.has("record_staff_copy")).toBe(route.record === "staff_copy");
  expect(seen.get("teach_back")).toContain(route.published ? "posted" : route.record === "staff_copy" ? "keeper" : "private");
});
