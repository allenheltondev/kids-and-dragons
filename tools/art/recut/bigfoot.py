"""Hand-traced Bigfoot ownership and receiving-part fur continuation. Never alters approved art."""
import json
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, label, binary_erosion, maximum_filter, gaussian_filter, binary_fill_holes

ROOT = Path(__file__).resolve().parents[3]
SET = sys.argv[1] if len(sys.argv) > 1 else ''
if SET not in ['bigfoot/fledgling','bigfoot/sworn','bigfoot/radiant','bigfoot/mythic']:
    sys.exit('Only the four Bigfoot base tiers are supported.')
BASE = ROOT / 'assets/characters' / SET
OUT = ROOT / 'art/recut' / SET
OUT.mkdir(parents=True, exist_ok=True)
A = np.array(Image.open(BASE / 'assembled.png').convert('RGBA'))
CFG = json.loads((ROOT / 'art/rig/bigfoot.rig.json').read_text())
J = json.loads((BASE / 'joints.json').read_text())
Z = CFG['zOrder']
H, W = A.shape[:2]

def polygon(points):
    im = Image.new('L', (W, H))
    ImageDraw.Draw(im).polygon([tuple(p) for p in points], fill=255)
    return np.array(im) != 0

def smooth_contour(points):
    pts=np.array(points,float)
    samples=[]
    for i in range(len(pts)):
        p0,p1,p2,p3=[pts[j%len(pts)] for j in [i-1,i,i+1,i+2]]
        for t in np.linspace(0,1,24,endpoint=False):
            q=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)
            samples.append(tuple(q))
    return polygon(samples)


def grow(m, r):
    return maximum_filter(m, size=2*r+1)

# Coordinates are canvas-registered, manually traced from the approved drawing.
# The silhouette comes exclusively from assembled alpha; these polygons only
# decide ownership on the inside of that silhouette.
face = polygon([(347,211),(352,191),(364,177),(380,170),(396,182),
    (409,164),(432,166),(452,159),(463,166),(482,168),(491,180),
    (501,184),(493,193),(501,199),(492,207),(503,215),(496,223),
    (501,239),(488,246),(478,251),(471,263),(469,276),(473,288),
    (466,297),(460,315),(445,325),(440,339),(424,336),(414,341),
    (407,333),(392,333),(383,326),(369,323),(359,315),(350,304),
    (345,285),(348,267),(349,251),(353,234)])
ear = polygon([(537,226),(545,220),(557,224),(563,233),(563,247),
    (552,253),(543,244)])
mane = polygon([(270,0),(800,0),(800,310),(710,345),(694,347),
    (676,337),(661,334),(659,345),(643,340),(647,356),(628,351),
    (621,361),(611,362),(606,374),(598,370),(597,388),(580,391),
    (568,407),(558,405),(548,428),(533,425),(527,437),(510,438),
    (502,450),(484,460),(475,464),(465,475),(451,479),(437,493),
    (427,481),(420,480),(410,471),(402,466),(390,453),(380,450),
    (371,436),(362,428),(352,413),(345,410),(344,393),(334,398),
    (327,386),(319,402),(295,390),(270,320)]) & ~face & ~ear
# Follow the drawn hair/coat boundary rather than taking the light coat
# fringe into the mane. The face/ear silhouettes have already been excluded.
mane = grow(mane, 5) & ~face & ~ear
mane &= ~((A[...,0]>205)&(A[...,1]>170)&
    (A[...,0].astype(int)-A[...,1].astype(int)<28))
left_arm = polygon([(610,370),(625,365),(645,355),(800,330),
    (820,800),(740,780),(700,750),(650,745),(631,729),(616,706),
    (610,680),(613,657),(619,635),(626,612),(630,590),(628,564),
    (624,542),(623,521),(624,501),(616,491),(606,464),
    (596,445),(580,425),(598,410)])
