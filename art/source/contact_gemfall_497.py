"""Review transparent exports at display sizes on light and dark grounds."""
import json
from pathlib import Path
from PIL import Image, ImageDraw
from review_font import review_font

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/review/gemfall-497-locations'
font = review_font(14)
for kind, catalog, directory, size in [
    ('props', 'gemfall-497-props.json', 'assets/story-props', 100),
    ('options', 'gemfall-497-options.json', 'packages/client/src/assets/painted', 40),
]:
    rows = json.loads((ROOT / 'art/source' / catalog).read_text(encoding='utf-8'))
    if isinstance(rows, dict):
        rows = rows['assets']
    sheet = Image.new('RGB', (1200, ((len(rows)+4)//5)*150), '#17142a')
    draw = ImageDraw.Draw(sheet)
    for i, row in enumerate(rows):
        x, y = i%5*240, i//5*150
        with Image.open(ROOT / directory / (row['id']+'.webp')) as image:
            image = image.convert('RGBA')
            assert image.getextrema()[3][0] == 0, row
            bbox = image.getchannel('A').getbbox()
            margin = 16 if kind == 'options' else 24
            assert min(bbox[0], bbox[1], image.width-bbox[2], image.height-bbox[3]) >= margin, (row, bbox)
            image.thumbnail((size,size), Image.Resampling.LANCZOS)
            for dx, bg in [(0, '#17142a'), (116, '#eee7d6')]:
                draw.rectangle((x+dx,y,x+dx+114,y+110),fill=bg)
                sheet.paste(image, (x+dx+(114-image.width)//2,y+(110-image.height)//2),image)
        draw.text((x+3,y+114),row['id'],font=font,fill='white')
    sheet.save(OUT / (kind+'.webp'),'WEBP',quality=90,method=6)
    print(f'{kind}: {len(rows)} transparent exports; safe margins verified')
