import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyEffects, applyIntent, enterScene, playbackMs } from "@kad/shared";
import type { Chapter, CheckScene, ClassId, RunState, SpeciesId } from "@kad/shared";
import { context, send, start } from "./riftlight-test-support.ts";
import { act, landed, miss, promptOf, solve } from "./interaction-play.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const finale = read<Chapter>("content/chapters/gemfall-08.json");
const sizes = [1, 2, 4];
// miss-supported misses only precision/timing/sequence/memory/tracking.
// cooperate/balance/relay/play have no failing player action; they complete
// successfully in this mixed profile. Their authored onFailure edges are not
// claimed as executable failure coverage. Incomplete work is tested below.
const outcomes = ["success", "miss-supported", "assisted"] as const;
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
function walk(chapter: Chapter, size: number, picks: Record<string, string>, outcome: Outcome = "success", rollFace = 20, defeat = false, flags: Record<string, boolean> = {}, species: SpeciesId = "manticore", cls: ClassId = "duskrunner", food = false, sceneOutcomes: Record<string, Outcome> = {}, items: string[] = []) {
  let state = initial(chapter, size, flags, species, cls);
  state.party[0]!.character.questItems.push(...items);
  if (food) state = applyEffects(state, [{type:"grantItem",itemId:"supper_bundle",to:"party"}], context(chapter));
  const trace = new Map<string, RunState>();
  const interactionOutcomes = new Map<string, string>();
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
      const playOutcome = sceneOutcomes[state.sceneId!] ?? outcome;
      let result: RunState;
      if (playOutcome === "assisted") {
        result = act(chapter, state, { action: "assist" }, promptOf(state).playerIds.at(-1)!);
        expect(promptOf(result).outcome).toBe("assisted");
      } else if (playOutcome === "miss-supported") {
        let missed = miss(chapter, state);
        const spec = promptOf(state).spec;
        // Reversing a palindromic memory answer (wait/walk/wait) is still
        // correct. Make a genuinely wrong, valid-length answer in that case.
        if (!missed && (spec.kind === "memory" || spec.kind === "sequence")) {
          const wrong = [...spec.answer];
          wrong[0] = spec.options.find(option => option.id !== wrong[0])!.id;
          const actor = promptOf(state).actorId;
          const started = act(chapter, state, {action:"start",relaxed:false}, actor);
          missed = act(chapter, started, {action:"answer",answer:wrong}, actor, playbackMs(spec,false)+1000);
        }
        if (missed) {
          expect(promptOf(missed).outcome).toBe("failure");
          result = missed;
        } else {
          expect(["cooperate", "balance", "relay", "play"]).toContain(promptOf(state).spec.kind);
          result = solve(chapter, state);
          expect(promptOf(result).outcome).toBe("success");
        }
      } else {
        result = solve(chapter, state);
        expect(promptOf(result).outcome).toBe("success");
      }
      interactionOutcomes.set(state.sceneId!, promptOf(result).outcome!);
      state = landed(chapter, result, promptOf(result).resolvedActorId ?? promptOf(result).actorId);
    } else if (state.prompt?.kind === "choice") {
      const id = picks[state.sceneId!] ?? state.prompt.options[0]!.id;
      expect(offered(state, id), `${chapter.id}/${state.sceneId}: ${id}`).toBe(true);
      state = send(state, { type: "CHOOSE", choiceId: id }, chapter);
    } else if (state.prompt?.kind === "roll") state = send(state, { type: "ROLL" }, chapter, rollFace);
    else state = send(state, { type: "ADVANCE" }, chapter);
  }
  if (state.chapterOutcome === "success" && !state.flags.walked_away) for (const step of chapter.goal!.steps) {
    if (step.optional) continue;
    const flags = Array.isArray(step.flag) ? step.flag : [step.flag!];
    expect(flags.some(flag => state.flags[flag]), step.id).toBe(true);
  }
  return { state, trace, interactionOutcomes };
}



