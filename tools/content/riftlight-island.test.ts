/**
 * The Island Due Back (riftlight-the-island-due-back), the Wandering Sky's key
 * node, rewritten in November 2026 to the Borrowed Ruins pilot's bar
 * (docs/campaigns/continental-rift/arc.md and island-continuity-review.md).
 * These tests protect what the party's choices change, not how many scenes,
 * votes or games there are:
 *
 * - every success ending ticks every goal step, keeps only the Listening Chime
 *   and carries the Sky fragment, which the p1 scene states plainly;
 * - guided whales give the keepers their sign (a free sighting and a safe
 *   crossing); scattered or circling whales leave the party to the dice;
 * - saving Tumble's letters or Juniper's signal frame decides who can carry
 *   the warning later, and tying the island down costs the frame and the stone;
 * - a failed roll reroutes and costs something, and the chapter still reaches
 *   its beat;
 * - the three island flags the temple reads are set exactly when they mean
 *   what squall-temple says they mean.
 */
import { completeVisit, enterScene, parseCampaignGraph, startJourney, takeExit, takeRiftAction } from "@kad/shared";
import type { RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-the-island-due-back")!;
const graph = parseCampaignGraph(campaign).graph!;
const offered = (s: RunState | undefined, id: string) => s?.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);
const hurt = (s: RunState) => s.party.some(p => p.hp < p.character.maxHp);

interface Route {
  whales: "guided" | "scattered" | "circling";
  spot: "tower_pass" | "tower_fail" | "sticks_pass" | "sticks_fail" | "whales";
  gust: "letters_pass" | "letters_fail" | "frame_pass" | "frame_fail";
  cross: "walk_pass" | "walk_fail" | "crawl_pass" | "crawl_fail" | "whales_success" | "whales_failure";
  hen: "keep" | "leave";
  explore: "orchard_pass" | "orchard_fail" | "ridge_pass" | "ridge_fail";
  copy: "success" | "chase_pass" | "chase_fail";
  hold: "tie_pass" | "tie_fail" | "run_pass" | "run_fail" | "swing_pass" | "swing_fail" | "line";
  word: "warn_best" | "warn_hand" | "welcome";
  pip: "doubt" | "loyal";
  seats: 1 | 2 | 4;
}
const ok = (choice: string) => choice.endsWith("_pass") || choice.endsWith("_success");
const head = (choice: string) => choice.split("_")[0]!;
const whaleFlags = (w: Route["whales"]): Record<string, boolean> => w === "guided" ? { whales_guided: true } : w === "scattered" ? { whales_scattered: true, olivia_trusted: true } : {};

