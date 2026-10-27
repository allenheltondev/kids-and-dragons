import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyEffects, enterScene } from "@kad/shared";
import type { Chapter, CheckScene, ClassId, RunState, SpeciesId } from "@kad/shared";
import { context, send, start } from "./riftlight-test-support.ts";
import { act, landed, miss, promptOf, solve } from "./interaction-play.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const ford = read<Chapter>("content/chapters/gemfall-03c.json");
const road = read<Chapter>("content/chapters/gemfall-04c.json");
const sizes = [1, 2, 4];
const outcomes = ["success", "failure", "assisted"] as const;
type Outcome = typeof outcomes[number];
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);

function initial(chapter: Chapter, size: number, flags: Record<string, boolean> = {}, species: SpeciesId = "manticore", cls: ClassId = "duskrunner") {
  const state = start(chapter, species, cls, flags, size);
  state.campaignId = "gemfall";
  state.coins = 10;
  // The older shared helper seeds Riftlight's chime in chapters 4+. It is not
  // part of a Gemfall household or a substitute for the witch's carried charm.
  for (const member of state.party) member.character.questItems = member.character.questItems.filter(id => id !== "listening_chime");
  return state;
}

/** Complete routes through real story controls. Combat branches are enumerated
 * here; the real-server campaign suite plays their unchanged boards. */
