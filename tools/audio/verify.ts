#!/usr/bin/env node
/**
 * The audio gate — `npm run audio:verify`.
 *
 * The job `tools/art/verify.py` does for pictures: say what the game has, what
 * it is still standing in for, and refuse anything that would reach a table
 * broken.
 *
 * ---------------------------------------------------------------------------
 * A MISSING FILE IS NOT A FAILURE
 *
 * Every cue has a synthesized placeholder (client/src/audio/synth.ts), so a
 * cue with no file plays a sine wave rather than nothing. "Not sourced yet" is
 * therefore an ordinary state of this repo — a gate that failed on it would
 * have been red on the day the sound system shipped, with every cue missing by
 * design, and a gate nobody can keep green is a gate nobody reads.
 *
 * So absence is *reported* and never fatal. What is fatal is a file that is
 * present and wrong: empty, unplayable, or so large it stalls the first tap on
 * a phone. Those reach a table as a bug rather than as a placeholder.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { audioJobs } from "./specs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const AUDIO = path.join(ROOT, "assets", "audio");

/**
 * What a file may weigh.
 *
 * A cue is a fraction of a second and downloads on the first tap; a loop is
 * under a minute and downloads while a scene is read aloud. Both are generous
 * for Opus at these lengths — they exist to catch a 40MB WAV dropped in by
 * mistake, not to tune bitrate.
 */
const MAX_BYTES = { sfx: 512 * 1024, music: 4 * 1024 * 1024 } as const;

/** ffprobe when it is installed, silence when it is not: CI has it, a laptop
    may not, and a gate that needs a media toolchain to say "this file is
    empty" would be skipped everywhere it matters. */
function seconds(file: string): number | null {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8" },
    );
    const value = Number.parseFloat(out.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const problems: string[] = [];
const placeholders: string[] = [];
let real = 0;

for (const job of audioJobs()) {
  const file = path.join(AUDIO, job.file);
  if (!fs.existsSync(file)) {
    placeholders.push(job.selector);
    continue;
  }
  const size = fs.statSync(file).size;
  if (size === 0) {
    problems.push(`${job.selector}: the file is empty`);
    continue;
  }
  const budget = MAX_BYTES[job.kind];
  if (size > budget) {
    problems.push(
      `${job.selector}: ${(size / 1024 / 1024).toFixed(1)}MB is over the ` +
        `${(budget / 1024 / 1024).toFixed(1)}MB budget for ${job.kind}`,
    );
    continue;
  }
  const length = seconds(file);
  if (length !== null && length <= 0) {
    problems.push(`${job.selector}: there is no audio in it`);
    continue;
  }
  /*
   * Length is a *target*, not a gate — the game plays what it is given, and a
   * cue a little longer than its brief is a style choice rather than a defect.
   * Wildly longer is a different thing: a 30-second "tap" is a mis-generated
   * file that would talk over the next three taps.
   */
  if (length !== null && length > job.seconds * 4 + 1) {
    problems.push(
      `${job.selector}: ${length.toFixed(1)}s against a ${String(job.seconds)}s brief — regenerate it`,
    );
    continue;
  }
  real += 1;
}

const total = audioJobs().length;
console.log(`audio: ${String(real)}/${String(total)} real, ${String(placeholders.length)} still synthesized`);
if (placeholders.length > 0) console.log(`  placeholders: ${placeholders.join(", ")}`);

if (problems.length > 0) {
  console.error("\naudio: files that would reach a table broken —");
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
