import { describe, expect, it } from "vitest";
import { riftlightFinale, RIFT_MOTIF } from "../../packages/client/src/audio/riftlight";
import { proceduralSounds } from "../../packages/client/src/audio/procedural";
import { MUSIC_BY_BIOME } from "../../packages/client/src/audio/paths";

describe("Riftlight finale", () => {
  it("recalls the same five notes with uneven timing and no voice crossing the loop", () => {
    const score = riftlightFinale();
    expect(score.seconds).toBe(45);
    const melody = score.voices.filter((voice) => voice.gain === 0.075);
    expect(melody).toHaveLength(15);
    expect(melody.slice(0, 5).map((voice) => Math.round(12 * Math.log2(voice.freq / 146.8324)))).toEqual([...RIFT_MOTIF]);
    expect(melody.slice(0, 5).map((voice) => voice.at)).toEqual([2, 3.7, 5.2, 7.4, 9]);
    expect(score.voices.every((voice) => voice.at + voice.duration <= 45)).toBe(true);
    expect(Object.values(MUSIC_BY_BIOME)).not.toContain("riftlight-finale");
  });
  it("lets the existing anchor cue resolve the motif's final E to D", () => {
    const anchor = proceduralSounds().find((sound) => sound.id === "anchor")!;
    expect(anchor.voices[0]!.freq).toBeCloseTo(82.41);
    expect(anchor.voices[0]!.endFreq).toBeCloseTo(73.42);
    expect(anchor.seconds).toBe(2);
  });
});
