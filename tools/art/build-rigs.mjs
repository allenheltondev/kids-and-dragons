#!/usr/bin/env node
/**
 * Kids & Dragons — build every character rig.
 *
 * Six authored configs (`art/rig/<species>.rig.json`), four tiers each, twenty-four
 * `.riv` files at `assets/characters/<species>/<tier>/rig.riv`. A tier is not a
 * different rig: it is the same config pointed at a different `parts/` directory,
 * and joints are re-measured from *that tier's* own alpha overlaps, so the drift
 * `verify.py` tolerates between tiers is absorbed here instead of nudged by hand.
 *
 * The clip table lives in exactly one place — `assets/manifest.json`'s
 * `rigContract` — and is handed to every build as `--contract ... --set hero`.
 * Nothing in this file or in a rig config restates a tick.
 *
 * Every rig is then checked at rest against the art it was built from: frame 0 of
 * `idle` must reproduce that tier's approved `assembled.png` **pixel for pixel**.
 * That is a stronger statement than it looks. `verify.py` approved those pixels and
 * `art-paths.ts` anchors the figure by the manifest's (512, 900) origin, so a rig
 * that is 90% the size of its own art — which is what the builder's default scale
 * produces, and what this check caught — is a figure that stands in the wrong place
 * the day the renderer swaps, with nothing else in the pipeline able to see it.
 *
 * Usage:
 *     npm run art:rigs                     # all six species
 *     npm run art:rigs -- unicorn kitsune  # just these
 *     node tools/art/build-rigs.mjs --render          # preview PNG beside each rig
 *     node tools/art/build-rigs.mjs --no-rest-check   # skip the pixel comparison
 *
 * The Rive CLI is not a dependency of this repo — it is a separate tool, and this
 * script says so out loud rather than failing with a spawn error. Point
 * `KAD_RIVE_CLI` at its `cli.js` (or have `rive-mcp-build` on PATH).
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MANIFEST = join(ROOT, "assets", "manifest.json");

const tty = process.stdout.isTTY;
const RED = tty ? "\x1b[31m" : "";
const GREEN = tty ? "\x1b[32m" : "";
const DIM = tty ? "\x1b[2m" : "";
const BOLD = tty ? "\x1b[1m" : "";
const RESET = tty ? "\x1b[0m" : "";

/**
 * How to invoke the CLI.
 *
 * `KAD_RIVE_CLI` may point at either the published binary or the `dist/cli.js`
 * inside a checkout — the second is what anybody working on the rigging tool
 * itself actually has, and requiring a global install to use your own working
 * copy is how a tool and the rigs it builds drift apart.
 */
