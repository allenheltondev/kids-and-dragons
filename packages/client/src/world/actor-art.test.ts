import { describe, expect, it } from "vitest";
import { drawContactShadow, shadowOffset } from "./actor-art";

describe("contact shadows", () => {
  const H = 300;

  it("sits among the feet, not in front of them", () => {
    const g = drawContactShadow(H, { x: 0, y: -0.03, halfWidth: 0.2, lift: 0 }, 0.2);
    const b = g.getLocalBounds();
    expect((b.minY + b.maxY) / 2).toBeCloseTo(-0.03 * H);
  });

  it("is as wide as the feet are", () => {
    const narrow = drawContactShadow(H, { x: 0, y: 0, halfWidth: 0.1, lift: 0 }, 0.2).getLocalBounds();
    const wide = drawContactShadow(H, { x: 0, y: 0, halfWidth: 0.25, lift: 0 }, 0.2).getLocalBounds();
    expect(wide.width).toBeGreaterThan(narrow.width * 2);
  });

  it("stays on the ground, smaller, under something hovering", () => {
    const standing = drawContactShadow(H, { x: 0, y: 0, halfWidth: 0.2, lift: 0 }, 0.2).getLocalBounds();
    const hovering = drawContactShadow(H, { x: 0, y: -0.2, halfWidth: 0.2, lift: 0.15 }, 0.2).getLocalBounds();
    expect((hovering.minY + hovering.maxY) / 2).toBeCloseTo(0);
    expect(hovering.width).toBeLessThan(standing.width);
  });

  it("is offset to wherever the feet are in the canvas", () => {
    expect(shadowOffset(H, { x: -0.2, y: 0, halfWidth: 0.1, lift: 0 })).toBeCloseTo(-0.2 * H);
    expect(shadowOffset(H, null)).toBe(0);
  });
});
