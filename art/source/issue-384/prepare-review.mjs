// Adapt the existing cast-shot review harness to show before/after pairs for all 14 figures.
import fs from 'node:fs';
const mf=JSON.parse(fs.readFileSync('assets/manifest.json','utf8'));
const ids=JSON.parse(fs.readFileSync('art/source/issue-384/paintings.json','utf8')).filter(r=>r.id.startsWith('cast/')).map(r=>r.id.slice(5));
const chapter=JSON.parse(fs.readFileSync('content/chapters/gemfall-01.json','utf8'));
const scenes=Object.entries(chapter.scenes).filter(([id,s])=>s.type==='story').slice(0,ids.length).map(([id])=>id);
const prior={warden_clerk:'cast/skywarden_faun',bell_code_expert:'characters/dragonling',bell_courier:'characters/dragonling'};
const review=Object.fromEntries(ids.map((id,i)=>{
  const f=mf.castFigures.find(f=>f.id===id);
  return [scenes[i],[{name:f.name+' (before)',figure:prior[id]??'entities/'+f.basis},{name:f.name+' (after)',figure:'cast/'+id}]];
}));
let source=fs.readFileSync('e2e/cast-shot.spec.ts','utf8');
source='const REVIEW_CAST = '+JSON.stringify(review)+';\n'+source;
source=source.replace('if (members) scene.cast = members;','scene.cast = REVIEW_CAST[id as keyof typeof REVIEW_CAST] ?? members ?? scene.cast;');
source=source.replace('test.setTimeout(300_000);','test.setTimeout(600_000);');
// Current displays must belong to the browser that opened the room.
source=source.replace('const tvCtx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });','const tvCtx = host.context();');
source=source.replace('const tv = await tvCtx.newPage();','const tv = await tvCtx.newPage();\n  await tv.setViewportSize({width:1920,height:1080});');
fs.writeFileSync('e2e/issue384-review.spec.ts',source);
fs.mkdirSync('art/review/issue-384',{recursive:true});
fs.writeFileSync('art/review/issue-384/scenes.json',JSON.stringify({scenes,ids,review},null,2)+'\n');
console.log('Prepared review harness; remove e2e/issue384-review.spec.ts after use.');
