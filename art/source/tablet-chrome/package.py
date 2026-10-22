"""Package imagegen outputs; build review sheets and report the delivery contract.

Run with Python/Pillow: package.py --sources <local JSON mapping id to PNG path>.
Generation sources stay outside Git; prompts and the exact delivery spec live here.
Only alpha-bound cropping, delivery resizing and WebP encoding affect runtime art.
"""
import argparse
import json
import math
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
SPEC = json.loads(Path(__file__).with_name('manifest.json').read_text())
OUT = ROOT / 'packages/client/src/assets/chrome'
REVIEW = ROOT / 'docs/reviews/tablet-chrome-art'
BG = (13, 11, 26, 255)

def font(size=14):
    try:
        return ImageFont.truetype('C:/Windows/Fonts/consola.ttf', size)
    except OSError:
        return ImageFont.load_default()

def package(sources, cwebp=None):
    OUT.mkdir(parents=True, exist_ok=True)
    for item in SPEC['assets']:
        if item['id'] not in sources:
            continue
        im = Image.open(sources[item['id']]).convert('RGBA')
        # Ignore nearly invisible alpha speckles when locating the painted silhouette.
        # This changes framing only; keep the original alpha inside the crop.
        bbox = im.getchannel('A').point(lambda a: 255 if a > 1 else 0).getbbox()
        if bbox and item['id'] != 'vignette':
            im = im.crop(bbox)
        im = im.resize((item['width'], item['height']), Image.Resampling.LANCZOS)
        stage=ROOT/'tmp/tablet-chrome-encoding'
        if cwebp:
            stage.mkdir(parents=True, exist_ok=True)
            im.save(stage/(item['id']+'.png'))
        # Retain alpha, using standard WebP alpha quantization for compact UI art.
        # The vignette uses a narrow, low-opacity feather that survives this encoding cleanly.
        for quality in [80, 75, 70, 65, 60, 55]:
            if cwebp:
                alpha_quality='70'
                subprocess.run([str(cwebp),'-quiet','-q',str(quality),'-alpha_q',alpha_quality,'-m','6',str(stage/(item['id']+'.png')),'-o',str(OUT/(item['id']+'.webp'))],check=True)
            else:
                im.save(OUT / (item['id'] + '.webp'), 'WEBP', quality=quality, method=6)
            if (OUT / (item['id'] + '.webp')).stat().st_size < 8000:
                break

