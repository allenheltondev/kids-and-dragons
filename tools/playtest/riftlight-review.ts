/** Repeatable UI review: npx tsx tools/playtest/riftlight-review.ts [scene,scene].
 * Uses a running local dev server and throwaway tables; captures TV and 360 x 640 phones. */
import { openTable } from './table.ts';
import { interactionActor, throwSituation, throwFlight, crossingWindow, carryState, type InteractionPrompt } from '../../packages/shared/src/index.ts';
import { expect as baseExpect } from '@playwright/test';
const expect=baseExpect.configure({timeout:30000});
import fs from 'node:fs';
const out='test-results/playtest/riftlight-revision';
fs.mkdirSync(out,{recursive:true});
const cases=[
 ['riftlight-exchange-rift','barge_toss',2,false],
 ['riftlight-stuttering-flats','cross_rhythm',4,true],
 ['riftlight-headwaters-washout','floe_hop',2,false],
 ['riftlight-ashspan-bridge','carry_beam',2,false],
 ['riftlight-sky-islands-arrival','camp_play',2,false],
 ['riftlight-saltrot-arrival','shell_path',1,true],
 ['riftlight-glacier-survival','note_try',2,true],
 ['riftlight-stone-counters','pebble',2,false],
] as const;
for(const [chapterId,sceneId,players,reducedMotion] of cases){
 if(process.argv[2] && !process.argv[2].split(',').includes(sceneId)) continue;
 const table=await openTable({chapterId,sceneId,players,reducedMotion,startServer:false});
 try{
  for(const phone of table.phones) await phone.setViewportSize({width:360,height:640});
  for(const phone of table.phones) await expect(phone.getByRole('region',{name:'Interaction controls'})).toBeVisible();
  const get=async()=>{const s=await table.state();if(s.prompt?.kind!=='interaction')throw Error('No game');return {s,p:s.prompt};};
  const phoneFor=async()=>{const {s,p}=await get();const id=interactionActor(p,s.party.filter(m=>m.connected).map(m=>m.playerId));return table.phone(s.party.findIndex(m=>m.playerId===id));};
  await (await phoneFor()).getByRole('button',{name:/We.*ready/i}).click();
  await expect.poll(async()=>(await get()).p.phase).toBe('active');
  console.log(await table.snap(sceneId+'-small-active',out));
  const kind=(await get()).p.spec.kind;
  const move=async(extra:()=>Promise<void>)=>{const before=(await get()).p.challenge?.round;await extra();await expect.poll(async()=>{const p=(await get()).p;return p.phase==='result'||p.challenge?.round!==before;}).toBe(true);};
  if(kind==='precision'){
   const phone=await phoneFor();await phone.getByRole('slider',{name:'Throw strength'}).fill('0');await phone.getByRole('slider',{name:'Throw height'}).fill('0');
   await move(async()=>{await phone.getByRole('button',{name:(await get()).p.spec.actionLabel,exact:true}).press('Enter');});
   await phone.reload();await expect(phone.getByRole('slider',{name:'Throw strength'})).toBeVisible();
   console.log(await table.snap(sceneId+'-miss-and-reload',out));
   while((await get()).p.phase==='active'){
    const {p}=await get(),target=throwSituation(p);let shot:{s:number;a:number}|undefined;
    for(let a=0;a<=100&&!shot;a+=5)for(let s=0;s<=100;s++){const f=throwFlight(p,s/100,a/100);if(Math.abs(f.landing-target.target)<target.width/2&&f.clearance>=target.clearance){shot={s,a};break;}}
    if(!shot)throw Error('No shot');const next=await phoneFor();await next.getByRole('slider',{name:'Throw strength'}).fill(String(shot.s));await next.getByRole('slider',{name:'Throw height'}).fill(String(shot.a));
    await move(async()=>{await next.getByRole('button',{name:p.spec.actionLabel,exact:true}).press('Enter');});
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
   await move(async()=>{await (await phoneFor()).getByRole('button',{name:`${spec.actionLabel}: ${['Left','Middle','Right'][target]}`,exact:true}).press('Enter');});
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
