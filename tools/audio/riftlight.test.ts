import { describe, expect, it } from "vitest";
import { proceduralSounds, renderProcedural } from "../../packages/client/src/audio/procedural";

describe("Riftlight's audible chime answers", () => {
  const sampleRate = 12000;
  const pcm = (id: string) => renderProcedural(proceduralSounds().find((s) => s.id === id)!, sampleRate)[0];
  const rms = (samples: Float32Array, from: number, to: number) => {
    const range = samples.slice(from * sampleRate, to * sampleRate);
    return Math.sqrt(range.reduce((sum, value) => sum + value * value, 0) / range.length);
  };

  it("leaves a pause before the clean returning strike, while sour keeps wobbling", () => {
    const sour = pcm("chime-sour");
    const echo = pcm("chime-echo");
    // The return must read on a mono living-room speaker, without stereo cues.
    expect(rms(echo, 0.64, 0.8)).toBeLessThan(rms(echo, 0.9, 1.1) * 0.08);
    expect(rms(sour, 0.64, 0.8)).toBeGreaterThan(rms(echo, 0.64, 0.8) * 8);
    expect(rms(echo, 0.9, 1.1)).toBeGreaterThan(0.02);
  });

  it("answers with a short swelling consonant hum, separate from the Gate drone", () => {
    const attune = pcm("attune-hum");
    expect(attune.length).toBe(3 * sampleRate);
    expect(rms(attune, 0, 0.15)).toBeLessThan(rms(attune, 1, 1.5) * 0.35);
    expect(pcm("gate-hum").length).toBe(8 * sampleRate);
  });
});
