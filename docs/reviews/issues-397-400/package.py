"""Register the first four paintings. Usage: python package.py <imagegen directory>."""
import sys
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[3]
SOURCES = [
    ('exec-5b6cc843-3ace-4b06-b885-7a69f36a2958.png', 'assets/scenes/riftlight/island-due-back.webp'),
    ('exec-36a726ed-f096-4dbe-9457-7bbc7bd66b8a.png', 'assets/scenes/classes/conservatory.webp'),
    ('exec-c147b28c-c4ef-463d-997d-0378404afa01.png', 'assets/cast/captain_thimble/assembled.png'),
    ('exec-2768c6d1-590b-43a5-ae17-4fdaccfc9c69.png', 'assets/character-rigs/songkeeper/sworn/kitsune/assembled.png'),
]


def main():
    source_dir = Path(sys.argv[1])
    for source, dest in SOURCES:
        im = Image.open(source_dir / source)
        out = ROOT / dest
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.suffix == '.webp':
            im = ImageOps.fit(im.convert('RGB'), (1920, 1080), method=Image.Resampling.LANCZOS)
            im.save(out, quality=88, method=6)
        else:
            # Preserve the generated alpha; use its visible contour only for registration.
            im = im.convert('RGBA')
            box = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
            assert box
            # Two extra source pixels retain the soft antialiased contour.
            box = (max(0, box[0]-2), max(0, box[1]-2), min(im.width, box[2]+2), min(im.height, box[3]+2))
            im = im.crop(box)
            ratio = min(820 / im.height, 950 / im.width)
            im = im.resize((round(im.width*ratio), round(im.height*ratio)), Image.Resampling.LANCZOS)
            visible = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
            canvas = Image.new('RGBA', (1024, 1024))
            canvas.alpha_composite(im, ((1024-im.width)//2, 901-visible[3]))
            canvas.save(out, optimize=True)
        print(dest, im.mode, out.stat().st_size)

    # Review the delivered files on both light and dark at full and phone size.
    sheet = Image.new('RGB', (1200, 1020), '#eee4d4')
    draw = ImageDraw.Draw(sheet)
    for idx, (_, dest) in enumerate(SOURCES[:2]):
        im = Image.open(ROOT / dest).resize((600, 338), Image.Resampling.LANCZOS)
        sheet.paste(im, (idx*600, 20))
        draw.text((idx*600+12, 5), dest, fill='#302820')
    for idx, (_, dest) in enumerate(SOURCES[2:]):
        figure = Image.open(ROOT / dest)
        for col, bg in enumerate(['#eee4d4', '#26313c']):
            x, y = col*600, 390+idx*310
            draw.rectangle((x, y, x+599, y+309), fill=bg)
            small = figure.resize((300, 300), Image.Resampling.LANCZOS)
            sheet.paste(small, (x+10, y), small)
            tiny = figure.resize((150, 150), Image.Resampling.LANCZOS)
            sheet.paste(tiny, (x+360, y+90), tiny)
            draw.text((x+12, y+290), dest, fill='#bba688' if col else '#302820')
    sheet.save(Path(__file__).with_name('first-batch.webp'), quality=90, method=6)


if __name__ == '__main__':
    main()
