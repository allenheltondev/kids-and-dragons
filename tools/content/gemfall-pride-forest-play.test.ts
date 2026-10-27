import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyEffects, enterScene } from "@kad/shared";
import type { Chapter, CheckScene, ClassId, RunState, SpeciesId } from "@kad/shared";
import { context, send, start } from "./riftlight-test-support.ts";
import { act, landed, miss, promptOf, solve } from "./interaction-play.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const pride = read<Chapter>("content/chapters/gemfall-04a.json");
const forest = read<Chapter>("content/chapters/gemfall-04b.json");
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

const pridePicks = {
 scene_east_bank: "pride_road", scene_brass_rope: "ask_question", scene_relay_runner: "news_west",
 scene_pride_road: "to_pride", scene_cub_scouts: "ask_why", scene_pride_greeting: "greet_back",
 scene_granny_cake: "recipe", scene_pride_camp: "to_waystation", choice_cub_nap: "sing",
 scene_moving_marker: "carry_post", scene_waystation: "stitch_first", scene_spiral: "to_rest",
 rest_waystation: "walk_out", scene_dawn_moths: "let_pass", scene_jackalope_wall: "ask_oldest",
 scene_wolf_sign: "follow_prints", scene_widest_bend: "take_stone", scene_wolves: "brace_fire",
};
const forestPicks = {
 scene_tree_line: "walk_in", scene_runner_path: "carry", scene_roll_call: "truth",
 scene_attendance: "open_path", scene_hedge: "empty", scene_mosshorns: "watch",
 scene_gray_patch: "press", scene_unicorns: "help", scene_finding: "how",
 rest_glade_edge: "on", scene_lost_calf: "carry", scene_sitting_beech: "told",
 scene_crater: "moss_strip", scene_glade_heart: "mend", scene_pile_shown: "on",
};
it.each(sizes.flatMap(size => outcomes.map(outcome => ({size,outcome}))))
 ("pride: $size seats / $outcome carries the brace and sash lesson through a complete evening", ({size,outcome}) => {
 const {state,trace}=walk(pride,size,pridePicks,outcome);
 expect(trace.has("interaction_cub_lullaby")).toBe(true);
 expect(trace.has("interaction_sash_frame")).toBe(true);
 expect(state.flags.pride_brace_learned).toBe(true);
 expect(state.flags.pride_windbreak_used).toBe(true);
 expect(trace.has("interaction_pride_windbreak")).toBe(true);
 expect(state.flags.read_the_sashes === true).toBe(outcome !== "failure");
 expect(state.chapterOutcome).toBe("success");
 });
