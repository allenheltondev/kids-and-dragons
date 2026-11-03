/**
 * The Maps Come Together (riftlight-convergence), rewritten in November 2026
 * (docs/campaigns/continental-rift/convergence-review.md). The route matrix is
 * in riftlight-final-play.test.ts; these pin the contract and the shortcuts.
 */
import { completeVisit, enterScene, parseCampaignGraph, startJourney, takeExit } from "@kad/shared";
import { expect, it } from "vitest";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { allPaths, campaign, chapters, context, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-convergence")!;
const graph = parseCampaignGraph(campaign).graph!;
const TWO = { fragment_paths_learned: true, fragment_coast_learned: true };

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

it("every authored outcome, for every species and class shortcut, reaches the beat with a side taken and Manipulate learned", () => {
  for (const [species, cls] of [["manticore", "duskrunner"], ["griffin", "duskrunner"], ["bigfoot", "thornguard"], ["unicorn", "songkeeper"], ["kitsune", "starweaver"]] as const) {
    const { ends, visited } = allPaths(chapter, species, cls, { ...TWO, orin_chime_shared: true });
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
      expect(end.flags.manipulate_learned).toBe(true);
      expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
      // Exactly one side, and Pip mirrors it.
      expect(end.flags.helped_bram === true).not.toBe(end.flags.olivia_continued === true);
      expect(end.flags.pip_stayed_back === true).toBe(end.flags.helped_bram === true);
    }
    expect(visited.has("bigfoot_stakes")).toBe(species === "bigfoot");
    expect(visited.has("swoop")).toBe(species === "griffin");
    expect(visited.has("hold_starweaver")).toBe(cls === "starweaver");
    for (const id of ["fit", "stopped", "stood", "orin_talks", "signal_stop", "remind", "beside_her", "rope_holds", "seren_holds"]) expect(visited.has(id), id).toBe(true);
  }
});

it("Orin can talk Olivia down only for a party that shared the chime's readings, and it counts as helping Bram", () => {
  for (const shared of [false, true]) {
    const state = enterScene(start(chapter, "manticore", "duskrunner", { ...TWO, orin_chime_shared: shared }), "decision", context(chapter)).state;
    expect(state.prompt?.kind === "choice" && state.prompt.options.some(o => o.id === "orin")).toBe(shared);
  }
  let state = enterScene(start(chapter, "manticore", "duskrunner", { ...TWO, orin_chime_shared: true }), "decision", context(chapter)).state;
  state = send(state, { type: "CHOOSE", choiceId: "orin" }, chapter);
  state = send(state, { type: "CHOOSE", choiceId: "back" }, chapter);
  expect(state.sceneId).toBe("stopped");
  expect(state.flags).toMatchObject({ helped_bram: true, olivia_continued: false, pip_stayed_back: true });
});

it.each([
  [true, "bram", "redeemed"], [true, "olivia", "ally"], [false, "bram", "rival"], [false, "olivia", "rival"],
] as const)("trust %s and %s make Olivia %s through the node's completion rules", (trusted, side, status) => {
  let state = enterScene(start(chapter, "manticore", "duskrunner", { ...TWO, olivia_trusted: trusted }), "decision", context(chapter)).state;
  state = send(state, { type: "CHOOSE", choiceId: side }, chapter);
  state = send(state, { type: "ROLL" }, chapter, 20);
  const initial = { ...startJourney(graph), node: "convergence", chapter: chapter.id, visits: { convergence: 1 } };
  const done = completeVisit(graph, initial, { node: "convergence", chapterId: chapter.id, visit: initial.visit, outcome: "success", flags: state.flags }, campaign);
  if (!done.ok) throw new Error(done.message);
  expect(["ally", "redeemed", "rival"].filter(s => done.journey.flags?.[`olivia_${s}`])).toEqual([status]);
});

it("the summoning shows Olivia she cannot choose what an opening does", () => {
  const summoning = chapter.scenes.summoning!;
  expect(summoning).toMatchObject({ type: "story", rift: "open" });
  expect((summoning as { narration: string }).narration).toContain("colors nobody chose");
  expect((summoning as { narration: string }).narration).toContain("The opening does not listen");
  expect((chapter.scenes.lesson_done as { narration: string }).narration).toContain("You can never choose where it goes");
});

it("the one p1 says plainly that the pieces fit one old map, on purpose, and names nobody", () => {
  const p1 = Object.entries(chapter.scenes).filter(([, s]) => "priority" in s && s.priority === 1);
  expect(p1.map(([id]) => id)).toEqual(["fit"]);
  const text = (p1[0]![1] as { narration: string }).narration;
  expect(text).toContain("one old map");
  expect(text).toContain("on purpose");
  expect(text).toContain("Whoever is moving the land");
  expect(JSON.stringify(chapter.scenes)).not.toMatch(/Corvane|Pangea|emperor/i);
});

it("Bram Lock arrives with a stake for the party", () => {
  const bram = chapter.scenes.bram as { narration: string; cast: { name?: string }[] };
  expect(bram.narration).toContain("\"Bram Lock,\"");
  expect(bram.narration).toContain("Will you help me make it strong?");
  expect(bram.cast.some(c => c.name === "Bram Lock")).toBe(true);
});

it("a party that skipped the Sky meets Olivia without a callback, and the others are greeted as they parted", () => {
  const greet = (flags: Record<string, boolean>) => enterScene(start(chapter, "manticore", "duskrunner", flags), "line_held", context(chapter)).state.narration;
  expect(greet({ olivia_trusted: true })).toContain("whale-road friends");
  expect(greet({ whales_guided: true })).toContain("chose the whales' way");
  const cold = greet({});
  expect(cold).not.toContain("whale");
  expect(cold).toContain("Lady Olivia says tonight is the night");
});

it("sets only the contract's journey flags", () => {
  const journey = new Set(campaign.graph!.flags);
  const written = new Set([...JSON.stringify(chapter).matchAll(/"type":"setFlag","flag":"([a-z_]+)"/g)].map(m => m[1]!));
  expect([...written].filter(f => journey.has(f)).sort()).toEqual(["helped_bram", "manipulate_learned", "olivia_continued", "pip_stayed_back"]);
});

it("keeps the success spine a full, playful evening across party scenarios", () => {
  for (const { shortest } of pacingReport(chapter, undefined, 0).scenarios) {
    expect(shortest!.scenes).toBeGreaterThanOrEqual(30);
    expect(shortest!.decisions + shortest!.checks).toBeGreaterThanOrEqual(14);
    expect(shortest!.longestReadingRun).toBeLessThanOrEqual(3);
  }
  expect(chapter.xpAward).toBe(650);
});
