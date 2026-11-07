/**
 * Coat masks (docs/hero-looks.md §4.3): the gate in verify.py, the draft tool and the review
 * tint in coat.py. Fixtures are made in a temporary directory; the real paintings are only read.
 *
 * A mask is 8-bit RGB: R the species' main part, G its accent part, B the figure (the hero's
 * whole silhouette, for the special looks). The 2026-11-07 proof of concept's throwaway masks
 * were never committed, so the draft is held to the parts the owner chose rather than to
 * pixels: on the fledgling unicorn, R her light coat and G her purple mane; on the fledgling
 * Bigfoot, R his fur (the cream coat and the brown mane on his head and shoulders, drafted
 * from two palette slots) and G the tan skin of his face and feet.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const art = fileURLToPath(new URL(".", import.meta.url));
const python = process.platform === "win32" ? "python" : "python3";

function run(code: string): any {
  const prelude = `
import json, os, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, ${JSON.stringify(art)})
import coat
`;
  const output = execFileSync(python, ["-c", prelude + code], { encoding: "utf8", maxBuffer: 1 << 24 });
  return JSON.parse(output.trim().split("\n").at(-1)!);
}

type Fixture =
  | "good"
  | "good-gear"
  | "wrong-size"
  | "greyscale"
  | "rgba-mask"
  | "empty-main"
  | "empty-accent"
  | "empty-figure"
  | "main-spill"
  | "accent-spill"
  | "figure-spill"
  | "overlap"
  | "whole-gear"
  | "unlisted"
  | "listed-missing";

function gate(fixture: Fixture): string[] {
  return run(`
import verify as v
mf = json.load(open(v.MANIFEST, encoding='utf-8'))
fixture = ${JSON.stringify(fixture)}
base = 'characters/unicorn/fledgling/assembled.png'
gear = 'gear-portraits/thornguard/sworn/unicorn.png'
FIGURE = (250, 200, 780, 900)

def channels(size, figure, main, accent):
    """An RGB mask from three greyscale channels (ellipse boxes or images)."""
    out = []
    for box in (main, accent, figure):
        if isinstance(box, Image.Image):
            out.append(box); continue
        ch = Image.new('L', size)
        if box: ImageDraw.Draw(ch).ellipse(box, fill=255)
        out.append(ch)
    return Image.merge('RGB', out)

with tempfile.TemporaryDirectory() as root:
    v.ROOT = root
    def put(rel, im):
        p = Path(coat.asset(rel, root)); p.parent.mkdir(parents=True, exist_ok=True); im.save(p)
    figure = Image.new('RGBA', (1024, 1024))
    ImageDraw.Draw(figure).ellipse(FIGURE, fill=(240, 225, 240, 255))
    put(base, figure)
    put(gear, Image.new('RGB', (1254, 1254), (20, 24, 40)))
    # main: the body, low on the figure; accent: the head, above it; figure: the alpha itself
    main, accent = (320, 520, 700, 860), (380, 240, 640, 480)
    if fixture == 'empty-main': main = None
    if fixture == 'empty-accent': accent = None
    if fixture == 'overlap': accent = main
    fig = None if fixture == 'empty-figure' else FIGURE
    if fixture in ('main-spill', 'accent-spill', 'figure-spill'):
        # a band across the top of the canvas, where the painting is transparent
        band = Image.new('L', (1024, 1024))
        d = ImageDraw.Draw(band); d.ellipse(main if fixture == 'main-spill' else accent if fixture == 'accent-spill' else FIGURE, fill=255)
        d.rectangle((0, 0, 1023, 150), fill=255)
        if fixture == 'main-spill': main = band
        elif fixture == 'accent-spill': accent = band
        else: fig = band
    mask = channels((1024, 1024), fig, main, accent)
    listed = [base]
    if fixture == 'wrong-size': mask = mask.resize((512, 512))
    if fixture == 'greyscale': mask = mask.convert('L')
    if fixture == 'rgba-mask': mask = mask.convert('RGBA')
    if fixture in ('whole-gear', 'good-gear'):
        if fixture == 'good-gear':
            gm = channels((1254, 1254), (400, 300, 850, 1000), (430, 600, 820, 980), (480, 330, 770, 560))
        else:
            gm = channels((1254, 1254), Image.new('L', (1254, 1254), 255), Image.new('L', (1254, 1254), 255),
                          (480, 330, 770, 560))
        put(coat.mask_path_for(gear), gm)
        listed.append(gear)
    if fixture != 'listed-missing': put(coat.mask_path_for(base), mask)
    if fixture == 'unlisted': listed = []
    mf['coatMasks']['paintings'] = listed
    rep = v.Report()
    v.check_coat_masks(rep, mf)
    print(json.dumps(rep.failures))
`);
}

const BASE = "characters/unicorn/fledgling/coat-mask.png";
const GEAR = "gear-portraits/thornguard/sworn/unicorn.coat-mask.png";

describe("art:verify gates every coat mask", () => {
  it("passes a mask on its painting's canvas: two parts inside the figure, the figure its alpha", () =>
    expect(gate("good")).toEqual([]));
  it("passes an opaque gear portrait's mask whose figure leaves the backdrop out", () =>
    expect(gate("good-gear")).toEqual([]));
  it("fails a mask of the wrong size", () => expect(gate("wrong-size")).toEqual([`${BASE} canvas`]));
  it("fails a greyscale mask (the one-region format)", () => expect(gate("greyscale")).toEqual([`${BASE} mode`]));
  it("fails a mask with an alpha channel: 8-bit RGB only", () => expect(gate("rgba-mask")).toEqual([`${BASE} mode`]));
  it("fails an empty main part", () => expect(gate("empty-main")).toEqual([`${BASE} main coverage`]));
  it("fails an empty accent part", () => expect(gate("empty-accent")).toEqual([`${BASE} accent coverage`]));
  it("fails an empty figure", () =>
    expect(gate("empty-figure")).toEqual([
      `${BASE} figure coverage`,
      `${BASE} main inside the figure`,
      `${BASE} accent inside the figure`,
    ]));
  it("fails a main part that spills outside the figure", () =>
    expect(gate("main-spill")).toEqual([`${BASE} main inside the figure`]));
  it("fails an accent part that spills outside the figure", () =>
    expect(gate("accent-spill")).toEqual([`${BASE} accent inside the figure`]));
  it("fails a figure that spills outside a transparent painting's alpha", () =>
    expect(gate("figure-spill")).toEqual([`${BASE} figure inside the alpha`]));
  it("fails a pixel strongly in both parts", () => expect(gate("overlap")).toEqual([`${BASE} overlap`]));
  it("fails a part, or a figure, that is the whole canvas", () =>
    expect(gate("whole-gear")).toEqual([`${GEAR} main coverage`, `${GEAR} figure coverage`, `${GEAR} overlap`]));
  it("fails a mask on disk the manifest does not list (a draft is never shipped as is)", () =>
    expect(gate("unlisted")).toEqual([BASE]));
  it("fails a listed mask that is missing, so the client never asks for it", () =>
    expect(gate("listed-missing")).toEqual([BASE]));
});

describe("art:coat-draft", () => {
  it("drafts the owner's parts: the unicorn's coat and mane, Bigfoot's fur and skin, and the figure", () => {
    const result = run(`
mf = json.load(open(os.path.join(coat.ROOT, 'assets', 'manifest.json'), encoding='utf-8'))
out = {}
for species in ('unicorn', 'bigfoot'):
    parts = coat.region_of(mf, species)
    palette = coat.palette_of(mf, species)
    rgba = np.asarray(Image.open(coat.asset(f'characters/{species}/fledgling/assembled.png')).convert('RGBA'))
    mask = coat.draft_parts(rgba, *(coat.seeds_of(mf, species, p) for p in coat.PARTS))
    m = mask.astype(float) / 255
    R, G, B = m[..., 0], m[..., 1], m[..., 2]
    alpha = rgba[..., 3] > 128
    lab = coat.srgb_to_oklab(rgba[..., :3] / 255.0)
    def near(slot):  # the painted pixels closest to a palette slot
        d = coat._distance(lab, coat.srgb_to_oklab(coat.hex_rgb(palette[slot])))
        return alpha & (d <= np.percentile(d[alpha], 8))
    out[species] = dict(
        regions=[parts[p]['region'] for p in coat.PARTS],
        main=float(R[alpha].mean()), accent=float(G[alpha].mean()),
        both=float((np.minimum(R, G) > 0.5).sum()),
        overlap=float(np.minimum(R, G).sum() / min(R.sum(), G.sum())),
        figure=float(np.abs(B - rgba[..., 3] / 255.0).max()),
        at={slot: [float(R[near(slot)].mean()), float(G[near(slot)].mean())] for slot in ('coat', 'mane', 'skin') if slot in palette},
        problems=[p[0] for p in coat.mask_problems(Image.fromarray(mask, 'RGB'), Image.fromarray(rgba, 'RGBA'),
                                                    mf['coatMasks']['tolerance'])],
    )
print(json.dumps(out))
`);
    const { unicorn, bigfoot } = result;
    expect(unicorn.regions).toEqual(["coat", "mane"]);
    expect(unicorn.main).toBeGreaterThan(0.45); // the light coat is most of her
    expect(unicorn.main).toBeLessThan(0.8);
    expect(unicorn.accent).toBeGreaterThan(0.1);
    expect(unicorn.at.coat[0]).toBeGreaterThan(0.8); // R: her coat ...
    expect(unicorn.at.coat[1]).toBeLessThan(0.1);
    expect(unicorn.at.mane[1]).toBeGreaterThan(0.8); // G: her purple mane ...
    expect(unicorn.at.mane[0]).toBeLessThan(0.1);
    expect(unicorn.both).toBe(0); // no pixel strongly in both
    expect(unicorn.figure).toBeLessThan(1 / 255 + 1e-9); // B is her alpha
    expect(unicorn.problems).toEqual([]);

    expect(bigfoot.regions).toEqual(["fur", "skin"]);
    expect(bigfoot.main).toBeGreaterThan(0.55); // the coat and the mane: most of him
    expect(bigfoot.accent).toBeGreaterThan(0.08);
    expect(bigfoot.at.coat[0]).toBeGreaterThan(0.8); // R: his cream fur ...
    expect(bigfoot.at.coat[1]).toBeLessThan(0.1);
    expect(bigfoot.at.skin[1]).toBeGreaterThan(0.8); // G: the tan skin of his face and feet ...
    expect(bigfoot.at.skin[0]).toBeLessThan(0.15); // his face is ringed by the mane: a soft edge, no more
    expect(bigfoot.at.mane[0]).toBeGreaterThan(0.75); // ... and most of his brown mane, the same part
    expect(bigfoot.at.mane[1]).toBeLessThan(0.1);
    expect(bigfoot.both).toBe(0);
    expect(bigfoot.overlap).toBeLessThan(0.08); // the manifest's maxOverlap
    expect(bigfoot.figure).toBeLessThan(1 / 255 + 1e-9);
    expect(bigfoot.problems).toEqual([]);
  });

  it("writes an RGB mask beside each painting and never replaces a mask without --force", () => {
    const result = run(`
import importlib.util, contextlib, io
spec = importlib.util.spec_from_file_location('coat_draft', os.path.join(${JSON.stringify(art)}, 'coat-draft.py'))
draft = importlib.util.module_from_spec(spec); spec.loader.exec_module(draft)
with tempfile.TemporaryDirectory() as out:
    args = ['bigfoot', '--family', 'base', '--tier', 'fledgling', '--out', out]
    with contextlib.redirect_stdout(io.StringIO()):
        draft.main(args)
    written = sorted(str(p.relative_to(out)) for p in Path(out).rglob('*.png'))
    target = Path(coat.asset('characters/bigfoot/fledgling/coat-mask.png', out))
    Image.new('RGB', (4, 4), 7).save(target)
    with contextlib.redirect_stdout(io.StringIO()):
        draft.main(args)
    kept = Image.open(target).size
    with contextlib.redirect_stdout(io.StringIO()):
        draft.main(args + ['--force'])
    replaced = Image.open(target)
    print(json.dumps(dict(written=written, kept=list(kept), replaced=[list(replaced.size), replaced.mode])))
`);
    expect(result.written).toEqual(["assets/characters/bigfoot/fledgling/coat-mask.png"]);
    expect(result.kept).toEqual([4, 4]);
    expect(result.replaced).toEqual([[1024, 1024], "RGB"]);
  });

  it("leaves an opaque painting's backdrop out of every channel, the figure included", () => {
    const r = run(`
# a gear-portrait-like fixture: a cream figure with a brown mane and tan face, on a dark backdrop
im = Image.new('RGB', (400, 400), (32, 30, 52))
d = ImageDraw.Draw(im)
d.ellipse((100, 60, 300, 380), fill=(242, 234, 225))
d.ellipse((150, 90, 250, 200), fill=(76, 63, 50))
d.ellipse((175, 115, 225, 165), fill=(230, 180, 129))
rgba = np.asarray(im.convert('RGBA'))
m = coat.draft_parts(rgba, '#F2EAE1', '#E6B481').astype(float) / 255
R, G, B = m[..., 0], m[..., 1], m[..., 2]
backdrop = lambda ch: float(ch[:40].mean() + ch[:, :60].mean())
print(json.dumps(dict(
    body=float(R[260:340, 160:240].mean()), face=float(G[130:150, 190:210].mean()),
    figure=float(B[100:360, 140:260].mean()),
    backdrop=[backdrop(R), backdrop(G), backdrop(B)],
)))
`);
    expect(r.body).toBeGreaterThan(0.9);
    expect(r.face).toBeGreaterThan(0.9);
    expect(r.figure).toBeGreaterThan(0.95);
    for (const leak of r.backdrop) expect(leak).toBeLessThan(0.01);
  });
});

describe("the review sheet's colour swap (§5.2)", () => {
  it("moves only the masked region, keeps its shading, and stays in range", () => {
    const r = run(`
rgba = np.zeros((2, 3, 4), np.uint8); rgba[..., 3] = 255
rgba[0, :, :3] = [[200, 200, 200], [150, 150, 150], [100, 100, 100]]  # a grey region with shading
rgba[1, :, :3] = [30, 160, 60]
mask = np.zeros((2, 3), np.uint8); mask[0] = 255
out = coat.tint(rgba, mask, '#E8326E')
lab = coat.srgb_to_oklab(out[0, :, :3] / 255.0)
target = coat.srgb_to_oklab(coat.hex_rgb('#E8326E'))
hue = np.degrees(np.arctan2(lab[:, 2], lab[:, 1])); th = np.degrees(np.arctan2(target[2], target[1]))
print(json.dumps(dict(
    untouched=out[1].tolist() == rgba[1].tolist(),
    alpha=out[..., 3].tolist() == rgba[..., 3].tolist(),
    order=bool(lab[0, 0] > lab[1, 0] > lab[2, 0]),
    hue=float(np.abs(hue - th).max()),
    brightest=int(coat.tint(rgba, mask, '#FFFFFF')[0, :, :3].max()),
)))
`);
    expect(r.untouched).toBe(true);
    expect(r.alpha).toBe(true);
    expect(r.order).toBe(true); // highlights stay highlights
    expect(r.hue).toBeLessThan(3); // the coat's hue, gamut kept by chroma not by clipping
    expect(r.brightest).toBeLessThan(252); // lightness clamped at 0.98: never blown out to pure white
  });

  it("colours a painting's two parts, each through its own channel, and leaves the rest as painted", () => {
    const r = run(`
rgba = np.zeros((1, 3, 4), np.uint8); rgba[..., 3] = 255
rgba[0, :, :3] = [[220, 220, 220], [120, 60, 140], [30, 30, 30]]
mask = np.zeros((1, 3, 3), np.uint8); mask[0, 0, 0] = 255; mask[0, 1, 1] = 255; mask[..., 2] = 255
out = coat.tint(coat.tint(rgba, mask[..., 0], '#E8326E'), mask[..., 1], '#2E8B57')
lab = coat.srgb_to_oklab(out[0, :, :3] / 255.0)
hue = lambda v: float(np.degrees(np.arctan2(v[2], v[1])))
want = lambda h: hue(coat.srgb_to_oklab(coat.hex_rgb(h)))
print(json.dumps(dict(main=abs(hue(lab[0]) - want('#E8326E')), accent=abs(hue(lab[1]) - want('#2E8B57')),
                      rest=out[0, 2].tolist() == rgba[0, 2].tolist())))
`);
    expect(r.main).toBeLessThan(3);
    expect(r.accent).toBeLessThan(3);
    expect(r.rest).toBe(true);
  });
});