right_arm = polygon([(200,350),(347,365),(350,400),(351,425),(355,449),
    (363,459),(384,475),(380,491),(380,509),(381,527),(385,548),
    (375,568),(367,588),(365,606),(361,625),(357,650),(358,675),
    (363,699),(350,725),
    (353,751),(250,768),(200,680)])
left_leg = polygon([(490,637),(511,619),(537,607),(562,610),
    (589,625),(606,608),(625,575),(649,590),(660,950),(450,950),
    (488,826),(498,747),(488,699)])
right_leg = polygon([(351,568),(373,575),(398,601),(429,620),
    (453,624),(473,634),(490,638),(488,691),(490,743),(504,798),
    (504,950),(270,950),(320,804),(342,731)])
regions = {'body': np.ones((H,W),bool), 'leg_l': left_leg,
    'leg_r':right_leg, 'arm_l':left_arm, 'arm_r':right_arm,
    'head': face|ear, 'mane':mane}
# Cream flecks beside the far shoulder and isolated pale seam pixels belong
# to the coat beneath the hair, rather than moving with the mane.
pale=mane & (A[...,0]>180) & (A[...,1]>160)
pl,pc=label(pale,np.ones((3,3)))
for pi in range(1,pc+1):
    region=pl==pi
    py,px=np.where(region)
    if (py.mean()>300 and px.mean()>630) or (py.mean()>350 and len(py)<20):
        mane[region]=False
# Tier-specific registration: facial and hair traces are individual; limbs
# use the same anatomical trace registered through their pinned hinges.
if SET != 'bigfoot/fledgling':
    tier=SET.split('/')[1]
    geometry=json.loads((Path(__file__).parent/'bigfoot-traces.json').read_text())[tier]
    face=polygon(geometry['face'])
    ear=polygon(geometry['ear'])
    mane=polygon(geometry['mane']) & ~face & ~ear
    regions['head']=face|ear
    regions['mane']=mane
    def register(mask,part):
        joint=J[part]
        ref={'arm_l':(625.1129,474.451),'arm_r':(379.9943,474.989),
             'leg_l':(589.989,620.006),'leg_r':(429.994,619.989)}[part]
        gy,gx=np.indices(mask.shape)
        # Taper hinge registration towards unchanged canvas feet/hand tips.
        weight=np.clip((860-gy)/(860-joint['y']),0,1)
        sx=np.rint(gx-(joint['x']-ref[0])*weight).astype(int)
        sy=np.rint(gy-(joint['y']-ref[1])*weight).astype(int)
        return mask[np.clip(sy,0,H-1),np.clip(sx,0,W-1)]
    for part in ['leg_l','leg_r']:
        regions[part]=register(regions[part],part)
    for part in ['arm_l','arm_r']:
        regions[part]=polygon(geometry[part])
    if 'thumb' in geometry:
        thumb=polygon(geometry['thumb'])
        # Include the owning thumb's outer ink and its antialiased edge.
        regions['arm_l'] |= grow(thumb,4)
    cream=(A[...,0]>165)&(A[...,1]>135)&(A[...,0].astype(int)-A[...,1].astype(int)<42)&(A[...,1].astype(int)-A[...,2].astype(int)<50)
    mane &= ~(cream & (distance_transform_edt(mane)<=8) & (np.indices((H,W))[0]>300))
    regions['mane']=mane
if SET!='bigfoot/fledgling':
    hair_candidate=grow(mane,12)&~face&~ear&(A[...,3]>0)
    cream=(A[...,0]>165)&(A[...,1]>135)&(A[...,0].astype(int)-A[...,1].astype(int)<42)&(A[...,1].astype(int)-A[...,2].astype(int)<50)
    hair_candidate &= ~cream
    hl,hc=label(hair_candidate,np.ones((3,3)));hs=np.bincount(hl.ravel());hs[0]=0
    mane=binary_fill_holes(hl==hs.argmax())&~face&~ear
    regions['mane']=mane
