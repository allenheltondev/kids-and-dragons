#!/usr/bin/env node
/**
 * Kids & Dragons — the rest check.
 *
 * At rest, a rig **is** the art. Frame 0 of `idle` must reproduce that tier's
 * approved `assembled.png`, in the window of the artboard the art canvas
 * occupies. Anything else — a scale, an offset, a tint overlay whose traced
 * silhouette spills past the part it belongs to — is a repaint of pixels
 * `verify.py` already approved, and this is the only place in the pipeline that
 * can see it.
 *
 * It is here because of what the other two gates structurally cannot see:
 *
 *   - `art:verify:rig` reads the .riv as data. A rig with a perfect clip table,
 *     staged correctly, drawn at 90% of its proper size, passes it completely.
 *   - `art:verify:rig:motion` measures every clip against *the rig's own* rest
 *     pose — `restBottom` is frame 0 of its own `idle`. That self-reference is
 *     deliberate there (it separates "this clip sinks" from "this rig stands in
 *     the wrong place") and it means a rig uniformly too small, or shifted
 *     bodily, is internally consistent and passes every floor and edge check.
 *
 * So the one thing neither gate checks is absolute position and scale — which is
 * the one thing a restage changes. That is what this file is for. It is the
 * gate to run after a `rive-mcp` regeneration, and the reason it exists as its
 * own command rather than as a step inside a builder is that the builder is not
 * ours: rigging is generated (art-pipeline §3), so the check has to be able to
 * run against rigs somebody else produced.
 *
 * The comparison is a window, not the whole artboard. The stage is deliberately
 * larger than the art canvas so a rig has room to rotate in (manifest
 * `rigStage`, art-pipeline §6.3), so "the rest pose is the approved art" is a
 * statement about the sub-rect the canvas occupies — offset into the stage by
 * `rigStage.offsetX/Y`. That offset is also what makes this check work unchanged
 * on either stage: on the old 1024 it is zero, and the same code compares the
 * same pixels.
 *
 * Usage:
 *     npm run art:verify:rig:rest
 *     node tools/art/verify-rig-rest.mjs unicorn --tier mythic
 *
 * Needs the Rive CLI (KAD_RIVE_CLI, or rive-mcp-build on PATH), which is not an
 * npm dependency of this repo — its published package ships only the MCP server,
 * not this CLI. CI builds it from source instead: the `rigs` job in ci.yml checks
 * out `rive-mcp` at the commit pinned in `art/rig/rive-mcp.pin.json` and runs this
 * on every pull request, ~40s for all 24. So a green pipeline does now say
 * something about it — which it did not when this file was written, and which is
 * the whole reason the pin exists: the renderer is the measuring instrument, and
 * an instrument that moves on its own turns this gate into a coin toss.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "assets", "manifest.json"), "utf8"));
const CANVAS = MANIFEST.canvas;
const STAGE = MANIFEST.rigStage ?? { width: CANVAS.width, height: CANVAS.height, offsetX: 0, offsetY: 0 };

const tty = process.stdout.isTTY;
const RED = tty ? "\x1b[31m" : "";
const GREEN = tty ? "\x1b[32m" : "";
const DIM = tty ? "\x1b[2m" : "";
const BOLD = tty ? "\x1b[1m" : "";
const RESET = tty ? "\x1b[0m" : "";

/**
 * The floor, and it is this pipeline's number rather than the art contract's.
 *
 * It used to borrow `tolerance.recompositeIouMin`, which was a category error
 * worth naming: that governs the IoU of *silhouettes* when parts are put back
 * together, while this compares RGB per pixel — strictly stricter, and able to
 * fail art that `verify.py` passes.
 *
 * Set from what a clean build actually achieves rather than from taste. These
 * are inherited figures, recorded when this check was first calibrated against
 * a full 24-rig set: 23 of 24 reproduced their approved art exactly, and the
 * radiant unicorn differed in 511 px out of 311,022 visible (0.16%) where its
 * horn crosses the forelock — the part split's own edge showing through, not a
 * rig fault. The same calibration put the builder's fit-to-artboard bug at 76%
 * and a tint overlay spilling onto its neighbours at 89–95%.
 *
 * Independently re-measured here against `unicorn/fledgling` by feeding this
 * comparison synthetic stages, since no rig on the current stage exists yet to
 * check: a correct rest pose scores 100.00%, a figure scaled to 90% and
 * re-seated 23.65%, a 20px bodily shift 35.30%, the stage offset ignored
 * entirely 7.26%, and an empty artboard 0.00% (the mask is the *union* of the
 * two alphas, so drawing nothing cannot score a perfect match). Different
 * constructions from the inherited ones and so different numbers, but the
 * conclusion they share is the one that matters: every way of getting the
 * geometry wrong lands tens of points below this floor, not fractions.
 */
