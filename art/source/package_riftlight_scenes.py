"""Package the six Riftlight places as 1920x1080 WebP and a review sheet."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ROOT=Path(__file__).resolve().parents[2]
IDS=['ice-shelf-headwaters','reading-room','cairnstep','buried-bridge','temple-island-squall','stuttering-flats']


def main():
    manifest=ROOT/'assets/manifest.json'
    mf=json.loads(manifest.read_text(encoding='utf-8'))
    review=ROOT/'art/review/riftlight-places'
    review.mkdir(parents=True,exist_ok=True)
    sheet=Image.new('RGB',(1280,3*390),'#e3d9c4')
    draw=ImageDraw.Draw(sheet)
    for i,id in enumerate(IDS):
        source=Image.open(ROOT/f'art/source/riftlight/scenes/{id}.png').convert('RGB')
        assert abs(source.width/source.height-16/9)<.02, f'{id}: unexpected source aspect ratio'
        image=ImageOps.fit(source,(1920,1080),method=Image.Resampling.LANCZOS)
        target=ROOT/f'assets/scenes/riftlight/{id}.webp'
        target.parent.mkdir(parents=True,exist_ok=True)
        image.save(target,quality=88,method=6)
        assert Image.open(target).size==(1920,1080)
        entry=f'scenes/riftlight/{id}'
        if entry not in mf['sceneIllustrations']: mf['sceneIllustrations'].append(entry)
        x,y=i%2*640,i//2*390
        draw.text((x+10,y+5),id,fill='#383838')
        sheet.paste(image.resize((640,360),Image.Resampling.LANCZOS),(x,y+25))
        print(f'{entry}: 1920x1080 WebP, {target.stat().st_size:,} bytes')
    manifest.write_text(json.dumps(mf,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    sheet.save(review/'places-contact.png')


if __name__=='__main__': main()