# Explicit ownership precedence follows anatomy, not the old slab masks.
owner = np.full((H,W),Z.index('body'),np.int16)
for n in ['leg_l','leg_r','arm_l','arm_r','head','mane']:
    owner[regions[n]] = Z.index(n)
if SET!='bigfoot/fledgling':
    for arm in ['arm_l','arm_r']:
        selected=owner==Z.index(arm)
        labs,count=label(selected&(A[...,3]>=128),np.ones((3,3)))
        sizes=np.bincount(labs.ravel());sizes[0]=0
        isolated=selected&(labs!=sizes.argmax())
        owner[isolated]=Z.index('mane')
if SET!='bigfoot/fledgling':
    own_torso=smooth_contour(geometry['torso'])
    boundary=own_torso & (distance_transform_edt(own_torso)<=4)
    coat=(A[...,0]>150)&(A[...,1]>120)
    surplus=(owner==Z.index('body')) & (~own_torso | (boundary&coat&(np.indices((H,W))[0]<geometry['waist']-40)))
    gy,gx=np.indices((H,W))
    owner[surplus&(gx<512)]=Z.index('arm_r')
    owner[surplus&(gx>=512)]=Z.index('arm_l')
owner[A[...,3] == 0] = -1
waist=637 if SET=='bigfoot/fledgling' else geometry['waist']
owner[(owner==Z.index('body'))&(np.indices((H,W))[0]>waist)] = Z.index('leg_r')
# The far toes and inner thigh remain leg pixels even when a trace ends at
# their outline. Assign the complete connected anatomical silhouette.
low=(owner==Z.index('leg_r'))&(np.indices((H,W))[0]>waist)&(np.indices((H,W))[1]>490)
owner[low]=Z.index('leg_l')
# Keep each complete foot with its leg. The nearer toes project left of x490;
# a vertical split there was invisible at rest and opened a slit in stride.
front_foot=polygon([(505,780),(505,811),(497,824),(477,845),
    (462,858),(452,880),(452,1024),(1024,1024),(1024,780)])
feet=(np.indices((H,W))[0]>=780)&(A[...,3]>0)
owner[feet&front_foot]=Z.index('leg_l')
owner[feet&~front_foot]=Z.index('leg_r')
# Remove trace slivers from visible ownership by giving each to the closest
# main silhouette, never deleting approved pixels.
main={}
for n in Z:
    labels,count=label((owner==Z.index(n))&(A[...,3]>=128),np.ones((3,3)))
    sizes=np.bincount(labels.ravel());sizes[0]=0
    main[n]=labels==sizes.argmax()
dist=np.stack([distance_transform_edt(~main[n]) for n in Z])
for n in Z:
    if n=='head' and SET!='bigfoot/fledgling':
        continue
    slivers=(owner==Z.index(n))&~main[n]&(A[...,3]>=128)
    choices=dist.copy();choices[Z.index(n)]=np.inf
    if SET!='bigfoot/fledgling': choices[Z.index('head')]=np.inf
    nearest=choices.argmin(axis=0)
    owner[slivers]=nearest[slivers]
# Grow real connected neighbours through the approved opaque silhouette to
# absorb sub-64px ownership specks without deleting approved visible pixels.
unassigned=np.zeros((H,W),bool)
seeds={}
for n in Z:
    labs,count=label((owner==Z.index(n))&(A[...,3]>=128),np.ones((3,3)))
    sizes=np.bincount(labs.ravel())
    limit=1000 if n.startswith('leg') else (0 if n=='head' and SET!='bigfoot/fledgling' else 64)
    tiny=np.isin(labs,np.where((sizes<limit)&(np.arange(len(sizes))>0))[0])
    unassigned |= tiny
    seeds[n]=(owner==Z.index(n))&(A[...,3]>=128)&~tiny
while unassigned.any():
    progress=False
    for n in Z:
        take=unassigned & grow(seeds[n],1)
        if take.any():
            owner[take]=Z.index(n)
            seeds[n] |= take
            unassigned[take]=False
            progress=True
    if not progress:
        raise RuntimeError('Disconnected approved silhouette needs human review')
