import path from 'node:path';
import {it,expect} from 'vitest';
import {loadContent} from '../../packages/server/src/content/loader.ts';
import {evening,gemfallHousehold} from '../../packages/server/src/handlers/gemfall-compat-probe.ts';
const content=await loadContent(path.resolve(import.meta.dirname,'../../content'));
const clocks=['clock_steady','clock_stirring','clock_late'];
it.each(['restore','leash'].flatMap(pursuit=>clocks.map(clock=>({pursuit,clock}))))
 ('Pursuit settlement: $pursuit replaces $clock after the actual assisted handover',async({pursuit,clock})=>{
 const h=await gemfallHousehold(content);
 await h.harness.repo.putCampaignProgress({householdId:h.householdId,campaignId:'gemfall',status:'active',setbacks:0,lastIndex:6,routeFlags:{route_wild:true,[`pursuit_${pursuit}`]:true,[clock]:true,kept_close:true,motive_curiosity:true},coins:0,updatedAt:'2026-10-27T12:00:00Z'});
 const t=await evening(h);expect(await t.begin()).toBe(pursuit==='restore'?'gemfall-07r':'gemfall-07l');
 await t.goto(pursuit==='restore'?'interaction_return_handover':'interaction_tether_team');
 let s=await t.state();if(s.prompt?.kind!=='interaction')throw Error('activity');
 await t.must({type:'INTERACT',openedSeq:s.prompt.openedSeq,attempt:s.prompt.attempt,action:'assist'});s=await t.state();if(s.prompt?.kind!=='interaction')throw Error('result');
 await t.must({type:'INTERACT',openedSeq:s.prompt.openedSeq,attempt:s.prompt.attempt,action:'continue'});
 expect((await t.state()).party.some(p=>p.character.questItems.includes('facet_caravan'))).toBe(true);
 await t.goto(pursuit==='restore'?'rest_tree_line':'rest_up_the_mountain');
 const row=(await h.attempt())!;expect(row.status).toBe('active');expect(row.lastIndex).toBe(7);
 expect(clocks.filter(c=>row.routeFlags![c])).toEqual(['clock_steady']);expect(row.routeFlags!.route_wild).toBe(true);expect(row.routeFlags!.motive_curiosity).toBe(true);
 expect(row.routeFlags).not.toHaveProperty('caravan_listening');expect(row.routeFlags).not.toHaveProperty('table_works');
 expect(await(await evening(h)).begin()).toBe('gemfall-08');
});
it.each(clocks.flatMap(clock=>['sell','refuse','hand_back'].map(response=>({clock,response}))))
 ('Walk settlement: $response from $clock ends at beat seven and commits earned XP',async({clock,response})=>{
 const h=await gemfallHousehold(content);
 await h.harness.repo.putCampaignProgress({householdId:h.householdId,campaignId:'gemfall',status:'active',setbacks:0,lastIndex:6,routeFlags:{route_wild:true,pursuit_hoard:true,[clock]:true,kept_close:true},coins:0,updatedAt:'2026-10-27T12:00:00Z'});
 const t=await evening(h);expect(await t.begin()).toBe('gemfall-07h');
 await t.goto('scene_tamsins_offer');await t.choose(response);
 await t.goto('choice_tree_line');await t.choose('walk');
 for(let i=0;(await t.state()).phase!=='chapter_complete';i++){
 expect(i).toBeLessThan(45);const s=await t.state();
 if(s.prompt?.kind==='choice')await t.choose(s.prompt.options[0]!.id);
 else if(s.prompt?.kind==='roll')await t.must({type:'ROLL'});
 else await t.must({type:'ADVANCE'});
 }
 const row=(await h.attempt())!;expect(row.status).toBe('complete');expect(row.lastIndex).toBe(7);
 const expected=response==='sell'?'clock_late':response==='hand_back'?'clock_steady':clock;
 expect(clocks.filter(c=>row.routeFlags![c])).toEqual([expected]);
 expect(row.routeFlags!.funded_the_break===true).toBe(response==='sell');
 expect((await t.state()).xpEarned).toBeGreaterThanOrEqual(60);
 const saved=await h.harness.repo.listCharacters(h.householdId);expect(saved[0]!.committed.xp).toBeGreaterThanOrEqual(60);
});