const REST_MIN_MATCH = 0.998;

/**
 * Compare the rendered stage's canvas window against the approved art.
 *
 * `visible` is the union of the two alpha masks, not the intersection: a rig
 * that draws nothing at all would otherwise compare zero pixels and score a
 * perfect 1.0. The 16/255 RGB threshold is there because the render path
 * resamples, and a resample that lands one level off in one channel is not a
 * repaint.
 */
const REST_PY = `
import sys
import numpy as np
from PIL import Image
stage, art, x0, y0, w, h, t = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:8])
a = np.array(Image.open(stage).convert("RGBA").crop((x0, y0, x0 + w, y0 + h))).astype(int)
b = np.array(Image.open(art).convert("RGBA")).astype(int)
visible = (a[:, :, 3] >= t) | (b[:, :, 3] >= t)
differs = (np.abs(a - b).max(axis=2) > 16) & visible
print(int(differs.sum()), int(visible.sum()))
`;

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const onlyTier = opt("tier", null);
const wanted = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--tier");

const SPECIES = MANIFEST.species.map((s) => s.id).filter((id) => wanted.length === 0 || wanted.includes(id));
const TIERS = MANIFEST.tiers.filter((t) => !onlyTier || t === onlyTier);

const targets = [];
for (const id of SPECIES) {
  for (const tier of TIERS) {
    targets.push({
      label: `${id}/${tier}`,
      tag: `${id}_${tier}`,
      rig: join(ROOT, "assets", "characters", id, tier, "rig.riv"),
      art: join(ROOT, "assets", "characters", id, tier, "assembled.png"),
    });
  }
}
for (const variant of MANIFEST.rigVariants ?? []) {
  if (!SPECIES.includes(variant.species) || !TIERS.includes(variant.tier)) continue;
  const base = join(
    ROOT,
    "assets",
    "character-rigs",
    variant.class,
    variant.tier,
    variant.species,
  );
  targets.push({
    label: `${variant.class}/${variant.tier}/${variant.species}`,
    tag: `class_${variant.class}_${variant.tier}_${variant.species}`,
    rig: join(base, "rig.riv"),
    art: join(base, "assembled.png"),
  });
}

/** Same resolution rule as the other rig tools — the CLI is not a repo dependency. */
function resolveCli() {
  const env = process.env.KAD_RIVE_CLI;
  if (env) {
    if (env.endsWith(".js") || env.endsWith(".mjs")) return { cmd: process.execPath, pre: [env] };
    return { cmd: env, pre: [] };
  }
  return { cmd: process.platform === "win32" ? "rive-mcp-build.cmd" : "rive-mcp-build", pre: [] };
}
const cli = resolveCli();

const work = join(tmpdir(), `kad-rig-rest-${process.pid}`);
mkdirSync(work, { recursive: true });

