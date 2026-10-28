import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { fakeTone } from "./bakeoff/providers";
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

  it("fails loudly on something that is not audio", () => {
    expect(() => encodeVoice(Buffer.from("not a wav"))).toThrow(/ffmpeg failed/);
  });
});
