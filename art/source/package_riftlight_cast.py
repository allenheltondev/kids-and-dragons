"""Package the remaining approved Riftlight cast and both Skupper states.

Sources and exact generation prompts live in the adjacent riftlight folder.
No existing cast figure or entity is modified.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[2]
CAST = [
    ('lady_olivia','Lady Olivia','unicorn','medium'),
    ('seren_wisp','Seren Wisp','kitsune','medium'),
    ('pip_thistledown','Pip Thistledown','manticore','medium'),
    ('bram_lock','Bram Lock','bigfoot','large'),
    ('yeti_elder','Reading-room elder','yeti','large'),
    ('kitsune_temple_keeper','Temple keeper','kitsune','medium'),
    ('dragonling_stone_keeper','Boundary-stone keeper','dragonling','medium'),
    ('saltrot_guide','Saltrot guide','skupper','small_to_medium'),
]


def package(source_name, target):
    source = Image.open(ROOT/f'art/source/riftlight/{source_name}.png').convert('RGBA')
    bbox = source.getchannel('A').point(lambda value: 255 if value>8 else 0).getbbox()
    assert bbox and bbox[0]>2 and bbox[1]>2 and bbox[2]<source.width-2 and bbox[3]<source.height-2, f'{source_name}: clipped source'
    cutout = source.crop((bbox[0]-2,bbox[1]-2,bbox[2]+2,bbox[3]+2))
    cutout.thumbnail((960,820),Image.Resampling.LANCZOS)
    figure = Image.new('RGBA',(1024,1024))
    figure.paste(cutout,((1024-cutout.width)//2,901-cutout.height))
    target.parent.mkdir(parents=True,exist_ok=True)
    figure.save(target)
    return figure


def main():
    path = ROOT/'assets/manifest.json'
    mf = json.loads(path.read_text(encoding='utf-8'))
    images = []
    for id,name,basis,scale in CAST:
        images.append((id,package(id,ROOT/f'assets/cast/{id}/assembled.png')))
        if not any(e['id']==id for e in mf['castFigures']):
            mf['castFigures'].append(dict(id=id,name=name,basis=basis,scale=scale))
    for id,filename in [('skupper','assembled.png'),('skupper_puffed','puffed.png')]:
        images.append((id,package(id,ROOT/f'assets/entities/skupper/{filename}')))
    if not any(e['id']=='skupper' for e in mf['entities']):
        mf['entities'].append(dict(id='skupper',classification='supporting_people',primaryBiome='sallow_wastelands',canonicalLocations=['sallow_wastelands'],scale='small_to_medium',states={'ordinary':'entities/skupper/assembled.png','puffed':'entities/skupper/puffed.png'}))
    path.write_text(json.dumps(mf,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    review = ROOT/'art/review/riftlight-people'
    review.mkdir(parents=True,exist_ok=True)
    sheet = Image.new('RGB',(5*256,2*430),'#e3d9c4')
    draw = ImageDraw.Draw(sheet)
    for i,(name,image) in enumerate(images):
        x,y=(i%5)*256,(i//5)*430
        draw.text((x+8,y+4),name,fill='#383838')
        tile=image.resize((256,256),Image.Resampling.LANCZOS)
        sheet.paste(tile,(x,y+20),tile)
        tile=image.resize((120,120),Image.Resampling.LANCZOS)
        sheet.paste(tile,(x+8,y+290),tile)
        alpha=tile.getchannel('A'); gray=ImageOps.grayscale(tile).convert('RGBA');gray.putalpha(alpha)
        sheet.paste(gray,(x+128,y+290),gray)
    sheet.save(review/'people-contact.png')


if __name__=='__main__': main()
