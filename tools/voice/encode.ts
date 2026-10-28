/**
 * WAV to the clip that ships: mono Opus in WebM (docs/voice-narration-plan.md
 * §4, "Rendering steps"). Voice gets a loudness target of its own, about
 * -16 LUFS, and the silence a provider leaves at either end trimmed, so a
 * playlist of clips has no gaps between sentences.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Encoded {
  bytes: Buffer;
  ms: number;
}

/** ffmpeg's filter chain: trim edge silence, then normalise loudness for speech. */
export const VOICE_FILTER = [
  "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-50dB:stop_periods=1:stop_duration=0.15:stop_threshold=-50dB:stop_silence=0.05",
  "loudnorm=I=-16:TP=-1.5:LRA=11",
].join(",");

export function encodeVoice(wav: Buffer): Encoded {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kad-voice-"));
  const input = path.join(dir, "in.wav");
  const output = path.join(dir, "out.webm");
  try {
    fs.writeFileSync(input, wav);
    execFileSync("ffmpeg", ["-y", "-i", input, "-af", VOICE_FILTER, "-c:a", "libopus", "-b:a", "32k", "-ac", "1", output], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const seconds = Number(
      execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output], { encoding: "utf8" }).trim(),
    );
    return { bytes: fs.readFileSync(output), ms: Math.round(seconds * 1000) };
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim().split("\n").at(-1);
    throw new Error(`ffmpeg failed: ${stderr ?? String(error)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
