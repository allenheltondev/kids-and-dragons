import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../..', import.meta.url));
const python = process.platform === 'win32' ? 'python' : 'python3';

it('checks delivered frames and rejects broken alpha, canvas and missing paintings', () => {
  const result = execFileSync(python, ['-c', `
import json, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, 'tools/art')
import verify as v
mf = json.load(open(v.MANIFEST, encoding='utf-8'))
real = v.Report()
v.check_nameplate_frames(real, mf)
assert not real.failures, real.failures
with tempfile.TemporaryDirectory() as root:
    v.ROOT = root
    folder = Path(root) / 'assets/nameplates'
    folder.mkdir(parents=True)
    spec = {'nameplateFrames': {'canvas': {'width': 512, 'height': 192}, 'slice': {'left':64,'right':64,'top':48,'bottom':48}, 'ids':['test']}}
    def check(image):
        image.save(folder / 'test.webp', 'WEBP', lossless=True)
        report = v.Report()
        v.check_nameplate_frames(report, spec)
        return report.failures
    good = Image.new('RGBA', (512,192))
    ImageDraw.Draw(good).rectangle((4,4,507,187), fill=(40,20,50,255))
    assert not check(good)
    assert check(Image.new('RGBA',(512,192),(40,20,50,255)))
    assert check(Image.new('RGBA',(512,192)))
    assert check(Image.new('RGBA',(256,96)))
    (folder / 'test.webp').unlink()
    missing = v.Report()
    v.check_nameplate_frames(missing,spec)
    assert missing.failures
print('nameplate contract verified')
`], { cwd: root, encoding: 'utf8' });
  expect(result).toContain('nameplate contract verified');
});
