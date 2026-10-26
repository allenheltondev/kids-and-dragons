"""Project issue 494's authored scene/encounter art into the small runtime catalog."""
import json,copy,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]

def mapping():
 return {
 'exchange-rift':{'barge_toss':['rope-loop','iron-anchor-ring'],'sack_chain':['relay-sack'],'ridge_walk':['coat-kid'],'ridge_lee':['coat-kid','wind-blanket']},
 'glacier-survival':{'kid_burrow':['snow-mound'],'crust_hold':['roof-slab','rope-wedge'],'herd_play':['goat-brush','relay-hay'],'shelf_cross':['water-surge','moving-floe'],'note_try':['note-low','note-middle','note-high']},
 'riftseekers-departure':{'sledge_lift':['relay-trunk','relay-barrel','relay-sack'],'ring_sort':['ring-case','clue-scrap'],'trial_echo':['standing-rings','note-low','note-middle','note-high'],'camp_play':['wind-blanket','camp-firepit','barley-tea']},
 'ice-shelf-traverse':{'ring_throw':['rope-loop','iron-anchor-ring'],'drip_run':['icicle-drips'],'hold_line':['rope-taut','rope-sag'],'level_line':['rope-sag','rope-taut']},
 'headwaters-washout':{'floe_hop':['moving-floe','water-surge'],'jam_hold':['relay-log','rope-taut'],'scarf_pass':['relay-scarf'],'knob_toss':['rope-loop','ice-knob']},
 'hidden-glacier-rift':{'holes':['snow-mound','ticking-crystal'],'squeeze_hold':['roof-slab','rope-wedge'],'seam_echo':['ticking-crystal'],'beat':['ticking-crystal']},
 'saltrot-arrival':{'shell_path':['shell-whelk','shell-cockle','shell-oyster'],'hatch_party':['hatch-cover','kelp-cake','tidepocket-broom'],'lamp_line':['relay-oil-jar','rope-ladder','hanging-lamp'],'tide_dash':['water-surge','shell-cockle']},
 'frostfang-shore':{'ladder_hold':['rope-ladder','rope-taut'],'bar_carry':['coat-kid','rope-sag'],'wave_gap':['water-surge','fight-wet-gravel'],'hay_relay':['relay-hay','rope-basket']},
 'cairnstep-pass':{'cairn_order':['cairn-leaning','cairn-flat','cairn-twin','clue-scrap'],'drawing_memory':['cairn-ledger'],'capstone':['cairn-flat','capstone-target'],'last_stone':['toss-pebble','capstone-target']},
 'boundary-stone-bank':{'surge_check':['boundary-bundle','water-surge'],'tighten':['count-cord'],'chalk_snap':['chalk-cord'],'stone_order':['fight-wet-gravel','notched-stone','carved-stone']},
 'ashspan-bridge':{'ferry_dock':['ferry-boat','fight-mooring-post'],'unload_relay':['relay-plank','relay-plank-cracked'],'carry_beam':['carry-beam'],'duck_play':['oat-crumbs']},
 'sky-islands-arrival':{'gust_lull':['wind-banner','fight-signal-pole'],'fuel_chain':['relay-log','fight-signal-pole','rope-ladder'],'camp_play':['kite-shade','barley-tea','wind-blanket','camp-firepit'],'song_track':['wind-bells'],'song_echo':['fight-shrine-bell','cloud-whale','note-low','note-middle','note-high']},
 }

