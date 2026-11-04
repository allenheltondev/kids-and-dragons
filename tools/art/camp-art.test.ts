import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
${edit}
with tempfile.TemporaryDirectory() as root:
    v.ROOT = root
    def save(rel, im, fmt):
        path = Path(root) / 'assets' / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path, fmt, lossless=True) if fmt == 'WEBP' else im.save(path, fmt)
${files.split('\n').map(line => `    ${line}`).join('\n')}
    rep = v.Report()
    v.check_camp_layout(rep, mf)
    v.check_camp_art(rep, mf)
    print(json.dumps(dict(failures=rep.failures, warnings=rep.warnings)))
`;
  const output = execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', code], { encoding: 'utf8' });
  return JSON.parse(output.trim().split('\n').at(-1)!);
}

const everyPainting = `
save('camp/backdrops/open_plains.webp', Image.new('RGB', (1920, 1080), (90, 140, 60)), 'WEBP')
for rel in ['campfire', 'bedroll', 'trailhead-post']:
    save(f'camp/frames/stage1/{rel}.png', cutout(), 'PNG')
save('camp/frames/stage1/campfire-flame.png', cutout(820), 'PNG')`;

describe('camp layout (manifest.camp)', () => {
  it('accepts the declared layout and owes, rather than fails, every missing painting', () => {
    const { failures, warnings } = verify('');
    expect(failures).toEqual([]);
    expect(warnings).toHaveLength(5);
  });

  it.each([
    ['a lane under the lobby panels', `camp['backdrops'][0]['lanes'][2]['y'] = 0.85`, 'camp/backdrop/open_plains lanes'],
    ['lanes out of depth order', `camp['backdrops'][0]['lanes'][1]['y'] = 0.55`, 'camp/backdrop/open_plains lanes'],
    ['a crossing off a lane', `camp['backdrops'][0]['crossings'][0]['x'] = 0.02`, 'camp/backdrop/open_plains lanes'],
    ['a stand point past its lane end', `point('wander_near_right')['x'] = 0.99`, 'camp/stage1 layout'],
    ['a hotspot that names no piece', `point('campfire_left')['hotspot'] = 'cookfire'`, 'camp/stage1 layout'],
    ['an unknown action', `point('campfire_left')['action'] = 'dance'`, 'camp/stage1 layout'],
    ['a missing seat', `frame['standPoints'] = [p for p in frame['standPoints'] if p.get('seat') != 3]`, 'camp/stage1 layout'],
    ['a wander spot in the middle third', `point('wander_back_left')['x'] = 0.5`, 'camp/stage1 layout'],
    ['a moving part on no piece', `frame['movingParts'][0]['piece'] = 'cookfire'`, 'camp/stage1 layout'],
    ['no open_plains fallback', `camp['backdrops'][0]['family'] = 'frozen_north'`, 'camp backdrops'],
  ])('rejects %s', (_, edit, label) => expect(verify(edit).failures).toEqual([label]));
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
    ['a moving part below the ground', `save('camp/frames/stage1/campfire-flame.png', cutout(960), 'PNG')`, 'camp/frames/stage1/campfire-flame.png origin'],
    ['an undeclared file', `save('camp/frames/stage1/tent.png', cutout(), 'PNG')`, 'camp/frames/stage1/tent.png undeclared'],
  ])('rejects %s', (_, file, label) => {
    expect(verify('', `${everyPainting}\n${file}`).failures).toEqual([label]);
  });
});

describe('camp art prompts', () => {
  it('keep one prompt for each painting the manifest declares, in its format', () => {
    const prompts = JSON.parse(readFileSync(join(process.cwd(), 'docs/camp-art-prompts.json'), 'utf8')) as {
      paintings: { path: string; output: { width: number; height: number; format: string } }[];
    };
    const declared = [
      ...manifest.camp.backdrops.map(backdrop => backdrop.path),
      ...manifest.camp.frames.flatMap(frame => [...frame.pieces, ...frame.movingParts].map(art => art.path)),
    ];
    expect(prompts.paintings.map(painting => painting.path.replace(/^assets\//, '')).sort())
      .toEqual([...new Set(declared)].sort());
    for (const painting of prompts.paintings) {
      const backdrop = painting.path.endsWith('.webp');
      expect(painting.output).toMatchObject(backdrop
        ? { ...manifest.camp.backdropCanvas, format: 'WebP' }
        : { width: manifest.canvas.width, height: manifest.canvas.height, format: 'PNG' });
    }
  });
});

describe('camp art inventory', () => {
  it('owes each declared painting once, until it is on disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'kad-camp-art-'));
    try {
      expect(campArtOwed(root, manifest)).toEqual({
        need: 5,
        missing: [
          'camp/backdrops/open_plains.webp',
          'camp/frames/stage1/campfire.png',
          'camp/frames/stage1/bedroll.png',
          'camp/frames/stage1/trailhead-post.png',
          'camp/frames/stage1/campfire-flame.png',
        ],
      });
      mkdirSync(join(root, 'assets/camp/frames/stage1'), { recursive: true });
      writeFileSync(join(root, 'assets/camp/frames/stage1/bedroll.png'), 'fixture');
      expect(campArtOwed(root, manifest).missing).not.toContain('camp/frames/stage1/bedroll.png');
      expect(campArtOwed(root, {})).toEqual({ need: 0, missing: [] });
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});
