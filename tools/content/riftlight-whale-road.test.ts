/**
 * The Whales' Turning Place (riftlight-whale-road), rewritten in November 2026
 * against docs/campaigns/continental-rift/arc.md. These tests protect what the
 * party's choices change, not how many scenes, votes or games there are:
 *
 * - every success ending ticks every goal step, keeps the Listening Chime as the
 *   only quest item, walks past the chime's lean, and asks the campaign question
 *   with this chapter's piece (the openings come in pairs, and something pulls them);
 * - hauling Hiccup out (force) or singing him out in the quiet beat (understand)
 *   changes who stays, the herd's trust, the dawn lead and the night's way out;
 * - startling the herd, by a failed test, a forced rescue or a dropped bell, makes
 *   the dawn's road song longer;
 * - a failed roll reroutes and costs something, and the chapter still reaches its beat;
 * - Pip's choice (Olivia's bell or Juniper's lanterns) changes the dawn and the decision;
 * - the contract: whales_guided is set only on the gentle ending, sky_followup_promised
 *   is set true or false on every path, and the chapter never makes Lady Olivia's choice
 *   itself: olivia_trusted / whales_scattered are left to the rift action on the map.
 *
 * Route walks play the real story controls through the engine: votes, dice at a
 * chosen face and interactions with real actions.
 */
import { completeVisit, parseCampaignGraph, riftState, startJourney, takeRiftAction } from "@kad/shared";
import type { RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, campaign, chapters, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-whale-road")!;
const graph = parseCampaignGraph(campaign).graph!;
const offered = (s: RunState | undefined, id: string) => s?.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);

interface Route {
  tip: "posts_pass" | "posts_fail" | "yarn_pass" | "yarn_fail";
  look: "listen_pass" | "listen_fail" | "rope_pass" | "rope_fail";
  test: "hum_pass" | "hum_fail" | "toss_pass" | "toss_fail";
  calf: "haul_pass" | "haul_fail" | "sing_pass" | "sing_fail";
  tug: "ropes_pass" | "ropes_fail" | "stones_pass" | "stones_fail";
  pip: "bell_pass" | "bell_fail" | "lanterns";
  rest: "rest" | "notebook";
  lead: "sing" | "lanterns" | "pip" | "hiccup";
  led: "pass" | "fail";
  promise: "report" | "local";
  decide: "stay" | "sleep";
  night: "pass" | "fail" | "olivia" | "juniper";
  seats: 1 | 2 | 4;
}
const ok = (choice: string) => choice.endsWith("_pass");
const head = (choice: string) => choice.split("_")[0]!;