it.each(sizes)("pride: checking the line changes the later route at %i seats", size => {
 const {state,trace}=walk(pride,size,{...pridePicks,choice_cub_nap:"packs_away",scene_wolf_sign:"checked_line"});
 expect(trace.has("interaction_wolf_trail")).toBe(false);
 expect(trace.has("scene_pride_checked_line")).toBe(true);
 expect(state.flags.pride_line_checked).toBe(true);
 expect(state.chapterOutcome).toBe("success");
});
it.each(sizes)("pride: leaving the stone avoids the wolf approach at %i seats", size => {
 const {state,trace}=walk(pride,size,{...pridePicks,scene_widest_bend:"leave_stone"});
 expect(trace.has("scene_wolves")).toBe(false);
 expect(state.party.every(p=>!p.character.questItems.includes("facet_pride"))).toBe(true);
 expect(state.chapterOutcome).toBe("success");
});
it.each(sizes.flatMap(size => outcomes.map(outcome => ({size,outcome}))))
 ("forest: $size seats / $outcome makes the mending lesson useful at the crater", ({size,outcome}) => {
 const {state,trace}=walk(forest,size,forestPicks,outcome);
 expect(state.flags.told_forest_truth).toBe(true);
 expect(state.flags.helped_mend).toBe(true);
 expect(state.flags.forest_moss_used).toBe(true);
 expect(offered(trace.get("scene_crater")!,"woodland_chorus")).toBe(false);
 expect(trace.has("interaction_mending_circle")).toBe(true);
 expect(state.flags.glade_mended).toBe(true);
 expect(state.chapterOutcome).toBe("success");
});
it.each(sizes)("forest: standing guard unlocks a different approach at %i seats", size => {
 const {state,trace}=walk(forest,size,{...forestPicks,scene_unicorns:"guard",scene_crater:"woodland_chorus",scene_glade_heart:"pocket",scene_pile_glimpsed:"on"},"assisted");
 expect(state.flags.helped_mend).not.toBe(true);
 expect(offered(trace.get("scene_crater")!,"moss_strip")).toBe(false);
 expect(state.flags.forest_chorus_used).toBe(true);
 expect(state.flags.glade_mended).not.toBe(true);
 expect(state.chapterOutcome).toBe("success");
});
it.each(sizes)("forest: the observed herd route recovers a lost echo fight at %i seats", size => {
 const {state,trace}=walk(forest,size,{...forestPicks,scene_crater:"stand",scene_echo_recovery:"herd_map"},"success",20,true);
 expect(trace.has("scene_echo_recovery")).toBe(true);
 expect(trace.has("interaction_gray_route")).toBe(true);
 expect(state.flags.forest_map_recovered).toBe(true);
 expect(state.chapterOutcome).toBe("success");
});
it.each(sizes)("forest: missing the herd observation cannot invent a recovery map at %i seats", size => {
 const {state,trace}=walk(forest,size,{...forestPicks,scene_crater:"stand",scene_echo_recovery:"guess"},"failure",1,true);
 expect(state.flags.read_the_herd).not.toBe(true);
 expect(offered(trace.get("scene_echo_recovery")!,"herd_map")).toBe(false);
 expect(state.chapterOutcome).toBe("setback");
});
const legacy = read<Record<string, Record<string, CheckScene>>>("tools/content/fixtures/gemfall-pride-forest-legacy-checks.json");
it.each([pride, forest])("$id still resumes every shipped roll prompt to its original branch", chapter => {
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
it.each(sizes)("pride: a paid lesson spends its actual coin and the escort is an earned alternative at %i seats", size => {
 const {state,trace}=walk(pride,size,{...pridePicks,scene_waystation:"pay_lesson",rest_waystation:"with_escort",scene_wolves:"call_escort"});
 expect(trace.get("scene_waystation_lesson")!.coins).toBe(trace.get("scene_waystation")!.coins-1);
 expect(trace.has("interaction_sash_frame")).toBe(false);
 expect(trace.has("interaction_sashes_pinned")).toBe(true);
 expect(state.flags.pride_friends).toBe(true);
 expect(state.flags.escorted).toBe(true);
 expect(trace.has("scene_escort_answers")).toBe(true);
 expect(trace.has("interaction_pride_windbreak")).toBe(false);
});
it.each(sizes)("pride: studying instead of carrying does not invent a brace at %i seats", size => {
 const {state,trace}=walk(pride,size,{...pridePicks,scene_moving_marker:"ask_where",scene_wolf_sign:"checked_line",scene_wolves:"chase_off"},"success",20,true);
 expect(offered(trace.get("scene_wolves")!,"brace_fire")).toBe(false);
 expect(state.flags.pride_brace_learned).not.toBe(true);
 expect(state.chapterOutcome).toBe("setback");
});
it.each(sizes)("forest: failed quick mending gives no earned moss shortcut at %i seats", size => {
 const {state,trace}=walk(forest,size,{...forestPicks,scene_unicorns:"quick_mend",scene_crater:"stand"},"success",1);
 expect(state.flags.helped_mend).not.toBe(true);
 expect(offered(trace.get("scene_crater")!,"moss_strip")).toBe(false);
 expect(offered(trace.get("scene_crater")!,"woodland_chorus")).toBe(false);
 expect(state.chapterOutcome).toBe("success");
});
it.each([pride,forest])("$id only uses registered scene art that exists on disk", chapter => {
 const manifest=read<{sceneIllustrations:string[]}>("assets/manifest.json");
 for(const [id,scene] of Object.entries(chapter.scenes)) if(scene.art){
 expect(manifest.sceneIllustrations,`${chapter.id}/${id}`).toContain(scene.art);
 expect(fs.existsSync(path.join(root,"assets",scene.art+".webp")),`${chapter.id}/${id}`).toBe(true);
 }
});
