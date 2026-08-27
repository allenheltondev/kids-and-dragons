/**
 * The frame meter — `?perf` on any surface.
 *
 * Off unless asked for, because a number in the corner of a television during
 * a story is exactly the kind of thing that ends up in a photograph of a
 * child's birthday. Asked for by query parameter rather than a build flag, so
 * the measurement can be taken on the machine that will actually drive the TV,
 * running the bytes that will actually ship — a debug build measures a debug
 * build.
 *
 * It reads the ticker the scene already runs (world/scene.ts), so nothing new
 * is scheduled to measure what is scheduled: an extra rAF loop competing with
 * the renderer would change the number it was reporting.
 */

import { useEffect, useState } from "react";
import { createFrameStats, verdictOf, type FrameReading } from "./frame-stats";
import { onFrame } from "./scene";

import "./FrameMeter.css";

/** Whether this page was asked to measure itself. */
export function perfRequested(search: string): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.has("perf");
}

/** How often the display refreshes. Four times a second is legible without
    the meter itself becoming the busiest thing on the screen. */
const REFRESH_MS = 250;

export function FrameMeter(): React.JSX.Element | null {
  const [reading, setReading] = useState<FrameReading | null>(null);

  useEffect(() => {
    const stats = createFrameStats();
    const stop = onFrame((ms) => { stats.push(ms); });
    const timer = setInterval(() => { setReading(stats.read()); }, REFRESH_MS);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, []);

  if (!reading || reading.samples === 0) return null;
  const verdict = verdictOf(reading);

  return (
    <div className={`kad-frame-meter kad-frame-meter--${verdict}`} role="status">
      <b>{Math.round(reading.fps)}</b> fps
      <span>worst {reading.worstMs.toFixed(1)}ms</span>
      <span>
        {reading.dropped}/{reading.samples} late
      </span>
    </div>
  );
}
