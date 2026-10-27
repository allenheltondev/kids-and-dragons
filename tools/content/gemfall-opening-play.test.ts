import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { applyEffects, applyIntent, enterScene, playbackMs } from "@kad/shared";
import type { Chapter, CheckScene, ClassId, RunState, SpeciesId } from "@kad/shared";
import { context, send, start } from "./riftlight-test-support.ts";
import { act, landed, miss, promptOf, solve } from "./interaction-play.ts";

const root = path.resolve(import.meta.dirname, "../..");
const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const city = read<Chapter>("content/chapters/gemfall-01.json");
const fields = read<Chapter>("content/chapters/gemfall-02.json");
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
  state.coins = chapter.id === "gemfall-01" ? 0 : 10;
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
      let result: RunState;
      if (outcome === "assisted") {
        result = act(chapter, state, { action: "assist" }, promptOf(state).playerIds.at(-1)!);
        expect(promptOf(result).outcome).toBe("assisted");
      } else if (outcome === "miss-supported") {
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

const cityPicks={scene_prologue_party:"prologue_begin",scene_red_sky:"watch_wall",scene_stampede:"find_table",
 scene_long_bridge:"barge",choice_why_north:"curiosity",scene_newcomers:"carry",scene_docks:"swap",
 scene_griffin_post:"sort",scene_gutter_glint:"checked_bags",scene_gull_dive:"sardine",scene_tavern:"follow",
 choice_ember:"keep",scene_provisions:"honey",scene_market:"keep_coins",scene_inn_full:"story",
 scene_last_noodles:"gift",scene_caravan_yard:"honest",scene_north_gate:"wave"};
const fieldPicks={scene_song_stops:"look",scene_trampled_field:"walk_rows",scene_caravan_turned:"onward",
 scene_egg_stall:"fair",scene_jackalope_road:"look_inland",scene_wolf_sign:"hurry",scene_plank_bridge:"beam",
 scene_embermoths:"watch",choice_night_tremor:"sleep",scene_corner_row:"salute",choice_harvest_stone:"leave",
 scene_signpost:"ruts",scene_hedge_mob:"bridge_brace",choice_pib_gift:"pin",rest_marda_inn:"to_board",
 choice_common_room:"frog",choice_rumour_board:"east"};
it.each(sizes.flatMap(size=>outcomes.map(outcome=>({size,outcome}))))
 ("city: $size seats / $outcome prepares only the mail bags actually checked",({size,outcome})=>{
 const checked=outcome!=="miss-supported";
 const {state,trace,interactionOutcomes}=walk(city,size,{...cityPicks,scene_gutter_glint:checked?"checked_bags":"pocket"},outcome);
 expect(offered(trace.get("scene_gutter_glint")!,"checked_bags")).toBe(checked);
 expect(state.flags.checked_mail_used===true).toBe(checked);
 expect(interactionOutcomes.get("interaction_post_routes")).toBe(outcome==="miss-supported"?"failure":outcome);
 expect(interactionOutcomes.get("interaction_newcomer_load")).toBe(outcome==="assisted"?"assisted":"success");
 expect(state.flags.hired_as_crew).toBe(true);
 expect(trace.has("interaction_inn_account")).toBe(true);
 expect(trace.has("interaction_crew_introduction")).toBe(true);
 expect(state.flags.ember_kept).toBe(true);
 expect(state.party.some(p=>p.character.questItems.includes("facet_ember"))).toBe(true);
 expect(state.chapterOutcome).toBe("success");
 });
it.each(sizes.flatMap(size=>outcomes.flatMap(outcome=>["beam","carry"].map(job=>({size,outcome,job})))))
 ("fields: $size seats / $outcome / $job changes the later hedge approach",({size,outcome,job})=>{
 const {state,trace,interactionOutcomes}=walk(fields,size,{...fieldPicks,scene_plank_bridge:job,scene_hedge_mob:job==="beam"?"bridge_brace":"hay_brushes"},outcome);
 expect(offered(trace.get("scene_hedge_mob")!,"bridge_brace")).toBe(job==="beam");
 expect(offered(trace.get("scene_hedge_mob")!,"hay_brushes")).toBe(job==="carry");
 expect(state.flags.farm_help_used).toBe(true);
 expect(state.flags.fair_prices===true).toBe(outcome!=="miss-supported");
 expect(interactionOutcomes.get("interaction_egg_prices")).toBe(outcome==="miss-supported"?"failure":outcome);
 expect(state.flags.sprites_friends).toBe(true);expect(state.flags.sprites_wronged).not.toBe(true);
 expect(state.flags.route_river).toBe(true);
 expect(state.chapterOutcome).toBe("success");
 });
it.each(sizes)("fields: a polite request works without either farm favor at %i seats",size=>{
 const {state,trace}=walk(fields,size,{...fieldPicks,scene_plank_bridge:"quick_beam",scene_hedge_mob:"honest"},"success",1);
 expect(offered(trace.get("scene_hedge_mob")!,"bridge_brace")).toBe(false);
 expect(offered(trace.get("scene_hedge_mob")!,"hay_brushes")).toBe(false);
 expect(trace.has("interaction_hedge_request")).toBe(true);
 expect(state.flags.let_in_properly).toBe(true);
});
it.each(sizes.flatMap(size=>["wealth","curiosity","prestige","duty","fresh_start","proving"].map(motive=>({size,motive}))))
 ("city: $size seats retains the $motive commitment and sale proceeds",({size,motive})=>{
 const {state,trace}=walk(city,size,{...cityPicks,choice_why_north:motive,choice_ember:"sell"});
 expect(["wealth","curiosity","prestige","duty","fresh_start","proving"].filter(x=>state.flags[`motive_${x}`])).toEqual([motive]);
 expect(state.flags.ember_sold).toBe(true);expect(state.flags.ember_kept).not.toBe(true);
 expect(state.party.every(p=>!p.character.questItems.includes("facet_ember"))).toBe(true);
 expect(trace.get("scene_sold")!.coins).toBe((trace.get("choice_ember")!.coins??0)+15);
 expect(trace.get("scene_newcomers")!.coins).toBe(6);
});
it.each(sizes.flatMap(size=>["east","north","west"].map(road=>({size,road}))))
 ("fields: $size seats carries only the chosen $road road",({size,road})=>{
 const {state}=walk(fields,size,{...fieldPicks,choice_rumour_board:road,choice_harvest_stone:"steal"});
 const expected={east:"route_river",north:"route_rush",west:"route_wild"}[road]!;
 expect(["route_river","route_rush","route_wild"].filter(f=>state.flags[f])).toEqual([expected]);
 expect(state.flags.sprites_wronged).toBe(true);expect(state.flags.sprites_friends).not.toBe(true);
 expect(state.party.some(p=>p.character.questItems.includes("facet_harvest"))).toBe(true);
});
it.each(sizes)("city: feeding the couriers spends food and does not label the mail bags at %i seats",size=>{
 const {trace,state}=walk(city,size,{...cityPicks,scene_griffin_post:"feed",scene_gutter_glint:"griffin",scene_gull_dive:"grab"});
 const food=(s:RunState)=>s.party.flatMap(p=>p.character.inventory).filter(i=>["supper_bundle","honeycake"].includes(i.itemId)).length;
 expect(food(trace.get("scene_griffin_post_feed")!)).toBe(food(trace.get("scene_griffin_post")!)-1);
 expect(state.flags.griffin_friends).toBe(true);expect(state.flags.post_routes_checked).not.toBe(true);
 expect(offered(trace.get("scene_gutter_glint")!,"checked_bags")).toBe(false);
});
it.each(sizes)("opening work preserves species and ability shortcuts at %i seats",size=>{
 const a=walk(city,size,{...cityPicks,scene_prologue_party:"lamps",scene_long_bridge:"lamp_path",scene_gull_dive:"grab",scene_caravan_yard:"lift_wagon"},"assisted",20,false,{},"bigfoot","thornguard");
 expect(a.trace.has("scene_long_bridge_lamp_path")).toBe(true);
 expect(a.trace.has("interaction_crew_introduction")).toBe(false);
 expect(a.trace.has("interaction_checked_mail")).toBe(true);
 const b=walk(fields,size,{...fieldPicks,scene_plank_bridge:"shoulders",scene_hedge_mob:"bridge_brace"},"assisted",20,false,{},"bigfoot","thornguard");
 expect(b.trace.has("interaction_bridge_load")).toBe(false);expect(b.state.flags.farm_help_used).toBe(true);
});
it.each([city,fields])("$id keeps scene art registered and present",chapter=>{
 const manifest=read<{sceneIllustrations:string[]}>("assets/manifest.json");
 for(const [id,scene] of Object.entries(chapter.scenes))if(scene.art){expect(manifest.sceneIllustrations,id).toContain(scene.art);expect(fs.existsSync(path.join(root,"assets",scene.art+".webp")),id).toBe(true);}
});
const legacy = read<Record<string, Record<string, CheckScene>>>("tools/content/fixtures/gemfall-opening-legacy-checks.json");
it.each([city, fields])("$id still resumes every shipped roll prompt to its original branch", chapter => {
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
it.each(sizes)("unfinished opening jobs cannot award preparation at %i seats",size=>{
 for(const [chapter,id,flag] of [
  [city,"interaction_checked_mail","checked_mail_used"],
  [city,"interaction_crew_introduction","hired_as_crew"],
  [fields,"interaction_bridge_load","bridge_mended"],
  [fields,"interaction_hedge_brace","farm_help_used"],
 ] as const){
  let state=enterScene(initial(chapter,size),id,context(chapter)).state;
  expect(miss(chapter,state)).toBeNull();
  const actor=promptOf(state).actorId;
  state=act(chapter,state,{action:"start",relaxed:false},actor);
  const result=applyIntent(state,{playerId:actor,intent:{type:"INTERACT",openedSeq:promptOf(state).openedSeq,attempt:promptOf(state).attempt,action:"complete"}},context(chapter));
  expect(result.error,id).toBeDefined();expect(promptOf(state).outcome).toBeUndefined();expect(state.flags[flag]).not.toBe(true);
 }
});
