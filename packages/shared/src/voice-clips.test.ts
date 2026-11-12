import { describe, expect, it } from "vitest";
import { clipObjectKey, helpAddress, howToPlayAddress, manifestOfAddress, clipPath, isClipKey, manifestName, manifestPath, playlistFor, variantKey, type VoiceManifest } from "./voice-clips.js";

const KEY = "ab".repeat(32);
const OTHER = "cd".repeat(32);

describe("where a clip lives", () => {
  it("is voice/<first two>/<key>.webm, never under assets/", () => {
    expect(clipObjectKey(KEY)).toBe(`voice/ab/${KEY}.webm`);
    expect(clipPath(KEY)).toBe(`/voice/ab/${KEY}.webm`);
    expect(clipPath(KEY).startsWith("/assets/")).toBe(false);
  });

  it("refuses anything that is not a clip key, so a path can never be built from a stray string", () => {
    for (const bad of ["", "ab", "../../etc/passwd", KEY.toUpperCase(), `${KEY}/x`]) {
      expect(isClipKey(bad)).toBe(false);
      expect(() => clipObjectKey(bad)).toThrow();
    }
  });

  it("files a chapter's manifest by chapter, and campaign or help text by its campaign", () => {
    expect(manifestName("bramblewood-01", "bramblewood")).toBe("bramblewood-01");
    expect(manifestName("@campaign", "gemfall")).toBe("_gemfall");
    expect(manifestName("@help", "help")).toBe("_help");
    expect(manifestPath("bramblewood-01")).toBe("/content/voice/manifest/bramblewood-01.json");
  });
});

describe("variant keys", () => {
  it("match the order the tools write them", () => {
    expect(variantKey(undefined)).toBe("");
    expect(variantKey({ party: "2" })).toBe("party=2");
    expect(variantKey({ facets: "3" })).toBe("facets=3");
    expect(variantKey({ facets: "3", party: "2" })).toBe("party=2,facets=3");
  });
});

describe("the playlist for a scene", () => {
  const manifest: VoiceManifest = {
    "ch/s1/narration": { "": [{ clip: KEY, ms: 1000 }] },
    "ch/s1/variants/0": { "party=2": [{ clip: OTHER, ms: 500 }, { clip: KEY, ms: 250 }] },
  };

  it("plays every part's clips in order", () => {
    const parts = [
      { address: "ch/s1/narration", line: "A." },
      { address: "ch/s1/variants/0", line: "{party} go.", token: { party: "2" } },
    ];
    expect(playlistFor(parts, manifest)?.map((c) => c.clip)).toEqual([KEY, OTHER, KEY]);
  });

  it("sends the whole utterance to the device voice when any part is not recorded", () => {
    const recorded = { address: "ch/s1/narration", line: "A." };
    expect(playlistFor([recorded, { line: "Run-time spoils." }], manifest)).toBeNull();
    expect(playlistFor([recorded, { address: "ch/s1/variants/0", line: "{party} go.", token: { party: "3" } }], manifest)).toBeNull();
    expect(playlistFor([recorded, { address: "ch/gone/narration", line: "B." }], manifest)).toBeNull();
    expect(playlistFor([], manifest)).toBeNull();
    expect(playlistFor([recorded], {})).toBeNull();
  });
});

describe("where an address is filed", () => {
  it("names the manifest each kind of line lives in", () => {
    expect(manifestOfAddress("bramblewood-01/scene_pib/narration")).toBe("bramblewood-01");
    expect(manifestOfAddress("bramblewood-01/@plate")).toBe("bramblewood-01");
    expect(manifestOfAddress("gemfall/@prologue/2")).toBe("_gemfall");
    expect(manifestOfAddress("gemfall/@epilogue/cure/0")).toBe("_gemfall");
    expect(manifestOfAddress("gemfall/@lastTime/opener")).toBe("_gemfall");
    expect(manifestOfAddress("help/join")).toBe("_help");
    expect(manifestOfAddress("")).toBeNull();
    expect(manifestOfAddress(undefined)).toBeNull();
    expect(manifestOfAddress("@help/x")).toBeNull();
  });

  it("files help by screen, by kind of thing, and by card, and leaves a thing's own words to the device voice", () => {
    expect(helpAddress("story", null)).toBe("help/surfaces/story");
    expect(helpAddress("story", { kind: "item" })).toBe("help/things/item");
    expect(helpAddress("story", { kind: "item", text: "Still warm." })).toBeNull();
    expect(howToPlayAddress(3)).toBe("help/howToPlay/3");
  });
});
