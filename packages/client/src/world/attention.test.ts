/**
 * Who the camera holds during a round.
 *
 * Pure over events, like the shake's beat table and for the same reason: the
 * frame, the flinch and the damage number all read one clock, and the only
 * way to know they agree is to assert the schedules against each other.
 */

import { describe, expect, it } from "vitest";
import type { EncounterEvent } from "@kad/shared";
import { beatOffsetsMs } from "./board-math";
import { impactBeats } from "./shake";
import { beatSubjects, FOCUS_HOLD_MS, focusHolds } from "./attention";

const damage = { type: "damage", actorId: "wisp-0", amount: 3, hp: 3 } as EncounterEvent;
const moved = { type: "moved", actorId: "c_1", to: { x: 1, y: 1 } } as EncounterEvent;
const roll = { type: "roll", roll: { characterId: "c_1" } } as unknown as EncounterEvent;
const evaded = { type: "evaded", actorId: "c_1", byId: "wisp-0" } as EncounterEvent;
const walled = { type: "walled", at: { x: 2, y: 2 } } as EncounterEvent;

describe("who a beat is about", () => {
  it("names the figure it happened to", () => {
    expect(beatSubjects(damage)).toEqual(["wisp-0"]);
    expect(beatSubjects({ type: "down", actorId: "c_1" } as EncounterEvent)).toEqual(["c_1"]);
  });

  it("names both figures when two are involved", () => {
    // A Vanish that framed only the dodger would show somebody stepping aside
    // from nothing; a Brace, somebody guarding thin air.
    expect(beatSubjects(evaded)).toEqual(["c_1", "wisp-0"]);
    expect(beatSubjects({ type: "protected", actorId: "c_1", byId: "c_2" } as EncounterEvent)).toEqual([
      "c_1",
      "c_2",
    ]);
  });

  it("names nobody for a beat with no figure in it", () => {
    // The roll's swing is already framed by the damage or evade beside it, and
    // a wall is a tile.
    expect(beatSubjects(roll)).toEqual([]);
    expect(beatSubjects(walled)).toEqual([]);
  });
});

describe("the holds a round asks for", () => {
  it("rides the same beat clock as the damage numbers and the jolts", () => {
    /*
     * Three readers, one table. If the frame arrived on a different schedule
     * from the number it is framing, the camera would be showing the right
     * figure at the wrong moment — which is worse than not moving at all.
     */
    const events = [moved, roll, damage];
    const offsets = beatOffsetsMs(events.length, 1900);
    const holds = focusHolds(events, 1900);

    expect(holds.map((hold) => hold.atMs)).toEqual([offsets[0], offsets[2]]);
    const jolt = impactBeats(events, 1900)[0];
    const forDamage = holds.find((hold) => hold.actorIds.includes("wisp-0"));
    expect(forDamage?.atMs).toBe(jolt?.atMs);
  });

  it("lets go, so the frame closes back onto whose turn it is", () => {
    // A camera that kept every figure a round touched would end up framing the
    // whole board — the unreadable thing camera.ts exists to avoid.
    const [hold] = focusHolds([damage], 1000);
    expect(hold?.untilMs).toBe((hold?.atMs ?? 0) + FOCUS_HOLD_MS);
  });

  it("asks for nothing when a round names no figures", () => {
    expect(focusHolds([roll, walled], 1000)).toEqual([]);
  });
});
