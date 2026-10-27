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
 *     and is followed by silence, and silences it, with short fades so the
 *     cut makes no click of its own;
 *  3. ends the clip where the speech ends: after the last voiced sound it
 *     keeps only a word's own loud tail (an "s", a "t"), and silences the
 *     rest, however long, loud or quiet it is, and whether or not silence
 *     separates it from the word;
 *  4. gates the quiet hiss in pauses, well under any speech;
 *  5. fades the clip's very start and end.
 *
 * What it keeps: a breath before a line (speech follows it closely), a sigh or
 * a laugh in the middle of a line (longer than a burst), a word's own "s"
 * (loud, and attached to the word), and a sound the line ends on when the
 * script says it does (`endsOnSound`: "…," <laugh>). The raw audio is kept
 * beside the cleaned clip so the page can play either, and so a better
 * cleaner can start again from it (CLEANER_VERSION).
 */

/** Bumped whenever cleaning changes, so clips cleaned the old way are cleaned again from their raw audio. */
export const CLEANER_VERSION = 2;

export interface CleanOptions {
  /** Longest island that can be a burst. Real breaths and gasps run longer. */
  maxBurstMs: number;
  /** How much of a word's own sound may follow its last voiced frame: a final "s" or "t". */
  maxTailMs: number;
  /** A word's tail is loud: above this, relative to the loudest frame. Hiss and bursts are quieter. */
  tailDb: number;
  /** Speech: above this, relative to the loudest frame, and voiced (under noiseZcr). */
  speechDb: number;
  /** Pauses quieter than this, relative to the loudest frame, are hiss and are gated to silence. */
  gateDb: number;
  /** Shortest quiet run the gate silences, so it never chops inside a word. */
  minGateMs: number;
  /** Silence before an island that sets it apart from the word it follows. */
  minGapBeforeMs: number;
  /** Silence after an island that makes it the end of a turn, not a breath before speech. */
  minGapAfterMs: number;
  /** Zero-crossing rate (crossings per sample) above which sound is noise, not voice. */
  noiseZcr: number;
  /** Below this, relative to the loudest frame, a frame is silence. */
  silenceDb: number;
}

export const CLEAN_DEFAULTS: CleanOptions = {
  maxBurstMs: 300,
  minGapBeforeMs: 20,
  minGapAfterMs: 100,
  noiseZcr: 0.3,
  silenceDb: -40,
  maxTailMs: 200,
  tailDb: -32,
  speechDb: -30,
  gateDb: -40,
  minGateMs: 50,
};

export interface CleanContext {
  /** The script ends on a sound, not a word ("…," <laugh>): keep what follows the last word. */
  endsOnSound?: boolean;
}

export interface Cleaned {
  pcm: Buffer;
  /** The stretches that were silenced, in milliseconds from the start. */
  removed: { startMs: number; endMs: number }[];
}

const FRAME_MS = 10;
const FADE_MS = 6;
/** The end of a line fades out over a little longer, so a cut tail sounds like the word ending. */
const TAIL_FADE_MS = 25;

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

export function cleanPcm16(pcm: Buffer, rate: number, context: CleanContext = {}, options: CleanOptions = CLEAN_DEFAULTS): Cleaned {
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
  const fade = Math.round((rate * FADE_MS) / 1000);
  const above = (f: number, db: number): boolean => rms[f]! >= peak * 10 ** (db / 20);
  // What a frame sounds like now, after the cuts so far.
  const audibleNow = (f: number): boolean => {
    const start = f * frame;
    const end = Math.min(samples.length, start + frame);
    let energy = 0;
    for (let i = start; i < end; i += 1) energy += samples[i]! * samples[i]!;
    return Math.sqrt(energy / Math.max(1, end - start)) >= peak * 10 ** (options.gateDb / 20);
  };
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
      silence(samples, island.from * frame, Math.min(samples.length, island.to * frame), fade);
      removed.push({ startMs: toMs(island.from), endMs: toMs(island.to) });
    }
  });

  // The end of the line: after the last voiced frame, a word's own loud tail and nothing else.
  let lastSpeech = -1;
  for (let f = frames - 1; f >= 0; f -= 1) {
    if (above(f, options.speechDb) && zcr[f]! < options.noiseZcr) {
      lastSpeech = f;
      break;
    }
  }
  if (lastSpeech >= 0 && !context.endsOnSound) {
    let cut = lastSpeech + 1;
    const tailFrames = Math.round(options.maxTailMs / FRAME_MS);
    while (cut < frames && cut - lastSpeech - 1 < tailFrames && above(cut, options.tailDb)) cut += 1;
    // Only worth a cut if something audible is left after it.
    let audible = false;
    for (let f = cut; f < frames && !audible; f += 1) audible = audibleNow(f);
    if (audible) {
      silence(samples, cut * frame, samples.length, Math.round((rate * TAIL_FADE_MS) / 1000));
      removed.push({ startMs: toMs(cut), endMs: toMs(frames) });
    }
  }

  // Hiss in the pauses: long-enough runs under the silence floor go to true silence.
  const gateFrames = Math.max(1, Math.round(options.minGateMs / FRAME_MS));
  for (let f = 0; f < frames; f += 1) {
    if (above(f, options.gateDb)) continue;
    const from = f;
    while (f < frames && !above(f, options.gateDb)) f += 1;
    if (f - from >= gateFrames) {
      // Only hiss: a run that is already digital silence is left be. Measured around its own mean,
      // so the steady offset the DC removal leaves in true silence is not mistaken for sound.
      const start = from * frame;
      const end = Math.min(samples.length, f * frame);
      let sum = 0;
      let squares = 0;
      for (let i = start; i < end; i += 1) {
        sum += samples[i]!;
        squares += samples[i]! * samples[i]!;
      }
      const n = Math.max(1, end - start);
      if (Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2)) >= peak * 10 ** (-70 / 20)) {
        silence(samples, from * frame, Math.min(samples.length, f * frame), fade);
        removed.push({ startMs: toMs(from), endMs: toMs(f) });
      }
    }
  }

  // The clip's own edges: a short fade so a playlist of clips never clicks between them.
  const edge = Math.min(fade, Math.floor(samples.length / 2));
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

/** Whether a request's spoken text ends on a sound (a laugh, a sigh) rather than a word, in either Gemini's form of the tags. */
export function endsOnSound(text: string): boolean {
  return /(<(sigh|laugh|chuckle|giggle|gasp|breath|yawn)>|\[(sighs?|laughs?|chuckles?|giggles?|gasps?|breath|inhales|gulps?|yawns?)\])[\s"'”’.,!?…]*$/i.test(text.trim());
}
