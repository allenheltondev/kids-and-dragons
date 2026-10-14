"""Compose review evidence from CLI renders; never writes assets."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import maximum_filter, binary_erosion

ROOT = Path(__file__).resolve().parents[3]
SET = sys.argv[1]
if SET not in ['bigfoot/'+t for t in ['fledgling','sworn','radiant','mythic']]:
    sys.exit('Bigfoot base tiers only')
OUT = ROOT/'art/recut'/SET/'final'
BASE = ROOT/'assets/characters'/SET
Z = json.loads((ROOT/'art/rig/bigfoot.rig.json').read_text())['zOrder']

def pair(left, right, target, labels):
    a,b=Image.open(left).convert('RGB'),Image.open(right).convert('RGB')
    result=Image.new('RGB',(a.width+b.width,max(a.height,b.height)+40),(26,26,30))
    result.paste(a,(0,40));result.paste(b,(a.width,40))
    draw=ImageDraw.Draw(result)
    draw.text((12,12),labels[0],fill='white');draw.text((a.width+12,12),labels[1],fill='white')
    result.save(target)

for clip in ['walk','attack']:
    pair(OUT/f'{clip}-before.png',OUT/f'{clip}.png',OUT/f'{clip}-before-after.png',
         ['BEFORE: original main, underpaint 48','AFTER: recut, underpaint 0'])
for clip in ['idle','walk','attack']:
    sheet=Image.open(OUT/f'sheet-{clip}.png').convert('RGB')
    row=Image.new('RGB',(sheet.width,280),(26,26,30))
    row.paste(sheet.crop((0,0,sheet.width,34)),(0,0))
    row.paste(sheet.crop((0,772,sheet.width,1018)),(0,34))
    row.save(OUT/f'bigfoot-sheet-{clip}.png')

parts={n:np.array(Image.open(BASE/'parts'/f'{n}.png')) for n in Z}
owner=np.full((1024,1024),-1)
for i,n in enumerate(Z): owner[parts[n][...,3]>=128]=i
diag=np.array(Image.open(BASE/'assembled.png'))
body=parts['body'][...,3]>=128
edge=body&~binary_erosion(body,structure=np.ones((3,3)))
diag[edge]=(60,255,90,255)
exceptions=json.loads((BASE/'seam-exceptions.json').read_text())
for key in exceptions:
    b,f=key.split('/')
    seam=(owner==Z.index(f)) & maximum_filter(owner==Z.index(b),size=3)
    band=(parts[f][...,3]==255)&maximum_filter(seam,size=49)
    missing=band&(parts[b][...,3]!=255)
    diag[missing]=(255,60,190,255)
dark=Image.new('RGBA',(1024,1024),(26,26,30,255))
dark.alpha_composite(Image.fromarray(diag))
dark.save(OUT/'contour-band.png')
pair(OUT/'contour-band.png',OUT/'attack.png',OUT/'exception-frame.png',
     ['GREEN: torso edge; PINK: band beyond contour','ATTACK: the submitted torso silhouette'])
