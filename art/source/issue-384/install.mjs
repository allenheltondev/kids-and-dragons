// Idempotent data wiring for issue #384; no narration or mechanics are edited.
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const rows = [
  ['seal_keeper','Seal-Keeper','legend_dragon','colossal',1800],
  ['brassbuckle_scout','Brassbuckle scout','burrowfolk','small_to_medium',95],
  ['brassbuckle_recordkeeper','Brassbuckle recordkeeper','burrowfolk','small_to_medium',95],
  ['relay_runner','Relay Runner','centaur','large',230],
  ['masked_choir_singer','Masked choir singer','burrowfolk','small_to_medium',95],
  ['bell_code_expert','Bell-Code Expert','dragonling','small',70],
  ['gullets_cousin',"Gullet's Cousins",'frogfolk','small_to_medium',110],
  ['road_warden','Road-Warden','centaur','large',230],
  ['fishmonger','Fishmonger','yeti','large',280],
  ['road_boss','Road Boss','centaur','large',250],
  ['warden_clerk','Warden Clerk','frogfolk','small_to_medium',110],
  ['rush_prospector','Rush prospector','burrowfolk','small_to_medium',95],
  ['bell_courier','Bell Courier','dragonling','medium',160],
  ['stall_witch','Stall Witch','witch_order','medium',140],
];
const manifestPath='assets/manifest.json';
const mf=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
for(const [id,name,basis,scale,heightCm] of rows) {
  if(!fs.existsSync(`assets/cast/${id}/assembled.png`)) throw new Error(`Missing ${id} painting`);
  const entry={id,name,basis,scale,heightCm,stance:'standing'};
  const i=mf.castFigures.findIndex(f=>f.id===id);
  if(i<0) mf.castFigures.push(entry); else mf.castFigures[i]=entry;
}
mf.figureOverflow['cast/seal_keeper']='top';
mf.$togetherOverlaysComment='Painted overlays for group-action checks (docs/briefs/group-actions.md §7; approved design merged in #361, closing #360). Each declared move has two 1600x360 band states and four 192x192 token states on disk. Runtime support and the content gate described by that design still need implementation. Art export and direct checks: art/source/issue-384/.';
mf.togetherOverlays=[['heave',['slack','taut']],['hum',['wobble','together']],['tiptoe',['hush','over']]].map(([move,states])=>({
  move,band:{width:1600,height:360,clearTopPx:90,fadeSidePx:48,states},
  token:{size:192,holeRadius:62,states:['empty','holding','done','helped']},
}));
fs.writeFileSync(manifestPath,JSON.stringify(mf,null,2)+'\n');
const names=new Map(rows.map(([id,name])=>[name,id]));
names.set('The Seal-Keeper','seal_keeper');
names.set('Muddy prospector','rush_prospector');
names.set('Burrowfolk prospector','rush_prospector');
const changes={};
for(const file of fs.readdirSync('content/chapters').filter(f=>f.startsWith('gemfall-'))) {
  const dest=`content/chapters/${file}`, raw=fs.readFileSync(dest,'utf8'), chapter=JSON.parse(raw);
  let n=0;
  for(const scene of Object.values(chapter.scenes)) for(const member of scene.cast??[]) {
    const id=names.get(member.name);
    if(!id) continue;
    // Preserve the other peoples already painted for this mixed choir.
    if(id==='masked_choir_singer' && !['entities/burrowfolk','cast/masked_choir_singer'].includes(member.figure)) continue;
    if(member.figure===`cast/${id}` && member.size===undefined) continue;
    member.figure=`cast/${id}`;
    delete member.size;
    n++;
  }
  if(!n) continue;
  // Verify that the complete non-cast chapter remains byte-equivalent as JSON.
  const strip=c=>{for(const scene of Object.values(c.scenes)) delete scene.cast; return JSON.stringify(c);};
  if(strip(JSON.parse(raw))!==strip(structuredClone(chapter))) throw new Error(`Non-cast edit: ${file}`);
  fs.writeFileSync(dest,JSON.stringify(chapter,null,2)+'\n');
  changes[file]=n;
}
// File hashes change only for these deliberate cast substitutions. Gameplay digests stay pinned.
const testPath='packages/server/src/handlers/gemfall-compat.test.ts';
let test=fs.readFileSync(testPath,'utf8');
for(const file of Object.keys(changes)) {
  const digest=createHash('sha256').update(fs.readFileSync(`content/chapters/${file}`)).digest('hex');
  test=test.replace(new RegExp(`("chapters/${file.replace('.', '\\.')}": ")[a-f0-9]+`),`$1${digest}`);
}
const reason=' * Re-pinned for #384: fourteen commissioned cast figures replace role stand-ins,\n * including the Seal-Keeper, with heights and stances from the manifest. Chapter\n * edits touch cast figures only (and remove obsolete size overrides); all gameplay\n * digests below remain unchanged.\n *\n';
if(!test.includes('Re-pinned for #384:')) test=test.replace('const GEMFALL_FILES:', 'const GEMFALL_FILES:').replace(' */\nconst GEMFALL_FILES:',reason+' */\nconst GEMFALL_FILES:');
fs.writeFileSync(testPath,test);
console.log(changes);