/** Plays one route through the engine and keeps the state at every scene it passed. */
function walk(route: Route) {
  let state = start(chapter, "manticore", "duskrunner", {}, route.seats);
  const trace = new Map<string, RunState>();
  const face = (choice: string) => (ok(choice) ? 20 : 1);
  const faces: Record<string, number> = {
    check_posts: face(route.tip), check_yarn: face(route.tip),
    check_listen: face(route.look), check_ropewalk: route.look === "rope_fail" ? 1 : 20,
    check_hum: face(route.test), check_haul: face(route.calf),
    check_tether: face(route.tug), check_anchor: face(route.tug), check_bell: face(route.pip),
    check_lantern: route.led === "pass" ? 20 : 1, check_lantern_pip: route.led === "pass" ? 20 : 1,
    lead_night: route.night === "fail" ? 1 : 20,
  };
  const games: Record<string, "success" | "failure"> = {
    toss: route.test === "toss_fail" ? "failure" : "success",
    quiet_beat: route.calf === "sing_fail" ? "failure" : "success",
    sing_road: route.led === "pass" ? "success" : "failure",
    sing_road_wary: route.led === "pass" ? "success" : "failure",
  };
  const night = route.night === "olivia" || route.night === "juniper" ? route.night : undefined;
  const picks: Record<string, string> = {
    low_pass: head(route.tip), turn_watch: route.look === "listen_pass" || route.look === "listen_fail" ? "listen" : "rope",
    echo_test: head(route.test), calf_stuck: head(route.calf), island_tug: head(route.tug), pip_bell: head(route.pip),
    rest: route.rest, promise: route.promise, sleep_on_it: night ?? "olivia",
  };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    const id = state.sceneId!;
    if (state.prompt?.kind === "interaction") {
      state = finishInteraction(state, chapter, games[id] ?? "success");
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, faces[id] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      let want = picks[id];
      if (id === "lead_test") {
        const spooked = state.flags.whale_herd_spooked === true;
        want = route.lead === "sing" ? (spooked ? "sing_wary" : "sing") : route.lead;
        if (!offered(state, want)) want = spooked ? "sing_wary" : "sing";
      }
      if (id === "decide") want = route.decide === "sleep" ? "sleep" : offered(state, "stay_hiccup") ? "stay_hiccup" : "stay";
      const choice = want && offered(state, want) ? want : state.prompt.options[0]!.id;
      state = send(state, { type: "CHOOSE", choiceId: choice }, chapter);
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
const DEFAULT: Route = {
  tip: "posts_pass", look: "listen_pass", test: "hum_pass", calf: "sing_pass", tug: "ropes_pass", pip: "lanterns", rest: "rest",
  lead: "sing", led: "pass", promise: "report", decide: "sleep", night: "olivia", seats: 1,
};
// The decisions that carry through to the dawn and the decision, in every pairing...
const decisions = {
  test: ["hum_pass", "hum_fail", "toss_pass", "toss_fail"], calf: ["haul_pass", "haul_fail", "sing_pass", "sing_fail"],
  pip: ["bell_pass", "bell_fail", "lanterns"], lead: ["sing", "lanterns", "pip", "hiccup"], led: ["pass", "fail"],
  promise: ["report", "local"], decide: ["stay", "sleep"], night: ["pass", "fail", "olivia", "juniper"], seats: [1, 2, 4],
} as const;
// ...and the early rolls and the island's lurch, whose costs are their own.
const early = {
  tip: ["posts_pass", "posts_fail", "yarn_pass", "yarn_fail"], look: ["listen_pass", "listen_fail", "rope_pass", "rope_fail"],
  tug: ["ropes_pass", "ropes_fail", "stones_pass", "stones_fail"], rest: ["rest", "notebook"], seats: [1, 2, 4],
} as const;
const routes: Route[] = [
  ...pairwise(product(decisions), Object.keys(decisions), { together: [["calf", "lead", "decide"], ["test", "calf", "pip", "lead"]] }),
  ...pairwise(product(early), Object.keys(early)),
].map(row => ({ ...DEFAULT, ...row }) as Route);

describe("every route through the Whales' Turning Place", () => {
  it.each(routes)("$tip $look $test $calf $tug $pip $rest $lead/$led $promise $decide/$night, $seats seats", route => {
    const { state, trace } = walk(route);
    const forced = route.calf.startsWith("haul");
    const trusts = route.calf === "sing_pass";
    const spooked = route.test === "hum_fail" || route.test === "toss_fail" || forced || route.pip === "bell_fail";
    const stay = route.decide === "stay";

    // The beat: every goal step ticked, the chime kept, the lean witnessed, the question asked.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    expect(trace.get("chime_lean")!.narration).toContain("back toward the glacier");
    expect(state.narration).toContain("the openings come in pairs, and something keeps pulling them");
    expect(state.narration).toContain("Something is moving the land. What is it? And can you put things right?");

    // A failed early roll costs something, or sends the party the long way.
    expect(trace.get("whale_eye")!.party.some(p => p.hp < p.character.maxHp)).toBe(!ok(route.tip));
    expect(trace.get("rest")!.narration.includes("Row one")).toBe(route.tip === "yarn_fail");
    expect(trace.has("check_ropewalk")).toBe(route.look !== "listen_pass");
    expect(trace.get("pair_seen")!.party.some(p => p.hp < p.character.maxHp)).toBe(!ok(route.tip) || route.look === "rope_fail");

    // Force or understand: who stays, who trusts you, and what the dawn and the night offer.
    expect(trace.has("hauled")).toBe(forced);
    expect(trace.has(route.calf === "sing_fail" ? "sung_slow" : "sung_out")).toBe(!forced);
    const offer = trace.get("olivia_offer")!.narration;
    expect(offer.includes("Pip is still staring after Hiccup")).toBe(forced);
    expect(offer.includes("At sunset, Lady Olivia trots back")).toBe(!forced);
    expect(trace.get("lead_test")!.narration.includes("notched fin")).toBe(route.calf === "haul_fail");
    expect(offered(trace.get("lead_test"), "hiccup")).toBe(trusts);
    expect(offered(trace.get("decide"), "stay_hiccup")).toBe(trusts);
    expect(offered(trace.get("decide"), "stay")).toBe(!trusts);
    if (stay) expect(trace.has(trusts ? "hiccup_night" : "lead_night")).toBe(true);

    // A startled herd makes the dawn's road song longer.
    expect(offered(trace.get("lead_test"), "sing_wary")).toBe(spooked);
    expect(offered(trace.get("lead_test"), "sing")).toBe(!spooked);
    expect(trace.get("lead_test")!.narration.includes("still remembers yesterday")).toBe(spooked);

    // The island's lurch costs supper.
    const cakes = route.tug.endsWith("_fail");
    expect(trace.get("rest")!.narration.includes("emergency oat bars")).toBe(cakes);
    expect(trace.get("rest")!.narration.includes("barley cakes, warm and sticky")).toBe(!cakes);

    // Pip's choice: Olivia's bell, or Juniper's lanterns.
    expect(offered(trace.get("lead_test"), "pip")).toBe(route.pip === "lanterns");
    expect(trace.get("two_ways")!.narration.includes("I hung it")).toBe(route.pip !== "lanterns");
    expect(trace.get("decide")!.narration.includes(route.pip === "lanterns" ? "his own lantern still in his paws" : "his hand on the rope")).toBe(true);
    expect(trace.get("two_ways")!.narration.includes("moved again last night")).toBe(route.rest === "notebook");

    // The dawn lead: a miss still leads Billow out, slowly.
    const balked = trace.has("billow_balks");
    if (trace.has("hiccup_leads")) expect(balked).toBe(false);
    else expect(balked).toBe(route.led === "fail");

    // The contract: the chapter guides the whales only if the party stays; the rest is the map's.
    expect(state.flags.whales_guided === true).toBe(stay);
    expect(state.flags.sky_followup_promised).toBe(route.promise === "report");
    expect(state.flags.olivia_trusted).toBeUndefined();
    expect(state.flags.whales_scattered).toBeUndefined();
    expect(trace.has(stay ? "guided" : "wait_ending")).toBe(true);
    if (stay && !trusts) expect(state.narration.includes("past noon")).toBe(route.night === "fail");
    if (!stay) {
      expect(state.narration).toContain("Lady Olivia's way, quick and loud, or the whales' way, slow and quiet");
      const heard = route.night === "juniper" ? "Juniper's lantern" : "we decide where they go";
      expect(state.narration).toContain(heard);
    }
  });
});

it("every authored outcome, for every species and class shortcut, reaches the beat", () => {
  for (const [species, cls] of [["manticore", "duskrunner"], ["griffin", "duskrunner"], ["bigfoot", "thornguard"], ["unicorn", "songkeeper"], ["kitsune", "starweaver"]] as const) {
    const { ends, visited } = allPaths(chapter, species, cls, {}, 1, 1);
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
      expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
      expect(end.party[0]!.down).toBe(false);
      expect([true, false]).toContain(end.flags.sky_followup_promised);
    }
    expect(visited.has("check_fly")).toBe(species === "griffin");
    expect(visited.has("check_leap")).toBe(cls === "duskrunner");
    expect(visited.has("check_read")).toBe(cls === "starweaver");
    expect(visited.has("check_lullaby")).toBe(cls === "songkeeper");
    expect(visited.has("check_brace")).toBe(cls === "thornguard");
    for (const id of ["hauled", "sung_out", "sung_slow", "billow_balks", "hiccup_leads", "guided", "wait_ending"]) expect(visited.has(id), `${species}: ${id}`).toBe(true);
  }
});

it("staying guides the whales and opens the pair; sleeping on it leaves both ways on the map", () => {
  const { ends } = allPaths(chapter, "manticore", "duskrunner");
  for (const guided of [true, false]) {
    const end = ends.find(e => (e.sceneId === "guided") === guided)!;
    expect(end.flags.whales_guided === true).toBe(guided);
    const initial = { ...startJourney(graph), node: "whale-road", chapter: chapter.id, visits: { "whale-road": 1 } };
    const done = completeVisit(graph, initial, { node: "whale-road", chapterId: chapter.id, visit: 1, outcome: "success", flags: end.flags }, campaign);
    if (!done.ok) throw new Error(done.message);
    expect(riftState(graph, "whales-to-coast", done.journey)?.status === "open").toBe(guided);
    const olivia = takeRiftAction(graph, done.journey, { action: "open", edge: "whales-to-coast", way: "olivia", visit: 1 }, campaign);
    expect(olivia.ok).toBe(!guided);
    if (!guided) {
      if (!olivia.ok) throw new Error(olivia.message);
      expect(olivia.journey.flags).toMatchObject({ olivia_trusted: true, whales_scattered: true });
      const gentle = takeRiftAction(graph, done.journey, { action: "open", edge: "whales-to-coast", way: "guide", visit: 1 }, campaign);
      if (!gentle.ok) throw new Error(gentle.message);
      expect(gentle.journey.flags?.whales_guided).toBe(true);
    }
  }
});

it("Lady Olivia's offer is made fairly, and right about something, before the party chooses", () => {
  const { visited } = allPaths(chapter, "manticore", "duskrunner");
  for (const id of ["olivia_here", "olivia_offer", "island_tug", "juniper_answer", "two_ways"]) expect(visited.has(id)).toBe(true);
  const text = (id: string) => (chapter.scenes[id] as { narration: string }).narration;
  expect(text("olivia_here")).toContain("\"Linked,\"");
  expect(text("olivia_offer")).toContain("Look how tired she is");
  expect(text("island_tug")).toContain("Half awake, and tugging");
  expect(text("juniper_answer")).toContain("She's right that they're tired");
  expect(text("juniper_answer")).toContain("island due back");
  expect(text("two_ways")).toContain("I don't like waiting");
  // Nobody is cast as a villain, and the whales are never fought or ridden.
  expect(Object.values(chapter.scenes).some(s => s.type === "encounter")).toBe(false);
  expect(JSON.stringify(chapter.scenes)).not.toMatch(/\b(ride|riding|saddle up|attack)\b/i);
});

it("introduces Keeper Juniper and the whales, and the chapter's clue is one quiet p2", () => {
  const entry = chapter.scenes[chapter.entry] as { narration: string; discovers?: string[]; cast?: { figure: string; name?: string }[] };
  expect(entry.narration).toContain("Keeper Juniper");
  expect(entry.narration).toContain("Why are they circling? And how do we let them go?");
  expect(entry.discovers).toEqual(["creature.cloud_whale"]);
  expect(entry.cast).toContainEqual({ figure: "cast/island_keeper", name: "Keeper Juniper" });
  const priority = Object.entries(chapter.scenes).filter(([, s]) => "priority" in s && s.priority);
  expect(priority.map(([id, s]) => [id, (s as { priority: number }).priority])).toEqual([["chime_lean", 2]]);
});
