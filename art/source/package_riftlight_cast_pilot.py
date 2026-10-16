"""Register Orin's generated figure to the existing cast contract."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[2]


def main():
    source=Image.open(ROOT/'art/source/riftlight/orin_vale.png').convert('RGBA')
    # Ignore the generator's nearly transparent alpha dust when measuring the
    # silhouette; retain the original alpha inside the padded crop.
    bbox=source.getchannel('A').point(lambda value: 255 if value>8 else 0).getbbox()
    assert bbox and min(bbox[:2])>0 and bbox[2]<source.width and bbox[3]<source.height
    cutout=source.crop((bbox[0]-4,bbox[1]-4,bbox[2]+4,bbox[3]+4))
    cutout.thumbnail((960,820),Image.Resampling.LANCZOS)
    figure=Image.new('RGBA',(1024,1024))
    figure.paste(cutout,((1024-cutout.width)//2,901-cutout.height))
    target=ROOT/'assets/cast/orin_vale'
    target.mkdir(parents=True,exist_ok=True)
    figure.save(target/'assembled.png')
    manifest=ROOT/'assets/manifest.json'
    mf=json.loads(manifest.read_text(encoding='utf-8'))
    mf['castFigures']=[entry for entry in mf['castFigures'] if entry['id']!='orin_vale']+[
        dict(id='orin_vale',name='Master Orin Vale',basis='griffin',scale='medium')]
    manifest.write_text(json.dumps(mf,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    review=ROOT/'art/review/riftlight-cast'
    review.mkdir(parents=True,exist_ok=True)
    sheet=Image.new('RGB',(800,600),'#e3d9c4'); d=ImageDraw.Draw(sheet)
    standin=Image.open(ROOT/'assets/characters/griffin/fledgling/assembled.png').convert('RGBA')
    for col,(label,im) in enumerate([('Species stand-in',standin),('Master Orin Vale / pilot',figure)]):
        d.text((col*400+15,12),label,fill='#383838')
        for size,y in [(400,40),(120,460)]:
            tile=im.resize((size,size),Image.Resampling.LANCZOS)
            sheet.paste(tile,(col*400+(400-size)//2,y),tile)
    sheet.save(review/'pilot-contact.png')


if __name__=='__main__': main()
