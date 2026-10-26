"""Wire the current merged Riftlight opening to the reviewed art deliveries."""
import json
from pathlib import Path
R=Path(__file__).resolve().parents[3];m=json.loads((R/'assets/manifest.json').read_text(encoding='utf-8'))
profiles={
'exchange-rift':{'barge_toss':'exchange-barge-sacks','sack_chain':'exchange-six-boats','ridge_walk':'exchange-squall-ridge','ridge_lee':'exchange-ridge-lee'},
'glacier-survival':{'kid_burrow':'glacier-snow-lip','crust_hold':'glacier-snow-lip','herd_play':'glacier-herd-rest','shelf_cross':'glacier-meltwater-step'},
'riftseekers-departure':{'sledge_lift':'departure-loaded-sledge','ring_sort':'departure-chime-rest','trial_echo':'departure-chime-rest','camp_play':'departure-loaded-sledge'},
'ice-shelf-traverse':{'ring_throw':'shelf-iron-ring','drip_run':'shelf-icicles','hold_line':'ice-shelf-roped-gap','level_line':'ice-shelf-roped-gap'},
'headwaters-washout':{'floe_hop':'headwaters-floes','jam_hold':'headwaters-log-chute','scarf_pass':'headwaters-floes','knob_toss':'headwaters-floes','ledge_ahead':'headwaters-bank-tree'},
'hidden-glacier-rift':{'holes':'hidden-ticking-ridge','squeeze_hold':'hidden-steaming-crack','seam_echo':'hidden-sealed-seam','beat':'hidden-ticking-fold'},
'saltrot-arrival':{'shell_path':'saltrot-high-shells','hatch_party':'tidepocket-open-hatch','lamp_line':'tidepocket-open-hatch','tide_dash':'saltrot-high-shells'},
'frostfang-shore':{'ladder_hold':'frostfang-ladder','bar_carry':'frostfang-gravel-bar','wave_gap':'frostfang-gravel-bar','hay_relay':'frostfang-ladder'},
'cairnstep-pass':{'cairn_order':'cairnstep-survey-slab','drawing_memory':'cairnstep-survey-slab','capstone':'cairnstep-capstone','last_stone':'cairnstep-capstone'},
'boundary-stone-bank':{'surge_check':'boundary-river-row','tighten':'boundary-river-row','chalk_snap':'boundary-river-row','stone_order':'boundary-mountain-carving'},
'ashspan-bridge':{'ferry_dock':'ashspan-ferry-landing','unload_relay':'ashspan-ferry-landing','carry_beam':'ashspan-broken-deck','duck_play':'ashspan-mended-deck'},
'sky-islands-arrival':{'gust_lull':'sky-landing','fuel_chain':'signal-pole','camp_play':'sky-night-windbreak','song_track':'sky-mist-song','song_echo':'sky-mist-song'},
}
report={'chapters':{},'revision':'50388e4865b763e6f212fb4fe85f8ca76ee7a70f'}
for slug,assign in profiles.items():
 p=R/'content/chapters'/('riftlight-'+slug+'.json');c=json.loads(p.read_text(encoding='utf-8'));updates=[]
 for id,art in assign.items():
  assert id in c['scenes'],(slug,id)
  full='scenes/riftlight/'+art;assert full in m['sceneIllustrations'],full
  c['scenes'][id]['art']=full;updates.append(id)
 for id,s in c['scenes'].items():
  for member in s.get('cast',[]):
   name=member.get('name','')
   if name=='Tilly':member['figure']='cast/tilly_eggs' if 'egg' in s.get('narration','').lower() and 'duckling' not in s.get('narration','').lower() else 'cast/tilly'
   elif name=='Bryn':member['figure']='cast/bryn'
   elif name=='Pebble':member['figure']='cast/pebble'
   elif name=='Dob':member['figure']='cast/dob'
   elif slug=='frostfang-shore' and (name=='Tamsin' or member['figure']=='cast/ridge_griffin'):
    member['figure']='cast/tamsin_river_keeper';member['name']='Tamsin'
   elif member['figure']=='cast/goat_kid':member['figure']='cast/snowhorn_kid'
   elif slug=='saltrot-arrival' and 'weaver' in name.lower():member['figure']='cast/skupper_weaver'
  if slug=='exchange-rift' and id=='barge_toss':
   for member in s.get('cast',[]):
    if 'pilot' in member.get('name','').lower() or member['figure']=='entities/frogfolk':member['figure']='cast/frogfolk_pilot'
  if id in ['kid_burrow','holes','ridge_walk','ridge_lee','bar_carry']:
   for member in s.get('cast',[]):
    if member['figure']=='entities/snowhorn_goat':member['figure']='cast/snowhorn_kid';member.pop('size',None)
 if slug=='saltrot-arrival':c['biome']='sallow_wastelands'
 if slug=='ice-shelf-traverse':
  for id in c['scenes']:
   if 'slope' in id:c['scenes'][id]['art']='scenes/riftlight/shelf-steep-slope';updates.append(id)
 p.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');report['chapters'][c['id']]=updates
(R/'docs/reviews/issue-494/runtime-integration.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print('Wired 12 chapters; preserved all authored mechanics and restored the Sallow Wastelands biome.')
