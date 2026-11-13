import { describe, expect, it } from "vitest";
import type { Presentation } from "@kad/shared";
import { holdFor, presentationDuration } from "./presentation";

const enter = { kind: "SCENE_ENTER" } as Presentation;
const roll = { kind: "ROLL", roll: {} } as Presentation;

describe("holdFor", () => {
  it("holds for the presentation's own time when nothing is waiting", () => {
    expect(holdFor(enter)).toBe(presentationDuration(enter));
    expect(holdFor(roll, 0)).toBe(presentationDuration(roll));
  });

  it("lets a transition go when the screen is behind, but never a roll", () => {
    expect(holdFor(enter, 2)).toBe(0);
    expect(holdFor({ kind: "CHOICE_MADE" } as Presentation, 1)).toBe(0);
    expect(holdFor(roll, 3)).toBe(presentationDuration(roll));
  });
});
