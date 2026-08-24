/**
 * The presentation → cue table. The property that matters is exhaustiveness:
 * the type system already forces every kind to have a row, and this file
 * pins the rows that carry meaning plus the agreement between this table and
 * the hold table the renderer paces itself by.
 */

import { describe, expect, it } from "vitest";
import type { Presentation } from "@kad/shared";
import { PRESENTATION_MS } from "../world/presentation";
import { cueForPresentation, PRESENTATION_CUES } from "./cues";

describe("what each beat sounds like", () => {
  it("gives the dice their rattle", () => {
    const roll = { kind: "ROLL" } as Presentation;
    expect(cueForPresentation(roll)).toBe("dice");
  });

  it("marks the enemy round once, not once per hit", () => {
    // COMBAT_SEQUENCE carries the whole round; a cue per inner event would be
    // a drum roll of identical thuds.
    const round = { kind: "COMBAT_SEQUENCE", events: [] } as unknown as Presentation;
    expect(cueForPresentation(round)).toBe("attack");
  });

  it("scores the two fanfares and the ending", () => {
    expect(PRESENTATION_CUES.LEVEL_UP).toBe("level-up");
    expect(PRESENTATION_CUES.TRANSFORM).toBe("transform");
    expect(PRESENTATION_CUES.CHAPTER_COMPLETE).toBe("victory");
  });

  it("covers exactly the kinds the hold table covers", () => {
    /*
     * Two tables describe every presentation — how long it holds
     * (world/presentation.ts) and what it sounds like (here). A kind added to
     * one and not the other means a beat that is timed but silent, or scored
     * but skipped. TypeScript enforces each Record separately; this pins that
     * they enumerate the same world.
     */
    expect(Object.keys(PRESENTATION_CUES).sort()).toEqual(Object.keys(PRESENTATION_MS).sort());
  });
});
