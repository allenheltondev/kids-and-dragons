/**
 * Coat masks (docs/hero-looks.md §4.3): the gate in verify.py, the draft tool and the review
 * tint in coat.py. Fixtures are made in a temporary directory; the real paintings are only read.
 *
 * The 2026-11-07 proof of concept's throwaway masks were never committed, so the draft is held
 * to the regions that prototype describes (§2) rather than to its pixels: on the fledgling
 * unicorn, the light coat and not the purple mane; on the fledgling Bigfoot, the dark mane on
 * his head and shoulders and not the cream coat.
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

type Fixture = "good" | "wrong-size" | "empty" | "spill" | "whole-gear" | "good-gear" | "unlisted" | "listed-missing" | "rgba-mask";

function gate(fixture: Fixture): string[] {
  return run(`
import verify as v
mf = json.load(open(v.MANIFEST, encoding='utf-8'))
fixture = ${JSON.stringify(fixture)}
base = 'characters/unicorn/fledgling/assembled.png'
gear = 'gear-portraits/thornguard/sworn/unicorn.png'
with tempfile.TemporaryDirectory() as root:
    v.ROOT = root
    def put(rel, im):
        p = Path(coat.asset(rel, root)); p.parent.mkdir(parents=True, exist_ok=True); im.save(p)
    figure = Image.new('RGBA', (1024, 1024))
    ImageDraw.Draw(figure).ellipse((250, 200, 780, 900), fill=(240, 225, 240, 255))
    put(base, figure)
    put(gear, Image.new('RGB', (1254, 1254), (20, 24, 40)))
    mask = Image.new('L', (1024, 1024))
    ImageDraw.Draw(mask).ellipse((320, 300, 700, 800), fill=255)
    listed = [base]
    if fixture == 'wrong-size': mask = mask.resize((512, 512))
    if fixture == 'empty': mask = Image.new('L', (1024, 1024))
    if fixture == 'spill': ImageDraw.Draw(mask).rectangle((0, 0, 1023, 180), fill=255)
    if fixture == 'rgba-mask': mask = mask.convert('RGBA')
    if fixture in ('whole-gear', 'good-gear'):
        gm = Image.new('L', (1254, 1254), 255 if fixture == 'whole-gear' else 0)
        if fixture == 'good-gear': ImageDraw.Draw(gm).ellipse((400, 300, 850, 1000), fill=255)
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

describe("art:verify gates every coat mask", () => {
  it("passes a mask on its painting's canvas, inside the figure", () => expect(gate("good")).toEqual([]));
  it("passes an opaque gear portrait's mask that leaves room for the backdrop", () =>
    expect(gate("good-gear")).toEqual([]));
  it("fails a mask of the wrong size", () =>
    expect(gate("wrong-size")).toEqual(["characters/unicorn/fledgling/coat-mask.png canvas"]));
  it("fails an empty mask", () =>
    expect(gate("empty")).toEqual(["characters/unicorn/fledgling/coat-mask.png coverage"]));
  it("fails a mask that spills outside the figure's alpha", () =>
    expect(gate("spill")).toEqual(["characters/unicorn/fledgling/coat-mask.png inside the figure"]));
  it("fails a mask that is the whole canvas", () =>
    expect(gate("whole-gear")).toEqual(["gear-portraits/thornguard/sworn/unicorn.coat-mask.png coverage"]));
  it("fails a mask that is not 8-bit greyscale", () =>
    expect(gate("rgba-mask")).toEqual(["characters/unicorn/fledgling/coat-mask.png mode"]));
  it("fails a mask on disk the manifest does not list (a draft is never shipped as is)", () =>
    expect(gate("unlisted")).toEqual(["characters/unicorn/fledgling/coat-mask.png"]));
  it("fails a listed mask that is missing, so the client never asks for it", () =>
    expect(gate("listed-missing")).toEqual(["characters/unicorn/fledgling/coat-mask.png"]));
});

describe("art:coat-draft", () => {
  it("drafts the prototype's regions: the unicorn's coat, Bigfoot's mane", () => {
    const result = run(`
mf = json.load(open(os.path.join(coat.ROOT, 'assets', 'manifest.json'), encoding='utf-8'))
out = {}
for species in ('unicorn', 'bigfoot'):
    region = coat.region_of(mf, species)
    palette = coat.palette_of(mf, species)
    rgba = np.asarray(Image.open(coat.asset(f'characters/{species}/fledgling/assembled.png')).convert('RGBA'))
    m = coat.draft_mask(rgba, palette[region['draftFrom']]).astype(float) / 255
    alpha = rgba[..., 3] > 128
    lab = coat.srgb_to_oklab(rgba[..., :3] / 255.0)
    def near(slot):  # the painted pixels closest to a palette slot
        d = coat._distance(lab, coat.srgb_to_oklab(coat.hex_rgb(palette[slot])))
        return alpha & (d <= np.percentile(d[alpha], 8))
    ys, xs = np.nonzero(alpha)
    my = (m * np.arange(m.shape[0])[:, None]).sum() / m.sum()
    out[species] = dict(
        region=region['region'],
        share=float(m[alpha].sum() / alpha.sum()),
        centre=float((my - ys.min()) / (ys.max() - ys.min())),  # 0 top of the figure, 1 its feet
        coat=float(m[near('coat')].mean()),
        mane=float(m[near('mane')].mean()),
        problems=[p[0] for p in coat.mask_problems(Image.fromarray((m * 255).round().astype(np.uint8), 'L'),
                                                    Image.fromarray(rgba, 'RGBA'), mf['coatMasks']['tolerance'])],
    )
print(json.dumps(out))
`);
    const { unicorn, bigfoot } = result;
    expect(unicorn.region).toBe("coat");
    expect(unicorn.share).toBeGreaterThan(0.45); // the light coat is most of her
    expect(unicorn.share).toBeLessThan(0.8);
    expect(unicorn.centre).toBeGreaterThan(0.3); // her body, not her head
    expect(unicorn.coat).toBeGreaterThan(0.8);
    expect(unicorn.mane).toBeLessThan(0.2); // the mane stays her painted accent
    expect(unicorn.problems).toEqual([]);

    expect(bigfoot.region).toBe("mane");
    expect(bigfoot.share).toBeGreaterThan(0.15);
    expect(bigfoot.share).toBeLessThan(0.45);
    expect(bigfoot.centre).toBeLessThan(0.4); // head and shoulders
    expect(bigfoot.mane).toBeGreaterThan(0.8);
    expect(bigfoot.coat).toBeLessThan(0.15); // not the cream coat
    expect(bigfoot.problems).toEqual([]);
  });

  it("writes beside each painting and never replaces a mask without --force", () => {
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
    Image.new('L', (4, 4), 7).save(target)
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
    expect(result.replaced).toEqual([[1024, 1024], "L"]);
  });

  it("leaves an opaque painting's backdrop out of the draft", () => {
    const r = run(`
# a brown mane on a cream figure, on a brown backdrop: the mane is drafted, the backdrop is not
im = Image.new('RGB', (400, 400), (70, 58, 46))
d = ImageDraw.Draw(im)
d.ellipse((100, 60, 300, 380), fill=(242, 234, 225))
d.ellipse((150, 90, 250, 200), fill=(76, 63, 50))
rgba = np.asarray(im.convert('RGBA'))
m = coat.draft_mask(rgba, '#4C3F32').astype(float) / 255
print(json.dumps(dict(mane=float(m[120:170, 180:220].mean()), backdrop=float(m[:40].mean() + m[:, :60].mean()))))
`);
    expect(r.mane).toBeGreaterThan(0.9);
    expect(r.backdrop).toBeLessThan(0.01);
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
});