function walk(chapter: Chapter, size: number, picks: Record<string, string>, outcome: Outcome = "success", rollFace = 20, defeat = false, flags: Record<string, boolean> = {}, species: SpeciesId = "manticore", cls: ClassId = "duskrunner") {
  let state = initial(chapter, size, flags, species, cls);
  const trace = new Map<string, RunState>();
  for (let step = 0; state.phase !== "chapter_complete"; step++) {
    expect(step).toBeLessThan(170);
    trace.set(state.sceneId!, structuredClone(state));
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      const branch = defeat ? scene.onDefeat : scene.onVictory;
      state = applyEffects(state, branch.effects ?? [], context(chapter));
      const next = enterScene(state, branch.goto, context(chapter));
      expect(next.error).toBeUndefined(); state = next.state;
    } else if (state.prompt?.kind === "interaction") {
      const result = outcome === "assisted" ? act(chapter, state, { action: "assist" }, promptOf(state).playerIds.at(-1)!)
        : outcome === "failure" ? miss(chapter, state) ?? solve(chapter, state) : solve(chapter, state);
      state = landed(chapter, result, promptOf(result).resolvedActorId ?? promptOf(result).actorId);
    } else if (state.prompt?.kind === "choice") {
      const id = picks[state.sceneId!] ?? state.prompt.options[0]!.id;
      expect(offered(state, id), `${chapter.id}/${state.sceneId}: ${id}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
    } else if (state.prompt?.kind === "roll") state = send(state, { type: "ROLL" }, chapter, rollFace);
    else state = send(state, { type: "ADVANCE" }, chapter);
  }
  if (state.chapterOutcome === "success") for (const step of chapter.goal!.steps) {
    const flags = Array.isArray(step.flag) ? step.flag : [step.flag!];
    expect(flags.some(flag => state.flags[flag]), step.id).toBe(true);
  }
  return { state, trace };
}

const fordPicks = {
  scene_parade: "walk_front", scene_spilled_pannier: "catch", scene_number_pebble: "pocket_pebble",
  choice_runaway_goat: "sort", scene_three_cards: "walk_by", scene_soup_line: "thank_wend",
  scene_queue_jumpers: "call_drovers", scene_relay_message: "sing", scene_family: "fix_wheel",
  scene_dusk_wolves: "leave_be", scene_campfire_play: "tell_true", scene_witch_stall: "real_question",
  scene_tuned_charm: "leave_it", scene_charm_walk: "wolves", scene_crossing_verse: "watch",
};
it.each(sizes.flatMap(size => outcomes.flatMap(outcome => ["wagon", "markers", "family"].map(job => ({ size, outcome, job })))))
  ("ford: $size seats / $outcome / $job changes the crossing or surge recovery", ({ size, outcome, job }) => {
    const { state, trace } = walk(ford, size, {
      ...fordPicks, choice_tolls: job, choice_ford: job === "family" ? "fennick_cart" : job === "markers" ? "follow_markers" : "drovers_pace",
      scene_surge: job === "wagon" ? "wagon_crew" : "let_go",
    }, outcome, 1);
    const swept = job === "markers";
    expect(state.flags.forded_clean === true).toBe(!swept);
    expect(state.flags.marsh_kept_us === true).toBe(swept);
    expect(state.flags.route_wild === true).toBe(swept);
    expect(state.flags.unmired_wagon === true).toBe(job === "wagon");
    expect(state.flags.restored_markers === true).toBe(job === "markers");
    expect(state.flags.helped_family === true).toBe(job === "family");
    expect(trace.has("interaction_surge_brace")).toBe(job === "wagon");
    expect(trace.has("interaction_bracken_crossing")).toBe(job === "family");
    if (job !== "family") expect(offered(trace.get("scene_surge")!, "wagon_crew")).toBe(job === "wagon");
    if (job === "wagon") expect(state.narration).toContain("crew repaid");
    if (job === "family" && outcome === "assisted") expect(state.narration).toContain("Brackens helped balance");
    expect(state.chapterOutcome).toBe("success");
  });

it.each(sizes)("ford: the unfair number still enters the real surge and can reroute at %i seats", size => {
  const { state, trace } = walk(ford, size, { ...fordPicks, scene_three_cards: "join", choice_tolls: "markers", choice_ford: "tamsin_pebble", scene_surge: "let_go" });
  expect(trace.has("check_ford")).toBe(false);
  expect(trace.has("check_ford_easy")).toBe(false);
  expect(trace.get("scene_surge")!.narration).toContain("Number 1");
  expect(state.sceneId).toBe("end_marsh_west");
  expect(state.flags.route_wild).toBe(true);
});

it.each(sizes.flatMap(size => ["give_pebble", "share_cake", "fix_wheel"].map(method => ({ size, method }))))
  ("ford: helping the family by $method earns their actual ride at $size seats", ({ size, method }) => {
    const { state, trace } = walk(ford, size, { ...fordPicks, choice_tolls: "family", scene_family: method, choice_ford: "fennick_cart" }, "assisted");
    expect(state.flags.helped_family).toBe(true);
    expect(trace.has("interaction_bracken_crossing")).toBe(true);
    expect(trace.get("interaction_bracken_crossing")!.narration).not.toContain("repaired cart");
    expect(state.flags.forded_clean).toBe(true);
    if (method === "share_cake") {
      const cakes = (s: RunState) => s.party.flatMap(p => p.character.inventory).filter(item => item.itemId === "honeycake").length;
      expect(cakes(trace.get("scene_dusk_wolves")!)).toBeLessThan(cakes(trace.get("scene_family")!));
    }
  });

it.each(sizes)("ford: a lost late drake fight retains the setback and western road at %i seats", size => {
  const { state, trace } = walk(ford, size, { ...fordPicks, choice_tolls: "family", choice_ford: "drovers_pace", scene_surge: "hold_wagon" }, "success", 1, true);
  expect(trace.has("encounter_drakes")).toBe(true);
  expect(state.sceneId).toBe("end_swept_setback");
  expect(state.chapterOutcome).toBe("setback");
  expect(state.flags.marsh_kept_us).toBe(true);
  expect(state.flags.route_wild).toBe(true);
});

const roadPicks = {
  scene_north_roads: "fall_in", scene_jackalope_race: "cheer", scene_empty_stretch: "keep_walking",
  scene_downbound: "search", scene_stubborn_mule: "unload", rest_soup_tents: "rest_go",
  scene_warden_patrol: "work_passage", scene_depot: "forms", scene_rumor_fire: "true_news",
  scene_bell_courier: "ring_for_her", scene_relay_sing: "listen", scene_road_bend: "wait",
};
it.each(sizes.flatMap(size => outcomes.flatMap(outcome => ["haul", "ask_why"].map(job => ({ size, outcome, job })))))
  ("road: $size seats / $outcome / $job changes the sign or wind task", ({ size, outcome, job }) => {
    const { state, trace } = walk(road, size, {
      ...roadPicks, scene_road_crew: job, scene_signposts: job === "ask_why" ? "checked_detour" : "read_signs",
      scene_ash_wind: job === "haul" ? "crew_screen" : "push_on",
    }, outcome, 20, false, { walked_over: true });
    const crew = job === "haul";
    expect(state.flags.helped_road_crew === true).toBe(crew);
    expect(state.flags.road_detour_checked === true).toBe(!crew);
    expect(trace.has("interaction_relay_signs")).toBe(crew);
    expect(trace.has("scene_signposts_checked")).toBe(!crew);
    expect(trace.has("scene_signposts_pigs")).toBe(crew && outcome === "failure");
    expect(trace.has("interaction_crew_screen")).toBe(crew);
    expect(trace.has("interaction_ash_load")).toBe(!crew);
    expect(offered(trace.get("scene_signposts")!, "checked_detour")).toBe(!crew);
    expect(offered(trace.get("scene_ash_wind")!, "crew_screen")).toBe(crew);
    const before = trace.get("scene_warden_patrol")!.coins;
    expect(trace.get("interaction_gate")!.coins).toBe(before);
    expect(state.flags.road_worked_passage).toBe(true);
    expect(state.flags.road_claim_shared).toBe(true);
    expect(state.flags.road_claim_helped === true).toBe(outcome === "assisted");
    expect(state.party.some(p => p.character.questItems.includes("facet_depot"))).toBe(true);
    expect(state.party.some(p => p.character.questItems.includes("verses_relay_spiral"))).toBe(true);
    expect(offered(trace.get("scene_road_crew")!, "charm")).toBe(false);
    if (crew) expect(state.narration).toContain("took its screen onward");
    expect(state.chapterOutcome).toBe("success");
  });

it.each(sizes)("road: a bill skips the claim, and paying actually spends two coins at %i seats", size => {
  const { state, trace } = walk(road, size, {
    ...roadPicks, scene_road_crew: "ask_why", scene_warden_patrol: "pay", scene_signposts: "checked_detour",
    scene_depot: "bill", scene_ash_wind: "shelter",
  });
  expect(trace.has("interaction_form_nine")).toBe(false);
  expect(state.flags.road_claim_shared).not.toBe(true);
  expect(trace.get("interaction_gate")!.coins).toBe(trace.get("scene_warden_patrol")!.coins! - 2);
  expect(state.flags.road_worked_passage).not.toBe(true);
  expect(state.party.some(p => p.character.questItems.includes("facet_depot"))).toBe(true);
});

it.each(sizes)("road: leaving the depot stone and losing at the bend never restores the stone at %i seats", size => {
  const { state, trace } = walk(road, size, {
    ...roadPicks, scene_road_crew: "ask_why", scene_signposts: "checked_detour", scene_depot: "leave",
    scene_ash_wind: "shelter", scene_road_bend: "drive",
  }, "assisted", 20, true);
  expect(trace.has("scene_depot_leave")).toBe(true);
  expect(state.sceneId).toBe("end_scattered");
  expect(state.chapterOutcome).toBe("setback");
  expect(state.party.every(p => !p.character.questItems.includes("facet_depot"))).toBe(true);
  expect(state.party.some(p => p.character.questItems.includes("verses_relay_spiral"))).toBe(true);
});

it.each(sizes)("failed old preparation rolls do not invent a restored line or a crew favor at %i seats", size => {
  const f = walk(ford, size, { ...fordPicks, choice_tolls: "guess_posts", choice_ford: "drovers_pace", scene_surge: "let_go" }, "success", 1);
  expect(f.state.flags.restored_markers).not.toBe(true);
  expect(offered(f.trace.get("choice_ford")!, "follow_markers")).toBe(false);
  expect(f.state.flags.route_wild).toBe(true);
  const r = walk(road, size, { ...roadPicks, scene_road_crew: "heave_posts", scene_signposts: "read_signs", scene_ash_wind: "push_on" }, "success", 1);
  expect(r.state.flags.helped_road_crew).not.toBe(true);
  expect(offered(r.trace.get("scene_ash_wind")!, "crew_screen")).toBe(false);
  expect(r.state.flags.passed_the_bend).toBe(true);
});

it.each(sizes)("griffin and songkeeper shortcuts still play the later chapter jobs at %i seats", size => {
  const f = walk(ford, size, { ...fordPicks, choice_tolls: "markers_air", choice_ford: "follow_markers" }, "success", 20, false, {}, "griffin", "songkeeper");
  expect(f.trace.has("interaction_ford_posts")).toBe(false);
  expect(f.trace.has("encounter_crabs")).toBe(true);
  expect(f.state.flags.restored_markers).toBe(true);
  expect(f.state.flags.forded_clean).toBe(true);
  const r = walk(road, size, { ...roadPicks, scene_road_crew: "fly", scene_warden_patrol: "griffin_logs", scene_signposts: "read_signs", scene_relay_sing: "lead_verse", scene_ash_wind: "fly_above" }, "success", 20, false, {}, "griffin", "songkeeper");
  expect(r.trace.has("interaction_post_line")).toBe(false);
  expect(r.trace.has("interaction_last_post")).toBe(true);
  expect(r.trace.has("interaction_verses")).toBe(true);
  expect(r.state.flags.sang_a_verse).toBe(true);
  expect(r.state.flags.passed_the_bend).toBe(true);
});

const legacy = read<Record<string, Record<string, CheckScene>>>("tools/content/fixtures/gemfall-ford-road-legacy-checks.json");
it.each([ford, road])("$id still resumes every shipped roll prompt to its original branch", chapter => {
  for (const [id, old] of Object.entries(legacy[chapter.id]!)) {
    expect(chapter.scenes[id], `${chapter.id}/${id}: old roll contract`).toEqual(old);
    const before = structuredClone(chapter); before.scenes[id] = old;
    for (const face of [1, 20]) for (const size of sizes) {
      let state = enterScene(initial(before, size), id, context(before)).state;
      state = JSON.parse(JSON.stringify(state)) as RunState;
      for (let count = 0; state.sceneId === id; count++) {
        expect(count).toBeLessThan(size + 2);
        state = send(state, { type: "ROLL" }, chapter, face);
      }
      expect(state.sceneId).toBe((face === 20 ? old.onSuccess : old.onFailure).goto);
    }
  }
});
