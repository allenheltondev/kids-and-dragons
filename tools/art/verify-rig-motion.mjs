#!/usr/bin/env node
/**
 * Kids & Dragons — the motion gate.
 *
 * `verify-rig.ts` reads a `.riv` as *data*: the clips exist, the ticks match the
 * table, the inputs are the right kinds. Everything it checks was true of a rig
 * whose knocked-down pose rotated most of the character off the artboard, and
 * true of one whose crouch put its feet through the floor, because neither fact
 * is visible in the file — only in what the file *renders*. This tool renders it.
 *
 * Three layers, cheapest first:
 *
 *   1. **Per-clip measurement.** Every clip of every rig is rendered and checked
 *      for things that are wrong regardless of taste: the figure sinking below
 *      its own standing line, leaving the artboard, opening a hole at a joint,
 *      coming apart into pieces, not moving at all, teleporting between ticks,
 *      or failing to close a loop.
 *   2. **State-machine behaviour.** Rendering clips in isolation lies: standalone,
 *      `down_loop` plays as a *standing* breathing loop, and only under the state
 *      machine does it inherit the prone pose from `down`. So every trigger is
 *      fired for real, the states it passes through are asserted, and every event
 *      is checked against the tick the contract puts it on.
 *   3. **A golden baseline.** Layers 1 and 2 catch what we thought to measure.
 *      The baseline catches everything else by refusing to let a rig change
 *      quietly: each clip hashes to a number in `art/rig/motion-baseline.json`,
 *      and a rebuild reports which clips moved. Review is then a diff — three
 *      clips to look at — rather than a sweep of three hundred.
 *
 * A note on the render, because it invalidated the first version of this file.
 * The Rive CLI's `--fps` did not reach the frame stepper (it sent
 * `stepSeconds`, `renderFrames` read `opts.fps`), so every gif and apng advanced
 * at 1/60s per frame whatever you asked for. Measured at `--fps 12` this tool saw
 * only the first fifth of every clip and pronounced the rigs clean — including
 * the fall it was written to catch. So: render at `--fps 60`, where the bug
 * cancels out, and take every fifth frame as a tick. Upstream has since fixed
 * `--fps` (the same commit that added `batch`), and at 60 the fixed and the
 * broken stepper agree exactly, so nothing here changed with it — TICK_STEP is
 * simply the honest number now rather than a workaround, and it stays the one
 * line to change if the render rate ever does.
 *
 * On how the rendering is driven, because it is where the time goes. Every
 * render and every state-machine drive used to be its own CLI process, and each
 * process is a Chromium launch: ~2s of launch around ~50ms of render, times
 * 23 jobs per rig, times 54 rigs — ~50s a rig, ~45 minutes for the corpus. The
 * CLI's `batch` command runs a whole job list in one browser, so this tool
 * builds every job for every rig up front — the rest frame, the thirteen clips,
 * the nine drives — and hands them over as one list (`rive-cli.mjs`). The
 * measurement half is unchanged: python still reads each apng, one process per
 * clip, because that half was never the cost.
 *
 * Usage:
 *     npm run art:verify:rig:motion
 *     node tools/art/verify-rig-motion.mjs unicorn --tier mythic
 *     node tools/art/verify-rig-motion.mjs --update-baseline
 *     node tools/art/verify-rig-motion.mjs --jobs 4
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveChrome, resolveCli, runBatch } from "./rive-cli.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "assets", "manifest.json"), "utf8"));
const CONTRACT = MANIFEST.rigContract;
const BASELINE = join(ROOT, "art", "rig", "motion-baseline.json");

const tty = process.stdout.isTTY;
const RED = tty ? "\x1b[31m" : "";
const GREEN = tty ? "\x1b[32m" : "";
const YELLOW = tty ? "\x1b[33m" : "";
const DIM = tty ? "\x1b[2m" : "";
const BOLD = tty ? "\x1b[1m" : "";
const RESET = tty ? "\x1b[0m" : "";

// ---------------------------------------------------------------------------
// The numbers, in one place
// ---------------------------------------------------------------------------

/** Frames per authored tick. See the header: the renderer steps at 1/60 regardless. */
const TICK_STEP = 60 / CONTRACT.tickFps;
/** Render width. Every pixel threshold below is quoted at this size. */
const RENDER_W = 512;
/**
 * Render pixels per canvas pixel.
 *
 * Rigs are staged on an artboard LARGER than the art canvas so they have room to
 * rotate in (manifest `$rigStageComment`), so a fixed 512/1024 would quietly
 * loosen every pixel threshold by the ratio between them.
 *
 * The stage comes from the **manifest**, not from the six rig configs. It is one
 * pipeline-wide number and the configs restate it for rive-mcp's benefit; reading
 * it from six files that can disagree would mean this tool's pixel scale depends
 * on which config it happened to look at. That the delivered `.riv` actually
 * *is* this size is `art:verify:rig`'s check — it opens each rig and compares the
 * artboard, and a stale rig fails there before it reaches this tool.
 */
const STAGE = MANIFEST.rigStage?.width ?? MANIFEST.canvas.width;
const SCALE = RENDER_W / STAGE;

/**
 * Clips where the figure is *supposed* to be off its feet, so the floor and
 * headroom rules do not apply. This list is short and it is meant to stay short:
 * every entry is a check somebody turned off, so each one says why.
 */
