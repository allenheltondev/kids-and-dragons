import { describe, expect, it } from "vitest";
import type { SittingSummary } from "@kad/shared";
import { currentSitting, minutesLabel, sittingSentence, splitSentence } from "./session-clock";

const MIN = 60_000;
const sitting = (over: Partial<SittingSummary> = {}): SittingSummary =>
  ({ id: "r_1:3", activeMs: 31 * MIN, pausedMs: 0, idleMs: 0, narrationMs: 0, activityMs: 0, encounterMs: 0, ...over }) as SittingSummary;

describe("the session clock in words", () => {
  it("rounds to minutes and never says zero", () => {
    expect(minutesLabel(20_000)).toBe("under a minute");
    expect(minutesLabel(MIN)).toBe("about a minute");
    expect(minutesLabel(31.4 * MIN)).toBe("about 31 minutes");
  });

  it("mentions a pause or silence only when it was worth mentioning", () => {
    expect(sittingSentence(sitting())).toBe("You played for about 31 minutes.");
    expect(sittingSentence(sitting({ pausedMs: 20 * MIN }))).toBe("You played for about 31 minutes, with about 20 minutes paused.");
    expect(sittingSentence(sitting({ idleMs: 9 * MIN }))).toContain("sitting quiet that did not count");
  });

  it("splits the time only when more than one part had a real share", () => {
    expect(splitSentence(sitting({ narrationMs: 20 * MIN }))).toBeNull();
    expect(splitSentence(sitting({ narrationMs: 20 * MIN, encounterMs: 5 * MIN }))).toBe(
      "Mostly: story and choices about 20 minutes, fights about 5 minutes.",
    );
  });

  it("finds this room's latest sitting by run id", () => {
    const report = { sittings: [sitting({ id: "r_2:9" }), sitting({ id: "r_1:3" }), sitting({ id: "r_1:40" })] };
    expect(currentSitting(report, "r_1")?.id).toBe("r_1:40");
    expect(currentSitting(report, "r_9")).toBeNull();
    expect(currentSitting(null, "r_1")).toBeNull();
  });
});
