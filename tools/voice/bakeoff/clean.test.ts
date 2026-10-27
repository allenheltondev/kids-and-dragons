/**
 * Gemini end-of-turn noise cleaning (clean.ts), on synthetic audio: a voiced
 * tone stands in for speech, seeded white noise for the burst, a breath and a
 * sigh. What must go is the short noise after speech and before silence; what
 * must stay is everything a performance means.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLEANER_VERSION, cleanPcm16, endsOnSound, readWav16 } from "./clean.ts";
import { cellOf } from "./bakeoff.ts";
import { engineOf, pcmToWav, plan, send, type CastFile, type Fetch, type Job } from "./providers.ts";
import { contentLines, readSampleFile, resolveSamples } from "./samples.ts";

const RATE = 24000;
type Piece = { kind: "voice" | "noise" | "silence"; ms: number; amp?: number };

function build(pieces: Piece[], dc = 0): Buffer {
  let seed = 12345;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  const samples: number[] = [];
  for (const piece of pieces) {
    const n = Math.round((RATE * piece.ms) / 1000);
    for (let i = 0; i < n; i += 1) {
      const value = piece.kind === "voice" ? Math.sin((2 * Math.PI * 180 * i) / RATE) * (piece.amp ?? 0.5) : piece.kind === "noise" ? random() * 2 * (piece.amp ?? 0.15) : 0;
      samples.push(value + dc);
    }
  }
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  return pcm;
}

/** RMS of a stretch, in ms, of 16-bit PCM. */
function rmsOf(pcm: Buffer, fromMs: number, toMs: number): number {
  const from = Math.round((RATE * fromMs) / 1000);
  const to = Math.round((RATE * toMs) / 1000);
  let energy = 0;
  for (let i = from; i < to; i += 1) energy += (pcm.readInt16LE(i * 2) / 32768) ** 2;
  return Math.sqrt(energy / (to - from));
}

