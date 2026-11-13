import { describe, expect, it } from "vitest";
import { MUSIC_SPECS, RECORDED_MUSIC, recordedMusicUrl } from "./paths";

describe("the music the look-ahead may fetch", () => {
  it("is exactly the tracks that have a brief", () => {
    expect([...RECORDED_MUSIC].sort()).toEqual(Object.keys(MUSIC_SPECS).sort());
  });

  it("resolves a biome through its shared arrangement, and nothing for a place with no track", () => {
    expect(recordedMusicUrl("bramblewood")).toBe("/assets/audio/music/forest.webm");
    expect(recordedMusicUrl("gemfall-citadel")).toBe("/assets/audio/music/gemfall-citadel.webm");
    expect(recordedMusicUrl("nowhere_at_all")).toBeNull();
    expect(recordedMusicUrl(null)).toBeNull();
  });
});
