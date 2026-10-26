"""Register the second Riftlight art delivery, then apply reviewed scene assignments."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parent

def read(rel):return json.loads((ROOT/rel).read_text(encoding='utf-8-sig'))
def write(rel,value):
 path=ROOT/rel
 if read(rel)!=value:path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

entries=json.loads((HERE/'sources.json').read_text())
m=read('assets/manifest.json')
for e in entries:
 if e['kind']=='scene':
  art='scenes/riftlight/'+e['id']
  assert (ROOT/'assets'/(art+'.webp')).is_file(),art
  if art not in m['sceneIllustrations']:m['sceneIllustrations'].append(art)
 elif e['kind']=='cast':
  entry=dict(id='yeti_grit_seller',name='Grit seller',basis='yeti',scale='medium',heightCm=145,stance='standing')
  existing=next((x for x in m['castFigures'] if x['id']==entry['id']),None)
  if existing is None:m['castFigures'].append(entry)
  else:assert existing==entry,entry['id']
 elif e['kind']=='entity':
  entry=dict(id='duckling',name='Duckling',scale='small',heightCm=20,stance='standing')
  existing=next((x for x in m['stageFigures'] if x['id']==entry['id']),None)
  if existing is None:m['stageFigures'].append(entry)
  else:assert existing==entry,entry['id']
write('assets/manifest.json',m)

assignments=json.loads((HERE/'scene-assignments.json').read_text())
for chapter,groups in assignments.items():
 rel='content/chapters/'+chapter+'.json';c=read(rel);seen=set()
 for g in groups:
  for id in g['scenes']:
   assert id in c['scenes'],(chapter,id)
   assert id not in seen,(chapter,id,'duplicate assignment')
   seen.add(id);c['scenes'][id]['art']=g['art']
 if chapter=='riftlight-hidden-glacier-rift':
  cast=c['scenes']['footing_buy'].setdefault('cast',[])
  if not any(x['figure']=='cast/yeti_grit_seller' for x in cast):
   assert len(cast)<3,'Grit seller needs a free slot'
   cast.append(dict(figure='cast/yeti_grit_seller',name='Grit seller'))
 write(rel,c)
rel='content/chapters/riftlight-ashspan-bridge.json';c=read(rel)
for id in ['hatch','duck_plan','scoop_check','coax_check','trail_check','ducks_safe','ducks_loose']:
 scene=c['scenes'][id]
 # Bryn has no lines in this sequence. Give the third slot to the ducklings.
 cast=[actor for actor in scene.get('cast',[]) if actor['figure'] not in ['cast/bryn','entities/duckling']]
 cast.append(dict(figure='entities/duckling',name='Ducklings',count=3))
 assert len(cast)<=3,(id,'stage full')
 scene['cast']=cast
write(rel,c)
print('Registered batch 2 and applied reviewed art/cast assignments.')
