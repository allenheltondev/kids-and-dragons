import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyEffects, enterScene } from "@kad/shared";
import type { Chapter, CheckScene, ClassId, RunState, SpeciesId } from "@kad/shared";
import { context, send, start } from "./riftlight-test-support.ts";
import { act, landed, miss, promptOf, solve } from "./interaction-play.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const bridge = read<Chapter>("content/chapters/gemfall-05a.json");
const woods = read<Chapter>("content/chapters/gemfall-05b.json");
const boundary = read<Chapter>("content/chapters/gemfall-05c.json");
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
function walk(chapter: Chapter, size: number, picks: Record<string, string>, outcome: Outcome = "success", rollFace = 20, defeat = false, flags: Record<string, boolean> = {}, species: SpeciesId = "manticore", cls: ClassId = "duskrunner", food = false) {
  let state = initial(chapter, size, flags, species, cls);
  if (food) state = applyEffects(state, [{type:"grantItem",itemId:"supper_bundle",to:"party"}], context(chapter));
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

const bridgePicks={scene_brass_south:"ask_what",scene_tremor:"catch_crates",scene_soup_line:"stay_in_line",
 scene_clerk:"find_rule",scene_engineers:"lay_evidence",scene_crack_string:"hold_string",
 choice_stones_on_table:"keep_shut",scene_who_to_tell:"keep_close",scene_span_question:"answer",
 scene_pack_crossing:"carry",scene_crossing:"measured_line",scene_rim_lookout:"send_word"};
const woodsPicks={scene_mosshome:"feet",scene_archive_table:"plot",scene_spiral:"on",scene_knot_cords:"pile",
 scene_pile_question:"let_be",scene_leaning_chair:"follow",rest_guest_tree:"knot",scene_runners_post:"rush",
 scene_cloud_gatherer:"walk",choice_elders:"wardens",scene_falls_stair:"logs",scene_soup_tent:"soup",
 choice_rope_bridge:"knot",scene_halfway_hut:"sign",scene_high_paths:"ivy_ledge",scene_foothills_view:"camp"};
const boundaryPicks={scene_inspection:"argue",scene_gate_town:"explain",scene_turned_back:"share_soup",
 scene_tallies:"lay_out",scene_here_first:"onward",scene_unassigned:"ask_carry",scene_moths_leaving:"hold_one",
 scene_bell_house_supper:"ask_recipe",rest_bell_house:"morning",scene_night_lights:"wake_grans",
 scene_morning_bells:"pull_rope",scene_crowd_at_stones:"crew_line",scene_centaur_whisper:"caravan_road",
 scene_warden_count:"ask_logs",scene_who_to_tell:"wardens"};
it.each(sizes.flatMap(size=>outcomes.flatMap(outcome=>["hold_string","read_chalk"].map(job=>({size,outcome,job})))))
 ("bridge: $size seats / $outcome / $job changes the crossing",({size,outcome,job})=>{
 const {state,trace}=walk(bridge,size,{...bridgePicks,scene_crack_string:job,scene_crossing:job==="hold_string"?"measured_line":"settled_interval"},outcome);
 expect(trace.has("interaction_transfer_rule")).toBe(true);
 expect(trace.has("interaction_survey_evidence")).toBe(true);
 expect(state.flags.bridge_preparation_used===true).toBe(job==="hold_string"||outcome!=="failure");
 expect(offered(trace.get("scene_crossing")!,"measured_line")).toBe(job==="hold_string");
 expect(offered(trace.get("scene_crossing")!,"settled_interval")).toBe(job==="read_chalk");
 expect(state.chapterOutcome).toBe("success");
 });
it.each(sizes)("bridge: disclosure still earns the original pass at %i seats",size=>{
 const {state,trace}=walk(bridge,size,{...bridgePicks,scene_who_to_tell:"tell_wardens",scene_crossing:"brask_pass"});
 expect(state.flags.told_wardens).toBe(true);
 expect(state.flags.kept_close).not.toBe(true);
 expect(trace.has("interaction_survey_line")).toBe(false);
 expect(state.chapterOutcome).toBe("success");
});
it.each(sizes)("bridge: late wolf defeat still ends in the original setback at %i seats",size=>{
 const {state}=walk(bridge,size,{...bridgePicks,scene_crossing:"ration",scene_under_bridge:"push_through"},"success",1,true);
 expect(state.sceneId).toBe("rest_setback");expect(state.chapterOutcome).toBe("setback");
});
it.each(sizes.flatMap(size=>outcomes.map(outcome=>({size,outcome}))))
 ("woods: $size seats / $outcome makes the log crew's brace useful",({size,outcome})=>{
 const {state,trace}=walk(woods,size,woodsPicks,outcome);
 expect(state.flags.high_path_brace).toBe(true);
 expect(state.flags.high_path_brace_used).toBe(true);
 expect(trace.has("interaction_ivy_ledge")).toBe(true);
 expect(trace.has("check_bridge_test")).toBe(false);
 expect(state.flags.told_wardens).toBe(true);
 expect(state.chapterOutcome).toBe("success");
 });
it.each(sizes.flatMap(size=>outcomes.map(outcome=>({size,outcome}))))
 ("woods: $size seats / $outcome uses runoff observation after a lost wolf fight",({size,outcome})=>{
 const {state,trace}=walk(woods,size,{...woodsPicks,scene_falls_stair:"count",scene_high_paths:"stand",scene_gully_recovery:"runoff"},outcome,20,true);
 expect(offered(trace.get("scene_high_paths")!,"ivy_ledge")).toBe(false);
 expect(trace.has("scene_gully_recovery")).toBe(true);
 expect(state.flags.runoff_recovery_used===true).toBe(outcome!=="failure");
 expect(state.chapterOutcome).toBe(outcome==="failure"?"setback":"success");
 });
it.each(sizes)("woods: a checked feeding plan spends actual food at %i seats",size=>{
 const {state,trace}=walk(woods,size,{...woodsPicks,scene_halfway_hut:"read",scene_high_paths:"checked_snack"},"assisted",20,false,{},"manticore","duskrunner",true);
 const foodCount=(s:RunState)=>s.party.flatMap(p=>p.character.inventory).filter(i=>["supper_bundle","honeycake"].includes(i.itemId)).length;
 expect(foodCount(trace.get("scene_checked_snack")!)).toBe(foodCount(trace.get("scene_high_paths")!)-1);
 expect(trace.has("scene_checked_snack")).toBe(true);
 expect(state.flags.keeper_plan_used).toBe(true);
});
it.each(sizes.flatMap(size=>outcomes.flatMap(outcome=>["pull_rope","polish"].map(job=>({size,outcome,job})))))
 ("boundary: $size seats / $outcome / $job changes the crowd activity",({size,outcome,job})=>{
 const {state,trace}=walk(boundary,size,{...boundaryPicks,scene_morning_bells:job,scene_crowd_at_stones:job==="pull_rope"?"crew_line":"hand_chorus"},outcome);
 expect(trace.has("interaction_gear_inventory")).toBe(true);
 expect(trace.has("interaction_one_rule")).toBe(true);
 expect(trace.has("interaction_kept_stone")).toBe(true);
 expect(state.party.some(p=>p.character.questItems.includes("facet_unassigned"))).toBe(true);
 expect(offered(trace.get("scene_crowd_at_stones")!,"crew_line")).toBe(job==="pull_rope");
 expect(offered(trace.get("scene_crowd_at_stones")!,"hand_chorus")).toBe(job==="polish");
 expect(state.flags.prepared_queue_used).toBe(true);
 expect(state.flags.told_wardens).toBe(true);
 expect(state.chapterOutcome).toBe("success");
 });
it.each(sizes)("boundary: asking about the unrung bell does not prepare either bell job at %i seats",size=>{
 const {state,trace}=walk(boundary,size,{...boundaryPicks,scene_unassigned:"leave_kept",scene_morning_bells:"unrung",scene_crowd_at_stones:"stand_with",scene_who_to_tell:"keep_close"});
 expect(offered(trace.get("scene_crowd_at_stones")!,"crew_line")).toBe(false);
 expect(offered(trace.get("scene_crowd_at_stones")!,"hand_chorus")).toBe(false);
 expect(state.party.every(p=>!p.character.questItems.includes("facet_unassigned"))).toBe(true);
 expect(state.flags.kept_close).toBe(true);expect(state.flags.told_wardens).not.toBe(true);
});
it.each([bridge,woods,boundary])("$id uses registered scene art that exists on disk",chapter=>{
 const manifest=read<{sceneIllustrations:string[]}>("assets/manifest.json");
 for(const [id,scene] of Object.entries(chapter.scenes))if(scene.art){
 expect(manifest.sceneIllustrations,`${chapter.id}/${id}`).toContain(scene.art);
 expect(fs.existsSync(path.join(root,"assets",scene.art+".webp")),`${chapter.id}/${id}`).toBe(true);
 }
});
const legacy = read<Record<string, Record<string, CheckScene>>>("tools/content/fixtures/gemfall-outline-legacy-checks.json");
it.each([bridge, woods, boundary])("$id still resumes every shipped roll prompt to its original branch", chapter => {
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
it.each(sizes)("preparation never invents the keeper's food at %i seats",size=>{
 const {state,trace}=walk(woods,size,{...woodsPicks,scene_halfway_hut:"read",scene_high_paths:"dash"});
 expect(state.flags.keeper_snack_plan).toBe(true);
 expect(offered(trace.get("scene_high_paths")!,"checked_snack")).toBe(false);
});
it.each(sizes)("species and class shortcuts preserve later work at %i seats",size=>{
 const a=walk(bridge,size,{...bridgePicks,scene_crossing:"griffin_shortcut"},"success",20,false,{},"griffin","thornguard");
 expect(a.trace.has("scene_griffin_shortcut")).toBe(true);
 expect(a.trace.has("interaction_survey_evidence")).toBe(true);
 const b=walk(woods,size,{...woodsPicks,scene_archive_table:"read",scene_high_paths:"hidden"},"success",20,false,{},"bigfoot","duskrunner");
 expect(b.trace.has("scene_high_paths_hidden")).toBe(true);
 expect(b.trace.has("encounter_drake")).toBe(true);
 const c=walk(boundary,size,{...boundaryPicks,scene_gate_town:"explain_home",scene_unassigned:"ask_proper"},"success",20,false,{},"dragonling","thornguard");
 expect(c.trace.has("interaction_one_rule")).toBe(false);
 expect(c.trace.has("interaction_kept_stone")).toBe(false);
 expect(c.state.flags.got_the_unassigned_stone).toBe(true);
 expect(c.trace.has("interaction_crowd_bell_line")).toBe(true);
});
it.each(sizes.flatMap(size=>["wardens","gatherers","close"].map(audience=>({size,audience}))))
 ("all roads: $size seats keeps exactly one $audience disclosure",({size,audience})=>{
 const a=walk(bridge,size,{...bridgePicks,scene_who_to_tell:audience==="close"?"keep_close":`tell_${audience}`});
 const b=walk(woods,size,{...woodsPicks,choice_elders:audience});
 const c=walk(boundary,size,{...boundaryPicks,scene_who_to_tell:audience==="close"?"keep_close":audience});
 const expected=audience==="close"?"kept_close":`told_${audience}`;
 for(const result of [a,b,c])expect(["told_wardens","told_gatherers","kept_close"].filter(f=>result.state.flags[f])).toEqual([expected]);
 });
it.each(sizes)("boundary: missed crab warning still enters the original fight at %i seats",size=>{
 const {trace,state}=walk(boundary,size,{...boundaryPicks,scene_gate_town:"quick_rule",scene_crab_warning:"read",scene_crabs_rescue:"work"},"failure",1,true);
 expect(trace.has("interaction_crab_warning")).toBe(true);
 expect(trace.has("encounter_crabs")).toBe(true);
 expect(trace.has("scene_crabs_rescue_work")).toBe(true);
 expect(state.chapterOutcome).toBe("success");
});
