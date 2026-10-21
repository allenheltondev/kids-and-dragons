import { expect, it } from "vitest";
import { applyEffects, completeVisit, enterScene, parseCampaignGraph, startJourney, takeExit } from "@kad/shared";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { allPaths, campaign, chapters, context, send, start } from "./riftlight-test-support.ts";
const chapter = chapters.get("riftlight-finale")!;
const learned = { fragment_paths_learned: true, fragment_coast_learned: true };
function walk(anchor: string, win: boolean, fate = "listen", extra: Record<string, boolean> = {}) {
  let state = start(chapter, "manticore", "duskrunner", { ...learned, ...extra });
  const trace = new Map<string, string>();
  let steps = 0;
  while (state.phase !== "chapter_complete") {
    expect(++steps).toBeLessThan(150);
    trace.set(state.sceneId!, state.narration);
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      // Outcome contract only; actual board execution is tested separately.
      const branch = win ? scene.onVictory : scene.onDefeat;
      state = enterScene(applyEffects(state, branch.effects, context(chapter)), branch.goto, context(chapter)).state;
    } else if (state.prompt?.kind === "choice") {
      const id = state.sceneId === "anchors" ? anchor : state.sceneId === "fate" ? fate : state.prompt.options[0]!.id;
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
    } else state = send(state, { type: state.prompt?.kind === "roll" ? "ROLL" : "ADVANCE" }, chapter, 1);
  }
  trace.set(state.sceneId!, state.narration);
  return { state, trace };
}
it.each(["ice", "listen"])("a victory reaches the chosen %s ending with no taken fragment", fate => {
  const { state, trace } = walk("reserve", true, fate);
  expect(state.flags[fate === "ice" ? "ending_keepers" : "ending_listened"]).toBe(true);
  expect(state.chapterOutcome).toBe("success");
  expect(trace.has("fight_standard")).toBe(true);
  expect(state.party[0]!.character.questItems).toEqual(["listening_chime"]);
  for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string]).toBe(true);
});
it("a late lost battle reaches Rivers Wander and completes the campaign", () => {
  const { state, trace } = walk("reserve", false);
  expect(trace.has("fate")).toBe(false);
  expect(state.flags.ending_rivers_wander).toBe(true);
  expect(state.chapterOutcome).toBe("setback");
  expect(chapter.scenes[state.sceneId!]!).toMatchObject({ endsCampaign: true });
  expect(state.party.every(p => !p.down)).toBe(true);
  const graph = parseCampaignGraph(campaign).graph!;
  const initial = { ...startJourney(graph), node: "finale", chapter: chapter.id, visits: { finale: 1 } };
  const done = completeVisit(graph, initial, { node: initial.node, chapterId: chapter.id, visit: initial.visit, outcome: "setback", flags: state.flags }, campaign);
  if (!done.ok || done.duplicate) throw new Error("Expected a fresh finale completion");
  expect(done.ended).toBe(true);
  expect(done.journey.status).toBe("ended");
});
it.each([
  ["third", { three_fragments_ready: true, fragment_sky_learned: true }],
  ["wyrm", { wyrm_ally: true }], ["olivia", { olivia_ally: true }],
] as const)("using %s adds exactly one anchor and selects the weakened fight", (anchor, flags) => {
  const { state, trace } = walk(anchor, true, "listen", flags);
  expect(trace.has("fight_weakened")).toBe(true);
  expect(trace.has("fight_standard")).toBe(false);
  expect(state.flags.third_anchor_used).toBe(true);
  const standard = chapter.scenes.fight_standard!, weakened = chapter.scenes.fight_weakened!;
  if (standard.type !== "encounter" || weakened.type !== "encounter") throw new Error("Expected fights");
  expect(standard.enemies.reduce((n, e) => n + (e.count ?? 1), 0) - weakened.enemies.reduce((n, e) => n + (e.count ?? 1), 0)).toBe(1);
  expect(weakened.enemies[0]!.hp).toBeLessThan(standard.enemies[0]!.hp);
});
it("having both allies still offers one support choice, not stacked extra anchors", () => {
  const { trace } = walk("wyrm", true, "listen", { wyrm_ally: true, olivia_ally: true, three_fragments_ready: true });
  expect([...trace.keys()].filter(id => ["third_plan", "wyrm_plan", "olivia_plan"].includes(id))).toEqual(["wyrm_plan"]);
});
it("the third-discovery flag is produced only by three actual completed key nodes", () => {
  const graph = parseCampaignGraph(campaign).graph!;
  for (const third of [false, true]) {
    const keys = ["reading-room", "buried-bridge", ...(third ? ["the-island-due-back"] : [])];
    const initial = { ...startJourney(graph), node: "convergence", chapter: "riftlight-convergence", visits: { convergence: 1 }, completions: Object.fromEntries(keys.map(k => [k, 1])) };
    const done = completeVisit(graph, initial, { node: initial.node, chapterId: initial.chapter, visit: initial.visit, outcome: "success", flags: {} }, campaign);
    if (!done.ok) throw new Error(done.message);
    expect(done.journey.flags?.three_fragments_ready === true).toBe(third);
  }
});
it("keeps the reveal on its own scene and all earlier text free of the identity", () => {
  const { trace } = walk("reserve", true);
  for (const [id, narration] of trace) {
    if (id === "reveal") break;
    expect(narration).not.toMatch(/Corvane|Pangea|emperor/i);
  }
  expect(chapter.scenes.reveal).toMatchObject({ priority: 1 });
  expect(Object.values(chapter.scenes).filter(s => "priority" in s && s.priority === 1)).toHaveLength(1);
});
it("has real endings in a complete 24-node story graph, with no development pauses", () => {
  expect(Object.keys(campaign.graph!.nodes)).toHaveLength(24);
  expect(campaign.chapters.some(id => id.includes("preview-pause"))).toBe(false);
  expect(Object.values(campaign.graph!.nodes).filter(n => n.ending)).toHaveLength(1);
  const { ends } = allPaths(chapter, "manticore", "duskrunner", { ...learned, fragment_sky_learned: true, three_fragments_ready: true, wyrm_ally: true, olivia_ally: true });
  expect(new Set(ends.map(s => s.sceneId))).toEqual(new Set(["keepers_epilogue", "listened_epilogue", "loss_epilogue"]));
});
it("offers the upriver escape once the guide has checked it at the Bone Yard", () => {
  const graph = parseCampaignGraph(campaign).graph!;
  for (const checked of [false, true]) {
    const initial = { ...startJourney(graph), node: "saltrot-arrival", chapter: "riftlight-saltrot-arrival", visits: { "saltrot-arrival": 1 }, completions: Object.fromEntries(checked ? [["bone-yard", 1]] : []) };
    const done = completeVisit(graph, initial, { node: initial.node, chapterId: initial.chapter, visit: initial.visit, outcome: "success", flags: {} }, campaign);
    if (!done.ok) throw new Error(done.message);
    expect(takeExit(graph, done.journey, { edge: "saltrot-to-ashspan", visit: done.journey.visit }, campaign).ok).toBe(checked);
  }
});
it("keeps the success spine interactive across party scenarios", () => {
  for (const { shortest } of pacingReport(chapter).scenarios) {
    expect(shortest!.scenes).toBeGreaterThanOrEqual(30);
    expect(shortest!.decisions).toBeGreaterThanOrEqual(14);
    expect(shortest!.checks).toBe(6);
    expect(shortest!.encounters).toBe(1);
  }
});
