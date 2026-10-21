import { expect, it } from "vitest";
import { completeVisit, enterScene, parseCampaignGraph, startJourney, takeExit } from "@kad/shared";
import { campaign, chapters, context, send, start } from "./riftlight-test-support.ts";
const chapter = chapters.get("riftlight-convergence")!;
const graph = parseCampaignGraph(campaign).graph!;
function walk(option: string, trust: boolean, shared = false) {
  let state = start(chapter, "manticore", "duskrunner", { olivia_trusted: trust, orin_chime_shared: shared, fragment_paths_learned: true, fragment_coast_learned: true });
  let steps = 0;
  while (state.phase !== "chapter_complete") {
    expect(++steps).toBeLessThan(150);
    if (state.prompt?.kind === "choice") state = send(state, { type: "CHOOSE", choiceId: state.sceneId === "decision" ? option : state.prompt.options[0]!.id }, chapter);
    else state = send(state, { type: state.prompt?.kind === "roll" ? "ROLL" : "ADVANCE" }, chapter, 1);
  }
  const journey = { ...startJourney(graph), node: "convergence", chapter: chapter.id, flags: state.flags, visits: { convergence: 1 } };
  const result = completeVisit(graph, journey, { node: journey.node, chapterId: chapter.id, visit: journey.visit, outcome: "success", flags: state.flags }, campaign);
  if (!result.ok) throw new Error(result.message);
  return { state, journey: result.journey };
}
it.each([
  [true, "bram", "redeemed", true], [true, "olivia", "ally", false],
  [false, "bram", "rival", true], [false, "olivia", "rival", false],
  [true, "orin", "redeemed", true], [false, "orin", "rival", true],
] as const)("trust=%s and %s yields Olivia as %s", (trust, option, ending, stopped) => {
  const { state, journey } = walk(option, trust, option === "orin");
  expect(journey.flags?.[`olivia_${ending}`]).toBe(true);
  expect(["ally", "redeemed", "rival"].filter(s => journey.flags?.[`olivia_${s}`])).toEqual([ending]);
  expect(journey.flags?.pip_stayed_back === true).toBe(stopped);
  expect(journey.flags?.manipulate_learned).toBe(true);
  expect(journey.facts?.attunement).toBe(2);
  for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string]).toBe(true);
});
it("offers Orin's intervention only with the shared chime evidence", () => {
  for (const shared of [false, true]) {
    let state = start(chapter, "manticore", "duskrunner", { orin_chime_shared: shared });
    while (state.sceneId !== "decision") {
      state = state.prompt?.kind === "choice" ? send(state, { type: "CHOOSE", choiceId: state.prompt.options[0]!.id }, chapter) : send(state, { type: state.prompt?.kind === "roll" ? "ROLL" : "ADVANCE" }, chapter);
    }
    expect(state.prompt?.kind === "choice" && state.prompt.options.some(o => o.id === "orin")).toBe(shared);
  }
});
it.each(["wyrm-nest", "bone-yard", "squall-temple"])("%s requires its own key and one other, with no required third strand", end => {
  const own = end === "wyrm-nest" ? "reading-room" : end === "bone-yard" ? "buried-bridge" : "the-island-due-back";
  const keys = ["reading-room", "buried-bridge", "the-island-due-back"];
  for (let mask = 0; mask < 8; mask++) {
    const completed = keys.filter((_, i) => mask & (1 << i));
    const initial = { ...startJourney(graph), node: end, chapter: graph.nodes[end]!.chapter, visits: { [end]: 1 }, completions: Object.fromEntries(completed.map(k => [k, 1])) };
    const done = completeVisit(graph, initial, { node: end, chapterId: initial.chapter, visit: initial.visit, outcome: "success", flags: {} }, campaign);
    if (!done.ok) throw new Error(done.message);
    const exits = Object.entries(campaign.graph!.edges).filter(([, edge]) => edge.from === end && edge.to === "convergence");
    const allowed = exits.some(([edge]) => takeExit(graph, done.journey, { edge, visit: done.journey.visit }, campaign).ok);
    expect(allowed, `${end}/${completed}`).toBe(completed.includes(own) && completed.length >= 2);
  }
});


it.each([
  ["fragment_paths_learned", "fragment_coast_learned", "memory readers", "buried bridge", "island mooring"],
  ["fragment_paths_learned", "fragment_sky_learned", "memory readers", "island mooring", "buried bridge"],
  ["fragment_coast_learned", "fragment_sky_learned", "buried bridge", "island mooring", "memory readers"],
])("reads only the two accounts from %s and %s", (a, b, first, second, absent) => {
  const state = start(chapter, "manticore", "duskrunner", { [a!]: true, [b!]: true });
  const text = enterScene(state, "evidence", context(chapter)).state.narration.toLowerCase();
  expect(text).toContain(first);
  expect(text).toContain(second);
  expect(text).not.toContain(absent);
});
