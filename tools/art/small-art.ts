/**
 * `npm run art:small`: the half-size copies a phone draws (packages/client/src/world/art-paths.ts,
 * "SMALL ART"), made from the paintings on disk.
 *
 * For every painting the rule names (scene and biome backdrops, and the figures of everyone
 * who is not a hero) it writes `<name>@0.5x.webp` beside it, half as wide and half as tall,
 * and records in `assets.small.json` which painting (by sha256) the copy was made from. A copy
 * whose painting has not changed is left alone, so a second run is quick and moves nothing.
 *
 * Then, as for any art: `npm run assets:push`, and commit `assets.lock.json` and
 * `assets.small.json` together. The next build sees that every copy is in the lock and
 * current, and phones start asking for them (packages/client/small-art-build.ts); until then,
 * and whenever a repaint has not been run through here, every device draws the paintings.
 *
 *   npm run art:small              make what is owed
 *   npm run art:small -- --check   say what is owed and write nothing (exit 1 when something is)
 *
 * Needs the paintings on disk (`npm run assets:pull`) and Pillow (requirements-dev.txt).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SMALL_ART_RECORD, loadSmallArt, smallArtOwed, smallArtSources, type SmallArtRecord } from "../../packages/client/small-art-build.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Lossy WebP at a quality painted art does not show, alpha kept; Lanczos, so edges stay clean at half size. */
const RESIZE = `
import json, sys
from PIL import Image
for job in json.load(sys.stdin):
    with Image.open(job["source"]) as im:
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        half = im.resize((max(1, im.width // 2), max(1, im.height // 2)), Image.LANCZOS)
        half.save(job["copy"], "WEBP", quality=82, method=6, exact=False)
`;

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

function main(argv: string[]): number {
  const check = argv.includes("--check");
  const { files, record } = loadSmallArt(ROOT);
  const sources = smallArtSources(files);

  if (check) {
    const owed = smallArtOwed(files, record);
    for (const { copy, why } of owed.slice(0, 20)) console.log(`  ${why.padEnd(7)} ${copy}`);
    if (owed.length > 20) console.log(`  … and ${owed.length - 20} more`);
    console.log(owed.length === 0 ? `small art: all ${sources.length} copies are in the lock and current` : `small art: ${owed.length} of ${sources.length} copies owed; run \`npm run art:small\`, then \`npm run assets:push\``);
    return owed.length === 0 ? 0 : 1;
  }

  const absent = sources.filter(({ source }) => !existsSync(`${ROOT}${source}`));
  if (absent.length > 0) {
    console.error(`small art: ${absent.length} paintings are not on disk (first: ${absent[0]!.source}). Run \`npm run assets:pull\` first.`);
    return 1;
  }

  // Judged by the painting on disk, which may be newer than the lock (a repaint not yet pushed).
  const next: SmallArtRecord = {};
  const jobs: { source: string; copy: string }[] = [];
  for (const { source, copy } of sources) {
    const from = sha256(`${ROOT}${source}`);
    next[copy] = from;
    if (record[copy] !== from || !existsSync(`${ROOT}${copy}`)) jobs.push({ source: `${ROOT}${source}`, copy: `${ROOT}${copy}` });
  }

  if (jobs.length > 0) {
    execFileSync("python3", ["-c", RESIZE], { input: JSON.stringify(jobs), stdio: ["pipe", "inherit", "inherit"], maxBuffer: 1 << 26 });
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(`${ROOT}${SMALL_ART_RECORD}`, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`small art: made ${jobs.length} of ${sources.length} copies. Now \`npm run assets:push\`, and commit assets.lock.json with ${SMALL_ART_RECORD}.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
