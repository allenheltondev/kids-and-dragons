import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyEffects, applyIntent, enterScene, playbackMs } from "@kad/shared";
import type { Chapter, CheckScene, ClassId, RunState, SpeciesId } from "@kad/shared";
import { context, send, start } from "./riftlight-test-support.ts";
import { act, landed, miss, promptOf, solve } from "./interaction-play.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const ashfall = read<Chapter>("content/chapters/gemfall-06.json");
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
function walk(chapter: Chapter, size: number, picks: Record<string, string>, outcome: Outcome = "success", rollFace = 20, defeat = false, flags: Record<string, boolean> = {}, species: SpeciesId = "manticore", cls: ClassId = "duskrunner", food = false, sceneOutcomes: Record<string, Outcome> = {}) {
  let state = initial(chapter, size, flags, species, cls);
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
  if (state.chapterOutcome === "success") for (const step of chapter.goal!.steps) {
    const flags = Array.isArray(step.flag) ? step.flag : [step.flag!];
    expect(flags.some(flag => state.flags[flag]), step.id).toBe(true);
  }
  return { state, trace, interactionOutcomes };
}

const picks={scene_arrival:"walk_up",scene_doorstep:"talk",scene_moths:"follow",scene_wolves:"wait",scene_claim_boulder:"share",scene_soup_tent:"just_soup",rest_warm_stones:"morning",scene_morning_bells:"learn",scene_crab:"dunmore",scene_crab_thanks:"straight_up",scene_citadel_gate:"follow",scene_citadel_gate_desk:"ask_why",scene_truth_table:"work_it_out",scene_whole_truth:"take_stone",scene_acceptable_losses:"hear_plan",scene_whole_truth_window:"bells",scene_ledger:"plainly",scene_who_to_tell:"wardens",scene_what_for:"restore",scene_gate_recovery:"ring",scene_shut_out:"restore"};
it.each(sizes.flatMap(size=>outcomes.map(outcome=>({size,outcome}))))
 ("Ashfall: $size seats / $outcome compares evidence before the reveal and hears every hero",({size,outcome})=>{
 const {state,trace,interactionOutcomes}=walk(ashfall,size,picks,outcome);
 expect(trace.has("interaction_truth_timeline")).toBe(true);
 expect(trace.has("interaction_purpose_council")).toBe(true);
 expect(trace.has("encounter_crab")).toBe(false);
 expect(state.flags.learned_the_whole_truth).toBe(true);
 expect(state.flags.truth_helped===true).toBe(outcome!=="success");
 expect(state.flags.truth_compared===true).toBe(outcome!=="miss-supported");
 expect(interactionOutcomes.get("interaction_truth_timeline")).toBe(outcome==="miss-supported"?"failure":outcome);
 expect(interactionOutcomes.get("interaction_purpose_council")).toBe(outcome==="assisted"?"assisted":"success");
 expect(state.flags.clock_steady).toBe(true);expect(state.flags.pursuit_restore).toBe(true);
 expect(trace.get("scene_whole_truth")!.narration).toContain("seal holds a titan asleep");
 expect(state.chapterOutcome).toBe("success");
 });
it.each(sizes.flatMap(size=>outcomes.map(outcome=>({size,outcome}))))
 ("Ashfall: $size seats / $outcome uses the learned call after a lost crab fight",({size,outcome})=>{
 const {state,trace}=walk(ashfall,size,{...picks,scene_crab:"fight"},"success",20,true,{},"manticore","duskrunner",false,{interaction_gate_call:outcome});
 expect(offered(trace.get("scene_gate_recovery")!,"ring")).toBe(true);
 expect(state.flags.gate_call_used===true).toBe(outcome!=="miss-supported");
 expect(["clock_steady","clock_stirring","clock_late"].filter(f=>state.flags[f])).toEqual([outcome==="miss-supported"?"clock_late":"clock_stirring"]);
 expect(state.chapterOutcome).toBe(outcome==="miss-supported"?"setback":"success");
 expect(trace.has("scene_shut_out")).toBe(outcome==="miss-supported");
 if(outcome==="miss-supported")expect(trace.get("scene_shut_out")!.narration).toContain("seal holds a titan asleep");
 });
