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
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

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

/** Same resolution rule as verify-rig-motion.mjs — the tool is not a repo dependency. */
function resolveCli() {
  const env = process.env.KAD_RIVE_CLI;
  if (env) {
    if (env.endsWith(".js") || env.endsWith(".mjs")) return { cmd: process.execPath, pre: [env] };
    return { cmd: env, pre: [] };
  }
  return { cmd: process.platform === "win32" ? "rive-mcp-build.cmd" : "rive-mcp-build", pre: [] };
}
const cli = resolveCli();

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

const rows = [];
try {
  for (const sp of MANIFEST.species) {
    const rig = join(ROOT, "assets", "characters", sp.id, tier, "rig.riv");
    if (!existsSync(rig)) {
      console.log(`  skip  ${sp.id}/${tier}  no rig.riv`);
      continue;
    }
    const cells = [];
    for (let i = 0; i < frames; i++) {
      // The last sample is one step short of the loop point: for a looping clip
      // frame N would be frame 0 again, and a duplicate cell reads as a stall.
      const t = (seconds * i) / frames;
      const out = join(work, `${sp.id}_${i}.png`);
      const r = spawnSync(
        cli.cmd,
        [...cli.pre, "render", rig, "--animation", clip, "--time", String(t), "--width", String(cell), "-o", out],
        { encoding: "utf8" },
      );
      if (r.error) {
        console.error(
          `\nerror: could not run the Rive CLI (${r.error.code ?? r.error.message}).\n` +
            `Set KAD_RIVE_CLI to its cli.js, or put rive-mcp-build on your PATH.\n`,
        );
        process.exit(2);
      }
      if (r.status !== 0) {
        console.error(`error: rendering ${sp.id} at t=${t.toFixed(3)}s failed\n${r.stdout}${r.stderr}`);
        process.exit(1);
      }
      cells.push(out);
    }
    rows.push({ id: sp.id, cells });
    console.log(`  ok    ${sp.id}/${tier}  ${frames} frames of ${clip}`);
  }

  if (rows.length === 0) {
    console.error("error: no rigs to sheet at assets/characters/<species>/<tier>/rig.riv — rigging is rive-mcp's (art-pipeline §3)");
    process.exit(1);
  }

  const outPath = join(ROOT, "art", "review", `rig_${clip}_${tier}.png`);
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
