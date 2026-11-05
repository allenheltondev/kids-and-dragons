import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../../assets/manifest.json';
import { campArtOwed } from './camp-art.ts';

const art = fileURLToPath(new URL('.', import.meta.url));

/** Runs verify.py's camp checks against the real manifest, edited by `edit` (Python). */
function verify(edit: string, files = ''): { failures: string[]; warnings: string[] } {
  const code = `
import json, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, ${JSON.stringify(art)})
import verify as v
mf = json.load(open(v.MANIFEST, encoding='utf-8'))
camp = mf['camp']
frame = camp['frames'][0]
def point(i): return next(p for p in frame['standPoints'] if p['id'] == i)
def cutout(bottom=900):
    im = Image.new('RGBA', (1024, 1024))
    ImageDraw.Draw(im).rectangle((300, 600, 700, bottom), fill=(150, 110, 60, 255))
    return im
def decoration(size=512, inset=40):
    im = Image.new('RGBA', (size, size))
    ImageDraw.Draw(im).ellipse((inset, inset, size - inset, size - inset), fill=(200, 160, 60, 255))
    return im
def deco(i): return next(d for d in camp['decorations'] if d['id'] == i)
def tent(i): return next(t for t in camp['tentStyles'] if t['id'] == i)
def crew(i): return next(p for p in camp['crewPieces'] if p['id'] == i)
stage2 = camp['frames'][1]
def point2(i): return next(p for p in stage2['standPoints'] if p['id'] == i)
def hotspot(i): return next(h for h in stage2['hotspots'] if h['id'] == i)
${edit}
with tempfile.TemporaryDirectory() as root:
    v.ROOT = root
    def save(rel, im, fmt):
        path = Path(root) / 'assets' / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path, fmt, lossless=True) if fmt == 'WEBP' else im.save(path, fmt)
    def save_icon(icon, im):
        path = Path(root) / 'packages/client/src/assets/painted' / f'{icon}.webp'
        path.parent.mkdir(parents=True, exist_ok=True)
        ImageDraw.Draw(im).ellipse((40, 40, 216, 216), fill=(60, 170, 160, 255))
        im.save(path, 'WEBP', lossless=True)
${files.split('\n').map(line => `    ${line}`).join('\n')}
    rep = v.Report()
    v.check_camp_layout(rep, mf)
    v.check_camp_catalog(rep, mf)
    v.check_camp_art(rep, mf)
    print(json.dumps(dict(failures=rep.failures, warnings=rep.warnings)))
`;
  const output = execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', code], { encoding: 'utf8' });
  const result = JSON.parse(output.trim().split('\n').at(-1)!) as { failures: string[]; warnings: string[] };
  result.failures = result.failures.map(label => label.replaceAll('\\', '/'));
  return result;
}

/** Every camp painting the manifest declares, in its format: ground pieces, the parts over them, decorations and the icon. */
const everyPainting = `
save('camp/backdrops/open_plains.webp', Image.new('RGB', (1920, 1080), (90, 140, 60)), 'WEBP')
grounded = {p['path'] for f in camp['frames'] for p in f['pieces']} | {k['path'] for k in camp['kitStyles']}
grounded |= {p['path'] for p in camp['crewPieces']} | {t['path'] for t in camp['tentStyles']} | {camp['souvenirDisplay']['path']}
parts = {m['path'] for f in camp['frames'] for m in f['movingParts']} | {t['flap'] for t in camp['tentStyles']}
parts |= {m['path'] for p in camp['crewPieces'] for m in p.get('movingParts', [])}
for rel in grounded:
    save(rel, cutout(), 'PNG')
for rel in parts - grounded:
    save(rel, cutout(820), 'PNG')
for deco in camp['decorations']:
    save(deco['path'], decoration(), 'PNG')
for icon in camp['paintedIcons']:
    save_icon(icon, Image.new('RGBA', (256, 256)))`;

