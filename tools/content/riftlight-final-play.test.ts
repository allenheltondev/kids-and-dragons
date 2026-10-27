import { applyEffects, completeVisit, enterScene, parseCampaignGraph, startJourney } from "@kad/shared";
import type { Chapter, RunState } from "@kad/shared";
import { expect, it } from "vitest";
import { campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";
type Outcome = "success" | "failure" | "assisted";
const scored = new Set(["memory", "sequence", "tracking", "timing", "precision"]);
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);
function walk(chapter: Chapter, initial: RunState, choose: (s: RunState) => string | undefined, outcome: Outcome, battle: "victory" | Outcome = "victory", override?: (s: RunState) => Outcome | undefined) {
  let state = initial;
  const trace = new Map<string, RunState>();
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${chapter.id}/${state.sceneId}`).toBeLessThan(100);
    trace.set(state.sceneId!, structuredClone(state));
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      // Complete story/control routes enumerate declared encounter outcomes;
      // the actual four boards and their turn costs have separate tests.
      const branch = battle === "victory" ? scene.onVictory : scene.onDefeat;
      state = applyEffects(state, [...(battle === "victory" ? scene.environment?.objectives?.[0]?.effects ?? [] : []), ...(branch.effects ?? [])], context(chapter));
      const next = enterScene(state, branch.goto, context(chapter)); expect(next.error).toBeUndefined(); state = next.state;
    } else if (state.prompt?.kind === "interaction") {
      const recovery = ["loss_anchor_check", "loss_anchor_supported"].includes(state.sceneId!);
      const result = override?.(state) ?? (recovery && battle !== "victory" ? battle : scored.has(state.prompt.spec.kind) ? outcome : "success");
      state = finishInteraction(state, chapter, result);
    } else if (state.prompt?.kind === "choice") {
      const id = choose(state) ?? state.prompt.options[0]!.id;
      expect(offered(state, id), `${state.sceneId}/${id}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
    } else throw Error(`Unexpected ${state.sceneId}/${state.prompt?.kind}`);
  }
  trace.set(state.sceneId!, structuredClone(state));
  expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
  expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
  for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.label).toBe(true);
  expect(chapter.estimatedMinutes).toBe(30);
  return { state, trace };
}
const pathFlags = ["fragment_paths_learned", "fragment_coast_learned", "fragment_sky_learned"];
const learnedSets = [[0, 1], [0, 2], [1, 2], [0, 1, 2]].map(ids => Object.fromEntries(pathFlags.map((f, i) => [f, ids.includes(i)])));
const conv = chapters.get("riftlight-convergence")!;
const comparisonChoices = [
  { id: "paths_coast", scene: "compare_paths_coast", flags: [pathFlags[0]!, pathFlags[1]!] },
  { id: "paths_sky", scene: "compare_paths_sky", flags: [pathFlags[0]!, pathFlags[2]!] },
  { id: "coast_sky", scene: "compare_coast_sky", flags: [pathFlags[1]!, pathFlags[2]!] },
];
const convCases = learnedSets.flatMap(known => ["guided", ...comparisonChoices.filter(c => c.flags.every(f => known[f])).map(c => c.id)].flatMap(source =>
  ["sheets", "line"].flatMap(setup => ["bram", "olivia", "orin"].flatMap(decision => [false, true].flatMap(trust =>
    (["success", "failure", "assisted"] as const).flatMap(outcome => [1, 2, 4].map(seats => ({ known, source, setup, decision, trust, outcome, seats }))))))));
