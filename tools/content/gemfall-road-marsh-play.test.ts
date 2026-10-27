import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyEffects, enterScene } from "@kad/shared";
import type { Chapter, CheckScene, RunState } from "@kad/shared";
import { context, send, start } from "./riftlight-test-support.ts";
import { act, landed, miss, promptOf, solve } from "./interaction-play.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const road = read<Chapter>("content/chapters/gemfall-03a.json");
const marsh = read<Chapter>("content/chapters/gemfall-03b.json");
type Outcome = "success" | "failure" | "assisted";
const offered = (s: RunState, id: string) => s.prompt?.kind === "choice" && s.prompt.options.some(o => o.id === id);

/** Complete story routes use real votes, rolls and interaction controls.
 * Encounter outcomes are enumerated here; real server campaign playthroughs
 * separately play their unchanged boards and numbers. */
function walk(chapter: Chapter, size: number, picks: Record<string, string>, outcome: Outcome, defeat = false) {
  let state = start(chapter, "manticore", "duskrunner", {}, size);
  state.campaignId = "gemfall";
  const trace = new Map<string, RunState>();
  for (let step = 0; state.phase !== "chapter_complete"; step++) {
    expect(step).toBeLessThan(160);
    trace.set(state.sceneId!, structuredClone(state));
    const scene = chapter.scenes[state.sceneId!]!;
    if (scene.type === "encounter") {
      const result = defeat ? scene.onDefeat : scene.onVictory;
      state = applyEffects(state, result.effects ?? [], context(chapter));
      const entered = enterScene(state, result.goto, context(chapter));
      expect(entered.error).toBeUndefined(); state = entered.state;
    } else if (state.prompt?.kind === "interaction") {
      const resolved = outcome === "assisted"
        ? act(chapter, state, { action: "assist" }, promptOf(state).playerIds.at(-1)!)
        : outcome === "failure" ? miss(chapter, state) ?? solve(chapter, state) : solve(chapter, state);
      state = landed(chapter, resolved, promptOf(resolved).resolvedActorId ?? promptOf(resolved).actorId);
    } else if (state.prompt?.kind === "choice") {
      const id = picks[state.sceneId!] ?? state.prompt.options[0]!.id;
      expect(offered(state, id), `${chapter.id}/${state.sceneId}: ${id}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
    } else if (state.prompt?.kind === "roll") state = send(state, { type: "ROLL" }, chapter);
    else state = send(state, { type: "ADVANCE" }, chapter);
  }
  for (const step of chapter.goal!.steps) {
    const flags = Array.isArray(step.flag) ? step.flag : [step.flag!];
    expect(flags.some(flag => state.flags[flag]), step.id).toBe(true);
  }
  return { state, trace };
}
const sizes = [1, 2, 4];
const outcomes: Outcome[] = ["success", "failure", "assisted"];
it.each(sizes.flatMap(size => outcomes.flatMap(outcome => ["by_water", "by_goat", "by_brass"].map(camp => ({ size, outcome, camp })))))
  ("Long Mile: $size seats / $outcome / $camp carries preparation to the actual bank", ({ size, outcome, camp }) => {
    const { state, trace } = walk(road, size, {
      scene_east_road: "restore", scene_kettle_camp: "swap_kindling", scene_stuck_wagon: "unload",
      scene_river_view: "watch_heron", scene_queue: "let_it_go", scene_skip_passes: "no_thanks",
      scene_first_story: "help_ending", scene_troll: "tell_story", scene_gem_toll: "lift_gem",
      scene_troll_hum: "answer_honest", choice_camp_spot: camp, rest_queue_camp: "to_bank",
      scene_night_rope: camp === "by_brass" ? "sit_on_rope" : "grab_rope", scene_wake_fee: "pay_fish",
      scene_crossing_bank: camp === "by_water" ? "slow_line" : camp === "by_goat" ? "night_line" : "wade",
    }, outcome);
    const wet = outcome === "failure";
    expect(state.flags.river_took_us === true).toBe(wet);
    expect(state.flags.crossed_dry === true).toBe(!wet);
    expect(trace.has("scene_mouth")).toBe(wet);
    expect(state.party.flatMap(p => p.character.questItems).includes("ossley_reed_knot")).toBe(wet);
    expect(trace.has("interaction_crossing_prepared")).toBe(camp !== "by_brass");
    expect(trace.has("scene_night_rope_sit_on_rope")).toBe(camp === "by_brass");
    expect(state.flags.markers_helped === true).toBe(outcome === "assisted");
    expect(state.flags.heron_line === true).toBe(outcome !== "failure");
    expect(state.chapterOutcome).toBe("success");
  });

it.each(sizes.flatMap(size => outcomes.flatMap(outcome => ["north", "road"].flatMap(exit => ["rubbing", "hum"].map(record => ({ size, outcome, exit, record }))))))
  ("Marsh: $size seats / $outcome / $exit / $record preserves evidence and the chosen road", ({ size, outcome, exit, record }) => {
    // Read the actual authored ids rather than inventing route-set effects.
    const exitScene = marsh.scenes.choice_exit!;
    if (!("choices" in exitScene)) throw Error("Expected exit vote");
    const exitChoice = exitScene.choices!.find(c => c.goto === (exit === "north" ? "scene_west_branch" : "scene_reed_edge"))!.id;
    const { state, trace } = walk(marsh, size, {
      scene_poling_in: "pole_on", scene_ribbon_line: "duck", scene_boggart_isle: "offer",
      scene_boggart_clue: "lost", scene_toll_reeds: "story", scene_barge: "inspect",
      scene_act_closed: "leave", rest_reed_raft: "on", scene_fog_bank: "lookout", scene_tussock: "haul",
      scene_wisp_lead: "please", scene_old_steps: "frog", scene_gate_hum: "step_back",
      choice_gate_record: record, scene_nan_washtub: exit, choice_exit: exitChoice,
      scene_west_branch: record === "hum" ? "practiced" : "ceremony", scene_reed_edge: "prospectors",
    }, outcome);
    expect(trace.has("encounter_mimic")).toBe(false);
    expect(state.flags.named_the_mimic).toBe(true);
    expect(trace.has("interaction_tussock_balance")).toBe(true);
    expect(state.flags.rescued_prospectors).toBe(true);
    expect(state.flags.gate_record_checked === true).toBe(record === "rubbing");
    expect(state.flags.gate_record_helped === true).toBe(record === "rubbing" && outcome === "assisted");
    if (record === "rubbing") expect(state.narration).toContain(outcome === "assisted" ? "Gullet's help" : "checked rubbing");
    else expect(state.narration).toContain("without a paper rubbing");
    expect(state.flags.walked_over === true).toBe(exit === "road");
    expect(state.flags.route_rush === true).toBe(exit === "road");
    expect(state.flags.forded_clean === true).toBe(exit === "north" && outcome !== "failure");
    expect(state.flags.marsh_kept_us === true).toBe(exit === "north" && outcome === "failure");
    expect(trace.has("scene_reed_edge_prospectors")).toBe(exit === "road");
    expect(state.chapterOutcome).toBe("success");
  });

it.each([road, marsh])("$id preparation widens a real timing result without erasing misses", chapter => {
  const ids = chapter === road ? ["interaction_crossing", "interaction_crossing_prepared"] : ["interaction_weir_song", "interaction_weir_practiced"];
  const results = ids.map(id => {
    let state = enterScene(start(chapter, "unicorn", "songkeeper"), id, context(chapter)).state;
    const actor = promptOf(state).actorId;
    state = act(chapter, state, { action: "start", relaxed: false }, actor);
    state = act(chapter, state, { action: "stop", position: .7 }, actor);
    return promptOf(state).outcome;
  });
  expect(results).toEqual(["failure", "success"]);
});

it.each(sizes)("checked fog landing avoids the boarding task at %i seats", size => {
  for (const light of [false, true]) {
    const { trace } = walk(marsh, size, {
      scene_barge: "inspect", scene_fog_bank: light ? "light" : "lookout", scene_tussock: "checked_landing",
      scene_wisp_lead: "please", scene_old_steps: "frog", scene_gate_hum: "step_back", choice_gate_record: "count",
    }, "success");
    expect(trace.has("scene_tussock_landing")).toBe(true);
    expect(trace.has("interaction_tussock_balance")).toBe(false);
  }
});

it.each(sizes)("ribbon help and sending prospectors home retain their distinct exit consequences at %i seats", size => {
  const { state, trace } = walk(marsh, size, {
    scene_ribbon_line: "help", scene_barge: "inspect", scene_fog_bank: "listen", scene_tussock: "shallows",
    scene_wisp_lead: "please", scene_old_steps: "frog", scene_gate_hum: "step_back", choice_gate_record: "hum",
    scene_nan_washtub: "north", choice_exit: "north", scene_west_branch: "crew",
  }, "success");
  expect(state.flags.helped_ribbon_crew).toBe(true);
  expect(state.flags.rescued_prospectors).not.toBe(true);
  expect(state.flags.fog_landing_checked).not.toBe(true);
  expect(offered(trace.get("scene_tussock")!, "checked_landing")).toBe(false);
  expect(trace.has("scene_west_branch_crew")).toBe(true);
  expect(trace.has("interaction_weir_practiced")).toBe(false);
  expect(state.flags.forded_clean).toBe(true);
});

it.each(sizes)("the ferry promise earns its charm and still plays the loaded crossing at %i seats", size => {
  const { state, trace } = walk(road, size, {
    scene_east_road: "wave_first", scene_stuck_wagon: "unload", scene_queue: "let_it_go",
    scene_troll: "tell_story", choice_camp_spot: "by_goat", rest_queue_camp: "to_bank",
    scene_wake_fee: "pay_fish", scene_crossing_bank: "ask_frog", scene_ossley_price: "pay_ossley",
  }, "assisted");
  expect(trace.has("interaction_markers")).toBe(false);
  expect(trace.has("interaction_ferry")).toBe(true);
  expect(state.party.some(p => p.character.inventory.some(item => item.itemId === "river_charm"))).toBe(true);
  expect(state.flags.crossed_dry).toBe(true);
  expect(state.flags.crossing_helped).toBe(true);
});

const legacy = read<Record<string, Record<string, CheckScene>>>("tools/content/fixtures/gemfall-road-marsh-legacy-checks.json");
it.each([road, marsh])("$id resumes every shipped roll prompt with its original success and failure", chapter => {
  for (const [id, oldScene] of Object.entries(legacy[chapter.id]!)) {
    expect(chapter.scenes[id], `${chapter.id}/${id} old roll contract`).toEqual(oldScene);
    const oldChapter = structuredClone(chapter);
    oldChapter.scenes[id] = oldScene;
    for (const face of [1, 20]) for (const size of sizes) {
      let state = enterScene(start(oldChapter, "manticore", "duskrunner", {}, size), id, context(oldChapter)).state;
      // JSON round-trip models the stored prompt, not a newly opened prompt.
      state = JSON.parse(JSON.stringify(state)) as RunState;
      for (let count = 0; state.sceneId === id; count++) {
        expect(count).toBeLessThan(size + 2);
        state = send(state, { type: "ROLL" }, chapter, face);
      }
      expect(state.sceneId).toBe((face === 20 ? oldScene.onSuccess : oldScene.onFailure).goto);
    }
  }
});