describe('camp layout (manifest.camp)', () => {
  it('accepts the declared layout and owes, rather than fails, every missing painting', () => {
    const { failures, warnings } = verify('');
    expect(failures).toEqual([]);
    const root = mkdtempSync(join(tmpdir(), 'kad-camp-owed-'));
    try {
      expect(warnings).toHaveLength(campArtOwed(root, manifest).need);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it.each([
    ['a lane below the open ground', `camp['backdrops'][0]['lanes'][2]['y'] = 0.8`, 'camp/backdrop/open_plains lanes'],
    ['a lane above the open ground, in the sky', `camp['backdrops'][0]['lanes'][0]['y'] = 0.4`, 'camp/backdrop/open_plains lanes'],
    ['lanes out of depth order', `camp['backdrops'][0]['lanes'][1]['y'] = 0.5`, 'camp/backdrop/open_plains lanes'],
    ['a crossing off a lane', `camp['backdrops'][0]['crossings'][0]['x'] = 0.02`, 'camp/backdrop/open_plains lanes'],
    ['a stand point past its lane end', `point('wander_near_right')['x'] = 0.99`, 'camp/stage1 layout'],
    ['a hotspot that names no piece', `point('campfire_left')['hotspot'] = 'cookfire'`, 'camp/stage1 layout'],
    ['an unknown action', `point('campfire_left')['action'] = 'dance'`, 'camp/stage1 layout'],
    ['a missing seat', `frame['standPoints'] = [p for p in frame['standPoints'] if p.get('seat') != 3]`, 'camp/stage1 layout'],
    ['a stand point out at the edge, where a phone crops', `point('wander_near_left')['x'] = 0.06`, 'camp/stage1 layout'],
    ['a piece out at the edge, where a phone crops', `frame['pieces'][0]['x'] = 0.95`, 'camp/stage1 layout'],
    ['a moving part on no piece', `frame['movingParts'][0]['piece'] = 'cookfire'`, 'camp/stage1 layout'],
    ['no open_plains fallback', `camp['backdrops'][0]['family'] = 'frozen_north'`, 'camp backdrops'],
    ['a stage-2 stand point at a hotspot nobody laid out', `point2('awning')['hotspot'] = 'lookout'`, 'camp/stage2 layout'],
    ['a hotspot off its lane', `hotspot('awning')['x'] = 0.95`, 'camp/stage2 layout'],
    ['a hotspot of a kind nobody paints', `hotspot('awning')['kind'] = 'lookout'`, 'camp/stage2 layout'],
    ['a hotspot sharing a piece id', `hotspot('awning')['id'] = 'tent_0'; point2('awning')['hotspot'] = 'tent_0'`, 'camp/stage2 layout'],
    ['a hotspot whose default stands at another kind', `hotspot('cookfire')['default'] = 'kept_crew_banner'`, 'camp/stage2 layout'],
    ['a lantern nobody can swing, at a hotspot a hero looks up at', `del crew('shop_lantern_arch')['movingParts']`, ['camp/stage1 layout', 'camp/stage2 layout']],
    ['a tent spot with no flap to sway', `stage2['movingParts'] = stage2['movingParts'][1:]`, 'camp/stage2 layout'],
    ['a frame piece warmed at with no flame', `frame['movingParts'] = []`, 'camp/stage1 layout'],
  ])('rejects %s', (_, edit, label) => expect(verify(edit).failures).toEqual([label].flat()));
});

describe('camp catalog (#623)', () => {
  it.each([
    ['a crew piece at a hotspot kind no frame has', `crew('shop_log_bench')['hotspot'] = 'porch'`],
    ['a crew piece from nowhere', `crew('shop_log_bench')['group'] = 'gift'`],
    ['a find with no chapter', `del crew('find_picnic_blanket')['chapter']`],
    ['a find for a chapter that does not exist', `crew('find_picnic_blanket')['chapter'] = 'first-steps-99'`],
    ['a trophy for no campaign', `crew('trophy_gemfall')['campaign'] = 'moonfall'`],
    ['a crew piece with no height', `del crew('shop_log_bench')['heightCm']`],
    ['two crew pieces with one id', `crew('shop_log_bench')['id'] = 'shop_striped_awning'`],
    ['a catalog tent with no bedroll kit', `tent('quilted')['kit'] = 'woolly'`],
    ['a kit style with no tent', `camp['tentStyles'] = [t for t in camp['tentStyles'] if t['id'] != 'patched']`],
    ['a milestone tent for a tier the art lacks', `tent('mythic')['tier'] = 'starborn'`],
    ['a tent with no flap', `del tent('sworn')['flap']`],
    ['a tent tinted some other way', `tent('rolled')['tint'] = 'two-layer'`],
    ['a souvenir peg below the ground', `camp['souvenirDisplay']['hangPoints'][0]['y'] = 950`],
    ['a class distinction with no decoration', `camp['decorations'] = [d for d in camp['decorations'] if d['id'] != 'deco_songkeeper_master']`],
    ['a kit find with no chapter', `del deco('deco_gull_feather')['chapter']`],
  ])('rejects %s', (_, edit) => expect(verify(edit).failures).toEqual(['camp catalog']));
});

describe('camp art delivery', () => {
  it('accepts every painting in its format', () => {
    expect(verify('', everyPainting)).toEqual({ failures: [], warnings: [] });
  });

  it.each([
    ['a transparent backdrop', `save('camp/backdrops/open_plains.webp', Image.new('RGBA', (1920, 1080)), 'WEBP')`, 'camp/backdrops/open_plains.webp opaque'],
    ['a backdrop on the wrong canvas', `save('camp/backdrops/open_plains.webp', Image.new('RGB', (1600, 900)), 'WEBP')`, 'camp/backdrops/open_plains.webp canvas'],
    ['a piece with an opaque background', `save('camp/frames/stage1/campfire.png', cutout().convert('RGB'), 'PNG')`, 'assets/camp/frames/stage1/campfire.png mode'],
    ['a floating piece', `save('camp/frames/stage1/bedroll.png', cutout(780), 'PNG')`, 'camp/frames/stage1/bedroll.png origin'],
    ['a floating kit variant', `save('camp/kits/rolled.png', cutout(780), 'PNG')`, 'camp/kits/rolled.png origin'],
    ['a moving part below the ground', `save('camp/frames/stage1/campfire-flame.png', cutout(960), 'PNG')`, 'camp/frames/stage1/campfire-flame.png origin'],
    ['an undeclared file', `save('camp/frames/stage1/tent.png', cutout(), 'PNG')`, 'camp/frames/stage1/tent.png undeclared'],
    ['a floating tent', `save('camp/kits/tents/radiant.png', cutout(780), 'PNG')`, 'camp/kits/tents/radiant.png origin'],
    ['a tent flap below the ground', `save('camp/kits/tents/radiant-flap.png', cutout(960), 'PNG')`, 'camp/kits/tents/radiant-flap.png origin'],
    ['a floating shop piece', `save('camp/pieces/shop-log-bench.png', cutout(700), 'PNG')`, 'camp/pieces/shop-log-bench.png origin'],
    ['a decoration on the figure canvas', `save('camp/decorations/bunting.png', decoration(1024), 'PNG')`, 'assets/camp/decorations/bunting.png canvas'],
    ['a decoration in its edge margin', `save('camp/decorations/bunting.png', decoration(512, 10), 'PNG')`, 'assets/camp/decorations/bunting.png edge margin'],
    ['a decoration that is not a PNG', `save('camp/decorations/bunting.png', decoration(), 'WEBP')`, 'camp/decorations/bunting.png format'],
    ['a Dash Cash icon on the wrong canvas', `save_icon('dash_cash', Image.new('RGBA', (512, 512)))`, 'painted/dash_cash'],
  ])('rejects %s', (_, file, label) => {
    expect(verify('', `${everyPainting}\n${file}`).failures).toEqual([label]);
  });
});

describe('camp art prompts', () => {
  const read = (file: string) => JSON.parse(readFileSync(join(process.cwd(), 'docs', file), 'utf8')) as {
    paintings: { path: string; reference: string; plays: string; prompt: string; output: { width: number; height: number; format: string } }[];
  };
  const files = ['camp-art-prompts.json', 'camp-kit-art-prompts.json', 'camp-art-prompts-phase2.json'];
  const paintings = files.flatMap(file => read(file).paintings);
  const camp = manifest.camp;
  const decorations = new Set(camp.decorations.map(deco => deco.path));
  const icons = new Set(camp.paintedIcons.map(id => `packages/client/src/assets/painted/${id}.webp`));

  it('keep one prompt for each painting the manifest declares, in its format', () => {
    const declared = [
      ...camp.backdrops.map(backdrop => backdrop.path),
      ...camp.frames.flatMap(frame => [...frame.pieces, ...frame.movingParts].map(art => art.path)),
      ...camp.kitStyles.map(art => art.path),
      ...camp.crewPieces.flatMap(piece => [piece.path, ...(piece.movingParts ?? []).map(part => part.path)]),
      ...camp.tentStyles.flatMap(tent => [tent.path, tent.flap]),
      camp.souvenirDisplay.path,
      ...decorations,
    ];
    expect(paintings.map(painting => painting.path).filter(path => !icons.has(path)).map(path => path.replace(/^assets\//, '')).sort())
      .toEqual([...new Set(declared)].sort());
    expect(paintings.map(painting => painting.path).filter(path => icons.has(path)).sort()).toEqual([...icons].sort());
    for (const painting of paintings) {
      const rel = painting.path.replace(/^assets\//, '');
      expect(painting.output, painting.path).toMatchObject(
        painting.path.endsWith('.webp') && !icons.has(painting.path) ? { ...camp.backdropCanvas, format: 'WebP' }
          : icons.has(painting.path) ? { ...manifest.paintedIcons.canvas, format: 'WebP' }
          : decorations.has(rel) ? { width: camp.decorationCanvas.width, height: camp.decorationCanvas.height, format: 'PNG' }
          : { width: manifest.canvas.width, height: manifest.canvas.height, format: 'PNG' });
    }
  });

  it('give every Phase 2 painting a reference from the art already painted, and keep to the house rules', () => {
    const phase2 = read('camp-art-prompts-phase2.json').paintings;
    for (const [i, painting] of phase2.entries()) {
      // A moving part is cut from its piece, which comes before it in the file and is painted first.
      const earlier = phase2.slice(0, i).some(before => before.path === painting.reference);
      expect(earlier || existsSync(join(process.cwd(), painting.reference)), `${painting.path} reference ${painting.reference}`).toBe(true);
      if (!earlier) expect(painting.reference, painting.path).toMatch(/^assets\/camp\/(frames\/stage1|kits)\/|^packages\/client\/src\/assets\/painted\//);
      expect(painting.plays.length, painting.path).toBeGreaterThan(40);
      expect(painting.prompt, painting.path).toMatch(/upper-left light/);
      expect(painting.prompt, painting.path).toMatch(/no text/i);
      if (!/moving-part cutout/i.test(painting.prompt)) expect(painting.prompt, painting.path).toMatch(/one funny detail/i);
      expect(painting.prompt + painting.plays, painting.path).not.toMatch(/—/);
    }
  });
});

describe('camp art inventory', () => {
  it('owes each declared painting once, until it is on disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'kad-camp-art-'));
    try {
      const owed = campArtOwed(root, manifest);
      expect(owed.missing).toHaveLength(owed.need);
      expect(new Set(owed.missing).size).toBe(owed.need);
      expect(owed.missing).toEqual(expect.arrayContaining([
        'camp/backdrops/open_plains.webp',
        'camp/frames/stage1/campfire.png',
        'camp/frames/stage1/bedroll.png',
        'camp/frames/stage1/trailhead-post.png',
        'camp/frames/stage1/campfire-flame.png',
        'camp/kits/rolled.png',
        'camp/kits/quilted.png',
        'camp/kits/patched.png',
        'camp/frames/stage2/cookfire.png',
        'camp/frames/stage2/cookfire-flame.png',
        'camp/kits/tents/mythic.png',
        'camp/kits/tents/mythic-flap.png',
        'camp/kits/souvenir-line.png',
        'camp/pieces/trophy-riftlight.png',
        'camp/decorations/songkeeper-master.png',
        'painted/dash_cash.webp',
      ]));
      // Phase 1 and #633's eight, and Phase 2's sixty: the four tent spots share their fallback tent.
      expect(owed.need).toBe(68);
      mkdirSync(join(root, 'assets/camp/frames/stage1'), { recursive: true });
      writeFileSync(join(root, 'assets/camp/frames/stage1/bedroll.png'), 'fixture');
      mkdirSync(join(root, 'packages/client/src/assets/painted'), { recursive: true });
      writeFileSync(join(root, 'packages/client/src/assets/painted/dash_cash.webp'), 'fixture');
      expect(campArtOwed(root, manifest).missing).not.toContain('camp/frames/stage1/bedroll.png');
      expect(campArtOwed(root, manifest).missing).not.toContain('painted/dash_cash.webp');
      expect(campArtOwed(root, {})).toEqual({ need: 0, missing: [] });
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});

/**
 * A hero's gear is fitted to her painted box (packages/client/src/world/camp-ownership.ts
 * `HERO_PAINT`): per species, the most any of her paintings (every tier, every class figure)
 * covers of her drawn height, measured as actor-art.ts `measurePaint` measures (alpha over 64 on a
 * 256px copy). The table must cover every painting, so her gear fits each, and stay close to the
 * largest, so it is not fitted to a hero bigger than any she is drawn as.
 */
describe('the hero paint boxes gear is fitted to', () => {
  it('cover every hero painting, and no more than a little past the largest', async () => {
    const { HERO_PAINT } = await import('../../packages/client/src/world/camp-ownership.ts');
    const code = `
import glob, json, collections
from PIL import Image
nominal = 900 / 1024 - 0.078
out = collections.defaultdict(lambda: [0.0, 0.0])
paths = glob.glob('assets/characters/*/*/assembled.png') + glob.glob('assets/character-rigs/*/*/*/assembled.png')
for path in paths:
    species = path.split('/')[-2] if 'character-rigs' in path else path.split('/')[2]
    alpha = Image.open(path).convert('RGBA').resize((256, 256)).getchannel('A').point(lambda v: 255 if v > 64 else 0)
    l, t, r, b = alpha.getbbox()
    out[species][0] = max(out[species][0], (b - t) / 256 / nominal)
    out[species][1] = max(out[species][1], (r - l) / 256 / nominal)
print(json.dumps(out))
`;
    const measured = JSON.parse(execFileSync('python3', ['-c', code], { cwd: join(art, '..', '..'), encoding: 'utf8' })) as Record<string, [number, number]>;
    expect(Object.keys(measured).sort()).toEqual(Object.keys(HERO_PAINT).sort());
    for (const [species, [height, width]] of Object.entries(measured)) {
      const table = HERO_PAINT[species]!;
      expect(table.height, `${species} height`).toBeGreaterThanOrEqual(height);
      expect(table.width, `${species} width`).toBeGreaterThanOrEqual(width);
      expect(table.height - height, `${species} height`).toBeLessThan(0.02);
      expect(table.width - width, `${species} width`).toBeLessThan(0.02);
    }
  });
});

describe('the Phase 2 prompts, in step with the stage-2 layout (#620)', () => {
  const prompts = JSON.parse(readFileSync(join(art, '..', '..', 'docs', 'camp-art-prompts-phase2.json'), 'utf8')) as { paintings: { path: string; plays: string }[] };
  const camp = (manifest as unknown as { camp: { crewPieces: { id: string; path: string; hotspot: string; heightCm: number; widthCm: number }[]; frames: { hotspots?: { kind: string; lane: string }[] }[] } }).camp;
  const stage2 = camp.frames[1]!.hotspots!;

  it("says each crew piece's true height and width, and the lane its spot stands on", () => {
    for (const piece of camp.crewPieces) {
      const painting = prompts.paintings.find((p) => p.path === `assets/${piece.path}`)!;
      expect(painting.plays, piece.id).toContain(`Drawn at ${piece.heightCm} cm tall and ${piece.widthCm} cm wide.`);
      const lane = stage2.find((h) => h.kind === piece.hotspot)!.lane;
      expect(painting.plays, piece.id).toContain(`${lane} lane`);
    }
  });

  it('says where a piece a stage-1 crew can own stands at stage 1, where its kind has a spot there', () => {
    const stage1 = camp.frames[0]!.hotspots ?? [];
    const early = camp.crewPieces.filter((piece) => /^(find|kept|starter-shop)$/.test((piece as { group?: string }).group ?? ''));
    let said = 0;
    for (const piece of early) {
      const spot = stage1.find((h) => h.kind === piece.hotspot);
      if (!spot) continue;
      const painting = prompts.paintings.find((p) => p.path === `assets/${piece.path}`)!;
      expect(painting.plays, piece.id).toMatch(new RegExp(`At stage 1 it (stands|lies) on the ${spot.lane} lane`));
      said++;
    }
    expect(said).toBe(6);
  });

  it('sizes a tent to fit its owner, and hangs her souvenir line against her tent', () => {
    for (const painting of prompts.paintings.filter((p) => /kits\/tents\/[a-z]+\.png$/.test(p.path))) {
      expect(painting.plays, painting.path).toMatch(/fit its owner/);
    }
    expect(prompts.paintings.find((p) => p.path.endsWith('souvenir-line.png'))!.plays).toMatch(/back lane against the inner side of each hero's tent/);
  });
});
