/**
 * Gemini end-of-turn noise cleaning (clean.ts), on synthetic audio: a voiced
 * tone stands in for speech, seeded white noise for the burst, a breath and a
 * sigh. What must go is the short noise after speech and before silence; what
 * must stay is everything a performance means.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cleanPcm16, readWav16 } from "./clean.ts";
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

  it("keeps a breath before the next line, a long sigh, and a word's own s", () => {
    const breath = build([{ kind: "voice", ms: 600 }, { kind: "silence", ms: 300 }, { kind: "noise", ms: 150 }, { kind: "silence", ms: 60 }, { kind: "voice", ms: 600 }]);
    expect(cleanPcm16(breath, RATE).removed).toEqual([]);
    const sigh = build([{ kind: "voice", ms: 600 }, { kind: "silence", ms: 200 }, { kind: "noise", ms: 500 }, { kind: "silence", ms: 300 }]);
    expect(cleanPcm16(sigh, RATE).removed).toEqual([]);
    const ess = build([{ kind: "voice", ms: 600 }, { kind: "noise", ms: 120 }, { kind: "silence", ms: 300 }]);
    expect(cleanPcm16(ess, RATE).removed).toEqual([]);
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
    expect(clip.file).toBe(`clips/${job!.key}.wav?cleaned=1`);
    // Done once: the next read finds it cleaned and leaves it be.
    const onDisk = path.join(outDir, "clips", `${job!.key}.wav`);
    const before = fs.readFileSync(onDisk);
    cellOf(engine, sample, 1, ws);
    expect(fs.readFileSync(onDisk).equals(before)).toBe(true);
  });
});