const PRONE = {
  down: "toppling — the body sweeps through its own diagonal, which is wider than the canvas",
  down_loop: "lying down",
  revive: "rising from lying down",
};

/**
 * Feet may leave the ground; they may not go through it.
 *
 * Quoted off the art contract's own registration tolerance rather than invented
 * here — the same number that decides whether two tiers of a character stand in
 * the same place decides whether a crouch has sunk into the floor.
 */
const FLOOR_BREAK_MAX = Math.round(MANIFEST.tolerance.originYTolerancePx * SCALE);

/**
 * How close a moving figure may come to the artboard edge.
 *
 * art-pipeline §6.1 requires the *static* art to keep `edgeMarginPx` clear
 * precisely so a rig has room to rotate. This is that promise, checked on the
 * rotation rather than on the pose — held to half the static margin, because a
 * clip that spends one tick near the edge is not the same fault as art that is
 * born against it.
 */
const EDGE_MARGIN_MIN = Math.round((MANIFEST.tolerance.edgeMarginPx / 2) * SCALE);

/**
 * How much of one artboard edge the figure may lie across.
 *
 * This is the check that catches a character rotating off stage, and it took
 * three tries to get right, which is worth recording because the two wrong ones
 * both looked reasonable. Counting edge *pixels* against the figure's area
 * passed the very bug this tool exists for — a head entirely outside the frame
 * contributes only the few pixels where the neck crosses. Measuring lost *area*
 * fired on `walk`, `hurt` and `celebrate`, where nothing is off-canvas at all
 * and the silhouette simply shrinks because the legs overlap each other.
 *
 * How much of an edge is covered scales with the cross-section passing through
 * it, which is the actual question. Calibrated against both: a knockdown with
 * the fix covered at most 12% of an edge for a tick or two and 0% typically;
 * without it, 40% at worst and 23% typically.
 */
const EDGE_COVER_MAX = 0.25;
const EDGE_COVER_MEDIAN_MAX = 0.05;

/**
 * How much of a tick may be a colour the approved art does not contain.
 *
 * A rig moves commissioned pixels around; it does not paint. Anything that
 * composites — a tint overlay whose traced silhouette overhangs its part, a blend
 * landing on the part underneath — invents hues, and it does so *only on the
 * ticks where the overhang sweeps across something else*, which reads as
 * hard-edged patches appearing and disappearing as the figure moves.
 *
 * Calibrated against a deliberately re-tinted kitsune: 0.3% of pixels on a clean
 * rig (resampling between the art's own colours) against 31% on the tinted one.
 * 3% is an order of magnitude clear of both.
 *
 * Nothing else in the pipeline can see this: `art:verify:rig` reads metadata and
 * renders nothing, and any rest-pose comparison only ever looks at tick 0.
 */
const NOVEL_COLOUR_MAX = 0.03;

/** A clip whose ticks are all the same image is a clip nobody animated. */
const MOTION_MIN = 0.05;

/**
 * A single tick that moves far more than its neighbours is a missing keyframe.
 * Generous on purpose: real acting has fast frames, and a gate that fires on
 * good animation gets switched off.
 */
const TELEPORT_MAX = 6;

/**
 * How much enclosed see-through area may open during a clip before it is worth
 * a look, in px at RENDER_W.
 *
 * This is a WARNING and not a failure, and the reason is worth recording so
 * nobody tightens it into a gate. The metric it reads was dead until recently —
 * it asked whether a non-solid pixel sat inside an eroded solid mask, which no
 * image can satisfy, so it returned 0 for every rig ever measured. Repairing it
 * to a real border-flood enclosure test made it fire on nearly every clip of a
 * demonstrably clean rig, and rendering the worst case showed why: the largest
 * enclosed region on a celebrating unicorn is the gap between its hind legs.
 * Negative space between limbs is enclosed by the silhouette, and it is
 * animation, not a defect.
 *
 * So the number cannot separate "a joint came apart" from "a leg lifted" on its
 * own, and a threshold low enough to catch the former fires constantly on the
 * latter. Measured across a sweep of the delivered rigs, clean clips reached
 * 6198px. This sits well clear of that: it will not notice a hairline seam, and
 * it will notice a limb detaching. The golden baseline is what actually watches
 * this metric — it catches the number *changing*, which is the question that can
 * be answered without knowing anatomy from breakage.
 */
const INTERIOR_GAP_WARN = 15000;

