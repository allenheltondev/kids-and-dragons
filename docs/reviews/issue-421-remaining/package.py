"""Export the remaining #421 imagegen originals, preserving generated alpha.

Run: python docs/reviews/issue-421-remaining/package.py
Source locations and exact prompts are recorded in prompts.json.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def main():
    record = json.loads((HERE / 'prompts.json').read_text(encoding='utf-8'))
    for asset in record['assets']:
        source = Path(asset['source'])
        image = Image.open(source)
        if asset['kind'] == 'icon':
            assert image.mode == 'RGBA', (source, image.mode)
            bounds = image.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
            assert bounds, source
            bounds = (max(0, bounds[0]-2), max(0, bounds[1]-2),
                      min(image.width, bounds[2]+2), min(image.height, bounds[3]+2))
            image = image.crop(bounds)
            image.thumbnail((224, 224), Image.Resampling.LANCZOS)
            canvas = Image.new('RGBA', (256, 256))
            canvas.alpha_composite(image, ((256-image.width)//2, (256-image.height)//2))
            image = canvas
        else:
            size = (1600, 900) if asset['kind'] == 'campaign' else (1920, 1080)
            image = ImageOps.fit(image.convert('RGB'), size, method=Image.Resampling.LANCZOS)
        output = ROOT / asset['output']
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output, format='WEBP', quality=92, method=6, exact=True)
        asset['sourceSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
        asset['sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
        asset['dimensions'] = list(image.size)
        asset['mode'] = image.mode
        print(asset['output'])
    (HERE / 'prompts.json').write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8')

    for kind in ['scene', 'campaign']:
        assets = sorted((a for a in record['assets'] if a['kind'] == kind), key=lambda a: a['id'])
        columns = 2 if kind == 'campaign' else 3
        sheet = Image.new('RGB', (columns*480, ((len(assets)+columns-1)//columns)*295), '#eee4d4')
        draw = ImageDraw.Draw(sheet)
        for i, asset in enumerate(assets):
            image = Image.open(ROOT / asset['output']).resize((480, 270), Image.Resampling.LANCZOS)
            x, y = (i % columns)*480, (i // columns)*295
            sheet.paste(image, (x, y))
            draw.text((x+8, y+275), asset['id'], fill='#302820')
        sheet.save(HERE / f'{kind}-review.webp', quality=92, method=6)
    assets = sorted((a for a in record['assets'] if a['kind'] == 'icon'), key=lambda a: a['id'])
    for name, bg, ink in [('light', '#eee4d4', '#302820'), ('dark', '#26313c', '#eee4d4')]:
        sheet = Image.new('RGB', (1200, ((len(assets)+5)//6)*230), bg)
        draw = ImageDraw.Draw(sheet)
        for i, asset in enumerate(assets):
            image = Image.open(ROOT / asset['output'])
            x, y = (i % 6)*200, (i // 6)*230
            for size, dx, dy in [(128, 36, 5), (48, 45, 145), (24, 125, 158)]:
                thumb = image.resize((size, size), Image.Resampling.LANCZOS)
                sheet.paste(thumb, (x+dx, y+dy), thumb)
            draw.text((x+8, y+207), asset['id'], fill=ink)
        sheet.save(HERE / f'icons-{name}.webp', quality=94, method=6)


if __name__ == '__main__':
    main()