const picks={scene_tree_line:"stair",scene_faun_family:"carry",scene_wolf_ledge:"sit",scene_warden_post:"sign",scene_overlook:"home",choice_cairn:"names",scene_bell_hut:"ring",scene_crab_field:"read",scene_ember_drift:"carry",choice_last_breath:"best",scene_mouth:"stand_ground",rest_cool_gallery:"down",scene_keeper:"truth",scene_q2:"road",scene_verdict:"each_voice",scene_seal_cracks:"brace",scene_titan_eye:"hum",scene_restore_begin:"brace_together",scene_restore_last_gap:"little_stone",scene_titan_sleeps:"front",scene_destroy_begin:"steady_latch",scene_titan_goes:"listen",scene_tether:"call_voss",scene_keystone:"collectors"};
const endings={restore:"ending_heroes",destroy:"ending_heroes_destroy",leash:"ending_wardens_regret",keystone:"ending_collectors"};
it.each(sizes.flatMap(size=>outcomes.flatMap(outcome=>["restore","destroy","leash","keystone"].map(philosophy=>({size,outcome,philosophy})))))
 ("Finale whole route: $size / $outcome / $philosophy",({size,outcome,philosophy})=>{
 const {state,trace}=walk(finale,size,{...picks,scene_seal_chamber:philosophy},outcome,20,false,{pursuit_hoard:true,told_wardens:true,clock_steady:true});
 expect(state.sceneId).toBe(endings[philosophy as keyof typeof endings]);
 expect(state.party.every(p=>!p.character.questItems.includes("listening_chime"))).toBe(true);
 expect(trace.has("interaction_verdict_council")).toBe(true);expect(trace.has("encounter_dragon")).toBe(false);
 if(philosophy==="restore")expect(trace.has("interaction_restore_brace")).toBe(true);
 if(philosophy==="destroy")expect(trace.has("interaction_wheel_latch")).toBe(true);
 if(philosophy==="leash")expect(trace.has("interaction_leash_transfer")).toBe(true);
 if(philosophy==="keystone")expect(state.party.some(p=>p.character.questItems.includes("facet_keystone"))).toBe(true);
});
it.each(sizes.flatMap(size=>outcomes.map(outcome=>({size,outcome}))))("Finale carried Restore: $size / $outcome uses matching with actual pieces",({size,outcome})=>{
 const {state,trace}=walk(finale,size,{...picks,scene_seal_chamber:"restore",scene_restore_begin:"match_by_hum"},outcome,20,false,{pursuit_restore:true,kept_close:true},"manticore","duskrunner",false,{},["facet_ember","facet_table","facet_caravan"]);
 expect(state.sceneId).toBe("ending_heroes");expect(trace.has("interaction_restore_fit")).toBe(true);
 expect(offered(trace.get("scene_restore_begin")!,"brace_together")).toBe(false);
});
it.each(sizes.flatMap(size=>["pursuit_restore","pursuit_hoard","pursuit_leash"].map(pursuit=>({size,pursuit}))))("Finale $size / $pursuit preserves every philosophy and prepared risk",({size,pursuit})=>{
 const {trace}=walk(finale,size,{...picks,scene_seal_chamber:"restore"},"success",20,false,{[pursuit]:true,kept_close:true});
 const vote=trace.get("scene_seal_chamber")!;
 for(const id of ["restore","destroy","leash","keystone"])expect(offered(vote,id)).toBe(true);
 let state=enterScene(initial(finale,size,{[pursuit]:true}),"scene_tether",context(finale)).state;
 expect(offered(state,"ours_tether")).toBe(pursuit==="pursuit_leash");expect(offered(state,"ours")).toBe(true);
 state=enterScene(initial(finale,size,{[pursuit]:true}),"scene_keystone",context(finale)).state;
 expect(offered(state,"collectors")).toBe(pursuit==="pursuit_hoard");expect(offered(state,"take")).toBe(true);
});
it.each(sizes)("Finale %i seats cannot complete a council or brace without participation",size=>{
 for(const id of ["interaction_verdict_council","interaction_restore_brace","interaction_leash_transfer"]){
 let state=enterScene(initial(finale,size),id,context(finale)).state;const actor=promptOf(state).actorId;
 state=act(finale,state,{action:"start",relaxed:false},actor);
 const result=applyIntent(state,{playerId:actor,intent:{type:"INTERACT",openedSeq:promptOf(state).openedSeq,attempt:promptOf(state).attempt,action:"complete"}},context(finale));
 expect(result.error).toBeDefined();expect(result.state.sceneId).toBe(id);expect(promptOf(result.state).outcome).toBeUndefined();
 }
});
it.each(sizes)("Finale %i seats keeps a missed action's sting nonlethal and on its resolved hero",size=>{
 for(const id of ["interaction_restore_fit","interaction_wheel_latch"]){
 const state=enterScene(initial(finale,size),id,context(finale)).state;
 const result=miss(finale,state)!;expect(promptOf(result).outcome).toBe("failure");
 const actor=promptOf(result).resolvedActorId??promptOf(result).actorId;
 const after=landed(finale,result,actor);
 for(const member of after.party){const before=state.party.find(p=>p.playerId===member.playerId)!;expect(member.hp).toBe(before.hp-Number(member.playerId===actor));}
 const low=structuredClone(state);for(const member of low.party)member.hp=1;
 const hurt=miss(finale,low)!;const recovered=landed(finale,hurt,promptOf(hurt).resolvedActorId??promptOf(hurt).actorId);
 expect(recovered.party.every(p=>p.hp>=1&&!p.down)).toBe(true);
 }
});
it.each(sizes)("Finale %i seats: late door recovery actually spends a stone",size=>{
 let state=initial(finale,size,{clock_late:true});state.party[0]!.character.questItems.push("facet_ember");
 state=enterScene(state,"scene_door_holds",context(finale)).state;
 expect(offered(state,"crack")).toBe(false);expect(offered(state,"wedge")).toBe(true);
 state=send(state,{type:"CHOOSE",choiceId:"wedge"},finale);
 expect(state.party.some(p=>p.character.questItems.includes("facet_ember"))).toBe(false);
 state=send(state,{type:"CHOOSE",choiceId:"on"},finale);expect(state.sceneId).toBe("scene_keeper");
});

