import path from "node:path";
import {it,expect} from "vitest";
import {loadContent} from "../../packages/server/src/content/loader.ts";
import {evening,gemfallHousehold} from "../../packages/server/src/handlers/gemfall-compat-probe.ts";
const content=await loadContent(path.resolve(import.meta.dirname,"../../content"));
const allies=["told_wardens","told_gatherers","kept_close"];
it.each(allies.flatMap(before=>["wardens","gatherers","close"].map(next=>({before,next}))))
 ("Ashfall settlement replaces $before with $next and retains the chosen pursuit",async({before,next})=>{
 for(const purpose of ["restore","hoard","leash","refuse"]){
  const h=await gemfallHousehold(content);
  await h.harness.repo.putCampaignProgress({householdId:h.householdId,campaignId:"gemfall",status:"active",setbacks:0,lastIndex:5,routeFlags:{route_wild:true,[before]:true,motive_curiosity:true},coins:0,updatedAt:"2026-10-27T12:00:00Z"});
  const t=await evening(h);expect(await t.begin()).toBe("gemfall-06");
  await t.goto("scene_crab_thanks");await t.choose("straight_up");
  await t.goto("scene_who_to_tell");await t.choose(next);
  await t.choose("on");
  let s=await t.state();expect(s.sceneId).toBe("interaction_purpose_council");if(s.prompt?.kind!=="interaction")throw Error("council prompt");
  await t.must({type:"INTERACT",openedSeq:s.prompt.openedSeq,attempt:s.prompt.attempt,action:"assist"});s=await t.state();if(s.prompt?.kind!=="interaction")throw Error("result prompt");
  await t.must({type:"INTERACT",openedSeq:s.prompt.openedSeq,attempt:s.prompt.attempt,action:"continue"});
  await t.choose(purpose);
  for(let step=0;(await t.state()).phase!=="chapter_complete";step++){expect(step).toBeLessThan(5);const current=await t.state();if(current.prompt?.kind==="choice")await t.choose(current.prompt.options[0]!.id);else await t.must({type:"ADVANCE"});}
  const flags=(await h.attempt())!.routeFlags!;
  const chosen=next==="close"?"kept_close":`told_${next}`;
  expect(allies.filter(f=>flags[f])).toEqual([chosen]);
  expect(["pursuit_restore","pursuit_hoard","pursuit_leash"].filter(f=>flags[f])).toEqual([purpose==="refuse"?"pursuit_restore":`pursuit_${purpose}`]);
  expect(flags.clock_steady).toBe(true);expect(flags.route_wild).toBe(true);expect(flags.motive_curiosity).toBe(true);
  expect(flags).not.toHaveProperty("truth_compared");expect(flags).not.toHaveProperty("gate_call_used");
 }
});
