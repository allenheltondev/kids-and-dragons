"""Package real TV/phone captures into chapter review sheets (Pillow only)."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / 'docs/review/gemfall-497-locations'
RAW = ROOT / 'test-results/gemfall-497-locations'
RAW.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 18)
rows = json.loads((ROOT / 'art/source/gemfall-497-locations.json').read_text(encoding='utf-8'))
chapters = dict.fromkeys(a['chapter'] for a in rows if not a['delivered'])
for chapter in chapters:
    scenes = [(a['slug'], sid) for a in rows if a['chapter'] == chapter and not a['delivered'] for sid in a['scenes']]
    sheet = Image.new('RGB', (1320, ((len(scenes) + 1) // 2) * 325), '#17142a')
    draw = ImageDraw.Draw(sheet)
    for i, (slug, sid) in enumerate(scenes):
        x, y = (i % 2) * 660, (i // 2) * 325
        for device, width, dx in [('tv', 512, 0), ('phone', 133, 520)]:
            name = f'{sid}-{device}.png'
            path = RAW / name
            if not path.exists():
                (REVIEW / name).rename(path)
            with Image.open(path) as image:
                sheet.paste(image.convert('RGB').resize((width, 288), Image.Resampling.LANCZOS), (x + dx, y))
        draw.text((x + 6, y + 291), f'{slug}: {sid}', fill='white', font=font)
    sheet.save(REVIEW / f'{chapter}.webp', 'WEBP', quality=88, method=6)
print(f'Packaged {len(chapters)} chapter sheets; original captures remain in {RAW}')
