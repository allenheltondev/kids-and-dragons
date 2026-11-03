/**
 * The Stone That Moved (riftlight-stone-counters), rewritten in November 2026
 * to the bar of the pilot (docs/campaigns/continental-rift/arc.md and
 * stone-counters-playtest.md). These tests protect what the party's choices
 * and rolls change, not how many scenes, votes or games there are:
 *
 * - every success ending ticks every goal step, keeps only the Listening
 *   Chime, and asks the campaign question with this chapter's piece;
 * - a slip while gathering the proof leaves Tally unsure, so clearing Pip
 *   takes a roll, and a failed one costs him his spoon until the goodbye;
 * - pushing the Eldest home or leaving it in its old socket changes how the
 *   turnip cart gets past, what Tally draws and what she says at the end;
 * - a stuck stone or a bad bend makes the squeeze past the fold tighter;
 * - what the party learns at the shrinking fold is what the ending can say
 *   about it; the page Pip carries sets stone_route_priority, which the next
 *   valley reads.
 *
 * Route walks play the real story controls through the engine: votes, dice at
 * a chosen face and interactions with real actions.
 */
import { enterScene } from "@kad/shared";
import type { RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-stone-counters")!;
const valley = chapters.get("riftlight-the-wrong-valley")!;
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);

interface Route {
  first: "spoon_pass" | "spoon_fail" | "calm_pass" | "calm_fail";
  grass: "search_pass" | "search_fail" | "wait_success" | "wait_failure";
  trickle: "pass" | "fail";
  under: "rock_pass" | "rock_fail" | "dig_pass" | "dig_fail";
  pebble: "success" | "failure";
  vouch: "pass" | "fail";
  eldest: "push_pass" | "push_fail" | "leave_pass" | "leave_fail";
  // A relay cannot be missed in the engine: carrying by hand is the safe, slow way.
  cart: "time_success" | "time_failure" | "carry";
  goat: "pass" | "fail";
  fold: "peek_pass" | "peek_fail" | "count_pass" | "count_fail";
  page: "plan" | "rubbing";
  seats: 1 | 2 | 4;
}
const ok = (choice: string) => choice === "pass" || choice === "success" || choice.endsWith("_pass") || choice.endsWith("_success");
const head = (choice: string) => choice.split("_")[0]!;

