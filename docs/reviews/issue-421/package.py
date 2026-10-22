"""Register generated cutouts without repainting or replacing their alpha.

Run from any directory: python docs/reviews/issue-421/package.py
Original built-in image_gen files remain in the generated_images directory.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def main():
    record = json.loads((HERE / 'prompts.json').read_text(encoding='utf-8'))
    for asset in record['assets']:
        source = Path(asset['source'])
        image = Image.open(source)
        assert image.mode == 'RGBA', (source, image.mode)
        bounds = image.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
        assert bounds, source
        bounds = (max(0, bounds[0]-2), max(0, bounds[1]-2),
                  min(image.width, bounds[2]+2), min(image.height, bounds[3]+2))
        image = image.crop(bounds)
        scale = min(820 / image.height, 950 / image.width)
        image = image.resize((round(image.width*scale), round(image.height*scale)),
                             Image.Resampling.LANCZOS)
        visible = image.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
        canvas = Image.new('RGBA', (1024, 1024))
        canvas.alpha_composite(image, ((1024-image.width)//2, 901-visible[3]))
        output = ROOT / asset['output']
        output.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(output, optimize=True)
        asset['sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
        asset['sourceSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
        asset['dimensions'] = list(canvas.size)
        asset['mode'] = canvas.mode
        print(asset['output'])
    (HERE / 'prompts.json').write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8')

    for name, background, ink in [('light', '#eee4d4', '#302820'),
                                   ('dark', '#26313c', '#eee4d4')]:
        sheet = Image.new('RGB', (1500, 900), background)
        draw = ImageDraw.Draw(sheet)
        small = Image.new('RGB', (1500, 360), background)
        small_draw = ImageDraw.Draw(small)
        for i, asset in enumerate(record['assets']):
            x, y = (i % 5)*300, (i // 5)*450
            figure = Image.open(ROOT / asset['output'])
            thumb = figure.copy()
            thumb.thumbnail((300, 400), Image.Resampling.LANCZOS)
            sheet.paste(thumb, (x+(300-thumb.width)//2, y+25), thumb)
            label = asset['class']+' / '+asset['species']
            draw.text((x+10, y+425), label, fill=ink)
            bounds = figure.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
            figure = figure.crop(bounds)
            scale = 120 / figure.height
            figure = figure.resize((round(figure.width*scale), 120), Image.Resampling.LANCZOS)
            small.paste(figure, (x+(300-figure.width)//2, (i//5)*180+10), figure)
            small_draw.text((x+10, (i//5)*180+145), label, fill=ink)
        sheet.save(HERE / f'figures-{name}.webp', quality=92, method=6)
        small.save(HERE / f'figures-120-{name}.webp', quality=92, method=6)


if __name__ == '__main__':
    main()