/**
 * How much figure may exist mid-clip in pieces that were not there at rest, in
 * px at RENDER_W, before the clip is worth a look.
 *
 * This is the measurement for a part coming OFF — an armour plate, a foot —
 * which no gap metric can see, because the silhouette that is left behind is
 * whole. `rig_motion.py` counts connected solid components per tick against
 * tick 0's count (so the manticore's six barbs, detached at rest, are not
 * pieces), and reports the extra area at the worst tick.
 *
 * It is a WARNING, and the calibration that decided that is worth keeping,
 * because it was meant to be a failure. The brief was: the griffin's radiant
 * class rigs lose their armour and feet mid-`cast` (1 island at rest, 8-11
 * mid-clip, 1.1-1.7k px), the base rigs do not, so find the line between them.
 * Measured over all 702 clips of the 54 rigs, there is no line: the base rigs
 * of four species come apart at least as badly — griffin/fledgling `cast` 5
 * pieces / 3,257px, griffin/sworn `walk` 6 / 3,719px, dragonling/mythic `lift`
 * 10 / 7,641px — and rendering those ticks shows feet detached and torsos in
 * blocks, identically under the pinned renderer and the current one. The
 * "clean base rig" premise held for two species only: of the 104 base unicorn
 * and bigfoot clips, 102 stay under 300px (the unicorn fledgling under 80px),
 * and the two that do not — unicorn/radiant `hurt` at 2,170px, bigfoot/fledgling
 * `lift` at 1,220px — are single pieces the size of a hoof. What the class rigs
 * have, the base rigs gave them; it is the duplicated-fragment defect
 * (part-fragments.md) seen from the other side, and a gate that reds 40 of 54
 * rigs on art nobody has re-cut is a gate that gets switched off.
 *
 * So the number is set where the clean population and the shredded one part:
 * 512px is 1.7x above the 299px the clean unicorn and bigfoot clips reach, and
 * every clip eyeballed above sits 2-15x over it. At 512px, 169 of 702 clips
 * warn (24%; griffin 62 of its 117, dragonling 45, kitsune 30, manticore 23,
 * bigfoot 6, unicorn 3), on 40 of the 54 rigs; the other 14 never do. Re-run
 * the calibration after the re-cut (`--gap-report`, then `gap-calibration.mjs`):
 * if the 169 collapse to the griffin `cast` clips, this becomes a failure.
 */
const ISLANDS_WARN_PX = 512;

/** A loop's last tick back to its first is one step of motion, not a jump. */
const LOOP_CLOSE_MAX = 3;

/** Events are collected at end-of-advance, and the runtime advances in 1/60s. */
const EVENT_TOLERANCE_S = 1 / 60 + 1e-3;

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
/*
 * Every option that takes a value, in one list, because the positional filter
 * below has to know them: a bare word is a species name unless the thing before
 * it was an option expecting a value. Adding an option and forgetting this list
 * does not error — it reads the option's value as a species, matches nothing,
 * and measures zero rigs while still exiting 0. `--gap-report out.json` did
 * exactly that before this list existed.
 */
const VALUE_OPTS = ["tier", "clip", "jobs", "gap-report"];
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const updateBaseline = flag("update-baseline");
/*
 * Where to write the enclosed-gap measurements for every clip, defect or not.
 *
 * This is calibration data, not a gate. `INTERIOR_GAP_WARN` is a *warning*
 * because enclosed area cannot separate a joint coming apart from a limb
 * lifting — measured, a real defect opened 2,716px where clean clips reach
 * 6,198px, so the defect sits below the clean population and no threshold on
 * area separates them. The figure that does separate them is how thickly each
 * gap is walled in (rig_motion.py `gap_regions`), and turning THAT into a
 * threshold needs its distribution over moving rigs — which needs the real
 * renderer, so it can only be collected where the renderer runs. That is CI.
 *
 * Written for every clip, including the ones that pass, because a threshold set
 * from failures alone is set without knowing what normal looks like.
 */
const gapReport = opt("gap-report", null);
const gapRows = [];
/*
 * How many jobs run at once. In the batch this is the number of pages the one
 * browser opens; each page renders on its own, so it is CPU-bound and four is
 * where a 4-core box stops gaining (measured: 4 pages took the corpus from
 * ~45 minutes to ~5, and 6 bought nothing more). The same number bounds the
 * python measurements afterwards, and the one-process-per-job fallback below.
 */
const jobs = Number(opt("jobs", "4"));
if (!Number.isInteger(jobs) || jobs < 1) {
  // The same rule as build-rigs.mjs: a bad worker count fails here, not as a
  // NaN or a fraction somewhere inside the batching or the pool.
  console.error("error: --jobs expects a whole number of workers, at least 1");
  process.exit(2);
}
const onlyTier = opt("tier", null);
const onlyClip = opt("clip", null);
const wanted = args.filter(
  (a, i) => !a.startsWith("--") && !VALUE_OPTS.includes((args[i - 1] ?? "").replace(/^--/, "")),
);

const SPECIES = MANIFEST.species.map((s) => s.id).filter((id) => wanted.length === 0 || wanted.includes(id));
const TIERS = MANIFEST.tiers.filter((t) => !onlyTier || t === onlyTier);

const cli = resolveCli();
resolveChrome();

/**
 * Fail before rendering anything if the Python half cannot run.
 *
 * Every measurement here is a render followed by a python3 call, and python3
 * without Pillow and numpy does not fail the run — it fails every *measurement*,
 * one ModuleNotFoundError per clip, after the render that preceded it has
 * already been paid for. On the rest gate that was 54 rigs rendered over ~100s
 * before the first comparison said what was wrong. One import up front is the
 * same fact for a hundredth of the price, and it names the fix.
 */
function requirePythonDeps(command) {
  const r = spawnSync("python3", ["-c", "import PIL, numpy"], { encoding: "utf8" });
  if (r.status === 0) return;
  const why = r.error ? String(r.error) : (r.stderr || r.stdout).trim().split("\n").pop();
  console.error(
    `${RED}error${RESET}: the pixel checks need Pillow and numpy, and python3 cannot import them (${why}).\n` +
      `Install the art tooling's Python dependencies, then re-run:\n\n` +
      `    python3 -m pip install -r requirements-dev.txt\n    ${command}\n`,
  );
  process.exit(2);
}
requirePythonDeps("npm run art:verify:rig:motion");

