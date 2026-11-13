/**
 * The fire's light on the ground, painted once (camp.ts `fireGlowPixels`):
 * the picture holds, pixel for pixel, what fourteen faint ellipses added one
 * over another came to.
 */

import { describe, expect, it } from "vitest";
import { fireGlowPixels, fireGlowTexture } from "./camp";

/** How many of the fourteen ellipses the old drawing laid over a point, counted the slow way. */
function ringsOver(heightPx: number, x: number, y: number): number {
  let inside = 0;
  for (let ring = 14; ring > 0; ring--) {
    const spread = ring / 14;
    const dx = x / (heightPx * 1.5 * spread);
    const dy = y / (heightPx * 0.34 * spread);
    if (dx * dx + dy * dy <= 1) inside += 1;
  }
  return inside;
}

describe("the firelight as one picture", () => {
  it("holds one ring's orange for every ring a pixel is inside", () => {
    const heightPx = 120;
    const { width, height, data } = fireGlowPixels(heightPx);
    expect(width).toBe(360);
    expect(height).toBe(82);
    let differing = 0;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const rings = ringsOver(heightPx, px + 0.5 - width / 2, py + 0.5 - height / 2);
        const at = (py * width + px) * 4;
        // 0.034 of 0xff9448, as bytes: alpha 8, and 8, 5 and 2 of colour.
        const want = [8 * rings, 5 * rings, 2 * rings, 8 * rings];
        if (want.some((value, i) => data[at + i] !== value)) differing += 1;
      }
    }
    // A pixel whose middle is on a ring's edge may fall either side of it.
    expect(differing).toBeLessThanOrEqual(8);
  });

  it("is brightest in the middle, all fourteen rings deep, and clear at its corners", () => {
    const { width, height, data } = fireGlowPixels(120);
    const middle = ((height / 2) * width + width / 2) * 4;
    expect([...data.slice(middle, middle + 4)]).toEqual([112, 70, 28, 112]);
    expect([...data.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...data.slice(data.length - 4)]).toEqual([0, 0, 0, 0]);
  });

  it("is a texture that names its bytes for what they are: red, green, blue, alpha, premultiplied", () => {
    const texture = fireGlowTexture(120);
    const { width, height } = fireGlowPixels(120);
    expect(texture.source.format).toBe("rgba8unorm");
    expect(texture.source.alphaMode).toBe("premultiplied-alpha");
    expect([texture.source.pixelWidth, texture.source.pixelHeight]).toEqual([width, height]);
    // The middle of the light is more red than blue: orange, whichever way a renderer reads the name.
    const bytes = texture.source.resource as Uint8Array;
    const middle = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    expect(bytes[middle]!).toBeGreaterThan(bytes[middle + 2]!);
    texture.destroy(true);
  });
});
