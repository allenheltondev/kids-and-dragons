/**
 * The one encode every committed sound goes through: Opus in WebM, which is
 * what `paths.ts` asks for, normalized to one loudness target so no cue is
 * startling next to another. ffmpeg does the work, and is required.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Encode to what the game loads, at one loudness for the whole set.
 *
 * Mono on purpose: every one of these is a UI sound or a bed under narration,
 * and a stereo image is bytes spent on nothing at that job.
 */
export function encodeToWebm(raw: Buffer, destination: string): void {
  const temporary = `${destination}.raw`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(temporary, raw);
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-i", temporary,
        "-c:a", "libopus",
        "-b:a", "96k",
        "-ac", "1",
        "-af", "loudnorm=I=-18:TP=-1.5:LRA=11",
        destination,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim().split("\n").at(-1);
    throw new Error(`ffmpeg failed: ${stderr ?? String(error)}`);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
