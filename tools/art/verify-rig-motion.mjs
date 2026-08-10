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
 *      not moving at all, teleporting between ticks, or failing to close a loop.
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
 * The Rive CLI's `--fps` does not reach the frame stepper (it sends
 * `stepSeconds`, `renderFrames` reads `opts.fps`), so every gif and apng advances
 * at 1/60s per frame whatever you ask for. Measured at `--fps 12` this tool saw
 * only the first fifth of every clip and pronounced the rigs clean — including
 * the fall it was written to catch. So: render at `--fps 60`, where the bug
 * cancels out, and take every fifth frame as a tick. If that upstream bug is ever
 * fixed, TICK_STEP is the one line that has to change.
 *
 * Usage:
 *     npm run art:verify:rig:motion
 *     node tools/art/verify-rig-motion.mjs unicorn --tier mythic
 *     node tools/art/verify-rig-motion.mjs --update-baseline
 *     node tools/art/verify-rig-motion.mjs --jobs 4
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

/** A loop's last tick back to its first is one step of motion, not a jump. */
const LOOP_CLOSE_MAX = 3;

/** Events are collected at end-of-advance, and the runtime advances in 1/60s. */
const EVENT_TOLERANCE_S = 1 / 60 + 1e-3;

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const updateBaseline = flag("update-baseline");
const jobs = Math.max(1, Number(opt("jobs", String(Math.min(6, Math.max(1, cpus().length - 2))))));
const onlyTier = opt("tier", null);
const onlyClip = opt("clip", null);
const wanted = args.filter((a) => !a.startsWith("--") && !["--tier", "--clip", "--jobs"].includes(args[args.indexOf(a) - 1]));

const SPECIES = MANIFEST.species.map((s) => s.id).filter((id) => wanted.length === 0 || wanted.includes(id));
const TIERS = MANIFEST.tiers.filter((t) => !onlyTier || t === onlyTier);

function resolveCli() {
  const env = process.env.KAD_RIVE_CLI;
  if (env) {
    if (env.endsWith(".js") || env.endsWith(".mjs")) return { cmd: process.execPath, pre: [env] };
    return { cmd: env, pre: [] };
  }
  return { cmd: process.platform === "win32" ? "rive-mcp-build.cmd" : "rive-mcp-build", pre: [] };
}
const cli = resolveCli();

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
let cliMissing = null;

/**
 * The row the figure's lowest pixel rests on, measured from the rig's own rest
 * pose rather than from the manifest origin: the rig at tick 0 of `idle` is the
 * reference for everything else. Measuring against the manifest instead would
 * fold "the rig stands in the wrong place" into every clip's floor result; that
 * is a separate fault, and `art:verify:rig` is where it belongs.
 */
