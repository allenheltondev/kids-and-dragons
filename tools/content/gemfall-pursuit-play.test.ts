import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyEffects, applyIntent, enterScene, playbackMs } from "@kad/shared";
import type { Chapter, CheckScene, ClassId, RunState, SpeciesId } from "@kad/shared";
import { context, send, start } from "./riftlight-test-support.ts";
import { act, landed, miss, promptOf, solve } from "./interaction-play.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const [returning, collection, tether] = ["r", "h", "l"].map(k=>read<Chapter>(`content/chapters/gemfall-07${k}.json`)) as [Chapter,Chapter,Chapter];
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


const returnPicks={choice_how:"handcart",scene_posy:"let_keep",scene_masks:"let_be",choice_haul:"carry",scene_evening:"camp",scene_morning_slide:"goat_path",scene_bend_lookout:"sign",choice_the_bend:"arrange_return",scene_downhill_crowd:"unload",choice_last_climb:"old_path"};
const collectPicks={scene_price_board:"read",scene_rival_collector:"haggle",scene_road_gifts:"trade_on",scene_mosshorn_calf:"packs_down",scene_evening:"camp",scene_humming_night:"socks",scene_checkpoint:"declare",scene_milestone_boy:"walk_down",scene_bend_approach:"high_rock",choice_the_bend:"outbid",scene_tidewell:"show",scene_tamsins_offer:"refuse",scene_dawn_bell:"clapper",choice_tree_line:"climb"};
const tetherPicks={choice_the_rule:"no_shouting",scene_ledger:"honest",scene_two_scouts:"truth",scene_choir:"ask",scene_first_sitting:"wobbly_side",scene_road_gifts:"stall",scene_stall_witch:"flatter",scene_returning_cart:"practice",scene_evening:"camp",scene_night_visitor:"rule_no_shouting",scene_rope_bridge:"roped",scene_switchback:"face",scene_bend_crowds:"chalk_line",choice_the_test:"table_works",scene_who_keeps_table:"grandmother"};
it.each(sizes.flatMap(size=>outcomes.map(outcome=>({size,outcome}))))("Return $size / $outcome: bells and preparation change the handover",({size,outcome})=>{
 const picks={...returnPicks,choice_the_bend:outcome==="miss-supported"?"big_sign":"arrange_return"};
 const {state,trace,interactionOutcomes}=walk(returning,size,picks,outcome);
 expect(trace.has("interaction_haul_team")).toBe(true);
 expect(trace.has("interaction_return_handover")).toBe(outcome!=="miss-supported");
 expect(interactionOutcomes.get("interaction_wagon_bells")).toBe(outcome==="miss-supported"?"failure":outcome);
 expect(state.flags.clock_steady).toBe(true);expect(state.party.some(p=>p.character.questItems.includes("facet_caravan"))).toBe(true);
 expect(state.chapterOutcome).toBe("success");
});
it.each(sizes)("Return %i: a signal without sign or wagon preparation keeps negotiation",size=>{
 const {trace}=walk(returning,size,{...returnPicks,scene_bend_lookout:"scout",choice_the_bend:"talk_master"},"success",1);
 const decision=trace.get("choice_the_bend")!;expect(offered(decision,"arrange_return")).toBe(false);expect(offered(decision,"marked_wagon")).toBe(false);
 expect(offered(decision,"talk_master")).toBe(true);
});
it.each(sizes.flatMap(size=>outcomes.map(outcome=>({size,outcome}))))("Collection $size / $outcome: chalk clues and wagon tracking earn distinct options",({size,outcome})=>{
 const {state,trace,interactionOutcomes}=walk(collection,size,collectPicks,outcome);
 const decision=trace.get("choice_the_bend")!;
 expect(offered(decision,"loud_offer")).toBe(outcome!=="miss-supported");expect(offered(decision,"middle_wagon")).toBe(outcome!=="miss-supported");
 expect(interactionOutcomes.get("interaction_price_clues")).toBe(outcome==="miss-supported"?"failure":outcome);
 expect(interactionOutcomes.get("interaction_wagon_watch")).toBe(outcome==="miss-supported"?"failure":outcome);
 expect(state.flags.climbed_the_mountain).toBe(true);
});
it.each(sizes.flatMap(size=>["loud_offer","middle_wagon","mule_whistle"].map(method=>({size,method}))))("Collection $size / $method: actually uses the earned caravan option",({size,method})=>{
 const {state,trace}=walk(collection,size,{...collectPicks,scene_bend_approach:method==="mule_whistle"?"mules":"high_rock",choice_the_bend:method});
 expect(trace.has("check_bend")).toBe(false);expect(state.party.some(p=>p.character.questItems.includes("facet_caravan"))).toBe(true);
});
it.each(sizes.flatMap(size=>["sell","refuse","hand_back"].flatMap(response=>["climb","walk"].map(exit=>({size,response,exit})))))
 ("Collection $size / $response / $exit keeps costs and the campaign exit",({size,response,exit})=>{
 const {state,trace}=walk(collection,size,{...collectPicks,scene_tamsins_offer:response,choice_tree_line:exit,walk_scene_factions:"news",walk_scene_look_back:"send_word"});
 const before=trace.get("scene_tamsins_offer")!;
 expect(state.coins).toBe((before.coins??0)+(response==="sell"?30:0));
 expect(state.flags.funded_the_break===true).toBe(response==="sell");
 expect(state.flags.clock_late===true).toBe(response==="sell");expect(state.flags.clock_steady===true).toBe(response==="hand_back");
 expect(state.flags.walked_away===true).toBe(exit==="walk");
 const end=collection.scenes[state.sceneId!]!;expect("endsCampaign"in end&&end.endsCampaign===true).toBe(exit==="walk");
 if(exit==="walk")expect(state.xpEarned).toBeGreaterThanOrEqual(60);
});
it.each(sizes.flatMap(size=>["no_shouting","masks_up","bring_one"].map(rule=>({size,rule}))))("Tether $size / $rule earns usable help from its table rule",({size,rule})=>{
 const method=rule==="masks_up"?"two_helpers":"table_works";
 const {state,trace}=walk(tether,size,{...tetherPicks,choice_the_rule:rule,scene_night_visitor:"rule_"+rule,choice_the_test:method});
 const visit=trace.get("scene_night_visitor")!;
 for(const r of ["no_shouting","masks_up","bring_one"])expect(offered(visit,"rule_"+r)).toBe(r===rule);
 expect(trace.has("interaction_tether_team")).toBe(true);expect(trace.has("check_hold")).toBe(false);expect(state.flags.tether_tested).toBe(true);
 expect(state.flags.clock_steady).toBe(true);
});
it.each(sizes.flatMap(size=>outcomes.flatMap(outcome=>["practiced","ledger","chord"].map(tool=>({size,outcome,tool})))))
 ("Tether $size / $outcome / $tool actually plays the selected instrument",({size,outcome,tool})=>{
 const id={practiced:"interaction_practiced_hold",ledger:"interaction_ledger_limits",chord:"interaction_chord_hold"}[tool]!;
 const {state,trace,interactionOutcomes}=walk(tether,size,{...tetherPicks,choice_the_test:tool},"success",20,false,{},"manticore","duskrunner",false,{[id]:outcome});
 expect(trace.has(id)).toBe(true);expect(interactionOutcomes.get(id)).toBe(outcome==="miss-supported"?"failure":outcome);
 expect(state.flags.clock_steady===true).toBe(outcome!=="miss-supported");expect(state.flags.clock_late===true).toBe(outcome==="miss-supported");
 expect(state.party.some(p=>p.character.questItems.includes("facet_caravan"))).toBe(outcome!=="miss-supported");
});
it.each(sizes)("Tether %i: missed practice does not invent preparation or remove the bare-hands option",size=>{
 const {state,trace}=walk(tether,size,{...tetherPicks,scene_night_visitor:"not_mine",choice_the_test:"bare_hands"},"success",20,false,{},"manticore","duskrunner",false,{interaction_small_hum:"miss-supported"});
 expect(state.flags.practiced).not.toBe(true);expect(offered(trace.get("choice_the_test")!,"practiced")).toBe(false);expect(trace.has("check_hold_hard")).toBe(true);
});
it.each(sizes)("Incomplete team work at %i seats never grants the stone or clock",size=>{
 for(const [chapter,id] of [[returning,"interaction_return_handover"],[tether,"interaction_tether_team"],[tether,"interaction_quiet_council"]] as const){
 let state=enterScene(initial(chapter,size),id,context(chapter)).state;const actor=promptOf(state).actorId;
 state=act(chapter,state,{action:"start",relaxed:false},actor);
 const result=applyIntent(state,{playerId:actor,intent:{type:"INTERACT",openedSeq:promptOf(state).openedSeq,attempt:promptOf(state).attempt,action:"complete"}},context(chapter));
 expect(result.error).toBeDefined();expect(result.state.sceneId).toBe(id);expect(result.state.flags.clock_steady).not.toBe(true);expect(result.state.flags.table_works).not.toBe(true);
 }
});
it("All pursuit scene paintings exist",()=>{
 const manifest=read<{sceneIllustrations:string[]}>("assets/manifest.json");
 for(const chapter of [returning,collection,tether])for(const [id,scene]of Object.entries(chapter.scenes))if(scene.art){expect(manifest.sceneIllustrations,id).toContain(scene.art);expect(fs.existsSync(path.join(root,"assets",scene.art+".webp")),id).toBe(true);}
});
const legacy = read<Record<string, Record<string, CheckScene>>>("tools/content/fixtures/gemfall-pursuit-legacy-checks.json");
it.each([returning, collection, tether])("$id still resumes every shipped roll prompt to its original branch", chapter => {
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


it.each(sizes)("Pursuit costs at %i seats consume actual coins and food",size=>{
 const returned=walk(returning,size,{...returnPicks,scene_switchback:"easier_way",scene_evening:"pay_cakes"});
 expect(returned.trace.get("scene_evening_cakes")!.coins).toBe((returned.trace.get("scene_evening")!.coins??0)-2);
 const before=returned.trace.get("scene_switchback")!,after=returned.trace.get("check_wolves")!;
 const held=(s:RunState)=>s.party.flatMap(p=>p.character.inventory).filter(i=>i.itemId==="supper_bundle").length;
 expect(held(before)).toBeGreaterThan(0);expect(held(after)).toBe(held(before)-1);
 const bought=walk(collection,size,{...collectPicks,scene_milestone_boy:"buy"});
 expect(bought.trace.get("scene_milestone_boy_buy")!.coins).toBe((bought.trace.get("scene_milestone_boy")!.coins??0)-4);
});
it.each(sizes)("Tether %i: without instruments, practice or friendship the fallback remains",size=>{
 const {trace}=walk(tether,size,{...tetherPicks,scene_returning_cart:"push",scene_night_visitor:"not_mine",choice_the_test:"bare_hands"},"success",1);
 const decision=trace.get("choice_the_test")!;
 for(const id of ["ledger","chord","practiced","table_works","two_helpers"])expect(offered(decision,id),id).toBe(false);
 expect(offered(decision,"bare_hands")).toBe(true);
});
it.each(sizes)("Pursuit class/species options at %i seats retain complete routes",size=>{
 const r=walk(returning,size,{...returnPicks,scene_morning_slide:"brace_heap",scene_bend_lookout:"scout",choice_the_bend:"marked_wagon"},"success",20,false,{},"manticore","thornguard");
 expect(r.state.phase).toBe("chapter_complete");expect(r.trace.has("interaction_return_handover")).toBe(true);
 const h=walk(collection,size,{...collectPicks,scene_humming_night:"songkeeper_lead"},"success",20,false,{},"kitsune","songkeeper");expect(h.state.phase).toBe("chapter_complete");
 const l=walk(tether,size,{...tetherPicks,scene_returning_cart:"both",choice_the_test:"practiced"},"success",20,false,{},"bigfoot","duskrunner");expect(l.state.flags.practiced).toBe(true);
});

it.each(sizes.flatMap(size=>outcomes.map(outcome=>({size,outcome}))))
 ("Tether review: $size / $outcome contrasts cart help with earned practice",({size,outcome})=>{
 const practiced=walk(tether,size,{...tetherPicks,scene_night_visitor:"not_mine",choice_the_test:"bare_hands"},"success",20,false,{},"manticore","duskrunner",false,{interaction_small_hum:outcome});
 const decision=practiced.trace.get("scene_returning_cart")!;
 expect(offered(decision,"quiet_practice")).toBe(false);
 expect(decision.prompt?.kind==="choice"&&decision.prompt.options.map(o=>o.id)).toEqual(["push","practice"]);
 expect(practiced.trace.get("interaction_small_hum")!.flags.practiced).not.toBe(true);
 expect(practiced.state.flags.practiced===true).toBe(outcome!=="miss-supported");
 expect(practiced.trace.has("scene_returning_cart_practice")).toBe(outcome!=="miss-supported");
 expect(offered(practiced.trace.get("choice_the_test")!,"practiced")).toBe(outcome!=="miss-supported");
 const helped=walk(tether,size,{...tetherPicks,scene_returning_cart:"push",scene_night_visitor:"not_mine",choice_the_test:"bare_hands"});
 expect(helped.trace.has("interaction_small_hum")).toBe(false);expect(helped.state.flags.practiced).not.toBe(true);
 const beads=(state:RunState)=>state.party.flatMap(p=>p.character.inventory).filter(i=>i.itemId==="hearthstone_bead").length;
 expect(beads(helped.trace.get("interaction_tea_cups")!)).toBeGreaterThan(beads(helped.trace.get("scene_returning_cart")!));
 expect(beads(practiced.trace.get("interaction_tea_cups")!)).toBe(beads(decision));
});
it.each(sizes)("Tether review: an already-earned legacy practice save resumes directly at %i seats",size=>{
 const old=read<Chapter>("content/chapters/gemfall-07l.json").scenes.scene_returning_cart_practice;
 expect(old).toEqual({type:"story",narration:"You leave the cart to a passing warden and find a quiet rock. You hold a small humming stone between your hands and try to make it still. It takes all afternoon. Then, for half a breath, it stops. You feel it at once, like a held door. Behind you, the cart gets up the hill without you.",choices:[{id:"on",label:"Back to the table",icon:"note",goto:"interaction_tea_cups"}]});
 let state=enterScene(initial(tether,size,{practiced:true}),"scene_returning_cart_practice",context(tether)).state;
 state=JSON.parse(JSON.stringify(state)) as RunState;
 state=send(state,{type:"CHOOSE",choiceId:"on"},tether);
 expect(state.sceneId).toBe("interaction_tea_cups");expect(state.flags.practiced).toBe(true);
});
