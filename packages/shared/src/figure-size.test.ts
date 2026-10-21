import { describe, expect, it } from "vitest";
import { SIZE_BAND_CM, heightInBand } from "./figure-size.js";

describe("heightInBand", () => {
  it("keeps the figure's own height when the band already holds it", () => {
    expect(heightInBand(160, "medium")).toBe(160);
    expect(heightInBand(160, undefined)).toBe(160);
  });

  it("moves a figure to the nearest edge of the band it is asked to be", () => {
    // A faun child: "small" is knee height, so the tallest small thing.
    expect(heightInBand(160, "small")).toBe(SIZE_BAND_CM.small[1]);
    // A tiny sprite asked to be large stands at the bottom of large.
    expect(heightInBand(25, "large")).toBe(SIZE_BAND_CM.large[0]);
  });

  it("orders its bands smallest first, each one a real range", () => {
    const bands = Object.values(SIZE_BAND_CM);
    for (const [low, high] of bands) expect(low).toBeLessThan(high);
    for (let i = 1; i < bands.length; i++) expect(bands[i]![0]).toBeGreaterThanOrEqual(bands[i - 1]![0]);
  });
});
