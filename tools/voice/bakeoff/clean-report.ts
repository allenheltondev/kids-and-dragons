#!/usr/bin/env node
/**
 * What the Gemini cleaner hears at the end of each clip — `npm run voice:clean`
 * (docs/voice-bakeoff.md, "Gemini's end-of-turn noise").
 *
 *   npm run voice:clean                       # every raw Gemini clip: where speech ends, what is cut
 *   npm run voice:clean -- <key or file.wav>  # one clip, with its last second frame by frame
 *
 * It reads the raw copies (`<key>.raw.wav`) and changes nothing: the page
 * cleans clips itself. A clip whose line ends on a sound (a laugh, a sigh) is
 * cleaned as the page cleans it, keeping that sound, from its `<key>.json`; a
 * file with no metadata beside it is cleaned as a line ending on a word. Paste the output of one clip that still sounds noisy,
 * and the frames show what the noise looks like to the cleaner.
 */

import fs from "node:fs";
import path from "node:path";
import { CLEAN_DEFAULTS, cleanPcm16, readWav16 } from "./clean.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const CLIPS = path.join(ROOT, "art", "review", "voice-bakeoff", "clips");

const args = process.argv.slice(2);
const files = args.length
  ? args.map((arg) => (fs.existsSync(arg) ? arg : path.join(CLIPS, `${arg.replace(/(\.raw)?\.wav$/, "")}.raw.wav`)))
  : fs.existsSync(CLIPS)
    ? fs.readdirSync(CLIPS).filter((name) => name.endsWith(".raw.wav")).sort().map((name) => path.join(CLIPS, name))
    : [];
if (files.length === 0) {
  console.log(`No raw Gemini clips in ${path.relative(ROOT, CLIPS)} yet: render some on the bake-off or cast page first.`);
  process.exit(0);
}

const db = (value: number, peak: number): string => (value <= 0 ? "  -inf" : (20 * Math.log10(value / peak)).toFixed(1).padStart(6));

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`${file}: no such clip`);
    continue;
  }
  const wav = readWav16(fs.readFileSync(file));
  if (wav === null) {
    console.log(`${path.basename(file)}: not a 16-bit mono WAV`);
    continue;
  }
  const samples = new Float32Array(wav.pcm.length / 2).map((_, i) => wav.pcm.readInt16LE(i * 2) / 32768);
  const frame = Math.round(wav.rate / 100);
  const frames = Math.ceil(samples.length / frame);
  const rms: number[] = [];
  const zcr: number[] = [];
  for (let f = 0; f < frames; f += 1) {
    let energy = 0;
    let crossings = 0;
    const end = Math.min(samples.length, (f + 1) * frame);
    for (let i = f * frame; i < end; i += 1) {
      energy += samples[i]! ** 2;
      if (i > f * frame && Math.sign(samples[i]!) !== Math.sign(samples[i - 1]!)) crossings += 1;
    }
    rms.push(Math.sqrt(energy / Math.max(1, end - f * frame)));
    zcr.push(crossings / Math.max(1, end - f * frame - 1));
  }
  const peak = Math.max(1e-9, rms.reduce((a, b) => (b > a ? b : a), 0));
  let lastSpeech = -1;
  for (let f = frames - 1; f >= 0 && lastSpeech < 0; f -= 1) if (rms[f]! >= peak * 10 ** (CLEAN_DEFAULTS.speechDb / 20) && zcr[f]! < CLEAN_DEFAULTS.noiseZcr) lastSpeech = f;
  const metaFile = file.replace(/(\.raw)?\.wav$/, ".json");
  const meta = fs.existsSync(metaFile) ? (JSON.parse(fs.readFileSync(metaFile, "utf8")) as { endsOnSound?: boolean }) : null;
  const endsOnSound = meta?.endsOnSound === true;
  const { removed } = cleanPcm16(wav.pcm, wav.rate, { endsOnSound });
  const name = path.basename(file).replace(/\.raw\.wav$/, "");
  const context = meta === null ? " (no metadata: cleaned as a line ending on a word)" : endsOnSound ? " (the line ends on a sound, which is kept)" : "";
  console.log(`${name}${context}: ${String(frames * 10)}ms, speech ends at ${lastSpeech < 0 ? "?" : `${String((lastSpeech + 1) * 10)}ms`}, cuts ${removed.length ? removed.map((r) => `${String(r.startMs)}-${String(r.endMs)}ms`).join(", ") : "nothing"}`);
  if (files.length === 1) {
    console.log("\n    ms     dB    zcr   (dB from the loudest frame; zcr over 0.3 is noise, not voice)");
    for (let f = Math.max(0, frames - 100); f < frames; f += 1) {
      const cut = removed.some((r) => f * 10 >= r.startMs && f * 10 < r.endMs);
      console.log(`${String(f * 10).padStart(6)} ${db(rms[f]!, peak)}  ${zcr[f]!.toFixed(2)}${f === lastSpeech ? "  <- last speech" : ""}${cut ? "  cut" : ""}`);
    }
  }
}
