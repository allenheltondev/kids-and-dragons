"""Register the delivered batch and assign art without importing gameplay changes.
Run from the repository: python docs/reviews/issue-494/integrate.py [target-root]
Missing expanded scenes are skipped; existing chapter text and rules are preserved.
"""
import difflib, json, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
TARGET=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT
REPORT=ROOT/'docs/reviews/issue-494'
changed=[]

def read(rel):
    return json.loads((TARGET/rel).read_text(encoding='utf-8-sig'))

def write(rel,data):
    path=TARGET/rel
    before=path.read_text(encoding='utf-8-sig')
    after=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
    if json.loads(before)==data: return
    changed.extend(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+rel,tofile='b/'+rel))
    path.write_text(after,encoding='utf-8')

cast=[
 ('pebble','Pebble','griffin','small_to_medium',95),
 ('dob','Dob','bigfoot','medium',185),
 ('bryn','Bryn','dragonling','medium',125),
 ('tilly','Tilly','griffin','medium',165),
 ('tilly_eggs','Tilly','griffin','medium',165),
 ('tamsin_river_keeper','Tamsin','griffin','medium_to_large',205),
 ('boundary_runner','Runner','dragonling','small_to_medium',105),
 ('snowhorn_kid','Kid goat','snowhorn_goat','small',45),
]
scenery=['sky-landing','signal-pole','signal-gale','sky-ferry','windbreak-camp','shelf-icicles','headwaters-floes','ashspan-broken-deck','ashspan-mended-deck']
manifest=read('assets/manifest.json')
for id,name,basis,scale,height in cast:
    entry=dict(id=id,name=name,basis=basis,scale=scale,heightCm=height,stance='standing')
    existing=next((e for e in manifest['castFigures'] if e['id']==id),None)
    if existing is None: manifest['castFigures'].append(entry)
    else: existing.update(entry)
for id in scenery:
    art='scenes/riftlight/'+id
    if art not in manifest['sceneIllustrations']: manifest['sceneIllustrations'].append(art)
write('assets/manifest.json',manifest)

def paint(c,ids,art):
    for id in ids.split():
        if id in c['scenes']:
            c['scenes'][id]['art']='scenes/riftlight/'+art

for slug in ['sky-islands-arrival','cairnstep-pass','frostfang-shore','ashspan-bridge','boundary-stone-bank','hidden-glacier-rift','ice-shelf-traverse','headwaters-washout']:
    rel='content/chapters/riftlight-'+slug+'.json'
    c=read(rel)
    expanded=len(c['scenes'])>40
    hatched=False
    for id,s in c['scenes'].items():
        if id=='hatch': hatched=True
        for actor in s.get('cast',[]):
            name=actor.get('name','')
            if slug=='cairnstep-pass' and name=='Pebble': actor['figure']='cast/pebble'
            if slug=='cairnstep-pass' and expanded and actor['figure']=='cast/pass_keeper': actor['name']='Brask'
            if slug=='ashspan-bridge' and name=='Bryn': actor['figure']='cast/bryn'
            if slug=='ashspan-bridge' and name=='Tilly': actor['figure']='cast/tilly' if hatched else 'cast/tilly_eggs'
            if slug=='boundary-stone-bank' and name=='Runner': actor['figure']='cast/boundary_runner'
            if slug=='hidden-glacier-rift' and name=='Kid goat': actor['figure']='cast/snowhorn_kid'
            if slug=='frostfang-shore' and expanded and actor['figure'] in ['cast/ridge_griffin','cast/tamsin']:
                actor['figure']='cast/tamsin_river_keeper'; actor['name']='Tamsin'
    if slug=='sky-islands-arrival':
        paint(c,'island landing landing_held landing_slid lesson pip_notes hum hum_attuned hum_heard hum_fuzzy local markers markers_check markers_set markers_dropped song song_check song_bearing song_muddled edge_scout edge_scouted edge_gusted walker walker_catch walker_call walker_leap walker_safe walker_dragged edge_merge route_vote route_flags island_done island_rest','sky-landing')
        paint(c,'basket_plan pole_ropes pole_wedge pole_smash pole_brace pole_up pole_leaning fuel fuel_logs fuel_twigs fuel_lace fuel_dash fuel_dry fuel_soggy light light_flint light_coals light_fox','signal-pole')
        paint(c,'basket_lit dusk_ferry ferry_lines ferry_flags ferry_tow ferry_whistle ferry_post','signal-gale')
        # A small/smoky failure does not show the tall successful signal flame.
        paint(c,'basket_smoky ferry_bumped','sky-landing')
        paint(c,'ferry_in passengers passengers_fed passengers_calm passengers_stuck thimble thimble_chart fenwick_flags route_ferry','sky-ferry')
        paint(c,'windbreak_rest pip_night night_song bearing_vote bearing_notes bearing_air bearing_chime bearing_sing bearing_found bearing_blurred','windbreak-camp')
        if expanded:
            for id in 'walker walker_catch walker_call walker_leap walker_safe walker_dragged edge_merge windbreak_rest route_ferry'.split():
                s=c['scenes'].get(id)
                if s is not None and len(s.get('cast',[]))<3 and not any(a.get('name')=='Dob' for a in s.get('cast',[])):
                    s.setdefault('cast',[]).append(dict(figure='cast/dob',name='Dob'))
    if slug=='ice-shelf-traverse':
        paint(c,'shelf lineup knots coil beat ring_thud tap slide scout starlight boot_marks ring_pull ring_look squeeze inch packs chop wide_spot wide_snack wide_eat wide_look icicles dash knock gust huddle lull sing','shelf-icicles')
    if slug=='headwaters-washout':
        paint(c,'current stock count pack_grab rally_breath ride feet_first kick_bank floes push_floes climb_floe smash_floe floe_rest floe_warm floe_look snag unhook loop_tie arch arch_flat arch_look arch_light eddy eddy_kick eddy_hook jam jam_gap jam_push chute chute_ride chute_steer chute_brace slip slip_haul slip_swing shiver shiver_eat shiver_sing shiver_paddle goats goats_watch goats_follow ledge_ahead aim aim_kick aim_swing aim_sky ledge grab hook smash lift throw_loop ashore tend tend_warm tend_dry early tree tree_choice climb lasso lane guide call middle rift rift_choice river_chime river_read rift_decision rift_end rapids swim signal mend_signal','headwaters-floes')
    if slug=='ashspan-bridge' and expanded:
        on_bridge=True
        repaired=False
        for id,s in c['scenes'].items():
            if id=='marsh_path': on_bridge=False
            if id=='lashed': repaired=True
            if on_bridge:
                s['art']='scenes/riftlight/'+('ashspan-mended-deck' if repaired else 'ashspan-broken-deck')
                if len(s.get('cast',[]))<3 and not any(a.get('figure')=='cast/old_ossley' for a in s.get('cast',[])):
                    s.setdefault('cast',[]).insert(0,dict(figure='cast/old_ossley',name='Old Ossley'))
        paint(c,'mat_return','ashspan-mended-deck')
    write(rel,c)
print(f'{TARGET}: updated {len(changed)} diff lines')
