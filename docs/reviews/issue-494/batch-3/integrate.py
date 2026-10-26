"""Install batch 3 paintings and the reusable story-prop catalog."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parent

def read(rel):return json.loads((ROOT/rel).read_text(encoding='utf-8-sig'))
def write(rel,value):
 if read(rel)!=value:(ROOT/rel).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

entries=json.loads((HERE/'sources.json').read_text(encoding='utf-8'))
m=read('assets/manifest.json')
props=[];motions={}
for e in entries:
 if e['kind']=='scene':
  id='scenes/riftlight/'+e['id']
  assert (ROOT/'assets'/(id+'.webp')).is_file(),id
  if id not in m['sceneIllustrations']:m['sceneIllustrations'].append(id)
 elif e['kind']=='prop':
  props.append(e['id'])
  preset='relay' if e['id'].startswith('relay-') else 'swing' if e['id']=='rope-loop' else 'surge' if e['id']=='water-surge' else 'pulse' if e['id'].startswith('note-') else 'still'
  if e['id']=='relay-scarf':preset='sway'
  motions[e['id']]=dict(preset=preset,durationMs=3200 if preset=='relay' else 2600)
  assert (ROOT/'assets/story-props'/(e['id']+'.webp')).is_file(),e['id']
existing=m.get('storyProps',{})
ids=list(existing.get('ids',[]))
for id in props:
 if id not in ids:ids.append(id)
merged_motions={**existing.get('motions',{}),**motions}
m['storyProps']=dict(canvas=dict(width=512,height=512),edgeMarginPx=24,ids=ids,motions=merged_motions)
write('assets/manifest.json',m)
for chapter,groups in json.loads((HERE/'scene-assignments.json').read_text(encoding='utf-8')).items():
 rel='content/chapters/'+chapter+'.json';c=read(rel);seen=set()
 for group in groups:
  for id in group['scenes']:
   assert id in c['scenes'],(chapter,id)
   assert id not in seen,(chapter,id,'duplicate assignment')
   seen.add(id);c['scenes'][id]['art']=group['art']
 if chapter in ['riftlight-exchange-rift','riftlight-glacier-survival']:
  for scene in c['scenes'].values():
   for actor in scene.get('cast',[]):
    if actor['figure']=='cast/goat_kid':actor['figure']='cast/snowhorn_kid'
 write(rel,c)
print('Installed 10 paintings, 13 props, and reviewed chapter assignments.')
