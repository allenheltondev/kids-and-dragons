/**
 * The shake maths — pure, like camera.ts, and tested the same way: the whole
 * curve is assertable because nothing in it is random.
 */

import { describe, expect, it } from "vitest";
import type { Presentation } from "@kad/shared";
import { PRESENTATION_MS } from "./presentation";
import type { EncounterEvent } from "@kad/shared";
import { beatOffsetsMs } from "./board-math";
import {
  advanceShake,
  impactBeats,
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

  it("gives a sequence no head shake — its impacts are scheduled to their beats", () => {
    // The engine wraps everything a fight does in COMBAT_SEQUENCE, and the
    // board paces those events across the hold. A jolt at the head flinched
    // during the walk-up and was still when the blow actually played.
    expect(shakeStrengthFor({ kind: "COMBAT_SEQUENCE", events: [] } as unknown as Presentation)).toBe(0);
  });
});

describe("where a round's impacts land", () => {
  const damage = { type: "damage", actorId: "a", amount: 3, hp: 4 } as EncounterEvent;
  const down = { type: "down", actorId: "a" } as EncounterEvent;
  const moved = { type: "moved", actorId: "a", to: { x: 1, y: 1 } } as EncounterEvent;
  const roll = { type: "roll", roll: {} } as unknown as EncounterEvent;

  it("schedules nothing for a round of walking and missing", () => {
    const evaded = { type: "evaded", actorId: "a", byId: "b" } as EncounterEvent;
    expect(impactBeats([moved, roll, evaded], 1500)).toEqual([]);
  });

  it("puts each impact on the same beat the board plays it on", () => {
    /*
     * moved → roll → damage → down, the common attack shape. The flinch has
     * to land with the damage number, which rides `beatOffsetsMs` — so the
     * offsets must be exactly that table's, at the impact's own index.
     */
    const events = [moved, roll, damage, down];
    const offsets = beatOffsetsMs(events.length, 1900);
    expect(impactBeats(events, 1900)).toEqual([
      { atMs: offsets[2], strength: 0.7 },
      { atMs: offsets[3], strength: 1 },
    ]);
  });

  it("reads a knockdown as the full hit and a shove as a nudge", () => {
    const shoved = { type: "shoved", actorId: "a", to: { x: 0, y: 0 } } as EncounterEvent;
    const beats = impactBeats([down, shoved], 1000);
    expect(beats.map((beat) => beat.strength)).toEqual([1, 0.45]);
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