describe("cleaning Gemini audio", () => {
  it("silences a short burst of noise after speech, before silence", () => {
    const pcm = build([{ kind: "voice", ms: 1000 }, { kind: "silence", ms: 60 }, { kind: "noise", ms: 100 }, { kind: "silence", ms: 300 }]);
    const { pcm: out, removed } = cleanPcm16(pcm, RATE);
    expect(removed).toHaveLength(1);
    expect(removed[0]!.startMs).toBeGreaterThanOrEqual(1050);
    expect(removed[0]!.endMs).toBeLessThanOrEqual(1170);
    expect(rmsOf(out, 1070, 1150)).toBeLessThan(0.001);
    // The speech itself is untouched.
    expect(rmsOf(out, 200, 800)).toBeCloseTo(rmsOf(pcm, 200, 800), 3);
  });

  it("silences a burst that runs to the end of the clip", () => {
    const { removed } = cleanPcm16(build([{ kind: "voice", ms: 800 }, { kind: "silence", ms: 40 }, { kind: "noise", ms: 80 }]), RATE);
    expect(removed).toHaveLength(1);
  });

  it("keeps a breath before the next line, a long sigh mid-line, and a word's own s", () => {
    const breath = build([{ kind: "voice", ms: 600 }, { kind: "silence", ms: 300 }, { kind: "noise", ms: 150 }, { kind: "silence", ms: 60 }, { kind: "voice", ms: 600 }]);
    expect(cleanPcm16(breath, RATE).removed).toEqual([]);
    const sigh = build([{ kind: "voice", ms: 600 }, { kind: "silence", ms: 200 }, { kind: "noise", ms: 500 }, { kind: "silence", ms: 300 }, { kind: "voice", ms: 600 }]);
    expect(cleanPcm16(sigh, RATE).removed).toEqual([]);
    const ess = build([{ kind: "voice", ms: 600 }, { kind: "noise", ms: 120 }, { kind: "silence", ms: 300 }]);
    expect(cleanPcm16(ess, RATE).removed).toEqual([]);
  });

  it("keeps a sound the line ends on when the script ends on one, and cuts it when it doesn't", () => {
    const sighing = build([{ kind: "voice", ms: 600 }, { kind: "silence", ms: 200 }, { kind: "noise", ms: 500 }, { kind: "silence", ms: 300 }]);
    expect(cleanPcm16(sighing, RATE, { endsOnSound: true }).removed).toEqual([]);
    expect(cleanPcm16(sighing, RATE).removed).toHaveLength(1);
    expect(endsOnSound('"…the marsh gives back different boots." <laugh>')).toBe(true);
    expect(endsOnSound("you should choose it together. [sighs]")).toBe(true);
    expect(endsOnSound("<sigh> I can only spare one.")).toBe(false);
    expect(endsOnSound("Wait. <long pause>")).toBe(false);
  });

  it("ends the clip where the speech ends: long bursts, quiet hiss and noise straight off the word", () => {
    // "Silent" here is under -80 dB: what is left is the DC removal's steady offset, which makes no sound.
    const end = (pcm: Buffer) => {
      const { pcm: out } = cleanPcm16(pcm, RATE);
      return { out, last: rmsOf(out, 1250, 1600) };
    };
    // A burst longer than the old 180ms limit.
    expect(end(build([{ kind: "voice", ms: 1000 }, { kind: "silence", ms: 50 }, { kind: "noise", ms: 280 }, { kind: "silence", ms: 270 }])).last).toBeLessThan(1e-4);
    // Hiss too quiet to count as sound before (about -42 dB under the speech), all the way to the end.
    const hiss = build([{ kind: "voice", ms: 1000 }, { kind: "noise", ms: 600, amp: 0.0048 }]);
    expect(rmsOf(hiss, 1250, 1600)).toBeGreaterThan(0.002);
    expect(end(hiss).last).toBeLessThan(1e-4);
    // Noise straight off the last word with no silence between, quieter than a real "s".
    const attached = end(build([{ kind: "voice", ms: 1000 }, { kind: "noise", ms: 600, amp: 0.02 }]));
    expect(attached.last).toBeLessThan(1e-4);
    expect(rmsOf(attached.out, 200, 900)).toBeGreaterThan(0.3);
  });

  it("gates quiet hiss in the pauses, and leaves quiet speech alone", () => {
    const pcm = build([{ kind: "voice", ms: 600 }, { kind: "noise", ms: 300, amp: 0.004 }, { kind: "voice", ms: 600 }]);
    const { pcm: out } = cleanPcm16(pcm, RATE);
    expect(rmsOf(out, 650, 850)).toBeLessThan(1e-4);
    expect(rmsOf(out, 1000, 1400)).toBeCloseTo(rmsOf(pcm, 1000, 1400), 3);
  });

  it("silences a burst between two turns of a dialogue", () => {
    const pcm = build([{ kind: "voice", ms: 800 }, { kind: "silence", ms: 40 }, { kind: "noise", ms: 120 }, { kind: "silence", ms: 120 }, { kind: "voice", ms: 800 }]);
    const { pcm: out, removed } = cleanPcm16(pcm, RATE);
    expect(removed.some((r) => r.startMs >= 830 && r.endMs <= 970)).toBe(true);
    expect(rmsOf(out, 850, 950)).toBeLessThan(1e-4);
    expect(rmsOf(out, 1200, 1800)).toBeCloseTo(rmsOf(pcm, 1200, 1800), 3);
  });

  it("never touches the first sound in a clip, and keeps quiet speech", () => {
    const opening = build([{ kind: "noise", ms: 100 }, { kind: "silence", ms: 300 }, { kind: "voice", ms: 600 }]);
    expect(cleanPcm16(opening, RATE).removed).toEqual([]);
    const soft = build([{ kind: "voice", ms: 600 }, { kind: "silence", ms: 100 }, { kind: "voice", ms: 150, amp: 0.1 }, { kind: "silence", ms: 300 }]);
    expect(cleanPcm16(soft, RATE).removed).toEqual([]);
  });

  it("removes a DC offset and fades the clip's edges, so a playlist never clicks", () => {
    const { pcm: out } = cleanPcm16(build([{ kind: "silence", ms: 50 }, { kind: "voice", ms: 300 }, { kind: "silence", ms: 50 }], 0.1), RATE);
    expect(Math.abs(rmsOf(out, 5, 45))).toBeLessThan(0.01);
    expect(out.readInt16LE(0)).toBe(0);
    expect(out.readInt16LE(out.length - 2)).toBe(0);
  });

  it("handles a long recording without overflowing", () => {
    // Ninety minutes is 540,000 ten-millisecond frames, past what a spread call takes. A low sample
    // rate keeps the buffer small; the frame count is what matters.
    const rate = 800;
    const long = Buffer.alloc(rate * 60 * 90 * 2);
    expect(() => cleanPcm16(long, rate)).not.toThrow();
  });

  it("reads back the WAVs the harness writes", () => {
    const pcm = build([{ kind: "voice", ms: 50 }]);
    expect(readWav16(pcmToWav(pcm, RATE))).toEqual({ pcm, rate: RATE });
    expect(readWav16(Buffer.from("ID3 not a wav"))).toBeNull();
  });
});

