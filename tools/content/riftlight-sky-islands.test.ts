/**
 * Land Under an Unfamiliar Sky (riftlight-sky-islands-arrival), revised in November
 * 2026 against docs/campaigns/continental-rift/arc.md. Its dice, its wisp fight
 * (riftlight-sky-islands-fight.test.ts) and its Dojo (riftlight-class-rooms.test.ts)
 * are pinned elsewhere; these tests protect what the revision added:
 *
 * - scene 1 asks the chapter's question and names Keeper Sorrel, on either way in;
 * - Pip is introduced in words true whether or not the party has met him;
 * - the snapped mooring and the chime's lean are on every path, and the ending asks
 *   the campaign question with this chapter's piece;
 * - the games' misses cost something a later scene reads.
 */
import { enterScene } from "@kad/shared";
import { expect, it } from "vitest";
import { allPaths, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-sky-islands-arrival")!;

it.each([false, true])("scene 1 asks why the island is here and names Keeper Sorrel (flown in: %s)", (flight) => {
  const state = start(chapter, "manticore", "duskrunner", flight ? { sky_arrival_flight: true } : {});
  expect(chapter.goal!.text).toBe("Why is this island where it should not be?");
  expect(state.narration).toContain("Why is this island where it should not be?");
  expect(state.narration).toContain("Keeper Sorrel");
  expect(state.narration.includes("Cairnstep griffins")).toBe(flight);
  expect(state.narration.length).toBeLessThan(600);
  for (const scene of Object.values(chapter.scenes)) {
    for (const member of scene.type === "encounter" ? [] : scene.cast ?? []) {
      if (member.figure === "cast/kitsune_temple_keeper") expect(member.name).toBe("Keeper Sorrel");
    }
  }
});

it.each([false, true])("Pip is introduced in words true whether or not the party has met him (taught before: %s)", (taught) => {
  const state = enterScene(start(chapter, "kitsune", "starweaver", taught ? { attune_taught: true } : {}), "lesson", context(chapter)).state;
  expect(state.narration).toContain("Pip Thistledown, the young manticore scout");
  expect(state.narration).toContain("Lady Olivia says");
  expect(state.narration.includes("taught you before")).toBe(taught);
  expect(state.narration.includes("That is called Attune")).toBe(!taught);
});

it("every path sees the snapped mooring and the chime's lean, and ends on the campaign question", () => {
  const { ends, visited } = allPaths(chapter, "manticore", "duskrunner");
  expect(visited.has("mooring")).toBe(true);
  const mooring = chapter.scenes.mooring as { narration: string; priority?: number };
  expect(mooring.priority).toBe(2);
  expect(mooring.narration).toContain("back toward the glacier");
  for (const end of ends) {
    expect(end.flags.sky_saw_the_mooring).toBe(true);
    for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
    expect(end.narration).toContain("Something pulled it loose");
    expect(end.narration).toContain("Something is moving the land. What is it? And can you put things right?");
  }
});

it("a dropped log costs the supper the ferry passengers would have shared", () => {
  for (const outcome of ["success", "failure"] as const) {
    let state = start(chapter, "manticore", "duskrunner");
    state = enterScene(state, "landing_held", context(chapter)).state;
    state = enterScene(state, "fuel_chain", context(chapter)).state;
    state = finishInteraction(state, chapter, outcome);
    expect(state.sceneId).toBe("light");
    const ferry = enterScene(state, "ferry_in", context(chapter)).state;
    const share = ferry.prompt?.kind === "choice" && ferry.prompt.options.some(o => o.id === "share");
    expect(share).toBe(outcome === "success");
  }
});

it("a missed gust costs a scrape, and a whale song left unanswered keeps Fenwick home", () => {
  let gust = enterScene(start(chapter, "manticore", "duskrunner"), "gust_lull", context(chapter)).state;
  gust = finishInteraction(gust, chapter, "failure");
  expect(gust.party[0]!.hp).toBeLessThan(gust.party[0]!.character.maxHp);
  for (const outcome of ["success", "failure"] as const) {
    let state = enterScene(start(chapter, "manticore", "duskrunner"), "song_echo", context(chapter)).state;
    state = finishInteraction(state, chapter, outcome);
    expect(state.sceneId).toBe("route_vote");
    const flags = state.prompt?.kind === "choice" && state.prompt.options.some(o => o.id === "flags");
    expect(flags).toBe(outcome === "success");
    expect(state.narration.includes("a keeper named Juniper")).toBe(true);
    state = send(state, { type: "CHOOSE", choiceId: "ferry" }, chapter);
    expect(state.flags.sky_whales_silent ?? false).toBe(false);
  }
});