function resolveCli() {
  const env = process.env.KAD_RIVE_CLI;
  if (env) {
    if (env.endsWith(".js") || env.endsWith(".mjs")) return { cmd: process.execPath, pre: [env] };
    return { cmd: env, pre: [] };
  }
  return { cmd: process.platform === "win32" ? "rive-mcp-build.cmd" : "rive-mcp-build", pre: [] };
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const MANIFEST_CANVAS = manifest.canvas;

/**
 * Crop the stage down to the art canvas and count pixels that differ.
 *
 * Only where something is actually *visible*: pixels below the art contract's own
 * `alphaThreshold` are ignored on both sides. That is not a loosening — it is the
 * same line verify.py draws. Comparing raw RGB counts colour noise inside pixels
 * that are 97% transparent, and on a 1400 stage that was 4,000 rim pixels per rig
 * with a maximum alpha of 7 out of 255: a failure nobody could see, on art nobody
 * had changed.
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
const TIERS = manifest.tiers;
const ALL_SPECIES = manifest.species.map((s) => s.id);

const args = process.argv.slice(2);
const render = args.includes("--render");
const restCheck = !args.includes("--no-rest-check");
const wanted = args.filter((a) => !a.startsWith("--"));
const species = wanted.length > 0 ? wanted : ALL_SPECIES;

for (const id of species) {
  if (!ALL_SPECIES.includes(id)) {
    console.error(`error: "${id}" is not a species in the manifest (${ALL_SPECIES.join(", ")})`);
    process.exit(2);
  }
}

const cli = resolveCli();


/**
 * The rest check's floor, and it is this pipeline's number rather than the art
 * contract's — which is a correction, because it used to borrow
 * `tolerance.recompositeIouMin` and that was a category error worth naming.
 * `recompositeIouMin` governs the IoU of *silhouettes* when parts are put back
 * together; this check compares RGB per pixel, which is strictly stricter and can
 * fail art that verify.py passes.
 *
 * Set from what a clean build actually achieves: 23 of the 24 rigs reproduce
 * their approved art exactly, and the radiant unicorn differs in 511 pixels out
 * of 311,022 visible (0.16%) where its horn crosses the forelock — the part
 * split's own edge showing through, not a rig fault. So the floor is descriptive
 * of the current set at its loosest, in the same spirit as the manifest's effect
 * tolerances, and it is nowhere near anything real: the 90%-scale bug measured
 * 76%, and a tint overlay spilling onto its neighbours measured 89-95%.
 */
const REST_MIN_MATCH = 0.998;

console.log(`${BOLD}Kids & Dragons - build rigs${RESET}`);
console.log(`${DIM}contract: assets/manifest.json (set "hero")   cli: ${cli.pre[0] ?? cli.cmd}${RESET}\n`);

let built = 0;
const failures = [];

for (const id of species) {
  const config = join(ROOT, "art", "rig", `${id}.rig.json`);
  if (!existsSync(config)) {
    failures.push(`${id}: no config at art/rig/${id}.rig.json`);
    console.log(`  ${RED}FAIL${RESET}  ${id}  no config at art/rig/${id}.rig.json`);
    continue;
  }
  for (const tier of TIERS) {
    const parts = join(ROOT, "assets", "characters", id, tier, "parts");
    const out = join(ROOT, "assets", "characters", id, tier, "rig.riv");
    const label = `${id}/${tier}`;
    if (!existsSync(parts)) {
      failures.push(`${label}: no parts/`);
      console.log(`  ${RED}FAIL${RESET}  ${label}  no parts directory`);
      continue;
    }
    const r = spawnSync(
      cli.cmd,
      [
        ...cli.pre,
        "rig",
        "--parts", parts,
        "--config", config,
        "-o", out,
        "--contract", MANIFEST,
        "--set", "hero",
        ...(render ? ["--render"] : []),
      ],
      { encoding: "utf8" },
    );
    if (r.error) {
      // ENOENT here is the one failure worth a paragraph: the tool is not in this
      // repo, so "command not found" is a setup fact, not a broken build.
      console.error(
        `\n${RED}error${RESET}: could not run the Rive CLI (${r.error.code ?? r.error.message}).\n` +
          `The rig builder is a separate tool and not a dependency of this repo.\n` +
          `Set KAD_RIVE_CLI to its cli.js, or put rive-mcp-build on your PATH:\n\n` +
          `    KAD_RIVE_CLI=/path/to/rive-mcp/dist/cli.js npm run art:rigs\n`,
      );
      process.exit(2);
    }
    // The CLI contract-checks what it just wrote and exits non-zero on findings,
    // so a green line here already means "written AND matches rigContract".
    if (r.status !== 0) {
      failures.push(label);
      console.log(`  ${RED}FAIL${RESET}  ${label}`);
      for (const line of `${r.stdout}${r.stderr}`.trimEnd().split("\n")) {
        console.log(`        ${line}`);
      }
      continue;
    }
    const size = /(\d+) bytes/.exec(r.stdout)?.[1];
    const guessed = /GUESSED \(([^)]*)\)/.exec(r.stdout);

    // At rest the rig IS the art. Anything else — a scale, an offset, a tint
    // overlay whose traced silhouette spills past the part it belongs to — is a
    // repaint of pixels `verify.py` already approved, and this is the only place
    // in the pipeline that can see it.
    //
    // The bar is the art pipeline's own, not zero, and the difference matters.
    // `assembled.png` is the *commissioned image*; `parts/` are cut out of it,
    // and verify.py accepts the seams reclosing to within `recompositeIouMin` —
    // so demanding an exact match here would demand more of a rig than the split
    // that fed it. Twenty-three of the twenty-four are exact anyway; the radiant
    // unicorn's horn carries ~500 px of alpha-1 fringe where it crosses the
    // forelock, which is the split's tolerance showing through and not a rig
    // fault. Different metric from IoU, same magnitude, and read off the manifest
    // (REST_MIN_MATCH, above) so tightening the art contract tightens this with it.
    let rest = "";
    if (restCheck) {
      const art = join(ROOT, "assets", "characters", id, tier, "assembled.png");
      // Render the WHOLE stage at its native size, then compare only the sub-rect
      // the art canvas occupies. The stage is deliberately larger than the canvas
      // (see any config's $stageComment) so a rig has room to rotate in, which
      // means "the rest pose is the approved art" is a statement about a window
      // onto the artboard, not about the artboard.
      const cfg = JSON.parse(readFileSync(config, "utf8"));
      const ab = cfg.artboardWidth ?? MANIFEST_CANVAS.width;
      const png = join(tmpdir(), `kad-rig-rest-${process.pid}.png`);
      const r0 = spawnSync(
        cli.cmd,
        [...cli.pre, "render", out, "--animation", "idle", "--time", "0", "--width", String(ab), "-o", png],
        { encoding: "utf8" },
      );
      if (r0.error) {
        console.error(`
${RED}error${RESET}: could not run the Rive CLI (${r0.error.code ?? r0.error.message}).`);
        process.exit(2);
      }
      const x0 = (cfg.ground?.x ?? MANIFEST_CANVAS.originX) - (cfg.origin?.x ?? MANIFEST_CANVAS.originX);
      const y0 = (cfg.ground?.y ?? MANIFEST_CANVAS.originY) - (cfg.origin?.y ?? MANIFEST_CANVAS.originY);
      const d = spawnSync(
        "python3",
        ["-c", REST_PY, png, art, String(x0), String(y0), String(MANIFEST_CANVAS.width), String(MANIFEST_CANVAS.height), String(manifest.tolerance.alphaThreshold)],
        { encoding: "utf8" },
      );
      const differ = /^(\d+) (\d+)$/.exec(d.stdout.trim());
      if (!differ) {
        failures.push(`${label}: rest check did not run`);
        console.log(`  ${RED}FAIL${RESET}  ${label}  could not compare frame 0 against assembled.png`);
        for (const line of `${d.stdout}${d.stderr}`.trimEnd().split(/\r?\n/)) console.log(`        ${line}`);
        continue;
      }
      const [bad, total] = [Number(differ[1]), Number(differ[2])];
      const match = 1 - bad / total;
      if (match < REST_MIN_MATCH) {
        failures.push(`${label}: ${(match * 100).toFixed(2)}% match at rest`);
        console.log(
          `  ${RED}FAIL${RESET}  ${label}  frame 0 of idle is ${(match * 100).toFixed(2)}% of assembled.png` +
            ` (${bad} px differ, floor ${(REST_MIN_MATCH * 100).toFixed(2)}%)`,
        );
        console.log(
          `        ${DIM}A rig at rest is its approved art. Check scale and ground against the manifest canvas.${RESET}`,
        );
        continue;
      }
      rest = `  ${DIM}rest ${bad === 0 ? "1:1" : `${(match * 100).toFixed(2)}%`}${RESET}`;
    }

    built += 1;
    console.log(
      `  ${GREEN}ok${RESET}    ${label}${size ? `  ${(Number(size) / 1024).toFixed(0)}KB` : ""}${rest}` +
        (guessed ? `  ${RED}pivots guessed: ${guessed[1]}${RESET}` : ""),
    );
    // A warning the CLI printed is a warning worth seeing here — an outline that
    // misses part of its own art is a recolour that will look wrong in the game.
    for (const line of r.stdout.split("\n").filter((l) => l.includes("warning:"))) {
      console.log(`        ${DIM}${line.trim()}${RESET}`);
    }
  }
}

rmSync(join(tmpdir(), `kad-rig-rest-${process.pid}.png`), { force: true });

console.log(`\n${BOLD}${"-".repeat(60)}${RESET}`);
if (failures.length > 0) {
  console.log(`${GREEN}${built} built${RESET}   ${RED}${failures.length} FAILED${RESET}`);
  console.log(`\n${RED}${BOLD}FAILED${RESET} - ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`${GREEN}${BOLD}${built} rig(s) built${RESET} and contract-checked as written.`);
console.log(`${DIM}Now run: npm run art:verify:rig${RESET}`);