describe("in the harness", () => {
  const HERE = import.meta.dirname;
  const cast = JSON.parse(fs.readFileSync(path.join(HERE, "cast.json"), "utf8")) as CastFile;
  const file = readSampleFile();
  const sample = resolveSamples(file, contentLines()).samples.find((s) => s.id === "hedge-wall")!;
  const engine = engineOf({ provider: "gemini", model: "gemini-3.8-flash-tts", mode: "lines", delivery: "tag" });
  const [job] = plan(engine, cast, sample, 1) as Job[];
  const dirty = build([{ kind: "voice", ms: 900 }, { kind: "silence", ms: 60 }, { kind: "noise", ms: 100 }, { kind: "silence", ms: 300 }]);

  it("cleans what Gemini sends and keeps the raw audio beside it", async () => {
    const fetch: Fetch = async () => {
      const body = JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: dirty.toString("base64") } }] } }] });
      return { ok: true, status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0), text: async () => body };
    };
    const audio = await send(job!, { gemini: "k" }, fetch);
    expect(audio.raw!.equals(pcmToWav(dirty, RATE))).toBe(true);
    expect(audio.bytes.equals(audio.raw!)).toBe(false);
    expect(audio.removedMs).toBeGreaterThan(0);
  });

  it("cleans a clip rendered before cleaning existed, for free, keeping the original as raw", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "bakeoff-clean-"));
    fs.mkdirSync(path.join(outDir, "clips"));
    fs.writeFileSync(path.join(outDir, "clips", `${job!.key}.wav`), pcmToWav(dirty, RATE));
    fs.writeFileSync(path.join(outDir, "clips", `${job!.key}.json`), JSON.stringify({ ext: "wav", chars: 10, renderMs: 5, bytes: 1, at: "then" }));
    const ws = { outDir, cast, pricing: { checked: "", speech: { charsPerSecond: 14, charsPerTextToken: 4, promptTokensPerRequest: 0 }, models: [] }, today: "2026-10-27" };

    const clip = cellOf(engine, sample, 1, ws).takes![0]!.clips[0]!;
    expect(clip.raw).toBe(`clips/${job!.key}.raw.wav`);
    expect(clip.removedMs).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(outDir, clip.raw!)).equals(pcmToWav(dirty, RATE))).toBe(true);
    // A new URL for the cleaned audio, so a browser that cached the noisy file cannot replay it.
    expect(clip.file).toBe(`clips/${job!.key}.wav?cleaned=${String(CLEANER_VERSION)}`);
    // Done once: the next read finds it cleaned and leaves it be.
    const onDisk = path.join(outDir, "clips", `${job!.key}.wav`);
    const before = fs.readFileSync(onDisk);
    cellOf(engine, sample, 1, ws);
    expect(fs.readFileSync(onDisk).equals(before)).toBe(true);
  });

  it("cleans a clip again, from its raw audio, when the cleaner has changed since", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "bakeoff-reclean-"));
    fs.mkdirSync(path.join(outDir, "clips"));
    const clips = path.join(outDir, "clips");
    // Cleaned by version 1, which left quiet hiss at the end; the raw copy is beside it.
    const hissy = build([{ kind: "voice", ms: 900 }, { kind: "noise", ms: 500, amp: 0.0048 }]);
    fs.writeFileSync(path.join(clips, `${job!.key}.wav`), pcmToWav(hissy, RATE));
    fs.writeFileSync(path.join(clips, `${job!.key}.raw.wav`), pcmToWav(hissy, RATE));
    fs.writeFileSync(path.join(clips, `${job!.key}.json`), JSON.stringify({ ext: "wav", chars: 10, renderMs: 5, bytes: 1, at: "then", cleaned: true, removedMs: 0 }));
    const ws = { outDir, cast, pricing: { checked: "", speech: { charsPerSecond: 14, charsPerTextToken: 4, promptTokensPerRequest: 0 }, models: [] }, today: "2026-10-27" };
    const clip = cellOf(engine, sample, 1, ws).takes![0]!.clips[0]!;
    expect(clip.file).toBe(`clips/${job!.key}.wav?cleaned=${String(CLEANER_VERSION)}`);
    expect(clip.removedMs).toBeGreaterThan(0);
    const cleaned = readWav16(fs.readFileSync(path.join(clips, `${job!.key}.wav`)))!;
    expect(rmsOf(cleaned.pcm, 1000, 1400)).toBeLessThan(1e-4);
    // The raw copy is still the raw audio.
    expect(fs.readFileSync(path.join(clips, `${job!.key}.raw.wav`)).equals(pcmToWav(hissy, RATE))).toBe(true);
  });
});

describe("npm run voice:clean", () => {
  it("cleans a clip as the page did: keeping the sound a line ends on, when its metadata says so", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-report-"));
    const sighing = pcmToWav(build([{ kind: "voice", ms: 600 }, { kind: "silence", ms: 200 }, { kind: "noise", ms: 500 }, { kind: "silence", ms: 300 }]), RATE);
    const report = (name: string, meta?: object): string => {
      fs.writeFileSync(path.join(dir, `${name}.raw.wav`), sighing);
      if (meta) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(meta));
      const tsx = path.join(import.meta.dirname, "..", "..", "..", "node_modules", ".bin", "tsx");
      return execFileSync(tsx, [path.join(import.meta.dirname, "clean-report.ts"), path.join(dir, `${name}.raw.wav`)], { encoding: "utf8" }).split("\n")[0]!;
    };
    expect(report("laughs", { ext: "wav", cleaned: 2, endsOnSound: true })).toMatch(/the line ends on a sound, which is kept\): .*cuts nothing$/);
    expect(report("words", { ext: "wav", cleaned: 2 })).toMatch(/^words: .*cuts 600-1600ms$/);
    expect(report("bare")).toMatch(/no metadata: cleaned as a line ending on a word/);
  });
});