visible = {n: owner==Z.index(n) for n in Z}
solid = A[...,3] == 255
paint = {n: visible[n].copy() for n in Z}

yy,xx = np.indices((H,W))
# Head continuation beneath its own hair connects face and ear and reaches
# the neck. It stays under opaque mane, never creates visible head artwork.
head_hidden = polygon([(352,210),(566,210),(570,285),(540,340),
    (536,414),(511,444),(487,447),(450,374),(350,310)])
if SET!='bigfoot/fledgling':
    head_hidden=polygon(geometry['head_hidden'])
paint['head'] |= head_hidden & visible['mane'] & solid
# Recompute seam bands from the explicit visible owners. Paint only beneath
# the front member; no sibling's artwork is a continuation source or target.
pairs = [('body','head'),('body','arm_l'),('body','arm_r'),
    ('body','leg_l'),('body','leg_r'),('body','mane'),('head','mane')]
for par,ch in pairs:
    b,f = (par,ch) if Z.index(par)<Z.index(ch) else (ch,par)
    seam = visible[f] & grow(visible[b],1)
    band = solid & paint[f] & grow(seam,24)
    required = band
    if par==b and ch in J and ch!='mane':
        j=J[ch]
        required |= solid & paint[f] & ((xx-j['x'])**2+(yy-j['y'])**2<=64**2)
    # Round the outside of the required square band, keeping it constrained
    # to the covering silhouette. No rectangular band termination is exposed.
    # A slight directional fur contour avoids a long ruler-straight edge at
    # the band termination without removing any of the mandatory band.
    reach=3.5+1.2*np.sin(yy*.42)+.6*np.sin(xx*.31)
    rounded=distance_transform_edt(~required)<reach if required.any() else required
    required |= solid & paint[f] & rounded
    if b.startswith('leg'):
        required &= visible[f]
    paint[b] |= required & (owner>Z.index(b))
# Hidden neck pivot is covered by the mane: anatomical head/body seam is
# beneath the hair at rest. Both must still paint that fixed pivot.
neck = polygon([(479,407),(499,400),(526,410),(540,433),
    (528,449),(501,454),(481,438)]) & solid & visible['mane']
if SET!='bigfoot/fledgling':
    nj=J['head']; neck=polygon([(nj['x']-25,nj['y']-28),(nj['x']+25,nj['y']-28),(nj['x']+25,nj['y']+20),(nj['x']-25,nj['y']+20)]) & solid & visible['mane']
paint['head'] |= neck
paint['body'] |= neck
# The cream shoulders emerge from below the mane well above the pinned
# hinges. In the extreme attack pose their roots uncover these continuations.
# Keep them beneath the actual arm/mane footprints and connected to torso.
shoulders=(((xx-640)/58)**2+((yy-391)/63)**2<1)|\
    (((xx-354)/38)**2+((yy-418)/61)**2<1)
paint['body'] |= shoulders & solid & ((owner==Z.index('arm_l'))|\
    (owner==Z.index('arm_r'))|(owner==Z.index('mane')))

# Independent torso contour: shoulder mass rounds into the chest and then
# tapers into the approved flank, rather than following the arm's footprint.

torso_contour=smooth_contour([(377,350),(470,333),(575,335),
    (644,355),(681,409),(691,473),(676,506),(650,540),
    (633,563),(623,582),(615,610),(588,625),(539,606),
    (490,638),(430,620),(390,600),(374,579),(360,552),
    (337,525),(321,501),(314,474),(322,441),(341,405)])
if SET!='bigfoot/fledgling':
    torso_contour=smooth_contour(geometry['torso'])
if SET!='bigfoot/fledgling':
    paint['body'] |= torso_contour & (owner>Z.index('body')) & solid
