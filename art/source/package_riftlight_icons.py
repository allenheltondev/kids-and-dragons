"""Package the three generated cutouts without repainting their alpha or colors."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
IDS = ['listening_chime', 'riftlight_indicator', 'riftspark']


def main():
    review = Image.new('RGB', (960, 440), '#e3d9c4')
    draw = ImageDraw.Draw(review)
    for n, id in enumerate(IDS):
        source = Image.open(ROOT / f'art/source/riftlight/{id}.png').convert('RGBA')
        bbox = source.getchannel('A').getbbox()
        assert bbox and bbox[0] > 0 and bbox[1] > 0 and bbox[2] < source.width and bbox[3] < source.height, f'{id}: clipped art'
        cutout = source.crop(bbox)
        cutout.thumbnail((820,820),Image.Resampling.LANCZOS)
        im = Image.new('RGBA',(1024,1024))
        im.paste(cutout,((1024-cutout.width)//2,(1024-cutout.height)//2))
        target = ROOT / f'assets/items/{id}'
        target.mkdir(parents=True,exist_ok=True)
        im.save(target/'assembled.png')
        im.resize((512,512),Image.Resampling.LANCZOS).save(target/'portrait.webp',quality=95,method=6)
        draw.text((n*320+12,12),id,fill='#383838')
        for size,y in [(256,38),(48,310),(24,382)]:
            tile=im.resize((size,size),Image.Resampling.LANCZOS)
            review.paste(tile,(n*320+(320-size)//2,y),tile)
            draw.text((n*320+12,y+8),str(size),fill='#383838')
    path=ROOT/'art/review/riftlight/icons.png'
    path.parent.mkdir(parents=True,exist_ok=True)
    review.save(path)


if __name__=='__main__': main()
