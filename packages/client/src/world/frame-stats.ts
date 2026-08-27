/**
 * What the renderer is actually costing — roadmap chapter 8's "performance
 * pass on the actual TV hardware".
 *
 * ---------------------------------------------------------------------------
 * WHY A METER RATHER THAN A PROFILER
 *
 * The measurement that matters happens on a laptop wired to a television with
 * three phones in the room and a real fight on screen. Nobody is going to be
 * holding devtools open at that moment, and a profile taken later on a
 * different machine measures a different machine. So the numbers are computed
 * in the page, kept tiny, and can be put on screen with a query parameter.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT REPORTS, AND WHY NOT THE AVERAGE
 *
 * An average frame time is the one number that cannot tell you whether the
 * game feels bad. Sixty frames at 8ms and one at 200ms averages to 11ms and
 * reads as fine; what the table saw was a hitch exactly when the dice landed.
 * So this keeps the **worst** frame in the window and the count of frames that
 * missed the budget, which is what a hitch is made of.
 *
 * Pure arithmetic over a rolling window, so the thresholds are testable
 * without a renderer — the same reasoning `camera.ts` and `shake.ts` follow.
 */

/** 60fps. A frame that takes longer than this dropped one. */
export const FRAME_BUDGET_MS = 1000 / 60;

/**
 * How many frames the window holds.
 *
 * Two seconds at 60fps. Long enough that one slow frame does not dominate the
 * reading, short enough that the number still moves while somebody is
 * watching it — a meter that lags reality is a meter nobody trusts.
 */
export const WINDOW_FRAMES = 120;

export interface FrameReading {
  /** Frames per second over the window, from the mean frame time. */
  fps: number;
  /** The slowest frame in the window, in milliseconds. */
  worstMs: number;
  /** How many frames in the window missed the budget. */
  dropped: number;
  /** How many frames the reading is based on. */
  samples: number;
}

export interface FrameStats {
  /** Record one frame's duration. */
  push(ms: number): void;
  read(): FrameReading;
  reset(): void;
}

export function createFrameStats(windowFrames = WINDOW_FRAMES): FrameStats {
  /*
   * A ring buffer rather than an array that shifts: this runs on every frame,
   * and an allocation per frame inside the thing measuring frame cost would
   * be measuring itself.
   */
  const samples = new Float32Array(windowFrames);
  let count = 0;
  let next = 0;

  return {
    push(ms) {
      // A negative or absurd delta is a tab that was backgrounded, a clock
      // that stepped, or a debugger pause. None of them are frame cost.
      if (!Number.isFinite(ms) || ms < 0 || ms > 5000) return;
      samples[next] = ms;
      next = (next + 1) % windowFrames;
      if (count < windowFrames) count += 1;
    },

    read() {
      if (count === 0) return { fps: 0, worstMs: 0, dropped: 0, samples: 0 };
      let total = 0;
      let worst = 0;
      let dropped = 0;
      for (let i = 0; i < count; i += 1) {
        const ms = samples[i] ?? 0;
        total += ms;
        if (ms > worst) worst = ms;
        if (ms > FRAME_BUDGET_MS) dropped += 1;
      }
      const mean = total / count;
      return {
        fps: mean > 0 ? 1000 / mean : 0,
        worstMs: worst,
        dropped,
        samples: count,
      };
    },

    reset() {
      count = 0;
      next = 0;
    },
  };
}

/**
 * How a reading should read to somebody glancing at it from a sofa.
 *
 * Three states, because the only decisions this drives are "carry on", "look
 * at it later" and "something is wrong now". A number with no verdict beside
 * it is a number nobody acts on.
 */
export type FrameVerdict = "smooth" | "uneven" | "struggling";

export function verdictOf(reading: FrameReading): FrameVerdict {
  // Nothing measured yet is not a complaint. A meter that opens on red is a
  // meter everybody learns to ignore before it has said anything true.
  if (reading.samples === 0) return "smooth";
  // Under a tenth of the window missing the budget is a normal browser: a GC
  // pause, a texture upload, a scene change.
  const dropRate = reading.dropped / reading.samples;
  if (reading.fps < 45 || dropRate > 0.35) return "struggling";
  if (dropRate > 0.1 || reading.worstMs > FRAME_BUDGET_MS * 3) return "uneven";
  return "smooth";
}
