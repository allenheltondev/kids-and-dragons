import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MUSIC_BY_BIOME, musicUrl } from "../../packages/client/src/audio/paths";
import { riftlightMusic, RIFT_MOTIF } from "../../packages/client/src/audio/riftlight";

describe("Riftlight's regional score", () => {
  it("gives each requested region its own arrangement", () => {
    expect(MUSIC_BY_BIOME.glacier_of_origins).toBe("riftlight-paths");
    expect(MUSIC_BY_BIOME.frostfang_peaks).toBe("riftlight-paths");
    expect(musicUrl("sky_islands")).toBe("/assets/audio/music/riftlight-sky.webm");
    expect(MUSIC_BY_BIOME.sallow_wastelands).toBe("riftlight-coast");
    expect(MUSIC_BY_BIOME.bone_yard).toBe("riftlight-coast");
  });

  it("changes no Gemfall chapter's biome music", () => {
    for (const file of readdirSync("content/chapters").filter((name) => /^gemfall.*\.json$/.test(name))) {
      const chapter = JSON.parse(readFileSync(`content/chapters/${file}`, "utf8"));
      expect(MUSIC_BY_BIOME[chapter.biome]?.startsWith("riftlight-"), file).not.toBe(true);
    }
  });

  it("states the same unresolved five-note motif in every regional score", () => {
    expect(RIFT_MOTIF).toEqual([0, 3, 7, 5, 2]);
    for (const sound of riftlightMusic()) {
      const steps = new Set(sound.voices.filter((voice) => !voice.noise).map((voice) => ((Math.round(12 * Math.log2(voice.freq / 146.8324)) % 12) + 12) % 12));
      for (const step of RIFT_MOTIF) expect(steps.has(step), `${sound.id}: motif note ${step}`).toBe(true);
      expect(sound.seconds).toBe(40);
      expect(sound.voices.every((voice) => voice.at + voice.duration <= sound.seconds + 0.001), sound.id).toBe(true);
    }
  });
});
