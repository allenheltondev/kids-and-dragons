"""Reproducible, registered Riftlight motion layers and accessible review sheets.

Run from any directory with Python + Pillow. No existing artwork is modified.
Neutral layers use dark charcoal rather than forbidden white/silver highlights.
"""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/effects'
REVIEW = ROOT / 'art/review/riftlight'
IDS = ['neutral', 'base', 'green', 'amber', 'blue', 'violet', 'shrink', 'stutter', 'sync', 'open', 'collapse']
COLORS = dict(neutral='#484848', base='#383838', green='#3da461', amber='#bf7430', blue='#467caf', violet='#8964b5')
S = 3


def frame(kind, i):
    im = Image.new('RGBA', (256*S, 256*S))
    d = ImageDraw.Draw(im)
    t = i/12
    phase = t*math.tau
    color = COLORS.get(kind, '#484848')

    def line(points, width=3, alpha=230):
        d.line([(round(x*S), round(y*S)) for x, y in points], fill=(*tuple(bytes.fromhex(color[1:])), alpha), width=round(width*S), joint='curve')

    def oval(rx, ry, width=3, alpha=230, cx=128, cy=130):
        points = [(cx+rx*math.cos(a*math.tau/120), cy+ry*math.sin(a*math.tau/120)) for a in range(121)]
        line(points, width, alpha)

    if kind in ('base', 'neutral', 'open', 'collapse', 'shrink', 'stutter'):
        scale = 1
        if kind == 'shrink':
            scale = 1 - .45*t  # countdown, resets only when the lifecycle loops
        if kind == 'open':
            scale = .08 + .92*i/11
        if kind == 'collapse':
            scale = 1 - .92*i/11
        dx = [0, 0, 4, -3, 0, 0, -5, 2, 0, 3, 0, 0][i] if kind == 'stutter' else 0
        alpha = 210
        if kind in ('open', 'collapse'):
            alpha = round(65+145*math.sin(math.pi*i/11))
        for side in (-1, 1):
            pts = []
            for n in range(65):
                a = n/64*math.pi
                y = 130 - math.cos(a)*52*scale
                x = 128+dx+side*(21*math.sin(a)+2*math.sin(a*5+phase))*scale
                pts.append((x,y))
            line(pts, 3, alpha)
        if kind == 'neutral':
            # Quiet local shimmer, deliberately no diagnostic pulse/ripple/arrow.
            line([(125+2*math.sin(phase+n*.35), 105+n) for n in range(48)], 1.5, 130)
    elif kind == 'green':
        breath = .5-.5*math.cos(phase)
        # Broad outer broken brackets breathe; no other layer occupies this band.
        for side in (-1,1):
            pts=[(128+side*(31+5*breath+4*math.sin(n/40*math.pi)), 92+n*1.9) for n in range(41)]
            line(pts, 4+2*breath, round(140+100*breath))
    elif kind == 'amber':
        # ONE candle tongue, at the foot: its silhouette survives desaturation.
        flicker=[0,2,-1,4,1,-3,2,0,3,-2,1,0][i]
        line([(128,174),(120,161),(124,151),(128+flicker,137),(134,157),(136,165),(128,174)],4)
    elif kind == 'blue':
        # Two travelling nested ripples: offset cycles never leave a blank frame.
        for offset in (0,.5):
            p=(t+offset)%1
            oval(11+14*p, 25+23*p, 2.5, round(245-90*p))
    elif kind == 'violet':
        # Spiral with a broad inward arrowhead; separated from outer brackets.
        pts=[]
        for n in range(85):
            p=n/84
            a=phase+p*math.tau*1.2
            r=1-p*.72
            pts.append((128+24*r*math.cos(a),130+42*r*math.sin(a)))
        line(pts,3.5)
        x,y=pts[-1]; px,py=pts[-4]
        a=math.atan2(y-py,x-px)
        line([(x-9*math.cos(a-.6),y-9*math.sin(a-.6)),(x,y),(x-9*math.cos(a+.6),y-9*math.sin(a+.6))],3.5)
    elif kind == 'sync':
        # Two matched lobes beat together, identical phase in both mouth sheets.
        pulse=.5+.5*math.cos(phase)
        for cx in (113,143):
            oval(3+3*pulse,3+3*pulse,2.5,round(140+100*pulse),cx,130)
        line([(119,130),(137,130)],2,170)
    return im.resize((256,256),Image.Resampling.LANCZOS)


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    REVIEW.mkdir(parents=True,exist_ok=True)
    frames={kind:[frame(kind,i) for i in range(12)] for kind in IDS}
    for kind, images in frames.items():
        sheet=Image.new('RGBA',(3072,256))
        for i,im in enumerate(images): sheet.paste(im,(i*256,0))
        sheet.save(OUT/f'rift_{kind}.sheet.png')
        (OUT/f'rift_{kind}.json').write_text(json.dumps(dict(frames=12,fps=12,size=256),indent=2)+'\n')
    mfpath=ROOT/'assets/manifest.json'
    mf=json.loads(mfpath.read_text(encoding='utf-8'))
    for kind in IDS:
        entry=dict(id=f'rift_{kind}',frames=12,fps=12,size=256,startsOn=None,outOfCombat=True)
        if kind not in ('open','collapse'): entry['loop']=True
        mf['effects']=[e for e in mf['effects'] if e['id']!=entry['id']]+[entry]
    mfpath.write_text(json.dumps(mf,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    # All twelve phases, color above grayscale; common stacks can be compared
    # at every phase, rather than a cherry-picked frame hiding an occlusion.
    stacks=[['green','amber','violet'],['amber','violet'],['green','blue'],['blue']]
    contact=Image.new('RGB',(12*128,4*280),'#e3d9c4')
    draw=ImageDraw.Draw(contact)
    animated=[]
    for row,layers in enumerate(stacks):
        draw.text((8,row*280+3),' + '.join(layers)+' / grayscale below',fill='#383838')
        for i in range(12):
            im=Image.new('RGBA',(256,256),'#d5c9b2')
            for layer in ['base']+layers: im=Image.alpha_composite(im,frames[layer][i])
            thumb=im.convert('RGB').resize((128,128),Image.Resampling.LANCZOS)
            contact.paste(thumb,(i*128,row*280+22))
            contact.paste(ImageOps.grayscale(thumb).convert('RGB'),(i*128,row*280+150))
    contact.save(REVIEW/'common-stacks.png')
    for i in range(12):
        im=Image.new('RGB',(8*192,220),'#d5c9b2'); d=ImageDraw.Draw(im)
        for j,layers in enumerate(stacks):
            tile=Image.new('RGBA',(256,256),'#d5c9b2')
            for layer in ['base']+layers: tile=Image.alpha_composite(tile,frames[layer][i])
            tile=tile.convert('RGB').resize((192,192),Image.Resampling.LANCZOS)
            im.paste(tile,(j*384,24)); im.paste(ImageOps.grayscale(tile).convert('RGB'),(j*384+192,24))
            d.text((j*384+4,4),'+'.join(layers),fill='#383838')
        animated.append(im)
    animated[0].save(REVIEW/'common-stacks.gif',save_all=True,append_images=animated[1:],duration=83,loop=0)
    overview=Image.new('RGB',(12*96,len(IDS)*112),'#d5c9b2'); d=ImageDraw.Draw(overview)
    for row,kind in enumerate(IDS):
        d.text((4,row*112),f'rift_{kind}',fill='#383838')
        for i,im in enumerate(frames[kind]):
            tile=Image.new('RGBA',(256,256),'#d5c9b2'); tile=Image.alpha_composite(tile,im)
            overview.paste(tile.convert('RGB').resize((96,96)),(i*96,row*112+16))
    overview.save(REVIEW/'effects.png')


if __name__=='__main__': main()
