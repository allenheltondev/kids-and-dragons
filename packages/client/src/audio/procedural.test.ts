import { describe, expect, it } from "vitest";
import { CUE_SPECS } from "./paths";
import { proceduralSounds, renderProcedural } from "./procedural";

describe("procedural audio previews", () => {
  it("keeps the lobby opening quiet without a string tail wrapping into it", () => {
    const lobby = proceduralSounds().find((sound) => sound.id === "entry-lobby")!;
    expect(lobby.voices.filter((voice) => !voice.noise).every((voice) => voice.at + voice.duration <= lobby.seconds)).toBe(true);
    const sampleRate = 6000;
    const pcm = renderProcedural(lobby, sampleRate);
    const rms = (start: number, end: number) => {
      let energy = 0;
      for (const channel of pcm) for (let i = start * sampleRate; i < end * sampleRate; i++) energy += channel[i]! ** 2;
      return Math.sqrt(energy / ((end - start) * sampleRate * 2));
    };
    expect(rms(0, 1)).toBeLessThan(rms(2, 5) * 0.3);
  });

  it("covers every game brief", () => {
    const sounds = proceduralSounds();
    expect(sounds.filter((s) => !s.loop).map((s) => s.id).sort()).toEqual(Object.keys(CUE_SPECS).sort());
    expect(new Set(sounds.map((s) => s.id)).size).toBe(sounds.length);
  });
  it.each(proceduralSounds())("renders audible, bounded PCM for $id", (sound) => {
      // Loop slope checks use the production sample rate; downsampling increases
      // legitimate adjacent-sample differences, especially with harmonics.
      const sampleRate = sound.loop ? 24000 : 6000;
      const pcm = renderProcedural(sound, sampleRate);
      expect(pcm[0].length).toBe(Math.round(sound.seconds * sampleRate));
      let energy = 0;
      for (const channel of pcm) for (const value of channel) {
        if (!Number.isFinite(value) || Math.abs(value) > 0.601) throw new Error(`${sound.id}: unsafe PCM`);
        energy += value * value;
      }
      expect(energy / (pcm[0].length * 2), sound.id).toBeGreaterThan(0.000001);
      if (sound.loop) for (const c of pcm) expect(Math.abs(c[0]! - c[c.length - 1]!), sound.id).toBeLessThan(0.025);
      else for (const c of pcm) expect([Math.abs(c[0]!), Math.abs(c[c.length - 1]!)]).toEqual([0, 0]);
  });
});
