"""Register fight artwork and apply backdrop assignments only where the authored fight exists."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parent

def read(rel):return json.loads((ROOT/rel).read_text(encoding='utf-8-sig'))
def write(rel,value):
 if read(rel)!=value:(ROOT/rel).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
entries=json.loads((HERE/'sources.json').read_text(encoding='utf-8'))
bindings=json.loads((HERE/'fight-bindings.json').read_text(encoding='utf-8-sig'))
m=read('assets/manifest.json')
props=m['storyProps']
for e in entries:
 if e['kind']=='entity-state':
  entity=next(x for x in m['entities'] if x['id']==e['entity'])
  path='entities/'+e['entity']+'/'+e['state']+'.png'
  existing=entity.setdefault('states',{}).get(e['state'])
  assert existing is None or existing==path,(e['id'],'conflicting state')
  assert (ROOT/'assets'/path).is_file(),path
  entity['states'][e['state']]=path
 elif e['kind']=='prop':
  assert (ROOT/'assets/story-props'/(e['id']+'.webp')).is_file(),e['id']
  if e['id'] not in props['ids']:props['ids'].append(e['id'])
  props['motions'][e['id']]=dict(preset='pulse' if e['id'].startswith('pickup-') else 'sway' if e['id']=='fight-disguised-planks' else 'still',durationMs=3200)
 elif e['kind']=='scene':
  path='scenes/riftlight/'+e['id']
  assert (ROOT/'assets'/(path+'.webp')).is_file(),path
  if path not in m['sceneIllustrations']:m['sceneIllustrations'].append(path)
m['fightArt']=bindings
write('assets/manifest.json',m)
report=dict(appliedScenes=[],pendingFights=[])
for fight in bindings['encounters']:
 rel='content/chapters/'+fight['chapter']+'.json';c=read(rel)
 # A shared destination can already exist in an older chapter. Never paint it
 # as a fight outcome unless the encounter that establishes that location exists.
 if fight['scene'] not in c['scenes']:
  report['pendingFights'].append(fight['chapter']+'/'+fight['scene']);continue
 for id in fight['introScenes']+[fight['scene']]:
  assert id in c['scenes'],(fight['chapter'],id)
  c['scenes'][id]['art']=fight['backdrop'];report['appliedScenes'].append(fight['chapter']+'/'+id)
 # Win/loss can rejoin one scene. Poses and pickups must be selected by the
 # authoritative outcome later; no outcome scene is unconditionally overwritten.
 write(rel,c)
(HERE/'integration-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('Registered 10 creature poses, 8 props and 2 paintings.')
print(len(report['appliedScenes']),'scene backdrops applied;',len(report['pendingFights']),'fight definitions await branch integration.')
