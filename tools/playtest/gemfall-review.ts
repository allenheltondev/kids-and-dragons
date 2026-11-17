/** Repeatable UI review: npx tsx tools/playtest/gemfall-review.ts [scene,scene].
 * Uses a running local dev server and throwaway tables; captures TV and 320 x 640 phones. */
import { openTable } from './table.ts';
import { interactionActor, steadySituation, haulNeeded, crossingWindow, carryState, type InteractionPrompt } from '../../packages/shared/src/index.ts';
import { expect } from '@playwright/test';
import fs from 'node:fs';
const out=process.env.KAD_REVIEW_OUT ?? 'test-results/playtest/gemfall-revision';
fs.mkdirSync(out,{recursive:true});
const cases=[
 ['gemfall-04b','interaction_calf_load',2,false],
 ['gemfall-04b','interaction_small_mend',1,true],
 ['gemfall-07l','interaction_small_hum',1,true],
 ['gemfall-08','interaction_chimney',4,true],
 ['gemfall-02','interaction_stuck_wagon',2,false],
 ['gemfall-05a','interaction_level',2,true],
 ['gemfall-08','interaction_restore_brace',4,false],
 ['gemfall-05b','check_archive_door',2,true],
 ['gemfall-02','interaction_jackalope_hats',2,false],
 ['gemfall-01','interaction_post_routes',2,true],
 ['gemfall-03b','interaction_runes',2,false],
] as const;
for(const [chapterId,sceneId,players,reducedMotion] of cases){
 if(process.argv[2] && !process.argv[2].split(',').includes(sceneId)) continue;
 const table=await openTable({chapterId,sceneId,players,reducedMotion,startServer:false});
 try{
  for(const phone of table.phones) await phone.setViewportSize({width:320,height:640});
  for(const phone of table.phones) await expect(phone.getByRole('region',{name:'Interaction controls'})).toBeVisible();
  const get=async()=>{const s=await table.state();if(s.prompt?.kind!=='interaction')throw Error('No game');return {s,p:s.prompt};};
  const phoneFor=async()=>{const {s,p}=await get();const id=interactionActor(p,s.party.filter(m=>m.connected).map(m=>m.playerId));return table.phone(s.party.findIndex(m=>m.playerId===id));};
  await (await phoneFor()).getByRole('button',{name:/We.*ready/i}).press('Enter');
  await expect.poll(async()=>(await get()).p.phase).toBe('active');
  for(const page of [table.tv,...table.phones]) await expect.poll(()=>page.locator('.game__board img').evaluateAll(images=>images.every(img=>(img as { complete: boolean }).complete))).toBe(true);
  console.log(await table.snap(sceneId+'-small-active',out));
  const kind=(await get()).p.spec.kind;
  const move=async(extra:()=>Promise<void>)=>{const before=(await get()).p.challenge?.round;await extra();await expect.poll(async()=>{const p=(await get()).p;return p.phase==='result'||p.challenge?.round!==before;}).toBe(true);};
  if(kind==='precision'){
   const phone=await phoneFor(),spec=(await get()).p.spec,hum=spec.kind==='precision'&&spec.handling==='hum',positionLabel=hum?'Note position':'Support position',effortLabel=hum?'Voice strength':'Effort';await phone.getByRole('slider',{name:effortLabel,exact:true}).fill('0');await phone.getByRole('slider',{name:positionLabel}).fill('0');
   await move(async()=>{await phone.getByRole('button',{name:(await get()).p.spec.actionLabel,exact:true}).press('Enter');});
   await phone.reload();await expect(phone.getByRole('slider',{name:positionLabel})).toBeVisible();
   console.log(await table.snap(sceneId+'-miss-and-reload',out));
   while((await get()).p.phase==='active'){
    const {p}=await get(),target=steadySituation(p),next=await phoneFor();
    await next.getByRole('slider',{name:positionLabel}).fill(String(Math.round(target.support*100)));
    await next.getByRole('slider',{name:effortLabel,exact:true}).fill(String(Math.round(target.load*100)));
    await move(async()=>{await next.getByRole('button',{name:p.spec.actionLabel,exact:true}).press('Enter');});
   }
  }else if(kind==='cooperate'){
   for(let seat=0;seat<players;seat++){const phone=table.phone(seat);await phone.getByRole('slider',{name:'Effort',exact:true}).fill('100');await phone.getByRole('button',{name:'Set my effort',exact:true}).press('Enter');await expect.poll(async()=>{const p=(await get()).p;return seat===players-1 ? p.challenge!.round>0 : p.challenge!.pulls[(await get()).s.party[seat]!.playerId]!==undefined;}).toBe(true);}
   console.log(await table.snap(sceneId+'-strain',out));
   while((await get()).p.phase==='active'){
    const round=(await get()).p.challenge!.round;
    for(let seat=0;seat<players;seat++){const {s,p}=await get(),id=s.party[seat]!.playerId,target=haulNeeded(p,s.party.filter(m=>m.connected).map(m=>m.playerId),id),phone=table.phone(seat);await phone.getByRole('slider',{name:'Effort',exact:true}).fill(String(Math.round(target*100)));await phone.getByRole('button',{name:'Set my effort',exact:true}).press('Enter');await expect.poll(async()=>{const p=(await get()).p;return p.challenge!.round!==round||p.challenge!.pulls[id]!==undefined;}).toBe(true);}
   }
  }else if(kind==='timing'){
   while((await get()).p.phase==='active'){const {p}=await get(),phone=await phoneFor();if(reducedMotion) await phone.getByRole('slider',{name:'Crossing moment'}).fill(String(Math.ceil((crossingWindow(p).start+.02)*100))); else await expect(phone.getByRole('region',{name:'Interaction controls'}).locator('.rift-field')).toHaveAttribute('data-safe','true');await move(async()=>{await phone.getByRole('button',{name:p.spec.actionLabel,exact:true}).press('Enter');});}
  }else if(kind==='balance'){
   while((await get()).p.phase==='active'){
    const {s,p}=await get(),ids=s.party.filter(m=>m.connected).map(m=>m.playerId),carry=carryState(p,ids);
    for(let seat=0;seat<s.party.length;seat++){const id=s.party[seat]!.playerId,left=carry.left.includes(id),target=left?.5+carry.shift:.5;const delta=Math.round((target-(p.levels?.[id]??0))*4);
     for(let n=0;n<Math.abs(delta);n++){const before=(await get()).p.levels?.[id]??0;await table.phone(seat).getByRole('button',{name:`${delta>0?'Lift':'Ease'} ${left?'left':'right'} end`,exact:true}).press('Enter');await expect.poll(async()=>(await get()).p.levels?.[id]).not.toBe(before);}}
    await move(async()=>{await (await phoneFor()).getByRole('button',{name:'Take a careful step',exact:true}).press('Enter');});
   }
  }else if(kind==='memory'||kind==='sequence'){
   const {p}=await get();if(p.spec.kind!=='memory'&&p.spec.kind!=='sequence')throw Error();const spec=p.spec;const phone=await phoneFor();
   for(let i=0;i<spec.answer.length;i++){const id=spec.answer[i]!,option=spec.options.find(o=>o.id===id)!;await phone.getByRole('button',{name:option.label,exact:true}).press('Enter');await expect.poll(async()=>(await get()).p.challenge?.arrangement.length).toBe(i+1);}
   if(kind==='sequence'){await move(async()=>{await phone.getByRole('button',{name:'Test these steps',exact:true}).press('Enter');});}
   await move(async()=>{await phone.getByRole('button',{name:spec.actionLabel,exact:true}).press('Enter');});
  }else if(kind==='tracking'){
   const {p}=await get();if(p.spec.kind!=='tracking')throw Error();const spec=p.spec;const target=spec.swaps.reduce((at,[a,b])=>at===a?b:at===b?a:at,spec.start);
   await move(async()=>{await (await phoneFor()).getByRole('button',{name:`${spec.actionLabel}: ${spec.covers[target]}`,exact:true}).press('Enter');});
  }else if(kind==='play'){
   const {p}=await get();if(p.spec.kind!=='play')throw Error();
   for(let seat=0;seat<players;seat++){const option=p.spec.options[seat%p.spec.options.length]!;await table.phone(seat).getByRole('button',{name:option.label,exact:true}).press('Enter');await expect.poll(async()=>(await get()).p.taps??0).toBeGreaterThanOrEqual(seat+1);}
   console.log(await table.snap(sceneId+'-choices',out));
   await (await phoneFor()).getByRole('button',{name:p.spec.actionLabel,exact:true}).press('Enter');
  }
  await expect.poll(async()=>(await get()).p.phase).toBe('result');
  expect((await get()).p.outcome).toBe('success');
  console.log(await table.snap(sceneId+'-result',out));
  const continuation=(await phoneFor()).getByRole('button',{name:'See what happens next',exact:true});
  await continuation.click();
  await expect.poll(async()=>(await table.state()).sceneId).not.toBe(sceneId);
  for(const page of [table.tv,...table.phones]){
   const broken=await page.locator('.game__board img').evaluateAll(images=>images.filter(img=>!(img as { complete: boolean; naturalWidth: number; src: string }).complete||(img as { complete: boolean; naturalWidth: number; src: string }).naturalWidth===0).map(img=>(img as { complete: boolean; naturalWidth: number; src: string }).src));
   if(broken.length)console.log('Images still loading or failed:',broken);
  }
  console.log('PASS',chapterId,sceneId,players,reducedMotion?'stationary':'normal');
 }finally{await table.close();}
}
