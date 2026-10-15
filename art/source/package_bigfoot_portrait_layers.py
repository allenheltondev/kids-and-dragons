"""Rig ownership masks over approved portrait pixels; no reconstructed clothing.

Coordinates are on the original 1254px portrait. Registration applies uniformly
to the complete portrait, never to individual part bounding boxes.
"""
from pathlib import Path
import json, shutil
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]

def portrait_part(character_class, tier, polygons, size=963, offset=(84, 40), snap=True):
    source = Image.open(ROOT / f'assets/gear-portraits/{character_class}/{tier}/bigfoot.png').convert('RGBA')
    if source.size != (1254,1254):
        raise ValueError('Ownership coordinates require the original 1254px portrait')
    mask = Image.new('L', source.size)
    draw = ImageDraw.Draw(mask)
    for polygon in polygons:
        draw.polygon(polygon, fill=255)
    # Snap the lower fringe boundary to the source's gold pixels rather than
    # cutting straight across the individual tassels. The neckline stays traced.
    if character_class == 'songkeeper' and snap:
        owned = np.asarray(mask) > 0
        rgb = np.asarray(source)[...,:3].astype(float)
        gold = (rgb[...,0] > 85) & (rgb[...,1] > 50) & (rgb[...,2] < rgb[...,0] * .67) & (rgb[...,1] > rgb[...,0] * .48)
        edge = ndimage.binary_dilation(owned, iterations=16)
        core = ndimage.binary_erosion(owned, iterations=8)
        snapped = ndimage.binary_fill_holes(core | (edge & gold))
        yy,xx = np.indices(owned.shape)
        # Do not let nearby brown mane become part of the garment.
        snapped[yy < 475] &= owned[yy < 475]
        if tier == 'sworn':
            # Sworn's broad lower envelope crosses light torso fur between
            # tassels. Preserve only the gold fringe there, not a strip of the
            # portrait's differently posed chest riding along with the shawl.
            fringe_gold = (rgb[...,0] > 70) & (rgb[...,1] > rgb[...,0] * .48) & (rgb[...,2] < rgb[...,0] * .60)
            fringe = ndimage.binary_fill_holes(ndimage.binary_dilation(fringe_gold,iterations=1))
            snapped[yy > 560] &= fringe[yy > 560]
            # The dark arm/torso crease beside the pendant is anatomy, too.
            snapped[(xx < 460) & (yy > 645)] = False
            # The shawl and its pendant are a single piece. Disconnected flecks
            # are portrait fur/shadow caught by the colour envelope, not trim.
            labels,count = ndimage.label(snapped)
            if count:
                areas = np.bincount(labels.ravel()); areas[0] = 0
                snapped = labels == areas.argmax()
        mask = Image.fromarray(np.where(snapped,255,0).astype('uint8'))
    if character_class == 'starweaver' and not snap:
        # A fitted backdrop estimate removes navy between the focus-stone rings,
        # retaining a soft alpha for its actual blue glow.
        rgb = np.asarray(source)[...,:3].astype(float)
        yy,xx = np.indices(mask.size[::-1])
        x=(xx-627)/627; y=(yy-627)/627
        features=np.stack([np.ones_like(x),x,y,x*x,x*y,y*y,x*x*x,x*x*y,x*y*y,y*y*y],axis=-1)
        border=((xx<95)|(xx>1159)|(yy<95)|(yy>1159)) & (xx%4==0) & (yy%4==0)
        backdrop=np.stack([features @ np.linalg.lstsq(features[border],rgb[...,ch][border],rcond=None)[0] for ch in range(3)],axis=-1)
        residual=np.sqrt(np.mean((rgb-backdrop)**2,axis=-1))
        alpha=np.clip((residual-10)/30,0,1)*np.asarray(mask)
        mask=Image.fromarray(alpha.astype('uint8'))
    source.putalpha(mask)
    source = source.resize((size, size), Image.Resampling.LANCZOS)
    result = Image.new('RGBA', (1024, 1024))
    result.alpha_composite(source, offset)
    return result

