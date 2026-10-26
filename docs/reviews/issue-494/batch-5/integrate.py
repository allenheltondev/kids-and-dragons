"""Register the complete fight environment and rescue-pose exports."""
import json,copy
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[4];HERE=Path(__file__).resolve().parent
m=json.loads((ROOT/'assets/manifest.json').read_text(encoding='utf-8'))
e=json.loads((HERE/'sources.json').read_text(encoding='utf-8'))
refs={'tamsin_whistling':'tamsin_river_keeper','brask_pot_lid':'pass_keeper','ossley_pole_tip':'old_ossley','pip_catching_glow':'pip_thistledown','tidepocket_pots':'saltrot_guide'}
for x in e:
 if x['kind']=='cast':
  base=copy.deepcopy(next(c for c in m['castFigures'] if c['id']==refs[x['id']]))
  base['id']=x['id'];base['name']=x['id'].replace('_',' ').title()
  existing=next((c for c in m['castFigures'] if c['id']==base['id']),None)
  if existing:existing.update(base)
  else:m['castFigures'].append(base)
 elif x['kind']=='prop':
  if x['id'] not in m['storyProps']['ids']:m['storyProps']['ids'].append(x['id'])
  preset='pulse' if x['id']=='fight-sideways-flame' else 'sway' if x['id']=='fight-wind-shrub' else 'still'
  m['storyProps']['motions'][x['id']]={'preset':preset,'durationMs':3200}
if 'sallow_wastelands' not in m['biomes']:m['biomes'].append('sallow_wastelands')
m['backgroundOnlyBiomes']=[x for x in m['backgroundOnlyBiomes'] if x!='sallow_wastelands']
for prop in ['fight-warm-mud-hollow','fight-wet-gravel','fight-washed-burrow']:
 target=ROOT/'assets/biomes/sallow_wastelands/props'/(prop+'.png');target.parent.mkdir(parents=True,exist_ok=True)
 Image.open(ROOT/'assets/story-props'/(prop+'.webp')).save(target)
m['fightBoards']=[{'id':x['id'],'tiles':'fight-boards/'+x['id']+'/tiles.png'} for x in e if x['kind']=='tiles' and x['id']!='sallow_wastelands']
(ROOT/'assets/manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Registered 11 fight props, 5 rescue figures, 4 board skins and the tiled Sallow Wastelands biome.')