function run(cmd, argv) {
  return new Promise((resolve) => {
    const p = spawn(cmd, argv, { encoding: "utf8" });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => resolve({ status: -1, out, err: String(e), spawnError: e }));
    p.on("close", (status) => resolve({ status, out, err }));
  });
}

/** Run `tasks` (thunks) at most `jobs` at a time, preserving order in the result. */
async function pool(tasks, n) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, tasks.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= tasks.length) return;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

/** Every clip a hero rig ships, including the hand-off loops the set implies. */
function heroClips() {
  const out = [];
  for (const name of CONTRACT.sets.hero) {
    const c = CONTRACT.clips[name];
    out.push({ name, ticks: c.ticks, loop: c.loop === true });
    if (c.loopClip) out.push({ name: c.loopClip, ticks: c.loopTicks, loop: true });
  }
  return onlyClip ? out.filter((c) => c.name === onlyClip) : out;
}

const work = join(tmpdir(), `kad-rig-motion-${process.pid}`);
mkdirSync(work, { recursive: true });

const failures = [];
const warnings = [];
const hashes = {};
let checked = 0;

/**
 * The row the figure's lowest pixel rests on, measured from the rig's own rest
 * pose rather than from the manifest origin: the rig at tick 0 of `idle` is the
 * reference for everything else. Measuring against the manifest instead would
 * fold "the rig stands in the wrong place" into every clip's floor result; that
 * is a separate fault, and `art:verify:rig` is where it belongs.
 *
 * `rendered` is the batch's result for this rig's rest job; the frame itself
 * was rendered with everything else, and this only reads it.
 */
async function restBottom(rendered) {
  if (!rendered.ok) return { error: rendered.error ?? "the batch returned no result for the rest frame" };
  const png = rendered.out;
  const m = await run("python3", ["-c", REST_PY, png]);
  const [row, area] = m.out.trim().split(/\s+/).map(Number);
  return Number.isFinite(row) && Number.isFinite(area) ? { row, area, png } : { error: m.out + m.err };
}

const REST_PY = `
import sys
import numpy as np
from PIL import Image
a = np.array(Image.open(sys.argv[1]).convert("RGBA"))[:, :, 3]
m = a > 8
rows = np.nonzero(m.any(axis=1))[0]
print(int(rows.max()) if len(rows) else -1, int(m.sum()))
`;

/** Measure one clip whose apng the batch already rendered (`rendered` is its result). */
async function measureClip(rendered, rest, art) {
  if (!rendered.ok) return { error: rendered.error ?? "the batch returned no result for this clip" };
  const apng = rendered.out;
  const m = await run("python3", [join(ROOT, "tools", "art", "rig_motion.py"), apng, String(TICK_STEP), String(rest.row), art]);
  if (m.status !== 0) return { error: (m.err || m.out).trim().split("\n").pop() };
  try {
    return JSON.parse(m.out);
  } catch {
    return { error: `unreadable measurement: ${m.out.slice(0, 200)}` };
  }
}

