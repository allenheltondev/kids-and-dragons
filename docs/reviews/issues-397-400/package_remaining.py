"""Export accepted built-in generations; pass their source directory as argv[1]."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def export(record, sources):
    source = sources / Path(record['source']).name
    im = Image.open(source)
    dest = ROOT / record['output']
    dest.parent.mkdir(parents=True, exist_ok=True)
    if record['kind'] == 'scene':
        im = ImageOps.fit(im.convert('RGB'), (1920, 1080), method=Image.Resampling.LANCZOS)
        im.save(dest, quality=88, method=6)
    else:
        assert im.mode == 'RGBA', (source, im.mode)
        # Generated alpha is preserved. Its visible bounds only determine placement.
        box = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
        assert box
        box = (max(0, box[0]-2), max(0, box[1]-2), min(im.width, box[2]+2), min(im.height, box[3]+2))
        im = im.crop(box)
        ratio = min(820/im.height, 950/im.width)
        im = im.resize((round(im.width*ratio), round(im.height*ratio)), Image.Resampling.LANCZOS)
        visible = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
        canvas = Image.new('RGBA', (1024, 1024))
        canvas.alpha_composite(im, ((1024-im.width)//2, 901-visible[3]))
        canvas.save(dest, optimize=True)
    print(record['output'])


if __name__ == '__main__':
    sources = Path(sys.argv[1])
    for record in json.loads((HERE/'remaining-prompts.json').read_text(encoding='utf-8'))['assets']:
        export(record, sources)
