/**
 * The shake maths — pure, like camera.ts, and tested the same way: the whole
 * curve is assertable because nothing in it is random.
 */

import { describe, expect, it } from "vitest";
import type { Presentation } from "@kad/shared";
import { PRESENTATION_MS } from "./presentation";
import {
  advanceShake,
  PRESENTATION_SHAKES,
  SHAKE_DURATION_S,
  shakeOffset,
  shakeStrengthFor,
  startShake,
} from "./shake";

describe("what hits how hard", () => {
  it("covers exactly the kinds the hold table covers", () => {
    // Same agreement contract as the cue table: three Records describe every
    // presentation, and they must enumerate the same world.
    expect(Object.keys(PRESENTATION_SHAKES).sort()).toEqual(Object.keys(PRESENTATION_MS).sort());
  });

  it("makes going down the hardest hit, per §7.3's weight on the moment", () => {
    const strengths = Object.values(PRESENTATION_SHAKES);
    expect(PRESENTATION_SHAKES.DOWN).toBe(Math.max(...strengths));
  });

  it("does not flinch at a heal, a roll, or a fanfare", () => {
    // A screen that shakes at everything has stopped saying anything.
    expect(shakeStrengthFor({ kind: "HEAL" } as Presentation)).toBe(0);
    expect(shakeStrengthFor({ kind: "ROLL" } as Presentation)).toBe(0);
    expect(shakeStrengthFor({ kind: "LEVEL_UP" } as Presentation)).toBe(0);
  });
});

describe("the jolt's life", () => {
  it("starts loud and rings down to nothing by the end", () => {
    const shake = startShake(null, 1)!;
    const early = shakeOffset(advanceShake(shake, 0.02), 900);
    const late = shakeOffset(advanceShake(shake, SHAKE_DURATION_S * 0.9), 900);
    expect(Math.hypot(early.x, early.y)).toBeGreaterThan(0);
    expect(Math.hypot(late.x, late.y)).toBeLessThan(Math.hypot(early.x, early.y));
  });

  it("ends, exactly", () => {
    const shake = startShake(null, 1);
    expect(advanceShake(shake, SHAKE_DURATION_S)).toBeNull();
    expect(shakeOffset(null, 900)).toEqual({ x: 0, y: 0 });
  });

  it("keeps the stronger of two overlapping hits instead of stacking them", () => {
    // Two hits in one beat should read as one good flinch, not an earthquake.
    const strong = startShake(null, 1)!;
    const kept = startShake(strong, 0.3);
    expect(kept).toBe(strong);
    // But a hard hit does replace a faded one.
    const faded = advanceShake(strong, SHAKE_DURATION_S * 0.95)!;
    const replaced = startShake(faded, 0.8)!;
    expect(replaced.age).toBe(0);
    expect(replaced.strength).toBe(0.8);
  });

  it("treats zero strength as no jolt at all", () => {
    expect(startShake(null, 0)).toBeNull();
    const ringing = startShake(null, 0.5);
    expect(startShake(ringing, 0)).toBe(ringing);
  });

  it("scales with the pane, so a phone flinches like a TV", () => {
    const shake = advanceShake(startShake(null, 1), 0.02)!;
    const tv = shakeOffset(shake, 1080);
    const phone = shakeOffset(shake, 360);
    expect(Math.hypot(tv.x, tv.y) / Math.hypot(phone.x, phone.y)).toBeCloseTo(3);
  });
});
