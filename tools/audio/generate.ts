#!/usr/bin/env node
/**
 * The audio generator — `npm run audio:generate -- [ids...]`.
 *
 * Turns the briefs in `client/src/audio/paths.ts` into real files under
 * `assets/audio/`. No arguments makes everything still synthesized; named
 * selectors (`dice`, `music:forest`) make just those.
 *
 * ---------------------------------------------------------------------------
 * ONE SEAM, BECAUSE THE VENDOR IS NOT DECIDED FOREVER
 *
 * The chapter generator goes through Bedrock because the model it wants is an
 * Anthropic one and this project already has an AWS account (tools/content/
 * generate.ts says so at length). Audio is not that: nothing in this repo
 * generates it, so the provider is a real choice — and one this file is
 * deliberately not permanent about.
 *
 * `PROVIDERS` is the whole surface: (brief, seconds, kind) → bytes. One is
 * implemented, and adding another is a function beside it. If a model in your
 * own Bedrock account can do this, that is a provider too; nothing above this
 * line knows the difference.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WRITES
 *
 * Opus in WebM, which is what `paths.ts` asks for, normalized to one loudness
 * target so no cue is startling next to another. Providers return whatever
 * they return, so ffmpeg does the last step — required, and said plainly
 * rather than leaving half a file in the tree.
 *
 * Nothing is destructive without `--force`. Regenerating everything on a whim
 * is how a game's sound drifts between sessions.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { audioJobs, type AudioJob } from "./specs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const AUDIO = path.join(ROOT, "assets", "audio");

export interface GenerateRequest {
  brief: string;
  seconds: number;
  kind: "sfx" | "music";
}

export type Provider = (request: GenerateRequest) => Promise<Buffer>;

/**
 * ElevenLabs: two documented endpoints, one key, nothing else to stand up.
 *
 * The `kind` split is not a nicety — every service that offers both has two
 * endpoints, and a sound-effects model asked for forty-five seconds of
 * ambience returns forty-five seconds of noise.
 */
const elevenlabs: Provider = async ({ brief, seconds, kind }) => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  const url =
    kind === "music"
      ? "https://api.elevenlabs.io/v1/music"
      : "https://api.elevenlabs.io/v1/sound-generation";
  const body =
    kind === "music"
      ? { prompt: brief, music_length_ms: Math.round(seconds * 1000) }
      : { text: brief, duration_seconds: seconds, prompt_influence: 0.6 };

  const response = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${String(response.status)} ${detail}`.trim());
  }
  return Buffer.from(await response.arrayBuffer());
};

export const PROVIDERS: Record<string, Provider> = { elevenlabs };

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

/** Which jobs the command line asked for. Exported for the test. */
export function selectJobs(all: AudioJob[], wanted: string[]): AudioJob[] {
  if (wanted.length === 0) return all;
  return all.filter((job) => wanted.includes(job.selector) || wanted.includes(job.id));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const providerName = args.find((a) => a.startsWith("--provider="))?.split("=")[1] ?? "elevenlabs";
  const provider = PROVIDERS[providerName];
  if (!provider) {
    console.error(
      `Unknown provider "${providerName}". Implemented: ${Object.keys(PROVIDERS).join(", ")}.\n` +
        "Adding one is a function in tools/audio/generate.ts → PROVIDERS.",
    );
    process.exit(2);
  }
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    console.error("ffmpeg is required to encode what the provider returns. Install it and re-run.");
    process.exit(2);
  }

  const jobs = selectJobs(audioJobs(), args.filter((a) => !a.startsWith("--")));
  if (jobs.length === 0) {
    console.error("Nothing matched. Selectors come from CUE_SPECS and MUSIC_SPECS in client/src/audio/paths.ts.");
    process.exit(2);
  }

  let made = 0;
  for (const job of jobs) {
    const file = path.join(AUDIO, job.file);
    if (fs.existsSync(file) && !force) {
      console.log(`· ${job.selector} already exists (--force to replace)`);
      continue;
    }
    process.stdout.write(`… ${job.selector} (${String(job.seconds)}s) `);
    try {
      const raw = await provider({ brief: job.brief, seconds: job.seconds, kind: job.kind });
      encodeToWebm(raw, file);
      made += 1;
      console.log(`→ assets/audio/${job.file}`);
    } catch (error) {
      console.log("failed");
      console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`\n${String(made)} written. \`npm run audio:verify\` says what is left.`);
}

// Importable by the test without generating anything.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await main();
}