RADIANT_SHAWL = [
    (342,350),(328,356),(319,378),(316,402),(309,416),(307,442),
    (296,457),(288,481),(284,511),(278,535),(265,552),(260,564),
    (273,575),(269,589),(280,605),(290,599),(294,618),(306,625),
    (316,612),(320,631),(332,637),(341,618),(349,624),(345,654),
    (345,688),(354,699),(371,697),(376,678),(372,651),(374,616),
    (389,618),(398,598),(405,591),(410,618),(405,665),(410,674),
    (430,676),(437,669),(436,618),(432,592),(442,577),(456,589),
    (460,623),(457,681),(466,690),(485,690),(491,682),(486,619),
    (485,598),(498,602),(505,620),(517,625),(522,610),(530,633),
    (542,645),(551,631),(556,666),(556,705),(563,718),(577,721),
    (587,709),(589,692),(596,716),(607,714),(617,690),(624,708),
    (635,705),(642,679),(651,697),(664,690),(673,670),(684,681),
    (695,671),(702,651),(713,660),(725,646),(731,626),(741,636),
    (753,624),(756,605),(767,613),(779,601),(784,581),(794,589),
    (805,577),(810,558),(821,566),(831,555),(831,539),(843,550),
    (856,542),(852,526),(862,532),(872,548),(867,558),(860,560),
    (850,534),(850,509),(842,483),(835,462),(827,444),(822,424),
    (809,407),(797,388),(776,375),(765,356),(753,338),(736,324),
    (713,320),(704,325),(714,343),(712,365),(699,386),(680,402),
    (655,417),(625,429),(590,440),(554,450),(514,462),(478,475),
    (446,482),(431,468),(411,453),(390,432),(371,410),(356,386),
    (351,365),
]

SWORN_SHAWL = [(391,378),(378,393),(370,420),(361,453),(356,484),(349,516),(330,550),(344,577),(373,600),(410,622),(449,641),(462,622),(467,603),(467,642),(460,695),(469,707),(490,708),(500,695),(492,639),(494,608),(523,591),(530,648),(552,652),(572,648),(601,639),(630,630),(665,617),(700,602),(734,589),(764,574),(795,556),(823,541),(850,526),(879,521),(884,510),(867,487),(860,468),(850,459),(850,439),(840,423),(838,405),(823,400),(827,385),(811,374),(789,373),(751,381),(709,397),(664,417),(615,439),(567,460),(520,480),(491,501),(467,484),(443,466),(419,440),(404,414)]
MYTHIC_SHAWL = [(366,396),(350,420),(338,450),(326,476),(311,503),(304,530),(286,553),(278,576),(274,600),(290,621),(319,637),(350,641),(379,632),(389,617),(391,661),(389,727),(403,745),(420,742),(426,713),(433,755),(443,770),(460,771),(471,758),(475,726),(483,743),(501,749),(513,735),(509,676),(508,630),(516,625),(542,642),(569,655),(601,665),(636,673),(672,681),(714,682),(753,677),(795,666),(833,653),(867,638),(904,622),(930,613),(940,589),(930,577),(933,560),(917,550),(913,532),(898,526),(894,502),(881,485),(878,462),(867,449),(862,429),(848,416),(847,400),(831,386),(807,375),(786,371),(771,384),(750,402),(723,421),(696,440),(667,454),(641,468),(611,481),(583,493),(553,505),(515,513),(485,512),(457,503),(435,488),(417,470),(395,447),(380,421)]
STAR_RADIANT = [(424,449),(430,480),(443,507),(467,532),(500,554),(538,576),(568,562),(605,551),(642,530),(673,505),(701,479),(727,447),(751,420),(779,401),(815,384),(837,385),(818,410),(799,437),(788,471),(781,505),(784,544),(799,578),(785,599),(785,634),(794,651),(660,727),(643,700),(580,761),(550,739),(527,743),(501,723),(480,701),(464,718),(443,696),(447,676),(433,657),(423,631),(417,596),(416,555),(417,514),(418,477)]
STAR_MYTHIC = [(449,591),(455,622),(473,648),(499,669),(532,685),(548,673),(577,667),(608,650),(638,632),(663,612),(687,585),(708,555),(736,527),(758,502),(776,477),(771,517),(775,554),(781,589),(789,620),(778,642),(780,680),(789,692),(675,778),(654,750),(595,807),(572,786),(547,808),(543,829),(549,843),(543,848),(532,833),(533,814),(501,780),(488,784),(472,762),(448,733),(439,707),(442,673),(444,631)]

