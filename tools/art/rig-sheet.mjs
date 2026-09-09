#!/usr/bin/env node
/**
 * Kids & Dragons — rig contact sheets.
 *
 * `tools/art/sheet.py` makes contact sheets of art that holds still. This makes
 * them of art that moves: one row per species, N frames evenly spaced across a
 * clip, so a human can see whether the figure is alive without opening a runtime.
 *
 * It is the counterpart to `art:verify:rig`, and the split is the same one the
 * verifier's own header draws — that tool checks that a clip is 24 ticks long and
 * loops, and it has no opinion whatsoever about whether the breathing reads as
 * breathing. This sheet is where that judgement gets made, by a person.
 *
 * Usage:
 *     npm run art:sheet:rig                     # idle, fledgling, all species
 *     node tools/art/rig-sheet.mjs --clip walk --tier mythic
 *     node tools/art/rig-sheet.mjs --frames 8
 *
 * Writes art/review/rig_<clip>_<tier>.png. Needs the Rive CLI (KAD_RIVE_CLI), the
 * same as `art:verify:rig:motion`, and Pillow, the same as the other art tooling.
 *
 * The frames come from one CLI `batch`: one `render` job per rig with the clip's
 * sample times, which the CLI writes as a filmstrip from a single file load, all
 * in one browser. Before that it was one process — one Chromium launch — per
 * frame, thirty-six launches for a six-frame sheet of six species.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { cannotRunMessage, resolveChrome, resolveCli, runBatch, runCli } from "./rive-cli.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "assets", "manifest.json"), "utf8"));

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const clip = opt("clip", "idle");
const tier = opt("tier", "fledgling");
const frames = Number(opt("frames", "6"));
const cell = Number(opt("cell", "240"));

if (!MANIFEST.tiers.includes(tier)) {
  console.error(`error: "${tier}" is not a tier (${MANIFEST.tiers.join(", ")})`);
  process.exit(2);
}
if (!MANIFEST.rigContract?.clips?.[clip]) {
  console.error(`error: "${clip}" is not a clip in rigContract`);
  process.exit(2);
}

const cli = resolveCli();
resolveChrome();

// The clip's own length, off the contract — a sheet that sampled a fixed two
// seconds would show `walk` four times and `idle` once, and the eye would read
// the difference as animation rather than as sampling.
const seconds = MANIFEST.rigContract.clips[clip].ticks / MANIFEST.rigContract.tickFps;

/** Pillow does the compositing; the rest of the art tooling already depends on it. */
const PY = `
import json, sys
from PIL import Image, ImageDraw

spec = json.loads(sys.argv[1])
cell, rows = spec["cell"], spec["rows"]
label_w, header, pad = 120, 34, 6
cols = len(rows[0]["cells"])
W = label_w + cols * (cell + pad) + pad
H = header + len(rows) * (cell + pad) + pad

sheet = Image.new("RGB", (W, H), (26, 26, 30))
draw = ImageDraw.Draw(sheet)
draw.text((pad, 10), f'{spec["clip"]}  -  {spec["tier"]}  -  {cols} frames over {spec["seconds"]:.2f}s', fill=(230, 230, 235))

for r, row in enumerate(rows):
    y = header + r * (cell + pad) + pad
    draw.text((pad, y + cell // 2 - 6), row["id"], fill=(200, 200, 210))
    for c, path in enumerate(row["cells"]):
        x = label_w + c * (cell + pad) + pad
        # A mid grey behind the figure: these are transparent PNGs, and both a
        # white and a black backing hide half the outline art the tiers escalate.
        tile = Image.new("RGBA", (cell, cell), (108, 110, 118, 255))
        im = Image.open(path).convert("RGBA")
        tile.alpha_composite(im, ((cell - im.width) // 2, (cell - im.height) // 2))
        sheet.paste(tile.convert("RGB"), (x, y))

sheet.save(spec["out"])
`;

const work = join(tmpdir(), `kad-rig-sheet-${process.pid}`);
mkdirSync(work, { recursive: true });

// The last sample is one step short of the loop point: for a looping clip
// frame N would be frame 0 again, and a duplicate cell reads as a stall.
const times = Array.from({ length: frames }, (_, i) => (seconds * i) / frames);

const rows = [];
try {
  const jobs = [];
  for (const sp of MANIFEST.species) {
    const rig = join(ROOT, "assets", "characters", sp.id, tier, "rig.riv");
    if (!existsSync(rig)) {
      console.log(`  skip  ${sp.id}/${tier}  no rig.riv`);
      continue;
    }
    // `{i}` is the CLI's filmstrip pattern: one PNG per time, in the order given.
    jobs.push({ id: sp.id, cmd: "render", file: rig, animation: clip, times, width: cell, out: join(work, `${sp.id}_{i}.png`) });
  }

  let results;
  try {
    ({ results } = runBatch(jobs, { concurrency: 4, cli }));
  } catch (err) {
    if (!err.unsupported) {
      console.error(`\nerror: ${err.message}`);
      process.exit(2);
    }
    // A CLI older than `batch` is also older than `--times`: one process per
    // frame, as this tool always did. Slower, and said so.
    console.log(`  note: ${err.message}; rendering one process per frame instead`);
    results = jobs.map((job) => {
      const outs = [];
      for (const [i, t] of times.entries()) {
        const out = job.out.replace("{i}", String(i));
        const r = runCli(["render", job.file, "--animation", job.animation, "--time", String(t), "--width", String(job.width), "-o", out], { cli });
        if (r.error) {
          console.error(`\nerror: ${cannotRunMessage(cli)}`);
          process.exit(2);
        }
        if (r.status !== 0) return { id: job.id, ok: false, error: `t=${t.toFixed(3)}s: ${(r.stderr || r.stdout).trim().split("\n").pop()}` };
        outs.push(out);
      }
      return { id: job.id, ok: true, outs };
    });
  }

  const byId = new Map(results.map((r) => [r.id, r]));
  for (const job of jobs) {
    const r = byId.get(job.id) ?? { ok: false, error: "the batch returned no result for this rig" };
    if (!r.ok || !Array.isArray(r.outs) || r.outs.length !== frames) {
      console.error(`error: rendering ${job.id} failed: ${r.error ?? "not every frame was written"}`);
      process.exit(1);
    }
    rows.push({ id: job.id, cells: r.outs });
    console.log(`  ok    ${job.id}/${tier}  ${frames} frames of ${clip}`);
  }

  if (rows.length === 0) {
    console.error("error: no rigs to sheet at assets/characters/<species>/<tier>/rig.riv — rigging is rive-mcp's (art-pipeline §3)");
    process.exit(1);
  }

  const outPath = join(ROOT, "art", "review", `rig_${clip}_${tier}.png`);
  // Gitignored output, so a fresh checkout has no such directory yet.
  mkdirSync(join(ROOT, "art", "review"), { recursive: true });
  const py = spawnSync(
    "python3",
    ["-c", PY, JSON.stringify({ rows, out: outPath, cell, clip, tier, seconds })],
    { encoding: "utf8" },
  );
  if (py.status !== 0) {
    console.error(py.stdout + py.stderr);
    process.exit(1);
  }
  console.log(`\n-> ${outPath}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
