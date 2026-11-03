import { expect, it } from "vitest";
import { completeVisit, enterScene, parseCampaignGraph, startJourney, takeExit } from "@kad/shared";
import { allPaths, campaign, chapters, context, start } from "./riftlight-test-support.ts";

// The valley's own crossing record is played in riftlight-wrong-valley.test.ts.
// The reading room's callbacks and its Coast comparison are played in its own November 2026 suite.

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
    for (const p of end.party) { expect(p.hp).toBeGreaterThanOrEqual(1); expect(p.down).toBe(false); } // The rest heals, and no fall downs anyone.
  }
});