it.each(sizes.flatMap(size=>["self","cult"].flatMap(holder=>["release","risk"].map(next=>({size,holder,next})))))
 ("Finale failed tether: $size / $holder / $next keeps the consequence",({size,holder,next})=>{
 const check=holder==="self"?"check_tether_self_bare":"check_tether_cult_bare";
 let state=enterScene(initial(finale,size),check,context(finale)).state;
 while(state.sceneId===check)state=send(state,{type:"ROLL"},finale,1);
 state=send(state,{type:"CHOOSE",choiceId:holder==="self"?(next==="release"?"let_go":"hold_on"):(next==="release"?"stop":"find")},finale);
 if(next==="release"){
 state=send(state,{type:"CHOOSE",choiceId:"on"},finale);
 expect(state.sceneId).toBe("scene_seal_chamber");expect(offered(state,"leash")).toBe(false);expect(offered(state,"restore")).toBe(true);expect(offered(state,"destroy")).toBe(true);
 }else{
 const retry=state.sceneId;while(state.sceneId===retry)state=send(state,{type:"ROLL"},finale,1);
 expect(state.sceneId).toBe("ending_broken_tether");expect(state.chapterOutcome).toBe("setback");
 }
});
it.each(sizes)("Finale %i: failed Keystone closes taking it, without closing other philosophies",size=>{
 let state=enterScene(initial(finale,size),"check_keystone",context(finale)).state;
 state=send(state,{type:"ROLL"},finale,1);expect(state.sceneId).toBe("scene_keystone_refused");
 state=send(state,{type:"CHOOSE",choiceId:"on"},finale);
 expect(offered(state,"keystone")).toBe(false);for(const id of ["restore","destroy","leash"])expect(offered(state,id)).toBe(true);
 expect(state.party.every(p=>!p.character.questItems.includes("facet_keystone"))).toBe(true);
});

it.each(sizes)("Finale verdict %i: one hero cannot submit for silent connected friends",size=>{
 let state=enterScene(initial(finale,size),"interaction_verdict_council",context(finale)).state;
 const prompt=promptOf(state),actor=prompt.actorId;
 state=act(finale,state,{action:"start",relaxed:false},actor);
 state=act(finale,state,{action:"play",optionId:"choice"},actor);
 const pending=promptOf(state);
 const attempt=applyIntent(state,{playerId:actor,intent:{type:"INTERACT",openedSeq:pending.openedSeq,attempt:pending.attempt,action:"complete"}},context(finale));
 if(size===1)expect(attempt.error).toBeUndefined();
 else{
 expect(attempt.error).toBeDefined();expect(promptOf(attempt.state).outcome).toBeUndefined();
 for(const friend of prompt.playerIds.filter(id=>id!==actor))state=act(finale,state,{action:"play",optionId:"helped"},friend);
 state=act(finale,state,{action:"complete"},actor);expect(promptOf(state).outcome).toBe("success");
 }
});
