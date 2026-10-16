"""Register the neutral-named finale figure and deep-ice backdrop."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps
from package_riftlight_cast import package

ROOT=Path(__file__).resolve().parents[2]


def main():
    figure=package('deep-ice-figure',ROOT/'assets/cast/deep-ice-figure/assembled.png')
    source=Image.open(ROOT/'art/source/riftlight/scenes/glacier-deep-ice.png').convert('RGB')
    scene=ImageOps.fit(source,(1920,1080),method=Image.Resampling.LANCZOS)
    scene.save(ROOT/'assets/scenes/riftlight/glacier-deep-ice.webp',quality=88,method=6)
    manifest=ROOT/'assets/manifest.json'
    mf=json.loads(manifest.read_text(encoding='utf-8'))
    entry=dict(id='deep-ice-figure',name='Deep-ice figure',basis='faun',scale='very_large')
    mf['castFigures']=[e for e in mf['castFigures'] if e['id']!=entry['id']]+[entry]
    if 'scenes/riftlight/glacier-deep-ice' not in mf['sceneIllustrations']:
        mf['sceneIllustrations'].append('scenes/riftlight/glacier-deep-ice')
    manifest.write_text(json.dumps(mf,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    review=ROOT/'art/review/riftlight-finale'
    review.mkdir(parents=True,exist_ok=True)
    sheet=Image.new('RGB',(800,640),'#e3d9c4'); draw=ImageDraw.Draw(sheet)
    ordinary=Image.open(ROOT/'assets/entities/faun/assembled.png').convert('RGBA')
    for col,(name,im) in enumerate([('Ordinary faun',ordinary),('Deep-ice figure / very_large',figure)]):
        draw.text((col*400+10,12),name,fill='#383838')
        for size,y in [(400,40),(120,470)]:
            tile=im.resize((size,size),Image.Resampling.LANCZOS)
            sheet.paste(tile,(col*400+(400-size)//2,y),tile)
    sheet.save(review/'figure-contact.png')
    scene.resize((960,540),Image.Resampling.LANCZOS).save(review/'backdrop.png')
    print('cast/deep-ice-figure: 1024x1024 RGBA, faun, very_large')
    print('scenes/riftlight/glacier-deep-ice: 1920x1080 WebP')


if __name__=='__main__': main()