outside=paint['body']&~visible['body']&~torso_contour
Image.fromarray(np.where(outside,255,0).astype(np.uint8)).save(OUT/'torso-required-outside-contour.png')
paint['body'] &= torso_contour|visible['body']

# Complete the arm's own shoulder cap beneath the mane. These pixels stay
# outside the measured body/arm bands and zones: the reviewed torso paint
# and exception measurements remain unchanged. No sibling limb is covered.
for arm,cx,cy,rx,ry in [('arm_l',655,365,42,48),('arm_r',343,411,26,35)]:
    if SET!='bigfoot/fledgling':
        cx,cy,rx,ry=(J[arm]['x']+15,J[arm]['y']+15,35,40) if arm=='arm_l' else (J[arm]['x']-20,J[arm]['y']+15,35,40)
    cap=((xx-cx)/rx)**2+((yy-cy)/ry)**2<1
    seam=visible[arm]&grow(visible['body'],1)
    available=~grow(seam,24)|paint['body']
    if arm=='arm_r':
        available |= ((xx-329)/8)**2+((yy-405)/12)**2<1
    cap &= visible['mane']&solid&available
    j=J[arm]
    cap &= (((xx-j['x'])**2+(yy-j['y'])**2>64**2)|paint['body'])
    paint[arm] |= cap

# Leg bands are evaluated after completing the torso behind its own hair.
# Complete only under the torso's visible footprint, never under sibling arms.
for leg in ([] if SET=='bigfoot/fledgling' else ['leg_l','leg_r']):
    seam=visible['body'] & grow(visible[leg],1)
    paint[leg] |= grow(seam,28) & visible['body'] & solid

(OUT/'visible-components.json').write_text(json.dumps({n:[{'count':int((labs==i).sum()),'x':float(np.where(labs==i)[1].mean()),'y':float(np.where(labs==i)[0].mean())} for i in range(1,count+1)] for n in Z for labs,count in [label(visible[n]&(A[...,3]>=128),np.ones((3,3)))]},indent=2))
images={}
fur_path = Path(sys.argv[sys.argv.index('--texture')+1]) if '--texture' in sys.argv else ROOT/'art/recut/bigfoot/fledgling/coat-fur-texture.png'
if not fur_path.exists():
    sys.exit('Missing generated material: download the PR texture attachment and pass --texture PATH. No assets were written.')
fur = None
if fur_path.exists():
    ref = Image.open(fur_path).convert('RGB').resize((W,H),Image.Resampling.LANCZOS)
    rgb=np.array(ref).astype(float)
    # Generated high-frequency fur is used only inside hidden paint. The
    # approved part supplies its own low-frequency light/shadow field.
    detail=rgb-gaussian_filter(rgb,(6,6,0))
    fur=detail
