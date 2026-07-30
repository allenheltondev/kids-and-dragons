/**
 * The board renderer's arithmetic (world/board-math.ts). Small on purpose —
 * these two functions are the only board logic that is a *promise* rather
 * than a picture: the floor lays the same on every device, and no combat beat
 * ever plays after the patch it belongs to.
 */

import { describe, expect, it } from "vitest";
import { beatOffsetsMs, tileVariant } from "./board-math";

describe("tileVariant", () => {
  it("is deterministic and always names one of the sheet's four variants", () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 10; x++) {
        const variant = tileVariant(x, y);
        expect(variant).toBe(tileVariant(x, y));
        expect(variant).toBeGreaterThanOrEqual(0);
        expect(variant).toBeLessThan(4);
        expect(Number.isInteger(variant)).toBe(true);
      }
    }
  });

  it("actually varies — a floor of one repeated tile reads as a mistake", () => {
    const seen = new Set<number>();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) seen.add(tileVariant(x, y));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("beatOffsetsMs", () => {
  it("keeps every beat strictly inside the presentation hold", () => {
    // 12 events at the 4000ms cap — the crowded-round case the hold scaling
    // exists for (world/presentation.ts).
    const offsets = beatOffsetsMs(12, 4000);
    expect(offsets).toHaveLength(12);
    for (const at of offsets) expect(at).toBeLessThan(4000);
  });

  it("is monotonic, starts after zero, and never spaces wider than one beat", () => {
    const offsets = beatOffsetsMs(3, 4000);
    expect(offsets[0]).toBeGreaterThan(0);
    for (let i = 1; i < offsets.length; i++) {
      const gap = (offsets[i] ?? 0) - (offsets[i - 1] ?? 0);
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(400);
    }
  });

  it("answers nothing for nothing", () => {
    expect(beatOffsetsMs(0, 1000)).toEqual([]);
    expect(beatOffsetsMs(-1, 1000)).toEqual([]);
  });
});
