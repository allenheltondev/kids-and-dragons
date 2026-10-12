/** Encode the approved procedural bank without changing its reviewed levels or stereo image. */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { proceduralSounds, renderProcedural } from "../../packages/client/src/audio/procedural";
import { wav } from "./procedural-preview";

const encoder = process.env.KAD_FFMPEG ?? "ffmpeg";
execFileSync(encoder, ["-version"], { stdio: "ignore" });
let total = 0;
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7).split(",");
if (only?.some((id) => !proceduralSounds().some((sound) => sound.id === id))) throw new Error("Unknown sound in --only");
for (const sound of proceduralSounds().filter((sound) => !only || only.includes(sound.id))) {
  const file = path.resolve("assets/audio", sound.loop ? "music" : "cues", `${sound.id}.webm`);
  if (fs.existsSync(file) && !process.argv.includes("--force")) throw new Error(`${file} exists; use --force to replace it`);
  const raw = wav(renderProcedural(sound), 24000);
  const approved = path.resolve("art/review/gemfall-audio-v2", `${sound.id}.wav`);
  if (fs.existsSync(approved) && !fs.readFileSync(approved).equals(raw)) throw new Error(`${sound.id} differs from the approved revision`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync(encoder, ["-hide_banner", "-loglevel", "error", "-y", "-f", "wav", "-i", "pipe:0", "-c:a", "libopus", "-b:a", sound.loop ? "96k" : "64k", "-ac", "2", "-ar", "48000", "-application", "audio", file], { input: raw });
  const bytes = fs.statSync(file).size;
  total += bytes;
  console.log(`${sound.id}: ${bytes} bytes`);
}
console.log(`Total: ${(total / 1024 / 1024).toFixed(2)} MiB`);
