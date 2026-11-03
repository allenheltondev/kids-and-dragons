/**
 * A Bridge Without a River (riftlight-buried-bridge), the Restless Coast's key
 * node, rewritten in November 2026 for the campaign rewrite
 * (docs/campaigns/continental-rift/arc.md and buried-bridge-playtest.md). These
 * tests protect what the party's choices change, not how many scenes, votes or
 * games there are:
 *
 * - every success ending ticks every goal step and learns the Coast fragment
 *   (fragment_coast_learned) in its own p1 scene, with only the chime carried;
 * - sharing the chime with Orin is a real choice: it sets orin_chime_shared and
 *   costs the chime's help at the tide; keeping it means Orin climbs to measure;
 * - digging (force) scrapes the carvings and buries the high path home; washing
 *   (understand) keeps them and soaks everyone;
 * - at the tide the party saves Orin's drawings or Pip's notebook, and the
 *   ending says which; a failed roll reroutes and costs, and never loses the beat.
 */
import { enterScene } from "@kad/shared";
import type { RunState } from "@kad/shared";
import { describe, expect, it } from "vitest";
import { pairwise } from "./pairwise.ts";
import { allPaths, campaign, chapters, context, finishInteraction, send, start } from "./riftlight-test-support.ts";

const chapter = chapters.get("riftlight-buried-bridge")!;
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);
const ok = (choice: string) => choice.endsWith("_pass") || choice.endsWith("_success");
const head = (choice: string) => choice.split("_")[0]!;

type Route = {
  walk: "hop_pass" | "hop_fail" | "posts_pass" | "posts_fail";
  chime: "share" | "keep";
  pip: "call_pass" | "call_fail" | "grab_pass" | "grab_fail";
  silt: "dig_pass" | "dig_fail" | "wash_success" | "wash_failure";
  measure: "pole_pass" | "pole_fail" | "spot_pass" | "spot_fail" | "count_pass" | "count_fail";
  follow: "hurry_pass" | "hurry_fail" | "crest_pass" | "crest_fail";
  tide: "drawings_pass" | "drawings_fail" | "notebook_pass" | "notebook_fail" | "footing_pass" | "footing_fail";
  rest: "think" | "door";
  home: "high_pass" | "high_fail" | "low_pass" | "low_fail";
  seats: 1 | 2 | 4;
}