it.each(sizes)("Ashfall: without learning the call, failed sprint retains the late setback at %i seats",size=>{
 const {state,trace}=walk(ashfall,size,{...picks,scene_morning_bells:"sock",scene_crab:"fight",scene_gate_recovery:"run"},"success",1,true);
 expect(offered(trace.get("scene_gate_recovery")!,"ring")).toBe(false);
 expect(state.flags.clock_late).toBe(true);expect(state.flags.gate_call_used).not.toBe(true);
 expect(state.chapterOutcome).toBe("setback");
});
it.each(sizes.flatMap(size=>["restore","hoard","leash","refuse"].map(purpose=>({size,purpose}))))
 ("Ashfall: $size seats / $purpose keeps the deliberate purpose and Table Stone choice",({size,purpose})=>{
 const {state,trace}=walk(ashfall,size,{...picks,scene_what_for:purpose,scene_whole_truth:"leave_stone"},"assisted");
 const expected=purpose==="refuse"?"pursuit_restore":`pursuit_${purpose}`;
 expect(["pursuit_restore","pursuit_hoard","pursuit_leash"].filter(f=>state.flags[f])).toEqual([expected]);
 expect(state.party.every(p=>!p.character.questItems.includes("facet_table"))).toBe(true);
 expect(trace.has("interaction_purpose_council")).toBe(true);
 expect(state.flags.said_what_for).toBe(true);
});
it.each(sizes.flatMap(size=>["logs_first","river_clues","wild_clues","rush_clues"].map(method=>({size,method}))))
 ("Ashfall: $size seats / $method reaches the same reveal through checked records",({size,method})=>{
 const road={river_clues:"route_river",wild_clues:"route_wild",rush_clues:"route_rush",logs_first:"route_river"}[method]!;
 const {state,trace}=walk(ashfall,size,{...picks,scene_truth_table:method},"success",20,false,{[road]:true});
 expect(trace.has(method==="logs_first"?"interaction_watch_logs":"interaction_truth_timeline")).toBe(true);
 expect(state.flags.learned_the_whole_truth).toBe(true);
 expect(trace.has("interaction_purpose_council")).toBe(true);
});
it.each(sizes)("Ashfall: the old bell roll and the flyer job both earn the recovery call at %i seats",size=>{
 for(const method of ["quick_ring","fly_ring"]){
 const {state,trace}=walk(ashfall,size,{...picks,scene_morning_bells:method,scene_crab:"fight"},"success",20,true,{},"griffin","thornguard");
 expect(offered(trace.get("scene_gate_recovery")!,"ring")).toBe(true);
 expect(state.flags.gate_call_used).toBe(true);
 }
});
it.each(sizes)("Ashfall: unfinished support and discussion do not grant completion at %i seats",size=>{
 for(const id of ["interaction_doorstep","interaction_purpose_council"]){
 let state=enterScene(initial(ashfall,size),id,context(ashfall)).state;const actor=promptOf(state).actorId;
 expect(miss(ashfall,state)).toBeNull();state=act(ashfall,state,{action:"start",relaxed:false},actor);
 const result=applyIntent(state,{playerId:actor,intent:{type:"INTERACT",openedSeq:promptOf(state).openedSeq,attempt:promptOf(state).attempt,action:"complete"}},context(ashfall));
 expect(result.error).toBeDefined();expect(result.state.sceneId).toBe(id);expect(promptOf(result.state).outcome).toBeUndefined();
 expect(result.state.flags.dunmore_friend).not.toBe(true);
 }
});
it("Ashfall art exists and the major reveal stays at its original scenes",()=>{
 const manifest=read<{sceneIllustrations:string[]}>("assets/manifest.json");
 for(const [id,scene] of Object.entries(ashfall.scenes))if(scene.art){expect(manifest.sceneIllustrations,id).toContain(scene.art);expect(fs.existsSync(path.join(root,"assets",scene.art+".webp")),id).toBe(true);}
 expect(Object.entries(ashfall.scenes).filter(([,s])=>"priority"in s&&s.priority===1).map(([id])=>id)).toEqual(["scene_whole_truth","scene_shut_out"]);
});
const legacy = read<Record<string, Record<string, CheckScene>>>("tools/content/fixtures/gemfall-ashfall-legacy-checks.json");
it.each([ashfall])("$id still resumes every shipped roll prompt to its original branch", chapter => {
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

it.each(sizes.flatMap(size=>["restore","hoard","leash","refuse"].map(purpose=>({size,purpose}))))
 ("Ashfall late route: $size seats / $purpose intentionally votes without the indoor council",({size,purpose})=>{
 const {state,trace}=walk(ashfall,size,{...picks,scene_crab:"fight",scene_shut_out:purpose},"success",20,true,{},"manticore","duskrunner",false,{interaction_gate_call:"miss-supported"});
 expect(trace.has("interaction_purpose_council")).toBe(false);
 const decision=trace.get("scene_shut_out")!;
 expect(decision.narration).toContain("seal holds a titan asleep");
 expect(decision.narration).toContain("Take time to hear one another before answering.");
 if(decision.prompt?.kind!=="choice")throw Error("late purpose vote");
 expect(decision.prompt.options.map(o=>o.id)).toEqual(["restore","hoard","leash","refuse"]);
 const expected=purpose==="refuse"?"pursuit_restore":`pursuit_${purpose}`;
 expect(["pursuit_restore","pursuit_hoard","pursuit_leash"].filter(f=>state.flags[f])).toEqual([expected]);
 expect(state.flags.clock_late).toBe(true);expect(state.chapterOutcome).toBe("setback");
 // A serialized save already waiting at the original decision still chooses
 // directly; introducing a mandatory new council here would change that contract.
 let resumed=JSON.parse(JSON.stringify(decision)) as RunState;
 resumed=send(resumed,{type:"CHOOSE",choiceId:purpose},ashfall);
 resumed=send(resumed,{type:"CHOOSE",choiceId:"on"},ashfall);
 expect(resumed.sceneId).toBe("rest_end_shut_out");
 expect(resumed.flags[expected]).toBe(true);expect(resumed.chapterOutcome).toBe("setback");
});
