"""Package the painted master as registered, palette-safe animation layers.

Run: python art/source/painted-rifts/build.py
The master is generated artwork; this script handles registration, texture
sampling, palette mapping and animation, rather than drawing a substitute rim.
24 x 320px fits a single 7680px strip on an 8192px GPU texture.
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = ROOT / 'assets/effects'
REVIEW = ROOT / 'art/review/painted-rifts'
SIZE, FRAMES, FPS = 320, 24, 12
IDS = ['neutral', 'base', 'green', 'amber', 'blue', 'violet', 'shrink', 'stutter', 'sync', 'open', 'collapse']
# Preserve the shipped palette, not destination-dependent colours.
PALETTE = {'green': (61, 164, 97), 'amber': (191, 116, 48),
           'blue': (70, 124, 175), 'violet': (137, 100, 181)}
yy, xx = np.mgrid[:SIZE, :SIZE].astype(float)
u, v = (xx - 160) / 115, (yy - 160) / 115
radius = np.hypot(u, v)
angle = np.arctan2(v, u)


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def master():
    image = Image.open(HERE / 'doorway-master.png').convert('RGBA')
    image = image.crop(image.getbbox())
    image.thumbnail((230, 230), Image.Resampling.LANCZOS)
    registered = Image.new('RGBA', (SIZE, SIZE))
    registered.paste(image, ((SIZE - image.width) // 2, 275 - image.height))
    data = np.asarray(registered, dtype=float) / 255
    grey = data[:, :, :3].mean(axis=2)
    # Actual neutral pigment, never metallic white/silver or a palette hue.
    data[:, :, :3] = np.minimum(grey, 0.75)[:, :, None]
    return data


MASTER = master()


def sample(source, sx, sy):
    """Bilinear sample in premultiplied alpha to avoid dark fringes."""
    x, y = np.clip(sx, 0, SIZE - 1.001), np.clip(sy, 0, SIZE - 1.001)
    ix, iy = x.astype(int), y.astype(int)
    fx, fy = (x - ix)[:, :, None], (y - iy)[:, :, None]
    pre = source.copy()
    pre[:, :, :3] *= pre[:, :, 3:4]
    result = ((pre[iy, ix] * (1-fx) + pre[iy, ix+1] * fx) * (1-fy)
              + (pre[iy+1, ix] * (1-fx) + pre[iy+1, ix+1] * fx) * fy)
    result[:, :, :3] /= np.maximum(result[:, :, 3:4], 1e-8)
    return result


def frame(kind, index):
    t = index / FRAMES
    phase = math.tau * t
    # Local sideways drift only: the neutral shimmer must not breathe, ripple,
    # flicker or spiral, since those movements carry diagnostic information.
    drift = (1 - smooth(0.75, 1.15, radius))
    painted = sample(MASTER, xx + 1.8*np.sin(phase + v*3)*drift,
                     yy + 1.0*np.sin(phase + u*4)*drift)
    if kind in ('neutral', 'base', 'shrink', 'stutter', 'open', 'collapse'):
        result = painted
        # Shrink/stutter act on the whole assembled glyph in CSS, so coloured
        # layers never float outside a shrinking or displaced doorway.
        if kind in ('open', 'collapse'):
            progress = index / (FRAMES - 1)
            if kind == 'collapse':
                progress = 1 - progress
            eased = progress*progress*(3-2*progress)
            scale = 0.06 + 0.94*eased
            result = sample(painted, 160 + (xx-160)/scale, 275 + (yy-275)/scale)
            result[:, :, 3] *= 0.25 + 0.75*eased
    else:
        # Texture comes from the painted master, including its broken edges.
        pigment = np.clip(painted[:, :, :3].mean(axis=2)*1.8, 0.25, 1)
        grain = 0.55 + 0.45*pigment
        if kind == 'green':
            breath = (1 - math.cos(phase))/2
            r = radius / (0.96 + 0.045*breath)
            mask = np.exp(-((r-0.86)/0.14)**2) * smooth(0.38, 0.62, np.abs(u))
            mask *= (1-smooth(0.55, 0.87, np.abs(v))) * (0.5+0.5*breath)
        elif kind == 'amber':
            # One candle-like catch in the painted lower rim. Keep its foot
            # and silhouette steady: a tall inflating teardrop read as a
            # separate object inside the portal. The brief dip and recovery
            # provide the flicker, with no breathing or growing flame.
            dip = math.exp(-((t-0.42)/0.055)**2)
            catch = math.exp(-((t-0.50)/0.06)**2)
            flicker = 0.72 - 0.36*dip + 0.18*catch
            rim = np.exp(-((radius-0.86)/0.12)**2)
            rim *= smooth(0.48, 0.70, v)*(1-smooth(0.30, 0.52, np.abs(u)))
            # A short, attached brush-wisp keeps the candle cue legible in
            # grayscale, without a floating flame or a point reaching upward.
            wisp = np.exp(-((u+0.055)/0.065)**2 - ((v-0.69)/0.14)**2)
            mask = (rim + 0.34*wisp)*flicker
        elif kind == 'blue':
            mask = np.zeros_like(radius)
            for offset in (0, 0.5):
                p = (t+offset) % 1
                ring = 0.27+0.45*p
                envelope = math.sin(math.pi*p)**0.6
                mask += np.exp(-((radius-ring)/0.055)**2)*envelope
        elif kind == 'violet':
            # d(radius)/dt < 0: light travels inward, not merely rotating.
            arms = (0.5+0.5*np.cos(2*angle + 9*np.log(radius+0.08) + phase))**10
            mask = arms*smooth(0.1, 0.24, radius)*(1-smooth(0.6, 0.78, radius))
        else:  # linked mouths: two painted lobes, one shared clock
            pulse = (1-math.cos(phase))/2
            mask = sum(np.exp(-(((u-x)/0.09)**2+((v+0.74)/0.07)**2)*2) for x in (-0.13, 0.13))
            mask *= 0.45+0.55*pulse
        result = np.zeros_like(painted)
        color = np.array(PALETTE.get(kind, (164, 164, 164))) / 255
        result[:, :, :3] = color[None, None, :] * (0.76+0.4*pigment[:, :, None])
        result[:, :, 3] = np.clip(mask*grain*painted[:, :, 3]*1.7, 0, 0.96)
    return Image.fromarray(np.uint8(np.clip(result, 0, 1)*255), 'RGBA')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    REVIEW.mkdir(parents=True, exist_ok=True)
    frames = {kind: [frame(kind, i) for i in range(FRAMES)] for kind in IDS}
    for kind, images in frames.items():
        sheet = Image.new('RGBA', (FRAMES*SIZE, SIZE))
        for i, image in enumerate(images):
            sheet.paste(image, (i*SIZE, 0))
        sheet.quantize(colors=256, method=Image.Quantize.FASTOCTREE).save(
            OUT / f'rift_{kind}.sheet.png', optimize=True)
        (OUT / f'rift_{kind}.json').write_text(json.dumps(dict(frames=FRAMES, fps=FPS, size=SIZE), indent=2)+'\n')
    path = ROOT / 'assets/manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    for effect in manifest['effects']:
        if effect['id'] in [f'rift_{kind}' for kind in IDS]:
            effect.update(frames=FRAMES, fps=FPS, size=SIZE, tileScoped=False)
            if effect['id'] in ('rift_open', 'rift_collapse'):
                # Opening ends exactly where the neutral loop begins; closing
                # starts there. Neither may fade out/in at that shared endpoint.
                effect['handoff'] = 'toLoop' if effect['id'] == 'rift_open' else 'fromLoop'
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    stacks = [('Neutral', ['neutral']), ('Green + amber + violet', ['base', 'green', 'amber', 'violet']),
              ('Amber + violet', ['base', 'amber', 'violet']), ('Green + blue', ['base', 'green', 'blue']),
              ('Blue + linked', ['base', 'blue', 'sync'])]
    animated = []
    for i in range(FRAMES):
        page = Image.new('RGB', (len(stacks)*256, 540), '#191925')
        draw = ImageDraw.Draw(page)
        for j, (label, layers) in enumerate(stacks):
            tile = Image.new('RGBA', (SIZE, SIZE), '#242432')
            for layer in layers:
                tile = Image.alpha_composite(tile, frames[layer][i])
            tile = tile.convert('RGB').resize((256, 256), Image.Resampling.LANCZOS)
            page.paste(tile, (j*256, 24))
            page.paste(ImageOps.grayscale(tile).convert('RGB'), (j*256, 284))
            draw.text((j*256+8, 6), label, fill='#ddd5c9')
        animated.append(page)
    animated[FRAMES//2].save(REVIEW/'common-stacks.png')
    # APNG preserves alpha/colour better than GIF; HTML review uses actual sheets.
    animated[0].save(REVIEW/'common-stacks.webp', save_all=True,
                     append_images=animated[1:], duration=round(1000/FPS), loop=0, quality=90)
    print(f'Packaged {len(IDS)} painted sheets: {FRAMES} frames, {FPS}fps, {SIZE}px')


if __name__ == '__main__':
    main()