/** Plays one route through the engine and keeps the state at every scene it passed. */
function walk(route: Route) {
  let state = start(chapter, "manticore", "duskrunner", whaleFlags(route.whales), route.seats);
  const trace = new Map<string, RunState>();
  const face = (choice: string) => (ok(choice) ? 20 : 1);
  const faces: Record<string, number> = {
    check_tower: face(route.spot), check_sticks: face(route.spot), wrong_side: 20,
    check_letters: face(route.gust), check_frame: face(route.gust),
    check_walk: route.cross === "whales_failure" ? 20 : face(route.cross), check_crawl: face(route.cross),
    check_orchard: face(route.explore), check_ridge: face(route.explore), check_chase: face(route.copy),
    check_tie: face(route.hold), check_snap: 20, check_return: face(route.hold), check_swing: face(route.hold),
  };
  const picks: Record<string, string> = {
    spot: head(route.spot), gust: head(route.gust), crossing: head(route.cross), pip_hen: route.hen,
    explore: head(route.explore), hold: route.hold.startsWith("tie") ? "tie" : "go",
    run_back: route.hold === "line" ? "line" : head(route.hold), rest: route.word === "welcome" ? "welcome" : "warn", farewell: route.pip,
  };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    if (state.prompt?.kind === "interaction") {
      const result = state.sceneId === "copy" ? (route.copy === "success" ? "success" : "failure")
        : state.sceneId === "whale_note" ? (route.cross === "whales_success" ? "success" : "failure") : "success";
      state = finishInteraction(state, chapter, result);
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, faces[state.sceneId!] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      let want = picks[state.sceneId!];
      if (state.sceneId === "dispatch") want = route.word === "warn_hand" ? "hand" : ["tumble", "frame", "hand"].find(id => offered(state, id));
      expect(!want || offered(state, want), `${state.sceneId}/${want}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: want ?? state.prompt.options[0]!.id }, chapter);
    } else {
      state = send(state, { type: "ADVANCE" }, chapter);
    }
  }
  trace.set(state.sceneId!, structuredClone(state));
  return { state, trace };
}

const product = <T extends Record<string, readonly unknown[]>>(axes: T) =>
  Object.entries(axes).reduce<Record<string, unknown>[]>((rows, [key, values]) =>
    rows.flatMap(row => values.map(value => ({ ...row, [key]: value }))), [{}]);
const valid = (r: Route) => (r.whales === "guided" || (r.spot !== "whales" && !r.cross.startsWith("whales"))) && (r.hold !== "line" || r.gust === "letters_pass");
const DEFAULT: Route = {
  whales: "circling", spot: "tower_pass", gust: "letters_pass", cross: "walk_pass", hen: "leave", explore: "orchard_pass",
  copy: "success", hold: "run_pass", word: "warn_best", pip: "loyal", seats: 1,
};
// The choices that decide what reaches the temple, every pair of them together...
const decisions = { whales: ["guided", "scattered", "circling"], gust: ["letters_pass", "letters_fail", "frame_pass", "frame_fail"],
  hold: ["tie_pass", "tie_fail", "run_pass", "run_fail", "swing_pass", "swing_fail", "line"], word: ["warn_best", "warn_hand", "welcome"],
  pip: ["doubt", "loyal"], seats: [1, 2, 4] } as const;
// ...and the rolls and games along the way, whose costs and reroutes are their own.
const early = { whales: ["guided", "scattered", "circling"], spot: ["tower_pass", "tower_fail", "sticks_pass", "sticks_fail", "whales"],
  cross: ["walk_pass", "walk_fail", "crawl_pass", "crawl_fail", "whales_success", "whales_failure"], hen: ["keep", "leave"],
  explore: ["orchard_pass", "orchard_fail", "ridge_pass", "ridge_fail"], copy: ["success", "chase_pass", "chase_fail"], seats: [1, 2, 4] } as const;
const routes: Route[] = [
  ...pairwise(product(decisions).map(row => ({ ...DEFAULT, ...row }) as Route).filter(valid) as unknown as Record<string, unknown>[], Object.keys(decisions), { together: [["gust", "hold", "word"]] }),
  ...pairwise(product(early).map(row => ({ ...DEFAULT, ...row }) as Route).filter(valid) as unknown as Record<string, unknown>[], Object.keys(early)),
] as unknown as Route[];

describe("every route to the island due back", () => {
  it.each(routes)("$whales $spot $gust $cross $hen $explore $copy $hold $word $pip, $seats seats", route => {
    const { state, trace } = walk(route);
    const tied = route.hold.startsWith("tie");
    const lettersSaved = route.gust === "letters_pass";
    const frameSaved = route.gust === "frame_pass" && !tied;

    // The beat: the island met, its stone copied, the Sky fragment carried home.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    expect(state.flags.fragment_sky_learned).toBe(true);
    expect(trace.has("mooring_stone")).toBe(true);

    // Whales the party guided clear give the keepers their sign; scattered or circling whales do not.
    const guided = route.whales === "guided";
    expect(offered(trace.get("spot"), "whales")).toBe(guided);
    expect(offered(trace.get("crossing"), "whales")).toBe(guided);
    expect(trace.get("arrival")!.narration.includes("whales have scattered")).toBe(route.whales === "scattered");
    expect(trace.get("spotted")!.narration.includes("calling for its family")).toBe(route.whales === "scattered");
    expect(trace.has("whales_lead")).toBe(route.spot === "whales");
    expect(trace.has("check_tower") || trace.has("check_sticks")).toBe(route.spot !== "whales");

    // A missed sighting puts the board on the wrong side, and somebody hauls it.
    expect(trace.has("wrong_side")).toBe(route.spot.endsWith("_fail"));
    // A missed crossing costs Pip his notebook, and the stone scene knows it.
    const notebookLost = route.cross.endsWith("_fail");
    expect(state.flags.isle_notebook_lost === true).toBe(notebookLost);
    expect(trace.get("stone")!.narration.includes("no notebook now")).toBe(notebookLost);
    expect(trace.has("check_walk")).toBe(route.cross.startsWith("walk") || route.cross === "whales_failure");
    if (route.cross.endsWith("_fail")) expect(hurt(trace.get("on_island")!)).toBe(true);
    expect(trace.has("lost_orchard")).toBe(route.explore === "orchard_fail");
    expect(trace.has("check_chase")).toBe(route.copy !== "success");

    // The hen goes home by herself if Pip takes her.
    expect(trace.get("back")!.narration.includes("She just wanted to go home")).toBe(route.hen === "keep");

    // Saving the letters or the frame decides who can carry a warning.
    expect(state.flags.island_messages_saved === true).toBe(lettersSaved);
    expect(offered(trace.get("run_back"), "line")).toBe(!tied && lettersSaved);
    if (trace.has("dispatch")) {
      expect(offered(trace.get("dispatch"), "tumble")).toBe(lettersSaved && route.hold !== "line");
      expect(offered(trace.get("dispatch"), "frame")).toBe(frameSaved);
    }

    // Force or understand: a rope holds the island but costs the frame and the stone.
    expect(trace.has("tied")).toBe(tied);
    expect(trace.has("check_snap")).toBe(tied);
    expect(trace.has("run_back")).toBe(!tied);
    expect(state.narration.includes("stone's eye is cracked")).toBe(tied);

    // What reaches the temple, as squall-temple reads it.
    const warned = route.word !== "welcome";
    const noQuickCarrier = !(lettersSaved && route.hold !== "line") && !frameSaved;
    expect(state.flags.island_warning_sent === true).toBe(warned);
    expect(state.flags.island_relay_delayed === true).toBe(warned && (route.word === "warn_hand" || noQuickCarrier));
    expect(trace.has("welcome_rung")).toBe(!warned);
    expect(state.narration.includes("still hopping along the stepping islands")).toBe(state.flags.island_relay_delayed === true);

    // The close pays Pip's choice and asks the campaign question with the island's piece.
    expect(state.narration.includes(route.pip === "doubt" ? "folded note" : "planning what to tell Lady Olivia")).toBe(true);
    expect(state.narration).toContain("its old stone shows the land below in an older shape");
    expect(state.narration).toContain("What is it? And can you put things right?");
  });
});

it.each([false, true])("the real whale-road rift action reaches the island with the right sign: scattered=%s", scattered => {
  const initial = { ...startJourney(graph), node: "whale-road", chapter: "riftlight-whale-road", visits: { "whale-road": 1 } };
  const done = completeVisit(graph, initial, { node: initial.node, chapterId: initial.chapter, visit: 1, outcome: "success", flags: {} }, campaign);
  if (!done.ok) throw new Error(done.message);
  const opened = takeRiftAction(graph, done.journey, { action: "open", edge: "whales-to-coast", way: scattered ? "olivia" : "guide", visit: 1 }, campaign);
  if (!opened.ok) throw new Error(opened.message);
  const entered = takeExit(graph, opened.journey, { edge: "whales-to-island", visit: 1 }, campaign);
  if (!entered.ok) throw new Error(entered.message);
  let state = start(chapter, "manticore", "duskrunner", entered.journey.flags as Record<string, boolean>);
  expect(state.narration.includes("whales have scattered")).toBe(scattered);
  expect(state.narration.includes("whales you guided clear")).toBe(!scattered);
  state = enterScene(state, "spot", context(chapter)).state;
  expect(offered(state, "whales")).toBe(!scattered);
  state = enterScene(state, "crossing", context(chapter)).state;
  expect(offered(state, "whales")).toBe(!scattered);
});

it("every authored outcome, for every species and class shortcut, reaches the beat with the fragment", () => {
  for (const [species, cls, flags] of [["manticore", "duskrunner", {}], ["griffin", "songkeeper", { whales_guided: true }], ["bigfoot", "thornguard", { whales_scattered: true }], ["kitsune", "starweaver", {}]] as const) {
    const { ends, visited } = allPaths(chapter, species, cls, flags, 1, 1);
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
      expect(end.flags.fragment_sky_learned).toBe(true);
      expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
      expect(end.party[0]!.down).toBe(false);
    }
    for (const id of ["wrong_side", "lost_orchard", "check_chase", "tied", "check_snap", "tumble_line", "by_hand", "welcome_rung"]) expect(visited.has(id), `${species}: ${id}`).toBe(true);
    expect(visited.has("fly_look")).toBe(species === "griffin");
    expect(visited.has("leap")).toBe(cls === "duskrunner");
    expect(visited.has("whales_lead")).toBe("whales_guided" in flags);
  }
});

it("the chapter's discovery is one p1 scene, said plainly, and nothing gives it away before", () => {
  const p1 = Object.entries(chapter.scenes).filter(([, s]) => "priority" in s && s.priority === 1);
  expect(p1.map(([id]) => id)).toEqual(["mooring_stone"]);
  const narration = (p1[0]![1] as { narration: string }).narration;
  expect(narration).toContain("land far below");
  expect(narration).toContain("the land below in an older shape");
  expect(narration).toContain("doesn't match Master Orin's map");
  const { trace } = walk(DEFAULT);
  for (const [id, s] of trace) {
    if (id === "mooring_stone") break;
    expect(s.narration, id).not.toMatch(/older shape|the way it lay/);
  }
  // The chime leans hard toward the glacier, and Juniper answers the chapter's question.
  expect(trace.get("pull")!.narration).toContain("toward the glacier");
  expect(trace.get("pull")!.narration).toContain("Something is pulling it.");
});

it("writes only the contract's journey flags, and none of the old island bookkeeping", () => {
  const journey = new Set(campaign.graph!.flags);
  const written = new Set([...JSON.stringify(chapter).matchAll(/"type":"setFlag","flag":"([a-z_]+)"/g)].map(m => m[1]!));
  expect([...written].filter(f => journey.has(f)).sort()).toEqual(["fragment_sky_learned", "island_messages_saved", "island_relay_delayed", "island_warning_sent"]);
  // The whales' history is read, never rewritten here.
  expect(written.has("whales_guided") || written.has("whales_scattered") || written.has("olivia_trusted")).toBe(false);
});

it("points at the convergence only for a party carrying another key's piece", () => {
  const ending = (flags: Record<string, boolean>) => enterScene(start(chapter, "kitsune", "starweaver", flags), "ending", context(chapter)).state.narration;
  expect(ending({})).not.toContain("another piece");
  expect(ending({ fragment_paths_learned: true })).toContain("another piece");
  expect(ending({ fragment_coast_learned: true })).toContain("another piece");
  expect(ending({ fragment_paths_learned: true, fragment_coast_learned: true }).match(/another piece/g)).toHaveLength(1);
});