function walk(route: Route, flags: Record<string, boolean> = {}) {
  let state = start(chapter, "manticore", "songkeeper", flags, route.seats);
  const trace = new Map<string, RunState>();
  const face = (choice: string) => (ok(choice) ? 20 : 1);
  const faces: Record<string, number> = {
    check_spoon: face(route.first), check_calm: face(route.first), check_grass: face(route.grass), check_trickle: face(route.trickle),
    check_rock: face(route.under), check_dig: face(route.under), check_vouch: face(route.vouch),
    check_push: face(route.eldest), check_bend: face(route.eldest), check_goat: face(route.goat),
    check_peek: face(route.fold), check_count: face(route.fold),
  };
  const picks: Record<string, string> = {
    the_road: head(route.first), grass: head(route.grass), under: head(route.under), verdict: "show",
    what_now: head(route.eldest), squeeze: head(route.cart), squeeze_tight: head(route.cart),
    fold_window: head(route.fold), fold_small: "count", rest: route.page,
  };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    if (state.prompt?.kind === "interaction") {
      const played = { grass_wind: route.grass, pebble: route.pebble, squeeze_time: route.cart, squeeze_close: route.cart, turnip_relay: route.cart }[state.sceneId as "pebble"] as string | undefined;
      state = finishInteraction(state, chapter, played === undefined || played === "carry" || ok(played) ? "success" : "failure");
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, faces[state.sceneId!] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      const want = picks[state.sceneId!];
      const id = want && offered(state, want) ? want : state.prompt.options[0]!.id;
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
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
  first: "spoon_pass", grass: "search_pass", trickle: "pass", under: "rock_pass", pebble: "success", vouch: "pass",
  eldest: "leave_pass", cart: "time_success", goat: "pass", fold: "count_pass", page: "plan", seats: 1,
};
// The proof the party gathers, and the doubt any slip leaves...
const proof = { first: ["spoon_pass", "spoon_fail", "calm_pass", "calm_fail"], grass: ["search_pass", "search_fail", "wait_success", "wait_failure"],
  trickle: ["pass", "fail"], under: ["rock_pass", "rock_fail", "dig_pass", "dig_fail"], pebble: ["success", "failure"], vouch: ["pass", "fail"], seats: [1, 2, 4] } as const;
// ...and the decisions that change the cart, the fold and the goodbye.
const decisions = { eldest: ["push_pass", "push_fail", "leave_pass", "leave_fail"], cart: ["time_success", "time_failure", "carry"],
  goat: ["pass", "fail"], fold: ["peek_pass", "peek_fail", "count_pass", "count_fail"], page: ["plan", "rubbing"], seats: [1, 2, 4] } as const;
const routes: Route[] = [
  ...pairwise(product(proof), Object.keys(proof), { together: [["first", "grass", "vouch"]] }),
  ...pairwise(product(decisions), Object.keys(decisions), { together: [["eldest", "cart", "goat"]] }),
].map(row => ({ ...DEFAULT, ...row }) as Route);

describe("every route through the Stone That Moved", () => {
  it.each(routes)("$first $grass $trickle $under $pebble vouch:$vouch | $eldest $cart goat:$goat $fold $page, $seats seats", route => {
    const { state, trace } = walk(route);
    const doubt = !ok(route.first) || !ok(route.grass) || route.trickle === "fail" || route.under === "dig_fail" || route.pebble === "failure";
    const forcedHome = route.eldest === "push_pass";
    const tight = route.eldest === "push_fail" || route.eldest === "leave_fail";
    const understood = head(route.eldest) === "leave";

    // The beat: the stone proven to have moved itself, the neighbors past it, every goal step ticked.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    for (const id of ["old_socket", "pebble", "seen", "pip_cleared"]) expect(trace.has(id), id).toBe(true);
    expect(state.narration).toContain("Something is moving the land. What is it? And can you put things right?");
    expect(state.narration).toContain("went back to where it stood long ago");

    // A slip while gathering the proof leaves Tally unsure: no showing, only vouching.
    expect(offered(trace.get("verdict")!, "show")).toBe(!doubt);
    expect(trace.has("check_vouch")).toBe(doubt);
    const spoon = doubt && route.vouch === "fail";
    expect(trace.get("pip_cleared")!.narration.includes("sorry I called you a thief")).toBe(!spoon);
    expect(trace.get("goodbye")!.narration.includes("hands Pip his spoon")).toBe(spoon);
    // A rock that falls back on a toe costs a heart.
    const socket = trace.get("old_socket")!;
    expect(socket.party.some(p => p.hp < p.character.maxHp)).toBe(route.under === "rock_fail");

    // Force or understand: how the cart gets past, and what Tally is left with.
    expect(trace.has("creak")).toBe(forcedHome);
    expect(trace.has("check_goat")).toBe(forcedHome);
    expect(trace.has("squeeze")).toBe(!forcedHome && !tight);
    expect(trace.has("squeeze_tight")).toBe(tight);
    expect(trace.has("stuck")).toBe(route.eldest === "push_fail");
    if (!forcedHome) {
      expect(trace.has(route.cart.startsWith("carry") ? "turnip_relay" : tight ? "squeeze_close" : "squeeze_time")).toBe(true);
    }
    // Rolling the cart between the tugs risks a sack of turnips; carrying them is safe and slow.
    const slow = !forcedHome && route.cart === "carry";
    const waved = trace.get(slow ? "past_slow" : "past")!.narration;
    expect(waved.includes("Minus a few")).toBe(!forcedHome && route.cart === "time_failure");
    expect(waved.includes("looking back for her hat")).toBe(forcedHome && route.goat === "fail");
    const goodbye = trace.get("goodbye")!.narration;
    expect(goodbye.includes("push it back every morning")).toBe(forcedHome);
    expect(goodbye.includes("stuck sideways across the road")).toBe(route.eldest === "push_fail");
    expect(goodbye.includes("Twelve, in a new shape")).toBe(understood);
    if (route.page === "plan") {
      const plan = trace.get("route_copy")!.narration;
      expect(plan.includes("old socket")).toBe(understood);
      expect(plan.includes("back in the ring")).toBe(forcedHome);
      expect(plan.includes("stuck sideways")).toBe(route.eldest === "push_fail");
    }

    // The shrinking fold: what the party learned there is what the ending can say.
    // After the slow carry the fold is too small to peek through.
    expect(trace.has("past_slow")).toBe(slow);
    expect(trace.has("fold_small")).toBe(slow);
    expect(trace.has("fold_window")).toBe(!slow);
    const counted = route.fold === "count_pass" || (slow && route.fold === "peek_pass");
    expect(state.narration.includes("not a minute more")).toBe(counted);
    expect(state.narration.includes("far downhill, by a big river")).toBe(route.fold === "peek_pass" && !slow);
    expect(state.flags.stone_route_priority).toBe(route.page === "plan");
  });
});

it("the fold visibly shrinks as the chapter goes on", () => {
  const sizes: [string, string][] = [["the_road", "as tall as a door"], ["under", "the height of a pony"], ["what_now", "size of a cartwheel"], ["fold_window", "size of a window"]];
  for (const [id, size] of sizes) expect((chapter.scenes[id] as { narration: string }).narration, id).toContain(size);
  for (const [id] of sizes) expect(chapter.scenes[id], id).toMatchObject({ rift: "steady" });
  // The shrinking fold is the graph's one-visit opening toward Ashspan, and the ending says it will not wait.
  expect(campaign.graph!.edges["counters-shrinking-fold"]).toMatchObject({ from: "stone-counters", rift: { lasts: { unit: "visits", count: 1 } } });
  expect((chapter.scenes.ending as { narration: string }).narration).toContain("Take it now, or it's gone");
});

it("Seren teaches Attune on a first strand, and only greets a party that already has it", () => {
  for (const taught of [false, true]) {
    let state = start(chapter, "kitsune", "starweaver", taught ? { attune_taught: true } : {});
    state = enterScene(state, "lesson", context(chapter)).state;
    expect(state.narration.includes("taught you before")).toBe(taught);
    expect(state.narration.includes("is called Attune")).toBe(!taught);
    state = send(state, { type: "CHOOSE", choiceId: "listen" }, chapter);
    expect(state.flags.attune_taught).toBe(true);
  }
});

it("every authored outcome, for every species and class shortcut, reaches the beat", () => {
  for (const [species, cls] of [["manticore", "duskrunner"], ["bigfoot", "thornguard"], ["kitsune", "starweaver"], ["unicorn", "songkeeper"]] as const) {
    for (const flags of [{}, { attune_taught: true }] as Record<string, boolean>[]) {
      const { ends, visited } = allPaths(chapter, species, cls, flags, 1, 1);
      for (const end of ends) {
        expect(end.chapterOutcome).toBe("success");
        for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
        expect(end.flags.attune_taught).toBe(true);
        expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
        expect(end.party[0]!.down).toBe(false);
      }
      expect(ends.some(e => e.flags.stone_route_priority === true)).toBe(true);
      expect(ends.some(e => e.flags.stone_route_priority === false)).toBe(true);
      expect(visited.has("sniff")).toBe(species === "manticore");
      expect(visited.has("bigfoot_carry")).toBe(species === "bigfoot");
      expect(visited.has("dusk_run")).toBe(cls === "duskrunner");
      expect(visited.has("attuned")).toBe(cls === "starweaver");
    }
  }
});

it("a bigfoot's carry is still forcing the stone: it creaks back toward the road", () => {
  let state = start(chapter, "bigfoot", "thornguard");
  state = enterScene(state, "what_now", context(chapter)).state;
  state = send(state, { type: "CHOOSE", choiceId: "carry" }, chapter);
  expect(state.sceneId).toBe("bigfoot_carry");
  expect(state.flags.counters_forced).toBe(true);
  state = send(state, { type: "CHOOSE", choiceId: "count" }, chapter);
  state = send(state, { type: "CHOOSE", choiceId: "on" }, chapter);
  expect(state.sceneId).toBe("creak");
});

it("the chapter's discovery is one p2 scene on every path, and nothing claims a p1", () => {
  const priority = Object.entries(chapter.scenes).filter(([, s]) => "priority" in s && s.priority);
  expect(priority.map(([id, s]) => [id, (s as { priority: number }).priority])).toEqual([["old_socket", 2]]);
  const narration = (chapter.scenes.old_socket as { narration: string }).narration;
  expect(narration).toContain("older than the counting ring");
  expect(narration).toContain("toward the far white glacier");
  expect(allPaths(chapter, "manticore", "duskrunner").ends.every(e => e.flags.counters_found_socket)).toBe(true);
});

it("the road plan is the page that makes the next valley's reading easier", () => {
  for (const carried of [false, true]) {
    const state = enterScene(start(valley, "manticore", "duskrunner", { stone_route_priority: carried }), "look", context(valley)).state;
    expect(offered(state, "plan")).toBe(carried);
    expect(offered(state, "map")).toBe(true);
  }
  expect(valley.scenes.check_plan).toMatchObject({ type: "check", tn: 8 });
  expect(valley.scenes.check_map).toMatchObject({ type: "check", tn: 12 });
});

it("journey flags: only attune_taught and stone_route_priority leave the chapter", () => {
  const journey = new Set(campaign.graph!.flags);
  const written = new Set<string>();
  for (const m of JSON.stringify(chapter).matchAll(/"type":"setFlag","flag":"([a-z_]+)"/g)) written.add(m[1]!);
  expect([...written].filter(f => journey.has(f)).sort()).toEqual(["attune_taught", "stone_route_priority"]);
});
