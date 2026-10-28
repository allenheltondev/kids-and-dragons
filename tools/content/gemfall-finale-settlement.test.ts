import path from 'node:path';
import {it,expect} from 'vitest';
import {loadContent} from '../../packages/server/src/content/loader.ts';
import {evening,gemfallHousehold} from '../../packages/server/src/handlers/gemfall-compat-probe.ts';
const content=await loadContent(path.resolve(import.meta.dirname,'../../content'));
it.each(['restore','hoard','leash'].flatMap(pursuit=>['restore','destroy','leash','keystone'].map(philosophy=>({pursuit,philosophy}))))
 ('Finale server: $pursuit can attempt $philosophy and settle the reached ending',async({pursuit,philosophy})=>{
 const h=await gemfallHousehold(content);
 await h.harness.repo.putCampaignProgress({householdId:h.householdId,campaignId:'gemfall',status:'active',setbacks:0,lastIndex:7,routeFlags:{route_wild:true,[`pursuit_${pursuit}`]:true,clock_steady:true,told_wardens:true,motive_curiosity:true},coins:7,updatedAt:'2026-10-27T12:00:00Z'});
 const t=await evening(h);expect(await t.begin()).toBe('gemfall-08');
 async function help(){let s=await t.state();if(s.prompt?.kind!=='interaction')throw Error('activity');await t.must({type:'INTERACT',openedSeq:s.prompt.openedSeq,attempt:s.prompt.attempt,action:'assist'});s=await t.state();if(s.prompt?.kind!=='interaction')throw Error('result');await t.must({type:'INTERACT',openedSeq:s.prompt.openedSeq,attempt:s.prompt.attempt,action:'continue'});}
 await t.goto('scene_verdict');await t.choose('each_voice');await help();expect((await t.state()).flags.dragon_satisfied).toBe(true);
 await t.goto('scene_seal_chamber');const vote=await t.state();if(vote.prompt?.kind!=='choice')throw Error('vote');expect(vote.prompt.options.map(o=>o.id)).toEqual(['restore','destroy','leash','keystone']);
 await t.choose(philosophy);
 if(philosophy==='restore'){await t.choose('brace_together');await help();await t.choose('gems');await t.choose('on');await t.choose('front');}
 else if(philosophy==='destroy'){await t.choose('steady_latch');await help();await t.choose('listen');await t.choose('on');}
 else if(philosophy==='leash'){await t.choose('call_voss');await t.choose('on');await help();await t.choose('on');}
 else {
  if(pursuit==='hoard')await t.choose('collectors');
  else {await t.choose('take');await t.must({type:'ROLL'});if((await t.state()).sceneId==='scene_keystone_refused'){await t.choose('on');expect((await t.state()).flags.keystone_refused).toBe(true);await t.choose('destroy');await t.choose('steady_latch');await help();await t.choose('listen');}}
  await t.choose('on');
 }
 const row=(await h.attempt())!;expect(row.status).toBe('complete');expect(row.lastIndex).toBe(8);expect(row.coins).toBe(7);
 expect(row.routeFlags!.route_wild).toBe(true);expect(row.routeFlags!.motive_curiosity).toBe(true);expect(row.routeFlags!.clock_steady).toBe(true);expect(row.routeFlags!.dragon_satisfied).toBeUndefined();
 expect((await t.state()).phase).toBe('chapter_complete');
});
