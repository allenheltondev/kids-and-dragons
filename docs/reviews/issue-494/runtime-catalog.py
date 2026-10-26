"""Project issue 494's authored scene/encounter art into the small runtime catalog."""
import json
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
 (ROOT/'packages/client/src/world/riftlight-art-urls.ts').write_text('/** Generated by docs/reviews/issue-494/runtime-catalog.py. Import-free for the service worker. */\nexport const RIFTLIGHT_CHAPTER_ART: Readonly<Record<string, readonly string[]>> = '+json.dumps(warm,indent=2)+';\n',encoding='utf-8')
 print('Projected six fight appearances and',sum(len(s) for s in result['interactions'].values()),'interaction appearances.')
if __name__=='__main__':generate()
