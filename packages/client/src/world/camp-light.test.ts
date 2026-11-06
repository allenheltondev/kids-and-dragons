/** Every camp backdrop is lit by its own light (camp-light.ts), and an unknown one by the plains'. */

import { describe, expect, it } from "vitest";
import { camp as campManifest } from "../../../../assets/manifest.json";
import { CAMP_FALLBACK_FAMILY } from "./camp-backdrop";
import { HAZE_FADE, INDOOR_LIGHT, campDepthShade, campLight, litFamilies } from "./camp-light";

const channels = (rgb: number) => [(rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff];

describe("the camp's light", () => {
  it("has a light for every painted backdrop, and the plains' for anything else", () => {
    const painted = campManifest.backdrops.map((b: { family: string }) => b.family);
    expect([...litFamilies()].sort()).toEqual([...painted].sort());
    expect(campLight("somewhere_unpainted")).toBe(campLight(CAMP_FALLBACK_FAMILY));
    expect(campLight(null)).toBe(campLight(CAMP_FALLBACK_FAMILY));
  });

  it("leans the back of the camp toward the painting's haze, and lets a touch of it through", () => {
    const light = campLight("open_plains");
    expect(campDepthShade(light, 0)).toEqual({ tint: light.tint, alpha: 1 });
    const far = campDepthShade(light, 1);
    expect(far.alpha).toBeCloseTo(1 - HAZE_FADE);
    // Every channel moved from the light's tint toward the haze, and not past it.
    for (const shift of [16, 8, 0]) {
      const [t, h, f] = [light.tint, light.haze, far.tint].map((c) => (c >> shift) & 0xff) as [number, number, number];
      expect(Math.abs(f - h)).toBeLessThanOrEqual(Math.abs(t - h));
    }
    // Past either end, clamped.
    expect(campDepthShade(light, 3)).toEqual(far);
  });

  it.each([...litFamilies(), "indoors"])("lights %s plausibly: a dark shade, a pale light, a cast that lies on the ground", (family) => {
    const light = family === "indoors" ? INDOOR_LIGHT : campLight(family);
    // A shadow is the ground's own dark, never black and never pale.
    expect(Math.max(...channels(light.shade))).toBeLessThan(0x90);
    // The light only warms or cools what it falls on; it never dims it by much.
    expect(Math.min(...channels(light.tint))).toBeGreaterThan(0xc0);
    expect(light.depth).toBeGreaterThan(0.2);
    expect(light.depth).toBeLessThanOrEqual(0.6);
    expect(light.blur).toBeGreaterThan(0);
    // Toward the viewer, never longer than the thing that casts it.
    expect(light.reach).toBeGreaterThan(0);
    expect(Math.hypot(light.lean, light.reach)).toBeLessThan(1);
  });
});