function judge(label, clip, m) {
  const bad = [];
  const soft = [];
  const prone = clip.name in PRONE;

  if (!prone && m.floor_break > FLOOR_BREAK_MAX) {
    bad.push(`sinks ${m.floor_break}px below its standing line (max ${FLOOR_BREAK_MAX})`);
  }
  // Deliberately NOT exempt for prone clips. They are excused the floor and a
  // momentary edge touch — a toppling figure sweeps its own diagonal, which is
  // wider than the canvas — but not from leaving the stage. Exempting them here
  // would let the knockdown bug this whole tool was written to catch walk back in.
  if (m.edge_cover_median > EDGE_COVER_MEDIAN_MAX) {
    bad.push(
      `the figure lies across ${(m.edge_cover_median * 100).toFixed(0)}% of an artboard edge for most of the clip — it is off stage` +
        (prone ? ` (${PRONE[clip.name]}, but it still has to be on screen)` : ""),
    );
  } else if (m.edge_cover_max > EDGE_COVER_MAX) {
    bad.push(`the figure crosses ${(m.edge_cover_max * 100).toFixed(0)}% of an artboard edge — a body is leaving the frame, not a hoof`);
  }
  // Touching the frame at all is a warning, not a failure. The art is
  // commissioned with 8px of margin and the rigs have to rotate inside it, so a
  // horn tip against the edge is the art contract's problem rather than this
  // rig's — and a gate that goes red for it is a gate that gets switched off.
  if (!prone && m.edge_margin < EDGE_MARGIN_MIN) {
    soft.push(
      `comes within ${m.edge_margin}px of the artboard edge (want ${EDGE_MARGIN_MIN}). ` +
        `The art is commissioned with only ${MANIFEST.tolerance.edgeMarginPx}px of margin, which is not enough for a rig to rotate in.`,
    );
  }
  if (m.novel_colour_max > NOVEL_COLOUR_MAX) {
    bad.push(
      `${(m.novel_colour_max * 100).toFixed(0)}% of one tick is a colour the approved art does not contain` +
        ` — something is painting over the parts, not just moving them`,
    );
  }
  if (m.interior_holes > INTERIOR_GAP_WARN) {
    // The area cannot say which of the two it is, so print what it is made of.
    // A gap pinched shut between two limbs is walled in by a few px of figure; a
    // hole in the middle of a torso by tens. That is the thing to look at.
    const where = (m.interior_worst ?? [])
      .map((r) => `${r.px}px walled in by ${r.wall}px at (${r.at[0]},${r.at[1]})`)
      .join(", ");
    soft.push(
      `${m.interior_holes}px of enclosed gap opened during the clip — a joint may be coming ` +
        `apart, or the figure may simply have spread its limbs. Look at it.` +
        // The tick is named because it is picked by what opened, not by this
        // number, so it is not the tick the reader would guess from it.
        (where ? `\n      tick ${m.interior_worst_tick}: ${where}` : ""),
    );
  }
  if (m.islands_new_px_max > ISLANDS_WARN_PX) {
    // The sizes are printed so a reader can tell one plate from a spray of
    // crumbs without re-rendering; the tick says which frame to open.
    const sizes = (m.islands_new_sizes ?? []).slice(0, 6).join(", ");
    soft.push(
      `comes apart: ${m.islands_new_max} piece(s) totalling ${m.islands_new_px_max}px that were not ` +
        `separate at rest (${m.islands_rest} at rest, warn above ${ISLANDS_WARN_PX}px) — a part is ` +
        `flying off, or a fragment another part also draws.` +
        (sizes ? `\n      tick ${m.islands_new_tick}: pieces of ${sizes}px` : ""),
    );
  }
  if (m.motion_median < MOTION_MIN) {
    bad.push(`does not move (median inter-tick delta ${m.motion_median})`);
  }
  if (m.teleport_ratio > TELEPORT_MAX) {
    soft.push(`one tick moves ${m.teleport_ratio}x the median — a missing keyframe?`);
  }
  if (clip.loop && m.loop_close / Math.max(0.01, m.motion_median) > LOOP_CLOSE_MAX) {
    bad.push(`loop does not close: last tick to first is ${(m.loop_close / m.motion_median).toFixed(1)}x a normal step`);
  }
  return { bad, soft };
}

// ---------------------------------------------------------------------------

console.log(`${BOLD}Kids & Dragons - rig motion${RESET}`);
console.log(
  `${DIM}contract: assets/manifest.json   ${SPECIES.length} species x ${TIERS.length} tier(s) x ${heroClips().length} clips` +
    `   ${jobs} at a time${RESET}`,
);

