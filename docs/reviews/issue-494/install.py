"""Register reviewed exports and apply presentation to matching authored scenes."""
import argparse,hashlib,importlib.util,json,shutil,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent
args=argparse.ArgumentParser();args.add_argument('--export',action='store_true');options=args.parse_args()
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'))
write=lambda p,v:p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if options.export:
 for records in [HERE/'sources.json']+[HERE/f'batch-{n}/sources.json' for n in range(2,9)]:
  subprocess.run([sys.executable,str(HERE/'export.py'),str(records)],check=True)
a=read(HERE/'final/catalog-additions.json');m=read(ROOT/'assets/manifest.json')
for key in ['castFigures','stageFigures','fightBoards']:
 entries=m.setdefault(key,[])
 for record in a[key]:
  current=next((e for e in entries if e['id']==record['id']),None)
  if current:current.update(record)
  else:entries.append(record)
for key in ['storyProps','storyGlyphs']:
 group=m.setdefault(key,{})
 for field,value in a[key].items():
  if field=='ids':
   ids=group.setdefault('ids',[])
   for id in value:
    if id not in ids:ids.append(id)
  elif field=='motions':group.setdefault(field,{}).update(value)
  else:group[field]=value
for id in a['sceneIllustrations']:
 if id not in m['sceneIllustrations']:m['sceneIllustrations'].append(id)
for id,states in a['entityStates'].items():next(e for e in m['entities'] if e['id']==id).setdefault('states',{}).update(states)
m['fightArt']=read(HERE/'batch-4/fight-bindings.json')
if 'sallow_wastelands' not in m['biomes']:m['biomes'].append('sallow_wastelands')
m['backgroundOnlyBiomes']=[b for b in m['backgroundOnlyBiomes'] if b!='sallow_wastelands']
for name in ['assembled.png','portrait.webp']:
 target=ROOT/'assets/entities/hen'/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/'assets/cast/camp_hen'/name,target)
write(ROOT/'assets/manifest.json',m)
applied=skipped=0
for id,entry in read(HERE/'final/chapter-presentation.json').items():
 p=ROOT/'content/chapters'/(id+'.json');chapter=read(p)
 if id=='riftlight-saltrot-arrival':chapter['biome']='sallow_wastelands'
 for sceneId,record in entry['scenes'].items():
  s=chapter['scenes'].get(sceneId)
  if not s or s['type']!=record['type'] or hashlib.sha256(s.get('narration','').encode('utf-8')).hexdigest()!=record['narrationHash']:skipped+=1;continue
  for key in ['art','cast']:
   if key in record['presentation']:s[key]=record['presentation'][key]
   else:s.pop(key,None)
  applied+=1
 write(p,chapter)
subprocess.run([sys.executable,str(HERE/'runtime-catalog.py')],check=True)
print(f'{applied} matching scene presentations applied; {skipped} changed authoring scenes preserved. Run npm run art:figures after registration.')
