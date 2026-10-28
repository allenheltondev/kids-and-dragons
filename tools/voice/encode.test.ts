import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { fakeTone, pcmToWav } from "./bakeoff/providers";
import { encodeVoice } from "./encode";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("encoding a clip", () => {
  it("turns a WAV into mono Opus in WebM and reports its length", () => {
    const wav = fakeTone([{ text: "The path ends at a wall of thorns twice your height.", speaker: "narrator" }]);
    const { bytes, ms } = encodeVoice(wav);
    // A WebM file opens with the EBML magic number.
    expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(ms).toBeGreaterThan(500);
    expect(bytes.length).toBeLessThan(wav.length);
  });

  // 24 kHz, 16-bit mono: a steady tone, or silence, of a given length.
  const RATE = 24000;
  const tone = (seconds: number): Buffer => {
    const pcm = Buffer.alloc(Math.round(RATE * seconds) * 2);
    for (let i = 0; i < pcm.length / 2; i += 1) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / RATE) * 12000), i * 2);
    return pcm;
  };
  const silence = (seconds: number): Buffer => Buffer.alloc(Math.round(RATE * seconds) * 2);
  const clip = (...parts: Buffer[]): Buffer => pcmToWav(Buffer.concat(parts), RATE);

  it("keeps speech after an ordinary pause: a sentence breathes", () => {
    // 1 s of speech, a 250 ms pause, 1 s more. The old filter ended the clip at the pause.
    const { ms } = encodeVoice(clip(tone(1), silence(0.25), tone(1)));
    expect(ms).toBeGreaterThan(2100);
  });

  it("trims the silence at either end and nothing else", () => {
    const padded = encodeVoice(clip(silence(0.8), tone(1), silence(0.8)));
    expect(padded.ms).toBeGreaterThan(900);
    expect(padded.ms).toBeLessThan(1300);
    // A pause in the middle survives the same trim.
    const withPause = encodeVoice(clip(silence(0.8), tone(1), silence(0.4), tone(1), silence(0.8)));
    expect(withPause.ms).toBeGreaterThan(2250);
    expect(withPause.ms).toBeLessThan(2700);
  });

  it("fails loudly on something that is not audio", () => {
    expect(() => encodeVoice(Buffer.from("not a wav"))).toThrow(/ffmpeg failed/);
  });
});