it.each(convCases)("convergence $source/$setup/$decision/trust:$trust/$outcome/$seats", route => {
  const result = walk(conv, start(conv, "manticore", "duskrunner", { ...route.known, olivia_trusted: route.trust, orin_chime_shared: route.decision === "orin" }, route.seats), s => {
    if (s.sceneId === "accounts") return route.source;
    if (s.sceneId === "measure") return route.setup;
    if (s.sceneId === "decision") return route.decision;
    if (s.sceneId === "lesson") return route.outcome === "success" ? offered(s, "prop") ? "prop" : "retrieve" : "team";
    return undefined;
  }, route.outcome);
  const { state, trace } = result;
  for (const option of comparisonChoices) expect(offered(trace.get("accounts")!, option.id)).toBe(option.flags.every(f => route.known[f]));
  expect(offered(trace.get("decision")!, "orin")).toBe(route.decision === "orin");
  expect(trace.has("bram_clear")).toBe(route.decision !== "olivia");
  expect(trace.has("olivia_watch")).toBe(route.decision === "olivia");
  expect(trace.has("orin_account")).toBe(route.decision === "orin");
  expect(trace.has("retrieve_prop")).toBe(route.setup === "line" && route.outcome === "success");
  expect(offered(trace.get("lesson")!, "prop")).toBe(route.setup === "sheets");
  expect(trace.has("cord_help")).toBe(route.outcome !== "success");
  expect(state.flags.converge_cord_compared).toBe(route.outcome === "success");
  expect(state.flags.manipulate_learned).toBe(true);
  expect(trace.get("ending")!.narration.includes("credited to Seren")).toBe(route.outcome !== "success");
  const graph = parseCampaignGraph(campaign).graph!;
  const initial = { ...startJourney(graph), node: "convergence", chapter: conv.id, visits: { convergence: 1 } };
  const done = completeVisit(graph, initial, { node: "convergence", chapterId: conv.id, visit: initial.visit, outcome: "success", flags: state.flags }, campaign);
  expect(done.ok).toBe(true); if (!done.ok) throw Error(done.message);
  const standing = route.trust ? route.decision === "olivia" ? "ally" : "redeemed" : "rival";
  expect(["ally", "redeemed", "rival"].filter(id => done.journey.flags?.[`olivia_${id}`])).toEqual([standing]);
  expect(done.journey.flags?.pip_stayed_back === true).toBe(route.decision !== "olivia");
});
it.each([1, 2, 4])("starweaver replaces only the condition-practice job at %i seats", seats => {
  const { trace, state } = walk(conv, start(conv, "kitsune", "starweaver", learnedSets[0], seats), s => s.sceneId === "lesson" ? "starweaver" : undefined, "success");
  expect(trace.has("count_check")).toBe(true); expect(trace.has("cord_release")).toBe(true);
  expect(trace.has("lesson_attuned")).toBe(true); expect(trace.has("lesson_team")).toBe(false); expect(trace.has("lesson_prop")).toBe(false);
  expect(state.flags.manipulate_learned).toBe(true);
});
const final = chapters.get("riftlight-finale")!;
const campaigns: { name: string; known: Record<string, boolean>; support: string; extra: Record<string, boolean> }[] = [
  { name: "paths-coast-wyrm", known: learnedSets[0]!, support: "wyrm", extra: { wyrm_ally: true } },
  { name: "paths-sky-olivia", known: learnedSets[1]!, support: "olivia", extra: { olivia_ally: true } },
  { name: "coast-sky-reserve", known: learnedSets[2]!, support: "reserve", extra: {} },
  { name: "all-three", known: learnedSets[3]!, support: "third", extra: { three_fragments_ready: true } },
];
const finalCases = campaigns.flatMap(campaign => ["brace", "rescue"].flatMap(prep => ["line", "marks"].flatMap(route => ["case", "open"].flatMap(map =>
  (["victory", "success", "failure", "assisted"] as const).flatMap(battle => (["success", "failure", "assisted"] as const).flatMap(outcome =>
    [1, 2, 4].map(seats => ({ campaign, prep, route, map, battle, outcome, seats }))))))));
