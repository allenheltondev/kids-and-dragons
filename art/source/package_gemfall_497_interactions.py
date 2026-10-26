"""Package active TV/phone snapshots; retain originals outside test output cleanup."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / 'docs/review/gemfall-497-interactions'
RAW = ROOT / 'staging/remaining-497/interaction-originals'
RAW.mkdir(parents=True, exist_ok=True)
for path in REVIEW.glob('*.png'):
    path.replace(RAW / path.name)
scenes = sorted(p.name.removesuffix('-tv.png') for p in RAW.glob('*-tv.png'))
assert len(scenes) == 9, scenes
sheet = Image.new('RGB', (1320, 325*((len(scenes)+1)//2)), '#17142a')
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',18)
for i, scene in enumerate(scenes):
    x, y = i%2*660, i//2*325
    for device, width, dx in [('tv',512,0),('phone',133,520)]:
        with Image.open(RAW / f'{scene}-{device}.png') as image:
            sheet.paste(image.convert('RGB').resize((width,288),Image.Resampling.LANCZOS),(x+dx,y))
    draw.text((x+5,y+291),scene,fill='white',font=font)
sheet.save(REVIEW / 'active-interactions.webp','WEBP',quality=90,method=6)
print(f'Packaged {len(scenes)} active interactions on both surfaces')
