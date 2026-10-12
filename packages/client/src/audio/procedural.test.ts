import { describe, expect, it } from "vitest";
import { CUE_SPECS } from "./paths";
import { proceduralSounds, renderProcedural } from "./procedural";

describe("procedural audio previews", () => {
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