def package(character_class, tier):
    out = ROOT / f'assets/character-rigs/{character_class}/{tier}/bigfoot'
    base=ROOT/f'assets/characters/bigfoot/{tier}'
    (out/'parts').mkdir(parents=True,exist_ok=True)
    for part in (base/'parts').glob('*.png'):
        shutil.copyfile(part,out/'parts'/part.name)
    joints=json.loads((base/'joints.json').read_text(encoding='utf-8'))
    joints['gear_visible']={'parent':'body','x':510,'y':470}
    if character_class == 'starweaver':
        joints['focus_stone']={'parent':'body','x':721,'y':226}
    elif tier == 'sworn':
        joints['ear_chime']={'parent':'head','x':535,'y':240}
    (out/'joints.json').write_text(json.dumps(joints,indent=2)+'\n',encoding='utf-8')
    exceptions=json.loads((base/'seam-exceptions.json').read_text(encoding='utf-8'))
    if tier == 'radiant' and character_class == 'starweaver':
        exceptions['body/arm_l']={'band':.97,'reason':'The approved waistcoat hides the upper seam, leaving the small lower armpit contour. The missing 2.6% lies outside the unchanged base torso silhouette, not at its shoulder pivot. See docs/reviews/bigfoot-class-seam-contours.webp and the attack contact sheet.'}
    if tier == 'radiant' and character_class == 'songkeeper':
        exceptions['body/arm_r']={'band':.68,'reason':'The approved shawl hides the upper seam, leaving only the short lower armpit contour. The missing 31.7% lies outside the unchanged base torso silhouette at that endpoint; extending it would add a torso slab into the arm gap. See docs/reviews/bigfoot-class-seam-contours.webp and the attack contact sheet.'}
    if tier == 'sworn' and character_class == 'songkeeper':
        exceptions['body/arm_r']={'band':.85,'reason':'Removing the portrait-fur strip below the shawl reveals the unchanged lower armpit contour. The 24px band reaches outside the torso silhouette there; the shoulder pivot remains covered. See docs/reviews/songkeeper-sworn-seam-contour.webp and the attack contact sheet.'}
    (out/'seam-exceptions.json').write_text(json.dumps(exceptions,indent=2)+'\n',encoding='utf-8')
    if character_class == 'songkeeper':
        polygon = {'sworn': SWORN_SHAWL,'radiant':RADIANT_SHAWL,'mythic':MYTHIC_SHAWL}[tier]
        offset = {'sworn':(48,40),'radiant':(84,40),'mythic':(60,40)}[tier]
        gear = portrait_part(character_class,tier,[polygon],offset=offset)
        if tier == 'sworn':
            ear = [(625,254),(635,244),(646,249),(645,264),(637,278),(643,294),(637,307),(635,319),(647,321),(649,390),(642,400),(619,398),(613,391),(619,322),(626,318),(627,302),(616,298),(608,282),(609,270)]
            portrait_part(character_class,tier,[ear],offset=offset,snap=False).save(out/'parts/ear_chime.png')
    else:
        offset = (20,30) if tier == 'radiant' else (20,15)
        polygon = STAR_RADIANT if tier == 'radiant' else STAR_MYTHIC
        gear = portrait_part(character_class,tier,[polygon],offset=offset)
        gem = [(925,151),(945,159),(961,179),(971,209),(971,244),(962,272),(943,296),(915,307),(888,302),(869,285),(856,260),(852,229),(855,199),(870,176),(896,160)] if tier == 'radiant' else [(950,169),(972,175),(987,193),(994,215),(996,247),(1003,274),(991,301),(974,313),(944,316),(919,327),(895,321),(875,304),(868,277),(866,246),(859,221),(864,198),(881,187),(913,181)]
        portrait_part(character_class,tier,[gem],offset=offset,snap=False).save(out/'parts/focus_stone.png')
    gear.save(out/'parts/gear_visible.png')
    config = ROOT/f'art/rig/{character_class}-{tier}-bigfoot.rig.json'
    rig = json.loads(config.read_text(encoding='utf-8'))
    result = Image.new('RGBA', (1024,1024))
    for part in rig['zOrder']:
        result.alpha_composite(Image.open(out / f'parts/{part}.png').convert('RGBA'))
    result.save(out / 'assembled.png')

if __name__ == '__main__':
    for cls,tier in [('starweaver','radiant'),('starweaver','mythic'),('songkeeper','sworn'),('songkeeper','radiant'),('songkeeper','mythic')]:
        package(cls,tier)