function walk(route: Route) {
  let state = start(chapter, "manticore", "duskrunner", {}, route.seats);
  const trace = new Map<string, RunState>();
  const face = (choice: string) => (ok(choice) ? 20 : 1);
  const faces: Record<string, number> = {
    check_hop: face(route.walk), check_posts: face(route.walk), check_call: face(route.pip), check_grab: face(route.pip),
    check_dig: face(route.silt), check_pole: face(route.measure), check_spot: face(route.measure), check_count: face(route.measure),
    check_follow: face(route.follow), check_crest: face(route.follow),
    save_drawings: face(route.tide), save_notebook: face(route.tide), check_footing: face(route.tide),
    check_high: face(route.home), check_low: face(route.home),
  };
  const picks: Record<string, string> = {
    walk_out: head(route.walk), orin: route.chime, pip_runs: head(route.pip), silt_choice: head(route.silt),
    measure: head(route.measure), follow: head(route.follow) === "hurry" ? "hurry" : "crest", tide: head(route.tide),
    rest: route.rest, home: head(route.home),
  };
  for (let steps = 0; state.phase !== "chapter_complete"; steps++) {
    expect(steps, `${state.sceneId}`).toBeLessThan(80);
    trace.set(state.sceneId!, structuredClone(state));
    if (state.prompt?.kind === "interaction") {
      state = finishInteraction(state, chapter, state.sceneId === "wash_out" && route.silt === "wash_failure" ? "failure" : "success");
    } else if (state.prompt?.kind === "roll") {
      state = send(state, { type: "ROLL" }, chapter, faces[state.sceneId!] ?? 20);
    } else if (state.prompt?.kind === "choice") {
      const want = picks[state.sceneId!];
      expect(want === undefined || offered(state, want), `${state.sceneId}: ${want}`).toBe(true);
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
const DEFAULT: Route = { walk: "hop_pass", chime: "share", pip: "call_pass", silt: "wash_success", measure: "count_pass", follow: "hurry_pass", tide: "drawings_pass", rest: "think", home: "high_pass", seats: 1 };
const valid = (r: Route) => !(head(r.measure) === "pole" && r.chime !== "share")
  && !(head(r.measure) === "spot" && r.chime !== "keep")
  && !(head(r.tide) === "footing" && r.chime !== "keep")
  && !(head(r.home) === "high" && head(r.silt) === "dig");
const decisions = { chime: ["share", "keep"], silt: ["dig_pass", "dig_fail", "wash_success", "wash_failure"],
  measure: ["pole_pass", "pole_fail", "spot_pass", "spot_fail", "count_pass", "count_fail"],
  tide: ["drawings_pass", "drawings_fail", "notebook_pass", "notebook_fail", "footing_pass", "footing_fail"],
  home: ["high_pass", "high_fail", "low_pass", "low_fail"], seats: [1, 2, 4] } as const;
const others = { walk: ["hop_pass", "hop_fail", "posts_pass", "posts_fail"], pip: ["call_pass", "call_fail", "grab_pass", "grab_fail"],
  follow: ["hurry_pass", "hurry_fail", "crest_pass", "crest_fail"], rest: ["think", "door"], seats: [1, 2, 4] } as const;
const rows = (axes: Record<string, readonly unknown[]>) => product(axes).map(row => ({ ...DEFAULT, ...row }) as Route).filter(valid);
const routes: Route[] = [
  ...pairwise(rows(decisions), Object.keys(decisions) as (keyof Route)[], { together: [["chime", "measure", "tide"], ["silt", "home"]] }),
  ...pairwise(rows(others), Object.keys(others) as (keyof Route)[]),
];

describe("every route under the buried bridge", () => {
  it.each(routes)("$walk $chime $pip $silt $measure $follow $tide $rest $home, $seats seats", route => {
    const { state, trace } = walk(route);
    const ending = state.narration;
    const shared = route.chime === "share";

    // The beat: the bridge studied, the Coast fragment learned, the chime decided.
    expect(state.chapterOutcome).toBe("success");
    for (const step of chapter.goal!.steps) expect(state.flags[step.flag as string], step.id).toBe(true);
    expect(state.flags.fragment_coast_learned).toBe(true);
    expect(state.flags.orin_chime_shared === true).toBe(shared);
    expect(state.party.flatMap(p => p.character.questItems)).toEqual(["listening_chime"]);
    expect(state.party.every(p => !p.down && p.hp > 0)).toBe(true);
    expect(trace.get("old_river")!.narration).toContain("A river ran right here, long ago, when the land was a different shape.");
    expect(ending).toContain("this bridge stands where a river ran when the land was a different shape");
    expect(ending).toContain("What is it? And can you put things right?");

    // Sharing the chime: Orin's pole or Orin's climb, the chime's help at the tide, and who has the readings.
    const measure = trace.get("measure")!;
    expect(offered(measure, "pole")).toBe(shared);
    expect(offered(measure, "spot")).toBe(!shared);
    expect(offered(trace.get("tide")!, "footing")).toBe(!shared);
    expect(trace.get("north")!.narration.includes("Orin gives your chime back")).toBe(shared);
    expect(ending.includes("Orin tucks your chime readings under his wing")).toBe(shared);
    expect(ending.includes("I'll take your word for the lean")).toBe(!shared);

    // Dig or wash: the carvings, the soaking and the high path home.
    const dug = head(route.silt) === "dig";
    const under = trace.get("under_arch")!;
    expect(under.narration.includes("scratched to dust")).toBe(dug);
    expect(under.narration.includes("carved fish")).toBe(!dug);
    if (!dug) expect(under.party.every(p => p.hp < p.character.maxHp)).toBe(true);
    expect(offered(trace.get("home")!, "high")).toBe(!dug);

    // A tight measurement only stays exact if its drawings come through the tide.
    const keptDrawings = route.tide === "drawings_pass" || route.tide === "footing_pass";
    const exact = ok(route.measure) && keptDrawings;
    expect(state.flags.bridge_exact === true).toBe(exact);
    expect(ending.includes("His copy is exact.")).toBe(exact);
    expect(ending.includes("near enough")).toBe(!exact);
    expect(trace.get("old_river")!.narration.includes("Your exact measurement")).toBe(exact);

    // Orin's drawings or Pip's notebook.
    const notebook = head(route.tide) !== "drawings";
    expect(ending.includes("Pip runs ahead with his notebook")).toBe(notebook);
    expect(ending.includes("drawing it all again from memory")).toBe(!notebook);
    expect(trace.get("pip_after")!.narration.includes("Lady Olivia will think I found nothing")).toBe(!notebook);
    expect(trace.has("both_saved")).toBe(route.tide === "footing_pass");

    // Pip on the stone: a failed roll breaks the guides' rule, and Puddle has to tell.
    expect(trace.has("pip_falls")).toBe(!ok(route.pip));
    expect(ending.includes("Puddle has to tell Grandmother")).toBe(!ok(route.pip));

    // Failed crossings and climbs cost a knock, and still arrive.
    expect(trace.get("bank")!.party.some(p => p.hp < p.character.maxHp)).toBe(!ok(route.walk));
    expect(trace.get("riverbed_end")!.narration).toContain("runs straight into a grassy hill");
    expect(trace.has("door")).toBe(route.rest === "door");
  });
});

it("every authored outcome, for every species and class shortcut, learns the fragment", { timeout: 120_000 }, () => {
  for (const [species, cls] of [["manticore", "duskrunner"], ["griffin", "duskrunner"], ["bigfoot", "thornguard"], ["unicorn", "songkeeper"], ["kitsune", "starweaver"]] as const) {
    const { ends, visited } = allPaths(chapter, species, cls, {}, 1, 1);
    for (const end of ends) {
      expect(end.chapterOutcome).toBe("success");
      for (const step of chapter.goal!.steps) expect(end.flags[step.flag as string]).toBe(true);
      expect(end.flags.fragment_coast_learned).toBe(true);
      expect(end.party[0]!.character.questItems).toEqual(["listening_chime"]);
    }
    expect(ends.some(e => e.flags.orin_chime_shared === true)).toBe(true);
    expect(ends.some(e => e.flags.orin_chime_shared !== true)).toBe(true);
    for (const id of ["pip_falls", "dug_slow", "washed_twice", "measured_rough", "drawings_soaked", "notebook_soggy", "both_saved", "door"]) expect(visited.has(id), `${species}: ${id}`).toBe(true);
    expect(visited.has("fly_rope")).toBe(species === "griffin");
    expect(visited.has("bigfoot_smash")).toBe(species === "bigfoot");
    expect(visited.has("manticore_call")).toBe(species === "manticore");
    expect(visited.has("thornguard_brace")).toBe(cls === "thornguard");
  }
});

it("a thornguard digs without scraping, but the dug silt still blocks the high path", () => {
  let state = enterScene(start(chapter, "bigfoot", "thornguard"), "silt_choice", context(chapter)).state;
  state = send(state, { type: "CHOOSE", choiceId: "brace" }, chapter);
  expect(state.flags.bridge_dug).toBe(true);
  expect(state.flags.bridge_scraped).not.toBe(true);
  state = send(state, { type: "CHOOSE", choiceId: "look" }, chapter);
  expect(state.narration).toContain("carved fish");
  expect(enterScene(state, "home", context(chapter)).state.prompt).toMatchObject({ kind: "choice" });
  const home = enterScene(state, "home", context(chapter)).state;
  expect(offered(home, "high")).toBe(false);
});

it("the Coast fragment is one p1 scene, and the arches are the stone The Borrowed Ruins recognizes", () => {
  const p1 = Object.entries(chapter.scenes).filter(([, s]) => "priority" in s && s.priority === 1);
  expect(p1.map(([id]) => id)).toEqual(["old_river"]);
  const setters = Object.entries(chapter.scenes).filter(([, s]) => JSON.stringify(s).includes("\"flag\":\"fragment_coast_learned\""));
  expect(setters.map(([id]) => id)).toEqual(["old_river"]);
  const bank = start(chapter, "manticore", "duskrunner");
  const view = enterScene(bank, "bank", context(chapter)).state.narration;
  expect(view).toContain("gray stone with white specks, like salt on bread");
  expect(view).toContain("a waterline carved high up");
  // The pilot's p1 depends on exactly these words.
  const ruins = chapters.get("riftlight-bone-yard")!.scenes.same_stone!;
  expect("narration" in ruins && ruins.narration).toContain("same waterline, carved high up");
  // The chapter writes only its own contract flags into the journey.
  const journey = new Set(campaign.graph!.flags);
  const written = new Set([...JSON.stringify(chapter).matchAll(/"type":"setFlag","flag":"([a-z_]+)"/g)].map(m => m[1]!));
  expect([...written].filter(f => journey.has(f)).sort()).toEqual(["fragment_coast_learned", "orin_chime_shared"]);
});