console.log(`${BOLD}Kids & Dragons - rig rest pose${RESET}`);
console.log(
  `${DIM}frame 0 of idle vs assembled.png, in the ${CANVAS.width}x${CANVAS.height} window at ` +
    `(${STAGE.offsetX},${STAGE.offsetY}) of a ${STAGE.width}x${STAGE.height} stage   floor ${(REST_MIN_MATCH * 100).toFixed(2)}%${RESET}\n`,
);

const failures = [];
let checked = 0;

for (const target of targets) {
    const { rig, art, label } = target;
    if (!existsSync(rig) || !existsSync(art)) continue;

    // Render the WHOLE stage at its native size, so the crop below is in
    // artboard pixels and no scaling stands between the rig and the art.
    const png = join(work, `${target.tag}.png`);
    const r = spawnSync(
      cli.cmd,
      [...cli.pre, "render", rig, "--animation", "idle", "--time", "0", "--width", String(STAGE.width), "-o", png],
      { encoding: "utf8" },
    );
    if (r.error) {
      console.error(
        `\n${RED}error${RESET}: could not run the Rive CLI.\n` +
          `Set KAD_RIVE_CLI to its cli.js, or put rive-mcp-build on your PATH:\n\n` +
          `    KAD_RIVE_CLI=/path/to/rive-mcp/dist/cli.js npm run art:verify:rig:rest\n`,
      );
      rmSync(work, { recursive: true, force: true });
      process.exit(2);
    }
    if (r.status !== 0) {
      failures.push(label);
      console.log(`  ${RED}FAIL${RESET}  ${label}  could not render frame 0: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
      continue;
    }

    const d = spawnSync(
      "python3",
      [
        "-c", REST_PY, png, art,
        String(STAGE.offsetX), String(STAGE.offsetY),
        String(CANVAS.width), String(CANVAS.height),
        String(MANIFEST.tolerance.alphaThreshold),
      ],
      { encoding: "utf8" },
    );
    const parsed = /^(\d+) (\d+)$/.exec(d.stdout.trim());
    if (!parsed) {
      failures.push(label);
      console.log(`  ${RED}FAIL${RESET}  ${label}  rest check did not run: ${(d.stderr || d.stdout).trim().split("\n").pop()}`);
      continue;
    }

    checked += 1;
    const bad = Number(parsed[1]);
    const visible = Number(parsed[2]);
    const match = visible > 0 ? 1 - bad / visible : 0;

    if (match < REST_MIN_MATCH) {
      failures.push(label);
      console.log(
        `  ${RED}FAIL${RESET}  ${label}  frame 0 of idle is ${(match * 100).toFixed(2)}% of assembled.png ` +
          `(${bad} of ${visible} visible px differ, floor ${(REST_MIN_MATCH * 100).toFixed(2)}%)`,
      );
      // The three failures this check was built to catch, in the order they are
      // worth suspecting. A near-miss is a split-edge fringe; a large miss is
      // almost always geometry, and 76% is the signature of the builder default
      // that fits the figure to the artboard instead of honouring scale: 1.
      if (match < 0.9) {
        console.log(
          `        ${DIM}A miss this large is geometry, not fringe: check the config's scale (must be 1) ` +
            `and that ground lands on the canvas origin offset into the stage.${RESET}`,
        );
      }
    } else {
      console.log(`  ${GREEN}ok${RESET}    ${label}  ${(match * 100).toFixed(2)}% at rest`);
    }
}

rmSync(work, { recursive: true, force: true });

console.log(`\n${"-".repeat(60)}`);
if (checked === 0) {
  console.error("error: no base or manifest-declared class rigs compared");
  process.exit(2);
}
if (failures.length > 0) {
  console.log(`${checked - failures.length} passed   ${RED}${failures.length} FAILED${RESET}\n`);
  console.log(`${RED}FAILED${RESET} - a rig does not stand where its art stands.`);
  process.exit(1);
}
console.log(`${checked} passed\n`);
console.log(`${GREEN}PASS${RESET} - every rig reproduces its approved art at rest.`);
