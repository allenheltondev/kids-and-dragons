import { expect, it } from "vitest";
import { completeVisit, enterScene, parseCampaignGraph, startJourney, takeExit } from "@kad/shared";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

it("the valley records the interactive route actually used, including a played backup after a miss", () => {
  const c = chapters.get("riftlight-the-wrong-valley")!;
  for (const option of [1, 2]) for (const outcome of ["success", "failure", "assisted"] as const) {
    const high = outcome !== "failure" ? option === 2 : option === 1;
    const initial = start(c, "manticore", "duskrunner", { valley_crossed_high: !high });
    let result = enterScene(initial, `crossing_choice_${option}_check`, context(c)).state;
    result = finishInteraction(result, c, outcome);
    if (outcome === "failure") {
      expect(result.sceneId).toBe(option === 1 ? "high_recovery" : "low_recovery");
      result = finishInteraction(result, c);
    }
    expect(result.flags.valley_crossed_high).toBe(high);
    expect(result.narration).toContain(high ? "high rock reach" : "supported low shelf");
  }
});

it("both crossing histories get accurate reading-room callbacks", () => {
  const c = chapters.get("riftlight-reading-room")!;
  for (const high of [false, true]) {
    const result = start(c, "manticore", "duskrunner", { valley_crossed_high: high });
    expect(result.narration.includes("high rock reach")).toBe(high);
    expect(result.narration.includes("supported low-shelf")).toBe(!high);
  }
});

it("the optional Coast comparison is backed by a real producer and never invented for another route", () => {
  const bridge = chapters.get("riftlight-buried-bridge")!;
  const source = allPaths(bridge, "manticore", "duskrunner");
  for (const [i, end] of source.ends.entries()) {
    expect(end.flags.fragment_coast_learned).toBe(true);
    expect(source.endingKnowledge[i]!.has("river_evidence")).toBe(true);
  }
  const setters = (v: unknown): number => {
    if (!v || typeof v !== "object") return 0;
    const o = v as Record<string, unknown>;
    return Number(o.type === "setFlag" && o.flag === "fragment_coast_learned" && o.value !== false)
      + Object.values(o).reduce<number>((n, child) => n + setters(child), 0);
  };
  for (const c of chapters.values()) if (c.id !== bridge.id) expect(setters(c), c.id).toBe(0);
  expect(setters(campaign.graph)).toBe(0); // No shortcut may manufacture the callback's prerequisite.
  const c = chapters.get("riftlight-reading-room")!;
  for (const learned of [false, true]) {
    const flags = { fragment_coast_learned: learned, valley_crossed_high: true };
    allPaths(c, "manticore", "duskrunner", flags);
    const initial = start(c, "manticore", "duskrunner", flags);
    const view = enterScene(initial, "compare_accounts", context(c)).state;
    expect(view.narration.includes("At the Saltrot's buried bridge")).toBe(learned);
  }
});

it("every memory path earns knowledge without an item and respects the choice to keep the account private", () => {
  const { ends } = allPaths(chapters.get("riftlight-reading-room")!, "manticore", "duskrunner", {}, 3, 1);
  expect(ends.some((s) => s.flags.memory_notes_shared === true)).toBe(true);
  expect(ends.some((s) => s.flags.memory_notes_shared === false)).toBe(true);
  for (const state of ends) {
    expect(state.flags.fragment_paths_learned).toBe(true);
    for (const p of state.party) { expect(p.hp).toBe(1); expect(p.down).toBe(false); }
    expect(state.party.flatMap((p) => p.character.questItems)).toEqual(["listening_chime"]);
  }
});

it("the completed memory path remains a pass-through return route rather than replaying the river event", () => {
  const graph = parseCampaignGraph(campaign).graph!;
  const journey = { ...startJourney(graph), node: "the-wrong-valley", chapter: "riftlight-the-wrong-valley", visits: { "the-wrong-valley": 1 }, flags: { wrong_valley_witnessed: true, valley_crossed_high: true } };
  const complete = (current: typeof journey) => {
    const done = completeVisit(graph, current, { node: current.node, chapterId: current.chapter, visit: current.visit, outcome: "success", flags: current.flags }, campaign);
    if (!done.ok) throw new Error(done.message);
    return done.journey;
  };
  const first = takeExit(graph, complete(journey), { edge: "wrong-valley-to-reading", visit: 1 }, campaign);
  if (!first.ok) throw new Error(first.message);
  const memory = completeVisit(graph, first.journey, { node: first.journey.node, chapterId: first.journey.chapter, visit: first.journey.visit, outcome: "success", flags: { ...first.journey.flags, fragment_paths_learned: true } }, campaign);
  if (!memory.ok) throw new Error(memory.message);
  const back = takeExit(graph, memory.journey, { edge: "reading-to-wrong-valley", visit: memory.journey.visit }, campaign);
  if (!back.ok) throw new Error(back.message);
  if (back.duplicate) throw new Error("Expected a fresh return crossing");
  expect(back.arrival).toBe("pass");
  expect(back.journey.status).toBe("choosing");
  const revisit = takeExit(graph, back.journey, { edge: "wrong-valley-to-reading", visit: back.journey.visit }, campaign);
  if (!revisit.ok) throw new Error(revisit.message);
  if (revisit.duplicate) throw new Error("Expected a fresh memory revisit");
  expect(revisit.arrival).toBe("pass");
  expect(revisit.journey.flags?.fragment_paths_learned).toBe(true);
  expect(revisit.journey.completions?.["reading-room"]).toBe(1);
});


it("the valley's failed environmental plans keep a one-HP party standing and together", () => {
  const { ends } = allPaths(chapters.get("riftlight-the-wrong-valley")!, "manticore", "duskrunner", {}, 3, 1);
  for (const end of ends) {
    expect(end.flags.wrong_valley_witnessed).toBe(true);
    expect(typeof end.flags.valley_crossed_high).toBe("boolean");
    expect(end.party).toHaveLength(3);
    for (const p of end.party) { expect(p.hp).toBe(1); expect(p.down).toBe(false); }
  }
});
