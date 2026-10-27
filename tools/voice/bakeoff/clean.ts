/**
 * Cleans Gemini TTS audio the way AI Studio's player does before you hear it
 * (docs/voice-bakeoff.md, "Gemini's end-of-turn noise").
 *
 * Raw audio from gemini-3.8-flash-tts carries a short burst of scratchy noise,
 * roughly 50 to 150ms, where a turn of speech ends and silence begins. AI
 * Studio's playback gates it away, so it sounds clean there and not here.
 *
 * What this does, on 16-bit mono PCM:
 *  1. removes any DC offset, which turns a drop to silence into a click;
 *  2. finds each short, noise-like island of sound that comes after speech
 *     and is followed by silence (or the end of the clip), and silences it,
 *     with short fades so the cut makes no click of its own;
 *  3. fades the clip's very start and end.
 *
 * What it keeps: a breath before a line (speech follows it closely), a sigh or
 * a laugh (longer than a burst), and a word's own "s" (attached to the word,
 * with no silence between). The raw audio is kept beside the cleaned clip so
 * the page can play either.
 */

export interface CleanOptions {
  /** Longest island that can be a burst. Real breaths and gasps run longer. */
  maxBurstMs: number;
  /** Silence before an island that sets it apart from the word it follows. */
  minGapBeforeMs: number;
  /** Silence after an island that makes it the end of a turn, not a breath before speech. */
  minGapAfterMs: number;
  /** Zero-crossing rate (crossings per sample) above which sound is noise, not voice. */
  noiseZcr: number;
  /** Below this, relative to the loudest frame, a frame is silence. */
  silenceDb: number;
}

export const CLEAN_DEFAULTS: CleanOptions = { maxBurstMs: 180, minGapBeforeMs: 20, minGapAfterMs: 150, noiseZcr: 0.3, silenceDb: -40 };

export interface Cleaned {
  pcm: Buffer;
  /** The stretches that were silenced, in milliseconds from the start. */
  removed: { startMs: number; endMs: number }[];
}

const FRAME_MS = 10;
const FADE_MS = 6;

function toFloats(pcm: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i += 1) samples[i] = pcm.readInt16LE(i * 2) / 32768;
  return samples;
}

function toPcm(samples: Float32Array): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]! * 32768))), i * 2);
  return pcm;
}

/** Ramps samples [from, to) down to silence and back up again around a silenced stretch. */
function silence(samples: Float32Array, from: number, to: number, fade: number): void {
  for (let i = Math.max(0, from - fade); i < from; i += 1) samples[i]! *= (from - i) / fade;
  for (let i = from; i < to; i += 1) samples[i] = 0;
  for (let i = to; i < Math.min(samples.length, to + fade); i += 1) samples[i]! *= (i - to) / fade;
}

export function cleanPcm16(pcm: Buffer, rate: number, options: CleanOptions = CLEAN_DEFAULTS): Cleaned {
  const samples = toFloats(pcm);
  if (samples.length === 0) return { pcm, removed: [] };

  let mean = 0;
  for (const s of samples) mean += s;
  mean /= samples.length;
  for (let i = 0; i < samples.length; i += 1) samples[i]! -= mean;

  const frame = Math.max(1, Math.round((rate * FRAME_MS) / 1000));
  const frames = Math.ceil(samples.length / frame);
  const rms = new Float32Array(frames);
  const zcr = new Float32Array(frames);
  for (let f = 0; f < frames; f += 1) {
    const start = f * frame;
    const end = Math.min(samples.length, start + frame);
    let energy = 0;
    let crossings = 0;
    for (let i = start; i < end; i += 1) {
      energy += samples[i]! * samples[i]!;
      if (i > start && Math.sign(samples[i]!) !== Math.sign(samples[i - 1]!)) crossings += 1;
    }
    rms[f] = Math.sqrt(energy / (end - start));
    zcr[f] = crossings / Math.max(1, end - start - 1);
  }
  // A loop, not Math.max(...rms): one argument per 10ms frame would overflow the call on a long recording.
  let peak = 0;
  for (const value of rms) if (value > peak) peak = value;
  const floor = Math.max(peak * 10 ** (options.silenceDb / 20), 1e-4);
  const loud = Array.from(rms, (value) => value >= floor);

  // Islands: runs of frames above the silence floor.
  const islands: { from: number; to: number }[] = [];
  for (let f = 0; f < frames; f += 1) {
    if (!loud[f]) continue;
    const from = f;
    while (f < frames && loud[f]) f += 1;
    islands.push({ from, to: f });
  }

  const removed: Cleaned["removed"] = [];
  const toMs = (frames: number): number => frames * FRAME_MS;
  islands.forEach((island, i) => {
    if (i === 0) return; // a burst ends a turn, so there is always speech before it
    const before = islands[i - 1]!;
    const after = islands[i + 1];
    const length = toMs(island.to - island.from);
    const gapBefore = toMs(island.from - before.to);
    const gapAfter = after === undefined ? Infinity : toMs(after.from - island.to);
    let crossings = 0;
    for (let f = island.from; f < island.to; f += 1) crossings += zcr[f]!;
    const noisy = crossings / (island.to - island.from) >= options.noiseZcr;
    if (length <= options.maxBurstMs && gapBefore >= options.minGapBeforeMs && gapAfter >= options.minGapAfterMs && noisy) {
      silence(samples, island.from * frame, Math.min(samples.length, island.to * frame), Math.round((rate * FADE_MS) / 1000));
      removed.push({ startMs: toMs(island.from), endMs: toMs(island.to) });
    }
  });

  // The clip's own edges: a short fade so a playlist of clips never clicks between them.
  const edge = Math.min(Math.round((rate * FADE_MS) / 1000), Math.floor(samples.length / 2));
  for (let i = 0; i < edge; i += 1) {
    samples[i]! *= i / edge;
    samples[samples.length - 1 - i]! *= i / edge;
  }
  return { pcm: toPcm(samples), removed };
}

/** The PCM and rate inside a 16-bit mono WAV as pcmToWav writes it, or null for anything else. */
export function readWav16(wav: Buffer): { pcm: Buffer; rate: number } | null {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return null;
  if (wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16) return null;
  return { pcm: wav.subarray(44), rate: wav.readUInt32LE(24) };
}