it.each(finalCases)("finale $campaign.name/$prep/$route/$map/$battle/$outcome/$seats", row => {
  const fate = row.seats === 1 ? "ice" : "listen";
  const first = row.seats === 1 ? "plan_1" : row.campaign.known.fragment_paths_learned ? "plan_2" : row.seats === 2 ? "plan_3" : "plan_4";
  const { state, trace } = walk(final, start(final, "manticore", "duskrunner", { ...row.campaign.known, ...row.campaign.extra }, row.seats), s => {
    const picks: Record<string, string> = { retreat: row.route, map_shelter: row.map, remember: first, hold_condition: row.prep, anchors: row.campaign.support, fate };
    if (s.sceneId === "standard_plan" || s.sceneId === "support_ready") return offered(s, "braced") ? "braced" : "continue";
    if (s.sceneId === "loss_watch") return offered(s, "line") ? "line" : offered(s, "marks") ? "marks" : "plan_1";
    if (s.sceneId === "loss_anchor_plan") return offered(s, "supported") ? "supported" : "brace";
    if (s.sceneId === "home_now") return offered(s, "case") ? "case" : "map";
    return picks[s.sceneId!];
  }, row.outcome, row.battle);
  const battleScene = `fight_${row.campaign.support === "reserve" ? "standard" : "weakened"}${row.prep === "brace" ? "_braced" : ""}`;
  expect([...trace.keys()].filter(id => id.startsWith("fight_"))).toEqual([battleScene]);
  expect(trace.has("map_shelter_changed")).toBe(row.map === "open" && row.outcome === "failure");
  expect(state.flags.final_map_wet === true).toBe(row.map === "open" && row.outcome === "failure");
  expect(trace.has("retreat_help")).toBe(row.route === "marks" && row.outcome !== "success");
  expect(trace.has("remember_paths")).toBe(first === "plan_2");
  expect(trace.has("remember_coast")).toBe(first === "plan_3");
  expect(trace.has("remember_sky")).toBe(first === "plan_4");
  expect(trace.has("third_account")).toBe(row.campaign.support === "third");
  expect(trace.has("wyrm_support")).toBe(row.campaign.support === "wyrm");
  expect(trace.has("olivia_support")).toBe(row.campaign.support === "olivia");
  const fell = row.battle !== "victory", failed = row.battle === "failure";
  expect(state.flags.final_fell_back === true).toBe(fell);
  expect(state.flags.third_anchor_used === true).toBe(!fell && row.campaign.support !== "reserve");
  expect(state.flags.final_battle_lost === true).toBe(failed);
  expect(state.chapterOutcome).toBe(failed ? "setback" : "success");
  expect(state.flags[failed ? "ending_rivers_wander" : fate === "ice" ? "ending_keepers" : "ending_listened"]).toBe(true);
  expect(trace.has("unpack_map")).toBe(!failed && row.map === "case");
  if (!failed) expect(trace.get(fate === "ice" ? "keepers" : "listened")!.narration.includes("scar on the map")).toBe(fell);
  if (fell) {
    expect(offered(trace.get("loss_anchor_plan")!, "supported")).toBe(row.prep === "rescue");
    expect(offered(trace.get("loss_anchor_plan")!, "reserve")).toBe(row.campaign.support === "reserve");
    expect(trace.has("loss_line")).toBe(row.route === "line");
  }
});
it.each([1, 2, 4])("keeping the reserve team enables a real supported closing job at %i seats", seats => {
  const { state, trace } = walk(final, start(final, "manticore", "duskrunner", learnedSets[0], seats), s => {
    if (s.sceneId === "loss_anchor_plan") return "reserve";
    return undefined;
  }, "failure", "failure");
  expect(trace.has("loss_anchor_reserved")).toBe(true);
  expect(trace.has("loss_anchor_check")).toBe(false);
  expect(state.chapterOutcome).toBe("success"); expect(state.flags.final_battle_lost).not.toBe(true);
});
it("a later missed cloth recall reroutes to the watcher lamp without revisiting the board", () => {
  const { trace } = walk(final, start(final, "manticore", "duskrunner", learnedSets[0]), s => s.sceneId === "retreat" ? "marks" : s.sceneId === "loss_watch" ? "marks" : undefined, "success", "success", s => s.sceneId === "loss_marks" ? "failure" : undefined);
  expect(trace.has("loss_marks")).toBe(true); expect(trace.has("loss_lamp")).toBe(true);
  expect([...trace.keys()].filter(id => id.startsWith("fight_"))).toHaveLength(1);
});
it.each([1, 2, 4])("starweaver replaces brace balancing but preserves the regional anchor work at %i seats", seats => {
  const { trace } = walk(final, start(final, "kitsune", "starweaver", learnedSets[0], seats), s => s.sceneId === "hold_condition" ? "starweaver" : s.sceneId === "standard_plan" ? "braced" : undefined, "success");
  expect(trace.has("hold_condition_3")).toBe(true); expect(trace.has("hold_condition_check")).toBe(false);
  expect(trace.has("first_anchor")).toBe(true); expect(trace.has("fight_standard_braced")).toBe(true);
});
it("a prepared rescue station changes a real near-edge recovery input", () => {
  const outcomes = [];
  for (const id of ["loss_anchor_check", "loss_anchor_supported"]) {
    let state = enterScene(start(final, "manticore", "duskrunner", learnedSets[0]), id, context(final)).state;
    if (state.prompt?.kind !== "interaction") throw Error("Expected interaction");
    const actor = state.prompt.actorId;
    state = send(state, { type: "INTERACT", openedSeq: state.prompt.openedSeq, attempt: state.prompt.attempt, action: "start", relaxed: false }, final);
    if (state.prompt?.kind !== "interaction") throw Error("Expected started interaction");
    state = send(state, { type: "INTERACT", openedSeq: state.prompt.openedSeq, attempt: state.prompt.attempt, action: "stop", position: .75 }, final);
    if (state.prompt?.kind !== "interaction") throw Error("Expected result");
    outcomes.push(state.prompt.outcome);
  }
  expect(outcomes).toEqual(["failure", "success"]);
});