const clips = heroClips();
const rigJobs = [];
for (const id of SPECIES) {
  for (const tier of TIERS) {
    const rig = join(ROOT, "assets", "characters", id, tier, "rig.riv");
    if (!existsSync(rig)) continue;
    rigJobs.push({
      label: `${id}/${tier}`,
      key: `${id}/${tier}`,
      rig,
      art: join(ROOT, "assets", "characters", id, tier, "assembled.png"),
      tag: `${id}_${tier}`,
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
  const rig = join(base, "rig.riv");
  if (!existsSync(rig)) continue;
  rigJobs.push({
    label: `${variant.class}/${variant.tier}/${variant.species}`,
    key: `class:${variant.class}/${variant.tier}/${variant.species}`,
    rig,
    art: join(base, "assembled.png"),
    tag: `class_${variant.class}_${variant.tier}_${variant.species}`,
  });
}

if (rigJobs.length === 0) {
  console.error("error: no base or manifest-declared class rigs found — rigging is rive-mcp's (art-pipeline §3)");
  process.exit(2);
}

/*
 * Layer 2's inputs, declared ahead of layer 1 because both layers are rendered
 * together: every drive goes into the same batch as the clips, so the table
 * has to exist before the batch does. It is read in the state-machine
 * section below.
 */
/**
 * What firing each input must do, **step by step**.
 *
 * `steps[i]` is the exact list of states the machine newly enters during step i,
 * in order. Reading it per step rather than flattening the whole run matters
 * more than it looks, because of what the runtime actually reports: `seek()`
 * upstream collects state changes with `if (!all.includes(s)) all.push(s)`, so
 * `statesChanged` is the DISTINCT states first seen during that advance — not a
 * transition history, and not the state the machine is resting in when the
 * advance ends.
 *
 * Flattening those lists and asking `includes()` therefore proves almost
 * nothing, and in particular it cannot catch the bug this whole section exists
 * for. A machine that re-enters on a level-held bool — down, down_loop, down,
 * down_loop, forever — reports exactly `["down", "down_loop"]`, the same as one
 * that fell over once and stayed there. Taking the last name as "settles in" is
 * not valid either; it is only the last name first seen.
 *
 * What *is* decidable from this report is that a step which changes nothing
 * reports nothing. So the knockdown drive holds the bool down across two
 * advances: the second one must be silent, and a re-entering machine cannot be
 * silent. That is the assertion the old `rests: "down_loop"` was pretending to
 * be.
 *
 * (The cleaner fix is upstream: `rive-mcp events` could report the full
 * transition sequence and the active state at the end of each step, and then
 * this could assert settling directly instead of inferring it from silence.)
 */
const DRIVES = [
  { fire: ["move"], steps: [["walk", "idle"]] },
  { fire: ["attack"], steps: [["attack", "idle"]] },
  { fire: ["cast"], steps: [["cast", "idle"]] },
  { fire: ["hurt"], steps: [["hurt", "idle"]] },
  { fire: ["leap"], steps: [["leap", "idle"]] },
  { fire: ["helpUp"], steps: [["lift", "idle"]] },
  { fire: ["celebrate"], steps: [["celebrate", "idle"]] },
  // Brace holds until your next turn, so it must NOT wander back to idle.
  { fire: ["guard"], steps: [["guard"]] },
  // The whole knockdown lifecycle on one machine: fall, prove it stays fallen,
  // then get back up. Step 2 re-applies the same value precisely so that its
  // silence means something.
  {
    fire: ["knockedDown=true", "knockedDown=true", "knockedDown=false"],
    steps: [["down", "down_loop"], [], ["revive", "idle"]],
  },
];

/** Seconds the CLI advances after each `--fire`. One step per fired input. */
const ADVANCE = 4;

// ---------------------------------------------------------------------------
// The render, all of it at once
// ---------------------------------------------------------------------------

/**
 * Every CLI job this run needs, for every rig, as `batch` job objects: the rest
 * frame, one apng per clip, one `events` drive per row of DRIVES. Ids are
 * `<tag>/rest`, `<tag>/clip/<name>` and `<tag>/drive/<n>`, and the results are
 * read back by those ids — the batch keeps order, but naming is what survives a
 * job that failed to report at all.
 */
function batchJobs() {
  const list = [];
  for (const job of rigJobs) {
    list.push({
      id: `${job.tag}/rest`,
      cmd: "render",
      file: job.rig,
      animation: "idle",
      time: 0,
      width: RENDER_W,
      out: join(work, `${job.tag}_rest.png`),
    });
    for (const clip of clips) {
      // One frame past the end, so the tick at T — the pose a loop must return
      // to — is actually in the sample. Without it a loop is judged on its
      // penultimate tick and every loop looks like it pops.
      const frameCount = clip.ticks * TICK_STEP + 1;
      list.push({
        id: `${job.tag}/clip/${clip.name}`,
        cmd: "render",
        file: job.rig,
        animation: clip.name,
        apng: true,
        duration: frameCount / 60,
        fps: 60,
        width: RENDER_W,
        out: join(work, `${job.tag}_${clip.name}.png`),
      });
    }
    DRIVES.forEach((d, i) => {
      list.push({ id: `${job.tag}/drive/${i}`, cmd: "events", file: job.rig, sm: "Rig", fire: d.fire, advance: ADVANCE });
    });
  }
  return list;
}

/**
 * The same job as a single-command argv, for a CLI that predates `batch`.
 *
 * The commit pinned in `art/rig/rive-mcp.pin.json` may be older than the
 * command — it was when this was written — and the answer to that is not a red
 * gate: it is the same jobs, one process each, pooled as they always were. The
 * job object stays the single statement of what to render; this only spells it.
 */
function argvFor(job) {
  if (job.cmd === "render") {
    const argv = ["render", job.file, "--animation", job.animation, "--width", String(job.width), "-o", job.out];
    if (job.apng) argv.push("--apng", "--duration", String(job.duration), "--fps", String(job.fps));
    else argv.push("--time", String(job.time));
    return argv;
  }
  const argv = ["events", job.file, "--sm", job.sm];
  for (const f of job.fire) argv.push("--fire", f);
  argv.push("--advance", String(job.advance), "--json");
  return argv;
}

/** Run every job, by batch where the CLI has it and one process at a time otherwise. */
async function renderAll(list) {
  try {
    return runBatch(list, { concurrency: jobs, cli }).results;
  } catch (err) {
    if (!err.unsupported) {
      console.error(`\n${RED}error${RESET}: ${err.message}`);
      rmSync(work, { recursive: true, force: true });
      process.exit(2);
    }
    console.log(`  ${YELLOW}note${RESET}: ${err.message}; running one process per job instead (a browser start each)`);
    return pool(
      list.map((job) => async () => {
        const r = await run(cli.cmd, [...cli.pre, ...argvFor(job)]);
        if (r.status !== 0) return { id: job.id, ok: false, error: (r.err || r.out).trim().split("\n").pop() };
        if (job.cmd === "render") return { id: job.id, ok: true, out: job.out };
        try {
          return { id: job.id, ...JSON.parse(r.out) };
        } catch {
          return { id: job.id, ok: false, error: "unreadable report" };
        }
      }),
      jobs,
    );
  }
}

const allJobs = batchJobs();
console.log(`\n${DIM}rendering ${allJobs.length} jobs for ${rigJobs.length} rig(s) in one browser...${RESET}`);
const renderStart = performance.now();
const rendered = new Map((await renderAll(allJobs)).map((r) => [r.id, r]));
console.log(`${DIM}rendered in ${((performance.now() - renderStart) / 1000).toFixed(1)}s${RESET}`);
const result = (id) => rendered.get(id) ?? { ok: false, error: "the batch returned no result for this job" };

// ---------------------------------------------------------------------------
// Layer 1 — every clip, measured
// ---------------------------------------------------------------------------

console.log(`\n${BOLD}clips${RESET}`);
for (const job of rigJobs) {
  const rest = await restBottom(result(`${job.tag}/rest`));
  if (rest.error) {
    failures.push(`${job.label}: could not render a rest frame`);
    console.log(`  ${RED}FAIL${RESET}  ${job.label}  rest frame: ${rest.error}`);
    continue;
  }

  const results = await pool(
    clips.map((clip) => () => measureClip(result(`${job.tag}/clip/${clip.name}`), rest, job.art).then((m) => ({ clip, m }))),
    jobs,
  );

  const lines = [];
  for (const { clip, m } of results) {
    const label = `${job.label} ${clip.name}`;
    if (m.error) {
      failures.push(label);
      lines.push(`  ${RED}FAIL${RESET}  ${label}  ${m.error}`);
      continue;
    }
    checked += 1;
    hashes[`${job.key}/${clip.name}`] = m.hash;
    if (gapReport) {
      gapRows.push({
        // `job.label` rather than species+tier: class rigs are jobs too now, and
        // they have no species/tier pair to spell.
        rig: job.label,
        clip: clip.name,
        interior_holes: m.interior_holes,
        // Which tick `worst` was read off. It is chosen by what opened, while
        // interior_holes is a net over the clip, so the two need not agree.
        worst_tick: m.interior_worst_tick ?? null,
        worst: m.interior_worst ?? [],
        // The detached-islands figures, for the same reason the gaps are here:
        // a threshold is set from the whole population or it is a guess.
        islands_rest: m.islands_rest ?? null,
        islands_new_max: m.islands_new_max ?? null,
        islands_new_px_max: m.islands_new_px_max ?? null,
        islands_new_tick: m.islands_new_tick ?? null,
        islands_new_sizes: m.islands_new_sizes ?? [],
      });
    }
    const { bad, soft } = judge(label, clip, m);
    for (const b of bad) {
      failures.push(label);
      lines.push(`  ${RED}FAIL${RESET}  ${label}  ${b}`);
    }
    for (const s of soft) {
      warnings.push(label);
      lines.push(`  ${YELLOW}warn${RESET}  ${label}  ${s}`);
    }
  }
  if (lines.length === 0) {
    console.log(`  ${GREEN}ok${RESET}    ${job.label}  ${results.length} clips`);
  } else {
    console.log(`  ${BOLD}${job.label}${RESET}`);
    for (const l of lines) console.log(l);
  }
}

// Written here rather than at the end, so a run that dies in layer 2 still
// yields its rows.
if (gapReport && gapRows.length > 0) {
  writeFileSync(gapReport, JSON.stringify({ clips: gapRows }, null, 1));
  console.log(`\n  ${DIM}gap measurements for ${gapRows.length} clips -> ${gapReport}${RESET}`);
}

// ---------------------------------------------------------------------------
// Layer 2 — the state machine, driven for real
// ---------------------------------------------------------------------------

console.log(`\n${BOLD}state machine${RESET}`);


/**
 * Every (event, tick) firing the contract promises for the clips a drive walks.
 *
 * The check this feeds used to iterate the *actual* firings and grade their
 * timing, which cannot see an event that never fired at all — a rig that
 * silently drops `impact` passed, because there was nothing in the list to
 * object to. Nor could it see a missing firing of a multi-tick event: `leap`
 * declares dust on the crouch AND the landing, and one firing at either tick
 * satisfied a `some()` over both.
 */
function expectedFirings(states) {
  const out = [];
  for (const state of states) {
    const clip = CONTRACT.clips[state];
    if (!clip?.events) continue;
    for (const [name, at] of Object.entries(clip.events)) {
      for (const tick of Array.isArray(at) ? at : [at]) out.push({ name, tick, state });
    }
  }
  return out;
}

// The drives were rendered with the clips — every (rig, drive) pair went into
// the batch as an `events` job — so this phase only reads. (Before the batch
// it was 200-odd browser launches, and it doubled the run time on its own.)
const driveResults = rigJobs.flatMap((job) => DRIVES.map((d, i) => ({ job, d, data: result(`${job.tag}/drive/${i}`) })));

const byRig = new Map(rigJobs.map((j) => [j.tag, []]));
for (const { job, d, data } of driveResults) {
  const problems = byRig.get(job.tag);
  {
    if (!data.ok) {
      problems.push(`${d.fire.join("+")}: ${data.error ?? "the drive did not report"}`);
      continue;
    }
    // One report entry per fired step, after the "init" settle.
    const steps = (data.report ?? []).filter((r) => r.step !== "init");
    if (steps.length !== d.steps.length) {
      problems.push(`${d.fire.join("+")}: ${steps.length} step(s) reported, expected ${d.steps.length}`);
    }
    d.steps.forEach((want, i) => {
      const got = steps[i]?.statesChanged ?? [];
      const same = got.length === want.length && got.every((v, k) => v === want[k]);
      if (same) return;
      const shown = got.length ? got.join(" -> ") : "nothing";
      problems.push(
        want.length === 0
          ? `${d.fire.join("+")}: step ${i + 1} should change nothing — it is meant to be resting ` +
            `in "${d.steps[i - 1]?.[d.steps[i - 1].length - 1] ?? "?"}" — but entered ${shown}. ` +
            `A level-held bool re-entering its own transition looks exactly like this.`
          : `${d.fire.join("+")}: step ${i + 1} entered ${shown}, expected ${want.join(" -> ")}`,
      );
    });

    // Events: presence, cardinality and timing, matched as a set rather than
    // graded one-sidedly. Each actual firing consumes one expected firing;
    // whatever is left over at the end is a fault in one direction or the
    // other — an event the contract promised and the rig never fired, or one
    // the rig fired that the contract does not describe.
    //
    // Times come back as elapsed across the whole drive, and each fired input
    // gets its own `ADVANCE` seconds, so a firing in step k arrives at
    // k*ADVANCE + its tick. Every clip is shorter than ADVANCE, so the
    // remainder recovers the time within the step exactly.
    const wanted = expectedFirings(d.steps.flat());
    const unmatched = [];
    for (const ev of data.events ?? []) {
      const within = ev.time % ADVANCE;
      const i = wanted.findIndex(
        (w) => w.name === ev.name && Math.abs(within - w.tick / CONTRACT.tickFps) <= EVENT_TOLERANCE_S,
      );
      if (i >= 0) wanted.splice(i, 1);
      else unmatched.push(ev);
    }
    for (const w of wanted) {
      problems.push(
        `${d.fire.join("+")}: event "${w.name}" never fired at tick ${w.tick} ` +
          `(${(w.tick / CONTRACT.tickFps).toFixed(3)}s into "${w.state}")`,
      );
    }
    for (const ev of unmatched) {
      // Only complain about events the contract knows; a rig may carry its own.
      const known = Object.values(CONTRACT.clips).some((c) => c.events && ev.name in c.events);
      if (!known) continue;
      problems.push(
        `${d.fire.join("+")}: event "${ev.name}" fired at ${ev.time}s, which is not a tick ` +
          `the contract puts it on`,
      );
    }
  }
}

for (const job of rigJobs) {
  const problems = byRig.get(job.tag) ?? [];
  if (problems.length === 0) {
    console.log(`  ${GREEN}ok${RESET}    ${job.label}  ${DRIVES.length} drives, states and event ticks as contracted`);
  } else {
    for (const p of problems) {
      failures.push(`${job.label} sm`);
      console.log(`  ${RED}FAIL${RESET}  ${job.label}  ${p}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 3 — the baseline
// ---------------------------------------------------------------------------

console.log(`\n${BOLD}baseline${RESET}`);
const partial = SPECIES.length !== MANIFEST.species.length || TIERS.length !== MANIFEST.tiers.length || onlyClip;

if (updateBaseline) {
  const merged = existsSync(BASELINE) && partial
    ? { ...JSON.parse(readFileSync(BASELINE, "utf8")).clips, ...hashes }
    : hashes;
  writeFileSync(
    BASELINE,
    JSON.stringify({
      $comment:
        "Golden hashes for tools/art/verify-rig-motion.mjs. One per rig clip, over a 96px downscale of every authored tick. A changed hash is not a failure — it is the list of clips a human has to look at, which is the whole point.",
      renderWidth: RENDER_W,
      clips: Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))),
    }, null, 2) + "\n",
  );
  console.log(`  ${GREEN}written${RESET}  ${Object.keys(merged).length} clip hashes -> art/rig/motion-baseline.json`);
} else if (!existsSync(BASELINE)) {
  console.log(`  ${DIM}no baseline yet — run with --update-baseline once these rigs are reviewed${RESET}`);
} else {
  const base = JSON.parse(readFileSync(BASELINE, "utf8")).clips ?? {};
  const changed = [];
  const added = [];
  for (const [k, v] of Object.entries(hashes)) {
    if (!(k in base)) added.push(k);
    else if (base[k] !== v) changed.push(k);
  }
  const missing = partial ? [] : Object.keys(base).filter((k) => !(k in hashes));
  if (changed.length === 0 && added.length === 0 && missing.length === 0) {
    console.log(`  ${GREEN}ok${RESET}    ${Object.keys(hashes).length} clips, none changed since the baseline`);
  } else {
    // Deliberately a warning. A changed rig is usually somebody's intended change;
    // the value is the short list, not a red build.
    for (const k of changed) {
      warnings.push(`changed ${k}`);
      console.log(`  ${YELLOW}changed${RESET}  ${k}`);
    }
    for (const k of added) console.log(`  ${DIM}new      ${k}${RESET}`);
    for (const k of missing) console.log(`  ${DIM}gone     ${k}${RESET}`);
    console.log(
      `  ${DIM}Look at these, then: npm run art:sheet:rig -- --clip <clip>  and  --update-baseline${RESET}`,
    );
  }
}

rmSync(work, { recursive: true, force: true });

console.log(`\n${BOLD}${"-".repeat(60)}${RESET}`);
const warn = warnings.length ? `   ${YELLOW}${warnings.length} warnings${RESET}` : "";
const bad = failures.length ? `   ${RED}${failures.length} FAILED${RESET}` : "";
console.log(`${GREEN}${checked} clips measured${RESET}${warn}${bad}`);
if (failures.length > 0) {
  console.log(`\n${RED}${BOLD}FAILED${RESET} - a rig renders something the contract cannot see.`);
  process.exit(1);
}
console.log(`\n${GREEN}${BOLD}PASS${RESET} - every clip stays on its feet, inside the artboard and on the contract's clock.`);
