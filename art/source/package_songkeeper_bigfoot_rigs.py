#!/usr/bin/env python3
"""Package Bigfoot Songkeeper tiers without changing reviewed base anatomy."""
from pathlib import Path
import json, shutil, sys
from PIL import Image, ImageDraw
import package_starweaver_radiant_bigfoot_rig as layers
ROOT=Path(__file__).resolve().parents[2]
TARGETS={'sworn':(280,340,710,675),'radiant':(265,330,735,650),'mythic':(260,345,750,680)}
layers.SIZE=(1024,1024)
layers.OFFSET=(0,0)

def package(tier):
 base=ROOT/'assets/characters/bigfoot'/tier
 out=ROOT/'assets/character-rigs/songkeeper'/tier/'bigfoot'
 (out/'parts').mkdir(parents=True,exist_ok=True)
 source=Image.open(ROOT/f'art/source/mattes/songkeeper_{tier}_bigfoot_overlay.png').convert('RGBA')
 w,h=source.size
 for p in (base/'parts').glob('*.png'):shutil.copyfile(p,out/'parts'/p.name)
 crop=(0,round(h*.34),w,h) if tier=='sworn' else (0,0,w,h)
 garment=layers.registered(source,crop,TARGETS[tier]);garment.save(out/'parts/gear_visible.png')
 joints=json.loads((base/'joints.json').read_text())
 joints['gear_visible']={'parent':'body','x':510,'y':470}
 order=['leg_l','leg_r','body','arm_l','arm_r','head','mane','gear_visible']
 if tier=='sworn':
  # The ear itself is anatomy, not part of the dangling gold accessory.
  accessory=source.copy();ImageDraw.Draw(accessory).rectangle((round(w*.56),0,w,round(h*.22)),fill=(0,0,0,0))
  ear=layers.registered(accessory,(round(w*.48),0,round(w*.60),round(h*.34)),(535,235,565,365))
  ear.save(out/'parts/ear_chime.png');order.append('ear_chime')
  joints['ear_chime']={'parent':'head','x':545,'y':240}
 composite=Image.new('RGBA',(1024,1024))
 for name in order:composite.alpha_composite(Image.open(out/'parts'/f'{name}.png').convert('RGBA'))
 composite.save(out/'assembled.png')
 (out/'joints.json').write_text(json.dumps(joints,indent=2)+'\n')
 shutil.copyfile(base/'seam-exceptions.json',out/'seam-exceptions.json')
 print(f'Packaged songkeeper/{tier}/bigfoot; recut anatomy unchanged.')

if __name__=='__main__':
 tiers=sys.argv[1:] or list(TARGETS)
 for tier in tiers:
  if tier not in TARGETS:raise SystemExit('tiers: sworn radiant mythic')
  package(tier)