async function restBottom(rig, tag) {
  const png = join(work, `${tag}_rest.png`);
  const r = await run(cli.cmd, [...cli.pre, "render", rig, "--animation", "idle", "--time", "0", "--width", String(RENDER_W), "-o", png]);
  if (r.spawnError) return { error: "cli" };
  if (r.status !== 0) return { error: r.err || r.out };
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

async function measureClip(rig, tag, clip, rest, art) {
  // One frame past the end, so the tick at T — the pose a loop must return to —
  // is actually in the sample. Without it a loop is judged on its penultimate
  // tick and every loop looks like it pops.
  const frameCount = clip.ticks * TICK_STEP + 1;
  const apng = join(work, `${tag}_${clip.name}.png`);
  const r = await run(cli.cmd, [
    ...cli.pre, "render", rig, "--animation", clip.name, "--apng",
    "--duration", String(frameCount / 60), "--fps", "60",
    "--width", String(RENDER_W), "-o", apng,
  ]);
  if (r.spawnError) return { error: "cli" };
  if (r.status !== 0) return { error: (r.err || r.out).trim().split("\n").pop() };
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
    soft.push(
      `${m.interior_holes}px of enclosed gap opened during the clip — a joint may be coming ` +
        `apart, or the figure may simply have spread its limbs. Look at it.`,
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
    rigJobs.push({ id, tier, rig, tag: `${id}_${tier}` });
  }
}

if (rigJobs.length === 0) {
  console.error("error: no rigs found at assets/characters/<species>/<tier>/rig.riv — rigging is rive-mcp's (art-pipeline §3)");
  process.exit(2);
}

console.log(`\n${BOLD}clips${RESET}`);
for (const job of rigJobs) {
  const rest = await restBottom(job.rig, job.tag);
  if (rest.error === "cli") {
    cliMissing = true;
    break;
  }
  if (rest.error) {
    failures.push(`${job.id}/${job.tier}: could not render a rest frame`);
    console.log(`  ${RED}FAIL${RESET}  ${job.id}/${job.tier}  rest frame: ${rest.error}`);
    continue;
  }

  const results = await pool(
    clips.map((clip) => () => measureClip(job.rig, job.tag, clip, rest, join(ROOT, "assets", "characters", job.id, job.tier, "assembled.png")).then((m) => ({ clip, m }))),
    jobs,
  );

  const lines = [];
  for (const { clip, m } of results) {
    const label = `${job.id}/${job.tier} ${clip.name}`;
    if (m.error === "cli") {
      cliMissing = true;
      break;
    }
    if (m.error) {
      failures.push(label);
      lines.push(`  ${RED}FAIL${RESET}  ${label}  ${m.error}`);
      continue;
    }
    checked += 1;
    hashes[`${job.id}/${job.tier}/${clip.name}`] = m.hash;
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
  if (cliMissing) break;
  if (lines.length === 0) {
    console.log(`  ${GREEN}ok${RESET}    ${job.id}/${job.tier}  ${results.length} clips`);
  } else {
    console.log(`  ${BOLD}${job.id}/${job.tier}${RESET}`);
    for (const l of lines) console.log(l);
  }
}

if (cliMissing) {
  console.error(
    `\n${RED}error${RESET}: could not run the Rive CLI.\n` +
      `Set KAD_RIVE_CLI to its cli.js, or put rive-mcp-build on your PATH:\n\n` +
      `    KAD_RIVE_CLI=/path/to/rive-mcp/dist/cli.js npm run art:verify:rig:motion\n`,
  );
  rmSync(work, { recursive: true, force: true });
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Layer 2 — the state machine, driven for real
// ---------------------------------------------------------------------------

console.log(`\n${BOLD}state machine${RESET}`);

/**
 * What firing each input must do. `states` is what the machine has to pass
 * through, in order; the clip it plays and the state it rests in are both part
 * of the contract's promise to the client, and neither is visible in the file.
 */
const DRIVES = [
  { fire: ["move"], states: ["walk", "idle"] },
  { fire: ["attack"], states: ["attack", "idle"] },
  { fire: ["cast"], states: ["cast", "idle"] },
  { fire: ["hurt"], states: ["hurt", "idle"] },
  { fire: ["leap"], states: ["leap", "idle"] },
  { fire: ["helpUp"], states: ["lift", "idle"] },
  { fire: ["celebrate"], states: ["celebrate", "idle"] },
  { fire: ["guard"], states: ["guard"], rests: "guard" },
  // The one the playbook warns about: a level-held bool on an any-state
  // transition re-enters the instant `down` hands off, and the figure falls
  // forever. Passing through down_loop and stopping there is the proof it does not.
  { fire: ["knockedDown=true"], states: ["down", "down_loop"], rests: "down_loop" },
  // ...and back up again. Every config wires `knockedDown == false` out of
  // `down_loop` into `revive`, and nothing above proves a character can stand
  // up: each drive starts from a fresh machine, so the machine that fell over
  // is never the machine asked to get up. Rendering `revive` as an isolated
  // clip would not cover it either — what matters is that it is reachable
  // *from down_loop*, which is a fact about the graph and not about the clip.
  // Two steps on one machine: fall, settle, then clear the bool.
  {
    fire: ["knockedDown=true", "knockedDown=false"],
    states: ["down", "down_loop", "revive", "idle"],
    rests: "idle",
  },
];

/** Seconds the CLI advances after each `--fire`. One step per fired input. */
const ADVANCE = 4;

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

// Every (rig, drive) pair is independent, so the whole phase goes through the
// same pool as the clips. Serially it is 200-odd browser launches and it doubled
// the run time on its own.
const driveResults = await pool(
  rigJobs.flatMap((job) =>
    DRIVES.map((d) => async () => {
      const argv = [...cli.pre, "events", job.rig, "--sm", "Rig"];
      for (const f of d.fire) argv.push("--fire", f);
      argv.push("--advance", String(ADVANCE), "--json");
      return { job, d, r: await run(cli.cmd, argv) };
    }),
  ),
  jobs,
);

const byRig = new Map(rigJobs.map((j) => [j.tag, []]));
for (const { job, d, r } of driveResults) {
  const problems = byRig.get(job.tag);
  {
    if (r.status !== 0) {
      problems.push(`${d.fire.join("+")}: ${(r.err || r.out).trim().split("\n").pop()}`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(r.out);
    } catch {
      problems.push(`${d.fire.join("+")}: unreadable report`);
      continue;
    }
    const seen = data.report.flatMap((s) => s.statesChanged ?? []);
    for (const want of d.states) {
      if (!seen.includes(want)) {
        problems.push(`${d.fire.join("+")}: never entered "${want}" (saw ${seen.join(" -> ") || "nothing"})`);
      }
    }
    const rests = d.rests ?? "idle";
    if (seen.length && seen[seen.length - 1] !== rests) {
      problems.push(`${d.fire.join("+")}: settles in "${seen[seen.length - 1]}", not "${rests}"`);
    }
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
    const wanted = expectedFirings(d.states);
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
    console.log(`  ${GREEN}ok${RESET}    ${job.id}/${job.tier}  ${DRIVES.length} drives, states and event ticks as contracted`);
  } else {
    for (const p of problems) {
      failures.push(`${job.id}/${job.tier} sm`);
      console.log(`  ${RED}FAIL${RESET}  ${job.id}/${job.tier}  ${p}`);
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
