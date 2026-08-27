/**
 * The frame meter's arithmetic.
 *
 * Pure, so the thresholds can be argued with in a test rather than by staring
 * at a television. The claim under test throughout: an *average* cannot tell
 * you whether the game felt bad, so the reading has to carry the worst frame
 * and the late count.
 */

import { describe, expect, it } from "vitest";
import { createFrameStats, FRAME_BUDGET_MS, verdictOf } from "./frame-stats";

const feed = (stats: ReturnType<typeof createFrameStats>, ms: number, times: number): void => {
  for (let i = 0; i < times; i += 1) stats.push(ms);
};

describe("reading frames", () => {
  it("says nothing before it has seen a frame", () => {
    expect(createFrameStats().read()).toEqual({ fps: 0, worstMs: 0, dropped: 0, samples: 0 });
  });

  it("turns a steady 16.7ms into 60fps", () => {
    const stats = createFrameStats();
    feed(stats, 1000 / 60, 60);
    const reading = stats.read();
    expect(Math.round(reading.fps)).toBe(60);
    expect(reading.dropped).toBe(0);
  });

  it("keeps the hitch that the average hides", () => {
    /*
     * The whole reason this is not one number: sixty frames at 8ms and one at
     * 200ms averages to 11ms and reads as fine. What the table saw was a
     * hitch exactly as the dice landed.
     */
    const stats = createFrameStats();
    feed(stats, 8, 60);
    stats.push(200);
    const reading = stats.read();
    expect(reading.fps).toBeGreaterThan(60); // the average still looks great
    expect(reading.worstMs).toBe(200); // and the hitch is still on the record
    expect(reading.dropped).toBe(1);
  });

  it("forgets frames older than its window", () => {
    // A meter that remembers a hitch from two minutes ago is describing a
    // moment nobody is in any more.
    const stats = createFrameStats(4);
    stats.push(500);
    feed(stats, 10, 4);
    expect(stats.read().worstMs).toBe(10);
    expect(stats.read().samples).toBe(4);
  });

  it("ignores a backgrounded tab rather than reporting it as a stall", () => {
    // Coming back after five minutes is one enormous delta and no frames were
    // dropped — nobody was watching.
    const stats = createFrameStats();
    feed(stats, 16, 10);
    stats.push(300_000);
    stats.push(Number.NaN);
    stats.push(-4);
    expect(stats.read().samples).toBe(10);
  });
});

describe("the verdict", () => {
  const reading = (fps: number, worstMs: number, dropped: number, samples = 120) => ({
    fps,
    worstMs,
    dropped,
    samples,
  });

  it("calls a clean run smooth", () => {
    expect(verdictOf(reading(60, 18, 2))).toBe("smooth");
  });

  it("calls an occasional long frame uneven, not broken", () => {
    // A GC pause or a texture upload is a normal browser, not a problem to
    // chase — but it is worth seeing when it happens every scene change.
    expect(verdictOf(reading(58, FRAME_BUDGET_MS * 4, 20))).toBe("uneven");
  });

  it("calls a genuinely slow run struggling", () => {
    expect(verdictOf(reading(30, 60, 90))).toBe("struggling");
  });

  it("does not call an empty window anything worse than smooth", () => {
    // Before the first frames arrive there is nothing to complain about, and
    // a meter that opens on red teaches everyone to ignore it before it has
    // said anything true.
    expect(verdictOf(reading(0, 0, 0, 0))).toBe("smooth");
  });
});
