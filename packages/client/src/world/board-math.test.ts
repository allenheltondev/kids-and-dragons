/**
 * The board renderer's pure decisions (world/board-math.ts) — the parts that
 * are a *promise* rather than a picture, and can therefore be asserted instead
 * of watched: the floor lays the same on every device, no combat beat plays
 * after the patch it belongs to, and each beat animates the figure it names.
 */

import { describe, expect, it } from "vitest";
import { beatOffsetsMs, clipForBeat, tileVariant } from "./board-math";

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

describe("clipForBeat", () => {
  /*
   * The beat→clip table (board.ts fires whatever this returns). Every case
   * here is a sentence about what the table should look like, because the
   * alternative way to check it is to start a fight and watch.
   */

  it("flinches the figure that took the damage", () => {
    expect(clipForBeat({ type: "damage", actorId: "c_hero", amount: 3, hp: 7 })).toEqual({
      actorId: "c_hero",
      trigger: "hurt",
    });
  });

  it("swings the figure that rolled", () => {
    // A roll comes from exactly one effect verb — `attack` — so a roll beat is
    // somebody taking a swing, and the roll names them.
    expect(
      clipForBeat({
        type: "roll",
        roll: { characterId: "c_hero", die: 12, mod: 3, total: 15, tn: 11, result: "hit" },
      }),
    ).toEqual({ actorId: "c_hero", trigger: "attack" });
  });

  it("swings the attacker even when the blow is evaded", () => {
    /*
     * Found in review on #31. Vanish resolves *before* any die is thrown, so
     * an evaded attack emits no `roll` at all — and with only the dodger named
     * on the beat, the figure that actually swung animated nothing. `byId` is
     * why the beat carries the attacker (encounter.ts).
     */
    expect(clipForBeat({ type: "evaded", actorId: "c_dodger", byId: "wisp#1" })).toEqual({
      actorId: "wisp#1",
      trigger: "attack",
    });
  });

  it("plants the protector, not the friend being protected", () => {
    expect(clipForBeat({ type: "protected", actorId: "c_friend", byId: "c_guard" })).toEqual({
      actorId: "c_guard",
      trigger: "guard",
    });
  });

  it("plays nothing for a ward — `guard` is a hold, and a ward covers a party", () => {
    /*
     * Unbreakable wards the caster and every ally beside them, and `guard`
     * holds its last pose until the next trigger. Firing it at four figures
     * would freeze the party mid-brace until each of them happened to act.
     */
    expect(clipForBeat({ type: "warded", actorId: "c_friend", amount: 1 })).toBeNull();
  });

  it("plays nothing for conditions, terrain, or state the patch already carries", () => {
    const quiet = [
      { type: "dazed", actorId: "wisp#1" },
      { type: "rooted", actorId: "wisp#1" },
      { type: "encore", actorId: "c_friend" },
      { type: "walled", at: { x: 3, y: 2 } },
      { type: "heal", actorId: "c_hero", amount: 3, hp: 10 },
      { type: "bonus", actorId: "c_hero", amount: 2 },
      { type: "down", actorId: "c_hero" },
      { type: "revived", actorId: "c_hero", hp: 1 },
    ];
    for (const event of quiet) {
      expect(clipForBeat(event), event.type).toBeNull();
    }
  });

  it("leaves motion to the slide — a walk is re-triggered while travelling, not fired once", () => {
    // `walk` is one 4-tick cycle and a move can cross six tiles, so board.ts
    // drives it from the distance left rather than from the beat.
    expect(clipForBeat({ type: "moved", actorId: "c_hero", to: { x: 4, y: 2 } })).toBeNull();
    expect(clipForBeat({ type: "shoved", actorId: "wisp#1", to: { x: 6, y: 2 } })).toBeNull();
  });
});
