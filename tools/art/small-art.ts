/**
 * `npm run art:small`: the copies of the art a device draws in a painting's place
 * (packages/client/src/world/art-paths.ts, "SMALL ART"), made from the paintings on disk.
 *
 *   - `<name>@0.5x.webp`, half as wide and half as tall, for a phone: scene, biome and camp
 *     backdrops, story plates, and the figures of everyone who is not a hero.
 *   - `<name>@1x.webp`, the painting's own size, for every other screen: every figure's PNG
 *     (the cast, creatures, and a hero's paintings and gear portraits) as a WebP a fifth to a
 *     tenth of its bytes, its alpha exactly the painting's.
 *
 * Each is written beside its painting, and `assets.small.json` records which painting (by
 * sha256) it was made from. A copy whose painting has not changed is left alone, so a second
 * run is quick and moves nothing, and a run after the rules grew makes only what is new.
 *
 * Then, as for any art: `npm run assets:push`, and commit `assets.lock.json` and
 * `assets.small.json` together. The next build sees that every copy is in the lock and
 * current, and devices start asking for them (packages/client/small-art-build.ts); until then,
 * and whenever a repaint has not been run through here, every device draws the paintings.
 *
 *   npm run art:small              make what is owed
 *   npm run art:small -- --check   say what is owed and write nothing (exit 1 when something is)
 *
 * Needs the paintings on disk (`npm run assets:pull`) and Pillow (requirements-dev.txt).
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { SMALL_ART_RECORD, loadSmallArt, smallArtOwed, smallArtSources, type ArtCopyKind, type SmallArtRecord } from "../../packages/client/small-art-build.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Lossy WebP with the alpha kept exactly (WebP's alpha plane is lossless unless asked
 * otherwise, and nothing here asks). A half is Lanczos at a quality painted art does not show,
 * so edges stay clean at half size; a whole is the painting's own pixels at a higher quality,
 * since it is what a television draws and what a hero's coat is tinted from.
 */
const RESIZE = `
import json, sys
from PIL import Image
for job in json.load(sys.stdin):
    with Image.open(job["source"]) as im:
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        if job["kind"] == "half":
            half = im.resize((max(1, im.width // 2), max(1, im.height // 2)), Image.LANCZOS)
            half.save(job["copy"], "WEBP", quality=82, method=6, exact=False)
        else:
            im.save(job["copy"], "WEBP", quality=90, method=6, exact=False)
`;

interface Job {
  source: string;
  copy: string;
  kind: ArtCopyKind;
}

/** One Python over `jobs`; resolves when it is done, rejects when it failed. */
function resize(jobs: Job[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const python = spawn("python3", ["-c", RESIZE], { stdio: ["pipe", "inherit", "inherit"] });
    python.on("error", reject);
    python.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`python3 exited ${String(code)}`))));
    python.stdin.end(JSON.stringify(jobs));
  });
}

/** Every job, dealt out to as many Pythons as there are cores (a whole figure takes seconds to encode). */
async function resizeAll(jobs: Job[]): Promise<void> {
  const hands = Math.max(1, Math.min(availableParallelism(), jobs.length));
  const dealt: Job[][] = Array.from({ length: hands }, () => []);
  jobs.forEach((job, i) => dealt[i % hands]!.push(job));
  await Promise.all(dealt.map(resize));
}

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

async function main(argv: string[]): Promise<number> {
  const check = argv.includes("--check");
  const { files, record } = loadSmallArt(ROOT);
  const sources = smallArtSources(files);

  if (check) {
    const owed = smallArtOwed(files, record);
    for (const { copy, why } of owed.slice(0, 20)) console.log(`  ${why.padEnd(7)} ${copy}`);
    if (owed.length > 20) console.log(`  … and ${owed.length - 20} more`);
    const halves = sources.filter(({ kind }) => kind === "half").length;
    console.log(owed.length === 0 ? `small art: all ${sources.length} copies (${halves} half-size, ${sources.length - halves} full-size) are in the lock and current` : `small art: ${owed.length} of ${sources.length} copies owed (${owed.filter(({ kind }) => kind === "half").length} half-size, ${owed.filter(({ kind }) => kind === "whole").length} full-size); run \`npm run art:small\`, then \`npm run assets:push\``);
    return owed.length === 0 ? 0 : 1;
  }

  const absent = [...new Set(sources.map(({ source }) => source))].filter((source) => !existsSync(`${ROOT}${source}`));
  if (absent.length > 0) {
    console.error(`small art: ${absent.length} paintings are not on disk (first: ${absent[0]!}). Run \`npm run assets:pull\` first.`);
    return 1;
  }

  // Judged by the painting on disk, which may be newer than the lock (a repaint not yet pushed).
  const next: SmallArtRecord = {};
  const jobs: Job[] = [];
  const hashed = new Map<string, string>();
  for (const { source, copy, kind } of sources) {
    const from = hashed.get(source) ?? sha256(`${ROOT}${source}`);
    hashed.set(source, from);
    next[copy] = from;
    if (record[copy] !== from || !existsSync(`${ROOT}${copy}`)) jobs.push({ source: `${ROOT}${source}`, copy: `${ROOT}${copy}`, kind });
  }

  if (jobs.length > 0) {
    console.log(`small art: making ${jobs.length} copies…`);
    await resizeAll(jobs);
  }
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(`${ROOT}${SMALL_ART_RECORD}`, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`small art: made ${jobs.length} of ${sources.length} copies. Now \`npm run assets:push\`, and commit assets.lock.json with ${SMALL_ART_RECORD}.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main(process.argv.slice(2)));
