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
 * present and wrong: empty, unplayable, silent, or so large it stalls the
 * first tap on a phone. Those reach a table as a bug rather than as a
 * placeholder.
 *
 * The distinction that makes those checks real is between *not knowing* and
 * *knowing it is bad* — see `probe`. Without ffmpeg installed this gate can
 * only weigh files; with it, a corrupt or silent file fails here rather than
 * falling back at a table.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
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

/**
 * Whether a tool is here at all.
 *
 * Asked once, and kept strictly separate from every per-file answer below.
 * Conflating the two is the bug this gate shipped with: one `try/catch`
 * around ffprobe returned the same "no answer" for *the tool is not
 * installed* and *the tool read this file and could not make sense of it*,
 * and the caller skipped its checks either way. In CI — where the tools are
 * installed — a corrupt .webm therefore passed as real, which is the exact
 * case the gate exists to catch.
 */
function hasTool(tool: string): boolean {
  try {
    execFileSync(tool, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const HAS_FFMPEG = hasTool("ffmpeg");
const HAS_FFPROBE = hasTool("ffprobe");

export type Inspection =
  /** No media tools: nothing is known, so nothing is claimed. */
  | { readonly kind: "unavailable" }
  /** A tool read the file and refused it — not audio, or not intact. */
  | { readonly kind: "rejected"; readonly detail: string }
  | { readonly kind: "ok"; readonly seconds: number | null; readonly peakDb: number | null };

/** `max_volume: -3.2 dB` out of ffmpeg's volumedetect report. */
export function parsePeak(report: string): number | null {
  const match = /max_volume:\s*(-?[\d.]+) dB/.exec(report);
  return match?.[1] ? Number.parseFloat(match[1]) : null;
}

/** The last line of a tool's complaint, which is the part that names the fault. */
export function faultLine(stderr: string): string {
  const line = stderr.trim().split("\n").filter(Boolean).at(-1);
  return line ?? "the file could not be read";
}

/**
 * What the tools make of a file.
 *
 * **ffmpeg is the playability check, not ffprobe.** Decoding the whole file to
 * nowhere is the closest thing to "will a browser play this", and it answers
 * the silence question in the same pass — a duration is not audio, and an
 * encode that goes wrong produces a file of exactly the right length full of
 * nothing. ffprobe only adds the duration, so a machine with one and not the
 * other still gets the checks that matter.
 */
function inspect(file: string): Inspection {
  if (!HAS_FFMPEG && !HAS_FFPROBE) return { kind: "unavailable" };

  let peak: number | null = null;
  if (HAS_FFMPEG) {
    /*
     * `-f null -` decodes the whole file and discards it. spawnSync rather
     * than execFileSync because *both* answers live on stderr — volumedetect
     * writes its report there on success, and a refusal writes its complaint
     * there on failure — and execFileSync hands back stdout, which is empty
     * either way. Reading the wrong stream is how the silence check quietly
     * did nothing.
     */
    const run = spawnSync(
      "ffmpeg",
      ["-v", "info", "-i", file, "-af", "volumedetect", "-f", "null", "-"],
      { encoding: "utf8" },
    );
    const report = `${run.stderr ?? ""}${run.stdout ?? ""}`;
    if (run.status !== 0) return { kind: "rejected", detail: faultLine(report) };
    peak = parsePeak(report);
  }

  let seconds: number | null = null;
  if (HAS_FFPROBE) {
    try {
      const out = execFileSync(
        "ffprobe",
        ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      const value = Number.parseFloat(out.trim());
      // A file ffprobe opens but cannot time is one no browser will play.
      if (!Number.isFinite(value)) return { kind: "rejected", detail: "no duration in it" };
      seconds = value;
    } catch (error) {
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
      return { kind: "rejected", detail: faultLine(stderr) };
    }
  }

  return { kind: "ok", seconds, peakDb: peak };
}

/** Below this nothing in the room hears it — a failed encode, not a quiet cue. */
const SILENCE_DB = -60;

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
  const seen = inspect(file);
  if (seen.kind === "rejected") {
    // Present, and no browser will play it: exactly what this gate is for.
    problems.push(`${job.selector}: unplayable — ${seen.detail}`);
    continue;
  }
  const length = seen.kind === "ok" ? seen.seconds : null;
  if (length !== null && length <= 0) {
    problems.push(`${job.selector}: there is no audio in it`);
    continue;
  }
  const peak = seen.kind === "ok" ? seen.peakDb : null;
  if (peak !== null && peak <= SILENCE_DB) {
    problems.push(`${job.selector}: silent (peak ${peak.toFixed(1)} dBFS) — the encode went wrong`);
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