def contact(backdrop=False):
    cellw, cellh, cols = 310, 230, 4
    rows = math.ceil(len(SPEC['assets']) / cols)
    canvas = Image.new('RGBA', (cols * cellw, rows * cellh), BG)
    scene = Image.open(ROOT / 'assets/biomes/enchanted_woods/bg.webp').convert('RGBA')
    scene = scene.resize((cellw - 8, cellh - 8))
    d = ImageDraw.Draw(canvas)
    for idx, item in enumerate(SPEC['assets']):
        x, y = (idx % cols) * cellw, (idx // cols) * cellh
        if backdrop:
            canvas.alpha_composite(scene, (x + 4, y + 4))
        path = OUT / (item['id'] + '.webp')
        if path.exists():
            im = Image.open(path).convert('RGBA')
            im.thumbnail((280, 170), Image.Resampling.LANCZOS)
            canvas.alpha_composite(im, (x + (cellw - im.width)//2, y + 16 + (170-im.height)//2))
        d.rectangle((x + 4, y + 189, x + cellw - 4, y + 226), fill=BG)
        d.text((x + 12, y + 190), item['id'], font=font(), fill='#ffc95c')
        d.text((x + 12, y + 209), f"{item['width']}x{item['height']}  {item['slicing']}", font=font(11), fill='#c5bdd9')
    canvas.convert('RGB').save(REVIEW / ('contact-backdrop.webp' if backdrop else 'contact-night.webp'), quality=90, method=6)

def report():
    entries = []
    for item in SPEC['assets']:
        path = OUT / (item['id'] + '.webp')
        if not path.exists():
            continue
        im = Image.open(path).convert('RGBA')
        assert im.size == (item['width'], item['height'])
        entry = dict(id=item['id'], bytes=path.stat().st_size, size=list(im.size), alpha_extrema=list(im.getchannel('A').getextrema()))
        if item['id'] == 'paper-night':
            lo,hi = im.convert('L').getextrema()
            entry['luminance_range_fraction'] = round((hi-lo)/255, 5)
        if item['id'] == 'vignette':
            entry['center_alpha'] = im.getpixel((im.width//2,im.height//2))[3]
        if item['slicing'].startswith('T'):
            # Numerical edge diagnostics complement the four-repeat visual review.
            axes = ['vertical', 'horizontal'] if item['slicing'] == 'T both' else [item['slicing'].split()[1]]
            seams = {}
            for axis in axes:
                a = list(im.crop((0,0,im.width,1) if axis == 'vertical' else (0,0,1,im.height)).getdata())
                b = list(im.crop((0,im.height-1,im.width,im.height) if axis == 'vertical' else (im.width-1,0,im.width,im.height)).getdata())
                seams[axis] = round(sum(abs(c-d) for p,q in zip(a,b) for c,d in zip(p,q)) / (len(a)*4), 3)
            entry['edge_mean_absolute_difference'] = seams
        entries.append(entry)
    total = sum(e['bytes'] for e in entries)
    result = dict(files=len(entries), expected=len(SPEC['assets']), total_bytes=total, target_total_bytes=160000, per_file_target_bytes=8000, oversized=[e['id'] for e in entries if e['bytes'] >= 8000], assets=entries)
    (REVIEW / 'validation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k:v for k,v in result.items() if k != 'assets'}))
    return result

def slice_insets(item):
    kind = item['slicing']
    if kind.startswith('9S insets left 112'):
        return (112,32,32,32)
    if kind.startswith('9S insets left/right'):
        return (48,32,48,32)
    if kind.startswith('9S inset'):
        return (int(kind.split()[-1]),)*4
    if kind.startswith('3S'):
        cap = int(kind.split()[-1])
        return (0,cap,0,cap) if 'vertical' in kind else (cap,0,cap,0)
    return None

def stretch(im, insets):
    left,top,right,bottom = insets
    w,h = im.size
    dw,dh = left + (w-left-right)*3 + right, top + (h-top-bottom)*3 + bottom
    out = Image.new('RGBA',(dw,dh))
    sx,sy = [0,left,w-right,w],[0,top,h-bottom,h]
    dx,dy = [0,left,dw-right,dw],[0,top,dh-bottom,dh]
    for row in range(3):
        for col in range(3):
            box = (sx[col],sy[row],sx[col+1],sy[row+1])
            dest = (dx[col+1]-dx[col],dy[row+1]-dy[row])
            if dest[0] and dest[1]:
                out.alpha_composite(im.crop(box).resize(dest,Image.Resampling.LANCZOS),(dx[col],dy[row]))
    return out

def technical_sheets():
    tiles = [i for i in SPEC['assets'] if i['slicing'].startswith('T')]
    # Keep four-repeat tiles at delivery resolution in individual review files.
    # The summary is only an index; inspect these originals for seam acceptance.
    canvas = Image.new('RGBA',(1100, len(tiles)*205),BG)
    d=ImageDraw.Draw(canvas)
    for row,item in enumerate(tiles):
        path=OUT/(item['id']+'.webp')
        if not path.exists():
            continue
        im=Image.open(path).convert('RGBA')
        nx = 4 if item['slicing'] in ['T horizontal','T both'] else 1
        ny = 4 if item['slicing'] in ['T vertical','T both'] else 1
        tiled=Image.new('RGBA',(im.width*nx,im.height*ny))
        for y in range(ny):
            for x in range(nx):
                tiled.alpha_composite(im,(x*im.width,y*im.height))
        full=Image.new('RGBA',tiled.size,BG)
        full.alpha_composite(tiled)
        full.convert('RGB').save(REVIEW/('tile-'+item['id']+'-4x.webp'),quality=95,method=6)
        # Uniform preview scaling preserves the tile seam; delivery files remain exact size.
        tiled.thumbnail((1040,170),Image.Resampling.LANCZOS)
        canvas.alpha_composite(tiled,(24,row*205+28))
        d.text((24,row*205+5),item['id']+' / four repeats per axis',font=font(),fill='#ffc95c')
    canvas.convert('RGB').save(REVIEW/'tile-repeat-review.webp',quality=92,method=6)
    panels=[i for i in SPEC['assets'] if slice_insets(i)]
    canvas=Image.new('RGBA',(1200,len(panels)*260),BG)
    d=ImageDraw.Draw(canvas)
    for row,item in enumerate(panels):
        path=OUT/(item['id']+'.webp')
        if not path.exists():
            continue
        im=stretch(Image.open(path).convert('RGBA'),slice_insets(item))
        im.thumbnail((1140,220),Image.Resampling.LANCZOS)
        canvas.alpha_composite(im,(24,row*260+30))
        d.text((24,row*260+5),item['id']+' / stretchable regions at 3x',font=font(),fill='#ffc95c')
    canvas.convert('RGB').save(REVIEW/'slice-stretch-review.webp',quality=92,method=6)
    # Dark ink is intentionally quiet on the night contact sheet; review it on its paper.
    paper=Image.open(OUT/'goal-paper.webp').convert('RGBA') if (OUT/'goal-paper.webp').exists() else None
    if paper:
        pairs=Image.new('RGBA',(paper.width*2,paper.height),BG)
        for col,name in enumerate(['goal-box','goal-box-ticked']):
            path=OUT/(name+'.webp')
            pairs.alpha_composite(paper,(col*paper.width,0))
            if path.exists():
                box=Image.open(path).convert('RGBA')
                pairs.alpha_composite(box,(col*paper.width+48,(paper.height-box.height)//2))
        pairs.convert('RGB').save(REVIEW/'goal-checkbox-review.webp',quality=95,method=6)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources', type=Path)
    parser.add_argument('--cwebp', type=Path, help='Optional libwebp cwebp encoder, alpha quality 70')
    parser.add_argument('--strict', action='store_true', help='Fail for missing art or byte budget violations')
    args = parser.parse_args()
    REVIEW.mkdir(parents=True, exist_ok=True)
    if args.sources:
        package(json.loads(args.sources.read_text()),args.cwebp)
    contact()
    contact(True)
    technical_sheets()
    result=report()
    if args.strict:
        assert result['files'] == result['expected'], 'Missing deliverables'
        assert not result['oversized'], 'Per-file byte budget exceeded'
        assert result['total_bytes'] < result['target_total_bytes'], 'Total byte budget exceeded'
        for item in result['assets']:
            if item['id']=='paper-night':
                assert item['luminance_range_fraction'] < .06, 'Background texture too contrasty'
            if item['id']=='vignette':
                assert item['center_alpha']==0, 'Vignette center must be transparent'
