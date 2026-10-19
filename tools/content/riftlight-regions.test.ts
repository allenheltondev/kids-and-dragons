import { expect, it } from "vitest";
import { completeVisit, enterScene, parseCampaignGraph, startJourney, takeExit, takeRiftAction, riftState } from "@kad/shared";
import { allPaths, campaign, chapters, context, start } from "./riftlight-test-support.ts";

const graph = parseCampaignGraph(campaign).graph!;
function ready(node: string, flags: Record<string, boolean> = {}) {
  const initial = { ...startJourney(graph), node, chapter: graph.nodes[node]!.chapter, flags, visits: { [node]: 1 } };
  const result = completeVisit(graph, initial, { node, chapterId: initial.chapter, visit: initial.visit, outcome: "success", flags }, campaign);
  if (!result.ok) throw new Error(result.message);
  return result.journey;
}

it.each(["olivia", "guide"])("the %s opening choice commits distinct consequences and shares the return mouth", (way) => {
  const result = takeRiftAction(graph, ready("whale-road"), { action: "open", edge: "whales-to-coast", way, visit: 1 }, campaign);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  expect(result.journey.flags?.whales_scattered === true).toBe(way === "olivia");
  expect(result.journey.flags?.olivia_trusted === true).toBe(way === "olivia");
  expect(result.journey.flags?.whales_guided === true).toBe(way === "guide");
  const crossed = takeExit(graph, result.journey, { edge: "whales-to-coast", visit: 1 }, campaign);
  if (!crossed.ok) throw new Error(crossed.message);
  expect(crossed.journey.flags?.saltrot_arrival_whales).toBe(true);
  expect(riftState(graph, "coast-to-whales", crossed.journey)?.status).toBe("open");
  const ch = chapters.get("riftlight-saltrot-arrival")!;
  const arrival = start(ch, "manticore", "duskrunner", crossed.journey.flags);
  expect(arrival.narration).toContain("cloud whales' distant song");
  expect(arrival.narration).not.toContain("cold glacier air");
  expect(arrival.narration).not.toContain("flat boat");
});

it("guiding in the chapter closes Olivia's early-opening choice", () => {
  const result = takeRiftAction(graph, ready("whale-road", { whales_guided: true }), { action: "open", edge: "whales-to-coast", way: "olivia", visit: 1 }, campaign);
  expect(result.ok).toBe(false);
});

it("the shrinking rift is usable on arrival and expires when the party takes the road instead", () => {
  const initial = ready("boundary-stone-bank");
  const entered = takeExit(graph, initial, { edge: "boundary-stone-bank-onward", visit: initial.visit }, campaign);
  if (!entered.ok) throw new Error(entered.message);
  expect(riftState(graph, "counters-shrinking-fold", entered.journey)?.status).toBe("open");
  const finished = completeVisit(graph, entered.journey, { node: "stone-counters", chapterId: "riftlight-stone-counters", visit: entered.journey.visit, outcome: "success", flags: entered.journey.flags ?? {} }, campaign);
  if (!finished.ok) throw new Error(finished.message);
  const crossed = takeExit(graph, finished.journey, { edge: "counters-shrinking-fold", visit: finished.journey.visit }, campaign);
  expect(crossed.ok).toBe(true);
  const road = takeExit(graph, finished.journey, { edge: "counters-to-bridge", visit: finished.journey.visit }, campaign);
  if (!road.ok) throw new Error(road.message);
  expect(riftState(graph, "counters-shrinking-fold", road.journey)?.status).toBe("expired");
});

it("every bridge path learns the clue, sharing remains optional, and no fragment becomes an item", () => {
  const { ends } = allPaths(chapters.get("riftlight-buried-bridge")!, "manticore", "duskrunner");
  expect(ends.every((s) => s.flags.fragment_coast_learned)).toBe(true);
  expect(ends.some((s) => s.flags.orin_chime_shared)).toBe(true);
  expect(ends.some((s) => !s.flags.orin_chime_shared)).toBe(true);
  for (const end of ends) expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
});

it("the stone lesson acknowledges an earlier strand's teaching on every branch", () => {
  const ch = chapters.get("riftlight-stone-counters")!;
  allPaths(ch, "kitsune", "starweaver", { attune_taught: true });
  const state = start(ch, "kitsune", "starweaver", { attune_taught: true });
  expect(enterScene(state, "lesson", context(ch)).state.narration).toContain("taught you before");
});
