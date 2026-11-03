/**
 * The Glacier Remembers (riftlight-finale), rewritten in November 2026
 * (docs/campaigns/continental-rift/finale-review.md). The route matrix is in
 * riftlight-final-play.test.ts and the boards in riftlight-finale-combat.test.ts;
 * these pin the contract: the reveal, the capped anchors, the endings.
 */
import { completeVisit, enterScene, parseCampaignGraph, startJourney, takeExit } from "@kad/shared";
import type { RunState } from "@kad/shared";
import { expect, it } from "vitest";
import { pacingReport } from "../../packages/shared/src/chapter-pacing.ts";
import { allPaths, campaign, chapters, context, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-finale")!;
const graph = parseCampaignGraph(campaign).graph!;
const TWO = { fragment_paths_learned: true, fragment_coast_learned: true };
const ALL = { ...TWO, fragment_sky_learned: true, three_fragments_ready: true };
const options = (s: RunState) => s.prompt?.kind === "choice" ? s.prompt.options.map(o => o.id) : [];

it("has real endings in a complete 24-node story graph", () => {
  expect(Object.keys(campaign.graph!.nodes)).toHaveLength(24);
  expect(Object.values(campaign.graph!.nodes).filter(n => n.ending)).toHaveLength(1);
  const { ends } = allPaths(chapter, "manticore", "duskrunner", { ...ALL, wyrm_ally: true, olivia_ally: true });
  expect(new Set(ends.map(s => s.sceneId))).toEqual(new Set(["keepers_epilogue", "listened_epilogue", "loss_epilogue"]));
  for (const end of ends) {
    expect(end.chapterOutcome).toBe(end.sceneId === "loss_epilogue" ? "setback" : "success");
    expect(end.flags[{ keepers_epilogue: "ending_keepers", listened_epilogue: "ending_listened", loss_epilogue: "ending_rivers_wander" }[end.sceneId!]!]).toBe(true);
    expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
    if (end.sceneId === "loss_epilogue") expect(end.flags.final_fell_back && end.flags.final_battle_lost).toBe(true);
  }
});

it("every species and class shortcut still reaches every ending", () => {
  for (const [species, cls] of [["griffin", "duskrunner"], ["unicorn", "songkeeper"], ["kitsune", "starweaver"], ["bigfoot", "thornguard"]] as const) {
    const { ends, visited } = allPaths(chapter, species, cls, TWO);
    expect(new Set(ends.map(s => s.sceneId)).size, species).toBe(3);
    expect(visited.has("glide")).toBe(species === "griffin");
    expect(visited.has("sing_kid")).toBe(cls === "songkeeper");
  }
});

it("the reveal is the one p1, and nothing before it names him", () => {
  const p1 = Object.entries(chapter.scenes).filter(([, s]) => "priority" in s && s.priority === 1).map(([id]) => id);
  expect(p1).toEqual(["reveal"]);
  const reveal = (chapter.scenes.reveal as { narration: string }).narration;
  for (const words of ["I am Corvane", "Pangea", "Do you know how long I have waited to see my rivers run the right way again?", "Corvane is the one moving the land"]) expect(reveal).toContain(words);
  expect(reveal).not.toMatch(/fauns? (today|now)|his people today/i);
  for (const id of ["arrival", "herder", "old_ice", "check_quiet", "frozen", "figure"]) {
    expect(JSON.stringify(chapter.scenes[id]), id).not.toMatch(/Corvane|Pangea|emperor|\bking\b/i);
  }
  expect((chapter.scenes.figure as { cast: { name?: string }[] }).cast.some(c => c.name === "Corvane")).toBe(false);
});

it("Corvane speaks in his own lines and never threatens", () => {
  const all = JSON.stringify(chapter.scenes);
  for (const line of ["Why is the river on the wrong side of the mountain?", "Those stones are mine", "It listens to you?",
    "That is not the color I asked for", "I only want to go home", "It was a very good map",
    "Wake me if the rivers ever forget their way", "Then tell me what you call this valley now", "Then we learn the new map"]) expect(all).toContain(line);
  expect(all).not.toMatch(/\b(conquer|punish|servants|destroy|hurt you)\b/i);
});

it("anchors are the pieces this party learned plus one ally, capped at three", () => {
  const at = (flags: Record<string, boolean>) => enterScene(start(chapter, "manticore", "duskrunner", flags), "corvane_two", context(chapter)).state;
  expect(options(at(TWO))).toEqual(["reserve", "ridge"]);
  expect(options(at(ALL))).toEqual(["reserve", "ridge", "third"]);
  expect(options(at({ ...TWO, wyrm_ally: true, olivia_ally: true }))).toEqual(["reserve", "ridge", "wyrm", "olivia"]);
  // Any one of them is the third anchor, and only one can be chosen: the weakened fight.
  for (const [choice, flags, face] of [["third", ALL, 20], ["wyrm", { ...TWO, wyrm_ally: true }, 1], ["olivia", { ...TWO, olivia_ally: true }, 20]] as const) {
    let state = at(flags);
    state = send(state, { type: "CHOOSE", choiceId: choice }, chapter);
    state = send(state, { type: "ROLL" }, chapter, face);
    expect(state.sceneId).toBe("seam_weak");
    expect(state.flags.third_anchor_used).toBe(true);
    expect(options(state)).not.toContain("third");
  }
  const weak = chapter.scenes.fight_weakened!, standard = chapter.scenes.fight_standard!;
  if (weak.type !== "encounter" || standard.type !== "encounter") throw new Error("Expected fights");
  const count = (s: typeof weak) => s.enemies.reduce((n, e) => n + (e.count ?? 1), 0);
  expect(count(standard) - count(weak)).toBe(1);
  expect(weak.enemies[0]!.hp).toBeLessThan(standard.enemies[0]!.hp);
});

it("the anchors say each learned piece, and a party without one never hears it", () => {
  const read = (id: string, flags: Record<string, boolean>) => enterScene(start(chapter, "manticore", "duskrunner", flags), id, context(chapter)).state.narration;
  expect(read("anchor_one", TWO)).toContain("memory ice");
  expect(read("anchor_one", { fragment_coast_learned: true, fragment_sky_learned: true })).toContain("buried bridge");
  expect(read("anchor_one", { fragment_coast_learned: true, fragment_sky_learned: true })).not.toContain("memory ice");
  expect(read("anchor_two", TWO)).toContain("buried bridge");
  expect(read("anchor_two", { fragment_paths_learned: true, fragment_sky_learned: true })).toContain("island that came back");
  expect(read("anchor_two", { fragment_paths_learned: true, fragment_sky_learned: true })).not.toContain("buried bridge");
  expect(read("anchor_two", { fragment_coast_learned: true, fragment_sky_learned: true })).toContain("island that came back");
  expect(read("anchor_three", { ...ALL, temple_damaged: true })).toContain("mending its landing");
});

it("the earlier strands make real differences at the end", () => {
  const plan = (flags: Record<string, boolean>) => options(enterScene(start(chapter, "manticore", "duskrunner", { ...TWO, ...flags }), "loss_plan", context(chapter)).state);
  expect(plan({})).toEqual(["brace"]);
  expect(plan({ pip_stayed_back: true })).toContain("pip");
  expect(plan({ temple_island_settled: true })).toContain("island");
  expect(plan({ fin_listened: true, fin_reserve: true })).toEqual(["brace", "ask", "reserve"]);
  const map = (flags: Record<string, boolean>) => options(enterScene(start(chapter, "manticore", "duskrunner", { ...TWO, ...flags }), "his_map", context(chapter)).state);
  expect(map({})).toEqual(["force", "show"]);
  expect(map({ olivia_redeemed: true })).toContain("olivia");
  const ending = (flags: Record<string, boolean>) => enterScene(start(chapter, "manticore", "duskrunner", { ...TWO, ...flags }), "keepers_epilogue", context(chapter)).state.narration;
  expect(ending({ temple_island_settled: true })).toContain("where the temple keepers settled it");
  expect(ending({ temple_damaged: true })).toContain("mend their landing");
  expect(ending({ wyrm_ally: true })).toContain("frost wyrm");
  expect(ending({ olivia_ally: true })).toContain("humbled and glad");
  expect(ending({ olivia_rival: true })).toContain("Nobody is cross with her");
});

it("the chime that leaned toward the glacier all campaign hangs straight when it is over", () => {
  expect((chapter.scenes.arrival as { narration: string }).narration).toContain("points straight down into the ice");
  expect((chapter.scenes.chime_straight as { narration: string }).narration).toContain("it hangs straight down");
  const { ends } = allPaths(chapter, "manticore", "duskrunner", TWO);
  expect(ends.filter(e => e.sceneId !== "loss_epilogue").length).toBeGreaterThan(0);
});

it("a lost battle reroutes with partial healing; only a failed recovery reaches Rivers Wander", () => {
  for (const id of ["fight_standard", "fight_standard_braced", "fight_weakened", "fight_weakened_braced"]) {
    const scene = chapter.scenes[id];
    if (scene?.type !== "encounter") throw new Error("Expected fight");
    expect(scene.map).toBe("riftlight_finale");
    expect(scene.onDefeat.goto).toBe("loss_recover");
    expect(scene.onDefeat.effects).toContainEqual({ type: "heal", amount: 3, to: "party" });
    expect(scene.onDefeat.effects).not.toContainEqual(expect.objectContaining({ flag: "final_battle_lost" }));
    expect(scene.onVictory.goto).toBe("spent");
  }
  for (const [id, scene] of Object.entries(chapter.scenes)) {
    if (!id.startsWith("recover_")) continue;
    if (scene.type !== "check") throw new Error("Expected a roll");
    expect(scene.onSuccess.goto).toBe("spent");
    expect(scene.onFailure.goto).toBe("loss_second_failed");
    expect(scene.onFailure.effects).toContainEqual({ type: "setFlag", flag: "final_battle_lost" });
  }
});

it("the third-piece flag is produced only by three actual completed key nodes", () => {
  for (const third of [false, true]) {
    const keys = ["reading-room", "buried-bridge", ...(third ? ["the-island-due-back"] : [])];
    const initial = { ...startJourney(graph), node: "convergence", chapter: "riftlight-convergence", visits: { convergence: 1 }, completions: Object.fromEntries(keys.map(k => [k, 1])) };
    const done = completeVisit(graph, initial, { node: initial.node, chapterId: initial.chapter, visit: initial.visit, outcome: "success", flags: {} }, campaign);
    if (!done.ok) throw new Error(done.message);
    expect(done.journey.flags?.three_fragments_ready === true).toBe(third);
  }
});

it("a Rivers Wander finale ends the journey", () => {
  const initial = { ...startJourney(graph), node: "finale", chapter: chapter.id, visits: { finale: 1 } };
  const done = completeVisit(graph, initial, { node: "finale", chapterId: chapter.id, visit: initial.visit, outcome: "setback", flags: { ending_rivers_wander: true } }, campaign);
  if (!done.ok || done.duplicate) throw new Error("Expected a fresh finale completion");
  expect(done.ended).toBe(true);
  expect(done.journey.status).toBe("ended");
});

it("offers the upriver escape once the guide has checked it at the Bone Yard", () => {
  for (const checked of [false, true]) {
    const initial = { ...startJourney(graph), node: "saltrot-arrival", chapter: "riftlight-saltrot-arrival", visits: { "saltrot-arrival": 1 }, completions: Object.fromEntries(checked ? [["bone-yard", 1]] : []) };
    const done = completeVisit(graph, initial, { node: initial.node, chapterId: initial.chapter, visit: initial.visit, outcome: "success", flags: {} }, campaign);
    if (!done.ok) throw new Error(done.message);
    expect(takeExit(graph, done.journey, { edge: "saltrot-to-ashspan", visit: done.journey.visit }, campaign).ok).toBe(checked);
  }
});

it("keeps the success spine a full climax across party scenarios", () => {
  for (const { shortest } of pacingReport(chapter, undefined, 0).scenarios) {
    expect(shortest!.scenes).toBeGreaterThanOrEqual(30);
    expect(shortest!.decisions + shortest!.checks).toBeGreaterThanOrEqual(14);
    expect(shortest!.longestReadingRun).toBeLessThanOrEqual(3);
    expect(shortest!.encounters).toBe(1);
  }
});
