/** Register generated cutouts without repainting them. Pass a sharp module path if not installed. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] || 'sharp');
const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '../../..');
const figures = JSON.parse(fs.readFileSync(path.join(DIR, 'figures.json'), 'utf8'));
const manifestPath = path.join(ROOT, 'assets/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const review = path.join(ROOT, 'art/review/issue-433');
fs.mkdirSync(review, { recursive: true });
const tiles = [];
for (const [index, entry] of figures.entries()) {
  const source = path.join(DIR, `${entry.id}.png`);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 8) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  if (right < left || left < 3 || top < 3 || right > info.width - 4 || bottom > info.height - 4) throw new Error(`Empty/clipped source: ${entry.id}`);
  const cutout = await sharp(source).extract({ left: left - 2, top: top - 2, width: right - left + 5, height: bottom - top + 5 }).resize({ width: 940, height: 820, fit: 'inside' }).png().toBuffer();
  const size = await sharp(cutout).metadata();
  const output = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#00000000' } }).composite([{ input: cutout, left: Math.round((1024 - size.width) / 2), top: 901 - size.height }]).png().toBuffer();
  const target = entry.basis ? `assets/cast/${entry.id}/assembled.png` : `assets/entities/${entry.id}/assembled.png`;
  fs.mkdirSync(path.dirname(path.join(ROOT, target)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, target), output);
  const { key, ...record } = entry;
  if (!entry.basis) delete record.basis;
  const list = entry.basis ? manifest.castFigures : manifest.stageFigures;
  const existing = list.findIndex((item) => item.id === entry.id);
  if (existing >= 0) list[existing] = record; else list.push(record);
  // Review complete figures and small silhouettes on both light and dark fields.
  const thumb = await sharp(output).resize(240, 240).toBuffer();
  const small = await sharp(output).trim().resize({ height: 120 }).toBuffer();
  const sw = (await sharp(small).metadata()).width;
  const caption = Buffer.from(`<svg width="300" height="28"><text x="8" y="20" font-family="sans-serif" font-size="16" fill="#33291f">${entry.id}</text></svg>`);
  const tile = await sharp({ create: { width: 300, height: 420, channels: 4, background: '#e6decd' } }).composite([
    { input: thumb, left: 30, top: 28 }, { input: caption, left: 0, top: 0 },
    { input: await sharp({ create: { width: 150, height: 150, channels: 4, background: '#243039' } }).png().toBuffer(), left: 150, top: 270 },
    { input: await sharp(small).resize({ width: Math.min(sw, 140), height: 120, fit: 'inside' }).toBuffer(), left: 5, top: 280 },
    { input: await sharp(small).resize({ width: Math.min(sw, 140), height: 120, fit: 'inside' }).toBuffer(), left: 155, top: 280 },
  ]).png().toBuffer();
  tiles.push({ input: tile, left: (index % 6) * 300, top: Math.floor(index / 6) * 420 });
  console.log(`${entry.id} -> ${target}`);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await sharp({ create: { width: 1800, height: Math.ceil(figures.length / 6) * 420, channels: 4, background: '#e6decd' } }).composite(tiles).png().toFile(path.join(review, 'contact.png'));