for n in Z:
    im=np.zeros_like(A)
    im[visible[n]]=A[visible[n]]
    hidden=paint[n]&~visible[n]
    # Clone only that part's own visible interior surface, with an inset to
    # keep its outlines out of the continuation. Source texture is offset
    # toward the centre of the part and sampled at full resolution.
    source=binary_erosion(visible[n]&solid, iterations=10)
    if SET=='bigfoot/fledgling' and n.startswith('leg'):
        # Keep real thigh shading at the cut while excluding its ink stroke.
        source=binary_erosion(visible[n]&solid,iterations=2)&(A[...,0]>130)
    if n=='head':
        source &= face
    _,idx=distance_transform_edt(~source,return_indices=True)
    tx=xx.copy(); ty=yy.copy()
    if n=='body':
        tx=xx.copy(); ty=yy.copy()
    elif n.startswith('leg'):
        center=560 if n=='leg_l' else 430
        tx=(center+(tx-center)*.72).astype(int)
        ty=ty+90
    elif n=='head':
        tx=378+(xx-378)%60;ty=261+(yy-261)%38
    else:
        ty=ty-20
    tx=np.clip(tx,0,W-1);ty=np.clip(ty,0,H-1)
    sx=idx[1,ty,tx];sy=idx[0,ty,tx]
    im[hidden,:3]=A[sy[hidden],sx[hidden],:3]
    if (n=='body' or n.startswith('leg') or n.startswith('arm')) and fur is not None:
        weights=gaussian_filter(source.astype(float),15)
        base=np.stack([gaussian_filter(A[...,c]*source.astype(float),15)/
            np.maximum(weights,1e-9) for c in range(3)],axis=-1)
        # Beyond the supported field, fall back to nearby own-coat value.
        invalid=weights<1e-5
        base[invalid]=base[idx[0,invalid],idx[1,invalid]]
        continuation=np.clip(base+fur*.8,0,255)
        edge_distance=distance_transform_edt(~visible[n])
        blend=np.clip(edge_distance/8,0,1)[...,None]
        donor=A[idx[0],idx[1],:3].astype(float)
        if SET=='bigfoot/fledgling' and n.startswith('leg'):
            local_weight=gaussian_filter(source.astype(float),3)
            local=np.stack([gaussian_filter(A[...,c]*source.astype(float),3)/np.maximum(local_weight,1e-9) for c in range(3)],axis=-1)
            nearest=local[idx[0],idx[1]]
            shading_blend=np.clip(edge_distance/24,0,1)[...,None]
            continuation=np.clip(nearest*(1-shading_blend)+base*shading_blend+fur*.8,0,255)
        elif not n.startswith('leg'):
            continuation=donor*(1-blend)+continuation*blend
        im[hidden,:3]=np.rint(continuation[hidden]).astype(np.uint8)
    im[hidden,3]=255
    if n.startswith('arm'):
        # The shoulder cap is the arm's own rounded silhouette beneath hair.
        cap_edge=paint[n] & (distance_transform_edt(paint[n])<=2)
        im[hidden&cap_edge,:3]=(58,42,30)
    if n=='body':
        true_edge=torso_contour & (distance_transform_edt(torso_contour)<=3.5)
        im[hidden&true_edge,:3]=(58,42,30)
    # Hidden paint cannot contain a detached clone island. Keep the component
    # carrying this part's visible surface; band verification follows below.
    labels,count=label(im[...,3]>=128,np.ones((3,3)))
    sizes=np.bincount(labels.ravel());sizes[0]=0
    detached=(labels!=sizes.argmax())&(labels!=0)&~visible[n]
    im[detached]=0
    images[n]=im
    # Encode outside assets and replace atomically: Windows preview/indexing
    # readers can briefly deny opening an existing PNG for truncation.
    temporary=OUT/f'.{n}-recut.png'
    Image.fromarray(im).save(temporary)
    for attempt in range(12):
        try:
            temporary.replace(BASE/'parts'/f'{n}.png')
            break
        except OSError:
            if attempt==11:
                raise
            time.sleep(.25)
    # Ownership and hidden-paint masks are review artifacts, never assets.
    mask=np.zeros((H,W,4),np.uint8)
    mask[visible[n]]=(90,190,255,255)
    mask[(im[...,3]==255)&~visible[n]]=(255,130,70,255)
    Image.fromarray(mask).save(OUT/f'{n}-mask.png')

metrics=[]
for par,ch in pairs[:-1]:
    b,f=(par,ch) if Z.index(par)<Z.index(ch) else (ch,par)
    seam=visible[f]&grow(visible[b],1)
    band=(images[f][...,3]==255)&grow(seam,24)
    cover=(band&(images[b][...,3]==255)).sum()/max(1,band.sum())
    metrics.append({'pair':f'{b}/{f}','band':float(cover),'band_px':int(band.sum())})
(OUT/'ownership-metrics.json').write_text(json.dumps(metrics,indent=2)+'\n')
counts={n:int(label(images[n][...,3]>=128,np.ones((3,3)))[1]) for n in Z}
if any(c!=1 for c in counts.values()):
    raise RuntimeError(f'Island audit failed: {counts}')
print('Recut '+SET)