def generate():
 m=json.loads((ROOT/'assets/manifest.json').read_text(encoding='utf-8'))
 fights=json.loads(json.dumps(m['fightArt']['encounters']))
 skins=['fight_gravel_ford','fight_gravel_ford','fight_cairn_pass',None,'fight_ferry_landing','fight_wind_yard']
 terrain=[['fight-wet-gravel','fight-grounded-floe'],['fight-burrow-mouth','fight-washed-burrow'],['fight-supply-cairn'],['fight-warm-mud-hollow'],['fight-landing-ramp','fight-mooring-post','fight-plank-edge'],['fight-signal-pole','fight-wind-shrub']]
 rescue=['','tamsin_whistling','brask_pot_lid','tidepocket_pots','ossley_pole_tip','']
 for i,f in enumerate(fights):
  f['tileUrl']='/assets/fight-boards/'+skins[i]+'/tiles.png' if skins[i] else '/assets/biomes/sallow_wastelands/tiles.png'
  f['terrainProps']=terrain[i];f['rescueFigure']=rescue[i];f['retreatDirection']=-1 if i==0 else 1
  f['activeUrl']='/assets/entities/'+f['creature']+'/'+('assembled' if f['poses']['intro']=='ordinary' else f['poses']['intro'])+'.png'
  f['retreatUrl']='/assets/entities/'+f['creature']+'/shooed.png'
 result={'fights':fights,'interactions':{'riftlight-'+chapter:{scene:{'props':props} for scene,props in scenes.items()} for chapter,scenes in mapping().items()}}
 target=ROOT/'packages/client/src/world/riftlight-art.generated.json'
 target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 reactions={
 'exchange-rift':['kid_shivering','kid_kicking','kid_listening','frogfolk_pilot'],
 'glacier-survival':['kid_peeking','kid_burrowing','lead_goat_bell','goat_leaning','goat_chewing','singer_low','singer_rise','singer_hold','herder_hay_water'],
 'riftseekers-departure':['seren_listening','olivia_blanket','lead_goat_bell'],
 'hidden-glacier-rift':['kid_peeking','kid_burrowing'],
 'saltrot-arrival':['skupper_child','skupper_grandmother','skupper_weaver','tidepocket_pots'],
 'ashspan-bridge':['duckling_heap','duckling_peeping','duckling_yawning','duckling_crumbs','kid_kicking','ossley_pole_tip'],
 'sky-islands-arrival':['camp_hen','seren_listening','pip_catching_glow'],
 }
 warm={}
 for chapter,scenes in result['interactions'].items():
  urls={'/assets/story-props/'+id+'.webp' for scene in scenes.values() for id in scene['props']}
  urls.update('/assets/cast/'+id+'/assembled.png' for id in reactions.get(chapter.removeprefix('riftlight-'),[]))
  urls.update('/assets/story-glyphs/'+id+'.svg' for id in ['tick','tock','hush','slow','quick','hold','coin'])
  for f in fights:
   if f['chapter']!=chapter:continue
   urls.update([f['tileUrl'],f['activeUrl'],f['retreatUrl']])
   urls.update('/assets/story-props/'+id+'.webp' for id in f['props']+f['terrainProps'])
   if f['rescueFigure']:urls.add('/assets/cast/'+f['rescueFigure']+'/assembled.png')
   if f['creature']=='mire_mimic':urls.add('/assets/entities/mire_mimic/little.png')
   if f['poses'].get('recovery'):urls.add('/assets/entities/'+f['creature']+'/'+f['poses']['recovery']+'.png')
  warm[chapter]=sorted(urls)
 for chapter,interactions in result['interactions'].items():
  path=ROOT/'content/chapters'/(chapter+'.json')
  content=json.loads(path.read_text(encoding='utf-8'))
  used={key for key in ['chapter','scene','creature','introScenes','board','backdrop','props','poses','victoryScene','defeatScene','tileUrl','terrainProps','rescueFigure','activeUrl','retreatUrl','retreatDirection']}
  content['presentation']={'fights':[{k:v for k,v in f.items() if k in used} for f in fights if f['chapter']==chapter],'interactions':interactions,'warmUrls':warm[chapter]}
  art=content['presentation']
  for f in art['fights']:
   casts={}
   for won in [True,False]:
    members=copy.deepcopy(content['scenes'][f['victoryScene'] if won else f['defeatScene']].get('cast',[]))
    if not won and f['rescueFigure']:
     pattern={'tamsin_whistling':'tamsin|ridge.griffin','brask_pot_lid':'brask|pass_keeper','ossley_pole_tip':'ossley'}.get(f['rescueFigure'])
     found=next((m for m in members if pattern and re.search(pattern,m.get('name',m['figure']),re.I)),None)
     if found is not None:found['figure']='cast/'+f['rescueFigure']
     elif len(members)<3:members.append({'figure':'cast/'+f['rescueFigure'],'name':'Tidepocket family'})
    if won and f['creature']=='will_o_wisp':
     for member in members:
      if member['figure']=='cast/pip_thistledown':member['figure']='cast/pip_catching_glow'
    if not won and f['poses'].get('recovery') and len(members)<3:members.append({'figure':'entities/'+f['creature'],'name':'Young river drakes','count':2})
    casts['victory' if won else 'defeat']=members
   f['outcomeCast']=casts
  art['reactions']={};art['castPoses']={}
  def reaction(scene,text):
   text=text.lower()
   if scene=='note_try':return 'singer_rise' if re.search('rise|high',text) else 'singer_hold' if re.search('hold|middle',text) else 'singer_low'
   if scene=='duck_play':return 'duckling_crumbs' if re.search('crumb|feed|oat',text) else 'duckling_yawning' if re.search('yawn|sleep|rest',text) else 'duckling_peeping' if re.search('peep|sing|talk',text) else 'duckling_heap'
   if scene=='ridge_lee':return 'kid_listening' if re.search('hum|sing|tune',text) else 'kid_kicking' if re.search('rub|kick|warm',text) else 'kid_shivering'
   if scene=='herd_play':return 'goat_chewing' if re.search('hay|feed',text) else 'goat_leaning' if re.search('brush|pet|rub',text) else 'lead_goat_bell'
  for scene in interactions:
   if scene in ['note_try','duck_play','ridge_lee','herd_play']:
    spec=content['scenes'][scene]['interaction'];field='memory' if spec['kind']=='memory' else 'options'
    art['reactions'][scene]={'defaultFigure':reaction(scene,''),field:{o['id']:reaction(scene,o['label']) for o in spec['options']}}
   if scene=='carry_beam':art['reactions'][scene]={'onFailure':'kid_kicking'}
   poses={}
   if scene=='ferry_dock':poses['cast/old_ossley']='ossley_pole_tip'
   if scene in ['shelf_cross','crust_hold','herd_play']:poses['cast/yeti_herder']='herder_hay_water'
   if scene in ['trial_echo','song_track']:poses['cast/seren_wisp']='seren_listening'
   if scene=='trial_echo':poses['cast/lady_olivia']='olivia_blanket'
   if poses:art['castPoses'][scene]=poses
  path.write_text(json.dumps(content,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print('Projected six fight appearances and',sum(len(s) for s in result['interactions'].values()),'interaction appearances.')
if __name__=='__main__':generate()
