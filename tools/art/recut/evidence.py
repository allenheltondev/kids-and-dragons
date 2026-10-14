"""Read-only pilot evidence: current/main metrics and labelled frame pairs."""
import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import label

ROOT = Path(__file__).resolve().parents[3]
SET=sys.argv[1] if len(sys.argv)>1 else 'bigfoot/fledgling'
if SET not in ['bigfoot/'+t for t in ['fledgling','sworn','radiant','mythic']]:
    sys.exit('Only Bigfoot base tiers are supported.')
sys.path.insert(0,str(ROOT/'tools/art'))
import verify_seams as verifier

OUT=ROOT/'art/recut'/SET/'final'
OUT.mkdir(parents=True,exist_ok=True)
CFG=json.loads((ROOT/'art/rig/bigfoot.rig.json').read_text())
Z=CFG['zOrder']
REL='assets/characters/'+SET
J=json.loads((ROOT/REL/'joints.json').read_text())
yy,xx=np.indices((1024,1024))

def load(ref=None):
    def read(name):
        path=f'{REL}/{name}'
        raw=subprocess.check_output(['git','show',f'{ref}:{path}'],cwd=ROOT) if ref else (ROOT/path).read_bytes()
        return np.array(Image.open(io.BytesIO(raw)).convert('RGBA'))
    return {n:read(f'parts/{n}.png') for n in Z},read('assembled.png')

def metrics(parts,asm):
    alpha={n:parts[n][...,3] for n in Z}
    owner=np.full(asm.shape[:2],-1,np.int16)
    for i,n in enumerate(Z): owner[alpha[n]>=128]=i
    parents=verifier.hierarchy(CFG,set(Z))
    rgb=asm[...,:3].astype(int)
    textured=np.zeros(asm.shape[:2],bool)
    textured[:,:-1]|=np.abs(rgb[:,:-1]-rgb[:,1:]).max(axis=-1)>8
    textured[:-1]|=np.abs(rgb[:-1]-rgb[1:]).max(axis=-1)>8
    rows=[]
    for par,ch in [('body','head'),('body','arm_l'),('body','arm_r'),('body','leg_l'),('body','leg_r'),('body','mane')]:
        b,f=(par,ch) if Z.index(par)<Z.index(ch) else (ch,par)
        bi,fi=Z.index(b),Z.index(f)
        riders=np.zeros_like(alpha[b],bool)
        for n in Z:
            m=n
            while m in parents and parents[m]!=f: m=parents[m]
            if n!=f and parents.get(m)==f and Z.index(n)>fi:
                riders|=alpha[n]==255
        fs=(alpha[f]==255)&~riders
        seam=(owner==fi)&verifier.grow(owner==bi,1)
        row={'pair':f'{b}/{f}','band':None,'joint':None,'copy':None}
        if seam.any():
            band=fs&verifier.grow(seam,24)
            row.update(band=float((band&(alpha[b]==255)).sum()/band.sum()),band_pixels=int(band.sum()))
            if par==b and parents.get(ch)==par and ch in J:
                j=J[ch];near=fs&((xx-j['x'])**2+(yy-j['y'])**2<=64**2)
                if near.any(): row['joint']=float((near&(alpha[b]==255)).sum()/near.sum())
            hidden=band&(alpha[b]==255)&(owner!=bi)&textured
            if hidden.sum()>=200:
                same=(parts[b][...,:3]==asm[...,:3]).all(axis=-1)
                row['copy']=float((same&hidden).sum()/hidden.sum())
        rows.append(row)
    return rows,owner

before,asm=load('origin/main')
after,current_asm=load()
current_j=J
J=json.loads(subprocess.check_output(['git','show',f'origin/main:{REL}/joints.json'],cwd=ROOT))
bm,_=metrics(before,asm)
J=current_j
am,owner=metrics(after,current_asm)
audit={
    'base':subprocess.check_output(['git','rev-parse','origin/main'],cwd=ROOT,text=True).strip(),
    'before':bm,'after':am,
    'parts':{n:{'sha256':hashlib.sha256((ROOT/REL/'parts'/f'{n}.png').read_bytes()).hexdigest(),
        'opaque_components':int(label(after[n][...,3]>=128,np.ones((3,3)))[1]),
        'visible_rgb_changed':int(((after[n][...,:3]!=current_asm[...,:3]).any(axis=-1)&(owner==Z.index(n))).sum()),
        'hidden_nonopaque':int(((after[n][...,3]>0)&(owner>Z.index(n))&(after[n][...,3]!=255)).sum())}
        for n in Z},
    'assembled_unchanged':bool(np.array_equal(asm,current_asm)),
    'rig_sha256':hashlib.sha256((ROOT/REL/'rig.riv').read_bytes()).hexdigest(),
}
(OUT/'audit.json').write_text(json.dumps(audit,indent=2)+'\n')

print(json.dumps({'before':bm,'after':am,'audit':audit['parts']},indent=2))
