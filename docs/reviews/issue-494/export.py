import json, sys
from pathlib import Path
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[3]
REVIEW=ROOT/'docs/reviews/issue-494'

def export(entries):
    for e in entries:
        source=ROOT/e['source']
        im=Image.open(source)
        if e.get('kind','cast') in ('cast','entity'):
            im=im.convert('RGBA')
            bounds=im.getchannel('A').point(lambda a:255 if a>8 else 0).getbbox()
            if not bounds: raise ValueError(e['id']+' has no figure')
            im=im.crop(bounds)
            ratio=min(880/im.width,810/im.height)
            im=im.resize((round(im.width*ratio),round(im.height*ratio)),Image.Resampling.LANCZOS)
            canvas=Image.new('RGBA',(1024,1024))
            canvas.paste(im,((1024-im.width)//2,901-im.height))
            directory='entities' if e.get('kind')=='entity' else 'cast'
            out=ROOT/'assets'/directory/e['id']/'assembled.png'
            out.parent.mkdir(parents=True,exist_ok=True)
            canvas.save(out)
            crop=canvas.crop(canvas.getchannel('A').getbbox())
            side=round(max(crop.size)*1.08)
            portrait=Image.new('RGBA',(side,side))
            portrait.paste(crop,((side-crop.width)//2,(side-crop.height)//2))
            portrait.resize((512,512),Image.Resampling.LANCZOS).save(out.with_name('portrait.webp'),'WEBP',quality=82,method=4)
        elif e.get('kind')=='entity-state':
            im=im.convert('RGBA')
            bounds=im.getchannel('A').point(lambda a:255 if a>8 else 0).getbbox()
            if not bounds: raise ValueError(e['id']+' has no visible creature')
            im=im.crop(bounds)
            width,height=(210,210) if e['entity']=='will_o_wisp' else (880,810)
            ratio=min(width/im.width,height/im.height)
            im=im.resize((round(im.width*ratio),round(im.height*ratio)),Image.Resampling.LANCZOS)
            canvas=Image.new('RGBA',(1024,1024))
            bottom=840 if e['entity']=='will_o_wisp' else 901
            canvas.paste(im,((1024-im.width)//2,bottom-im.height))
            out=ROOT/'assets/entities'/e['entity']/(e['state']+'.png')
            out.parent.mkdir(parents=True,exist_ok=True)
            canvas.save(out)
        elif e.get('kind')=='prop':
            im=im.convert('RGBA')
            bounds=im.getchannel('A').point(lambda a:255 if a>8 else 0).getbbox()
            if not bounds: raise ValueError(e['id']+' has no painted object')
            im=im.crop(bounds)
            ratio=min(448/im.width,448/im.height)
            im=im.resize((round(im.width*ratio),round(im.height*ratio)),Image.Resampling.LANCZOS)
            canvas=Image.new('RGBA',(512,512))
            canvas.paste(im,((512-im.width)//2,(512-im.height)//2))
            out=ROOT/'assets/story-props'/(e['id']+'.webp')
            out.parent.mkdir(parents=True,exist_ok=True)
            canvas.save(out,'WEBP',quality=88,method=6)
        elif e.get('kind')=='tiles':
            directory='biomes/sallow_wastelands' if e['id']=='sallow_wastelands' else 'fight-boards/'+e['id']
            out=ROOT/'assets'/directory/'tiles.png'
            out.parent.mkdir(parents=True,exist_ok=True)
            im.convert('RGB').resize((512,512),Image.Resampling.LANCZOS).save(out)
        else:
            out=ROOT/'assets/scenes/riftlight'/(e['id']+'.webp')
            # Generation requests 16:9; fit the delivery canvas without distorting it.
            from PIL import ImageOps
            ImageOps.fit(im.convert('RGB'),(1920,1080),method=Image.Resampling.LANCZOS).save(out,'WEBP',quality=88,method=6)
        print(out.relative_to(ROOT))

if __name__=='__main__':
    records=Path(sys.argv[1]) if len(sys.argv)>1 else REVIEW/'sources.json'
    entries=json.loads(records.read_text(encoding='utf-8-sig'))
    export(entries)
