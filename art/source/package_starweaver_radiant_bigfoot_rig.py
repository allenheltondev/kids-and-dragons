#!/usr/bin/env python3
"""Package Starweaver Radiant Bigfoot using the approved recut anatomy.

The portrait supplies only traced costume and focus-stone pixels. Canonical
anatomy and hidden seam paint remain byte-identical to the recut base.
"""
from pathlib import Path
import json, shutil
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'assets/characters/bigfoot/radiant'
OUT=ROOT/'assets/character-rigs/starweaver/radiant/bigfoot'
ORDER=['leg_l','leg_r','body','arm_l','arm_r','head','gear_visible','mane','focus_stone']
SIZE=(990,934);OFFSET=(-1,56)
OVERLAY=ROOT/'art/source/mattes/starweaver_radiant_bigfoot_overlay.png'
TARGET_GARMENT=(326,310,686,616)
TARGET_GEM=(698,125,788,246)

def registered(cutout, crop, target):
 cut=cutout.crop(crop)
 alpha=cut.getchannel('A');bounds=alpha.point(lambda v:255 if v>8 else 0).getbbox()
 if bounds is None:raise ValueError('Empty extracted part')
 cut=cut.crop(bounds)
 left,top,right,bottom=target
 width=round((right-left)*SIZE[0]/1024);height=round((bottom-top)*SIZE[1]/1024)
 cut=cut.resize((width,height),Image.Resampling.LANCZOS)
 canvas=Image.new('RGBA',(1024,1024))
 canvas.alpha_composite(cut,(round(left*SIZE[0]/1024)+OFFSET[0],round(top*SIZE[1]/1024)+OFFSET[1]))
 return canvas

def main():
 (OUT/'parts').mkdir(parents=True,exist_ok=True)
 source=Image.open(OVERLAY).convert('RGBA')
 for p in (BASE/'parts').glob('*.png'):shutil.copyfile(p,OUT/'parts'/p.name)
 # The generated extraction keeps the approved garment; fit it to measured
 # portrait bounds, then use the registered anatomy transform.
 w,h=source.size
 garment=registered(source,(0,round(h*.30),round(w*.80),h),TARGET_GARMENT)
 gem=registered(source,(round(w*.65),0,w,round(h*.30)),TARGET_GEM)
 garment.save(OUT/'parts/gear_visible.png');gem.save(OUT/'parts/focus_stone.png')
 composite=Image.new('RGBA',(1024,1024))
 for n in ORDER:composite.alpha_composite(Image.open(OUT/'parts'/f'{n}.png').convert('RGBA'))
 composite.save(OUT/'assembled.png')
 joints=json.loads((BASE/'joints.json').read_text());joints['gear_visible']={'parent':'body','x':510,'y':470};joints['focus_stone']={'parent':'body','x':721,'y':226}
 (OUT/'joints.json').write_text(json.dumps(joints,indent=2)+'\n')
 shutil.copyfile(BASE/'seam-exceptions.json',OUT/'seam-exceptions.json')
 print(f'Packaged {OUT.relative_to(ROOT)}; anatomy copied unchanged from recut base.')
if __name__=='__main__':main()
