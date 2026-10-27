/**
 * What the host's session clock says in words (#511). The numbers are the
 * server's (`TimingReport`, shared/session-timing.ts); this only phrases them
 * for a family: minutes rounded, nothing graded, time never called a score.
 */

import type { SittingSummary, TimingReport } from "@kad/shared";

/** "under a minute", "about 12 minutes". */
export function minutesLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  return minutes === 1 ? "about a minute" : `about ${String(minutes)} minutes`;
}

/** This room's most recent sitting, whichever chapter it is in (ids are `runId:seq`). */
export function currentSitting(report: Pick<TimingReport, "sittings"> | null, runId: string): SittingSummary | null {
  if (!report) return null;
  const mine = report.sittings.filter((s) => s.id.startsWith(`${runId}:`));
  return mine.length === 0 ? null : mine.reduce((a, b) => (Number(b.id.split(":")[1]) > Number(a.id.split(":")[1]) ? b : a));
}

/** The family-facing sentence for a sitting. */
export function sittingSentence(s: SittingSummary): string {
  const play = `You played for ${minutesLabel(s.activeMs)}`;
  const paused = s.pausedMs >= 60_000 ? `, with ${minutesLabel(s.pausedMs)} paused` : "";
  const idle = s.idleMs >= 5 * 60_000 ? ` and ${minutesLabel(s.idleMs)} sitting quiet that did not count` : "";
  return `${play}${paused}${idle}.`;
}

/** Where the time went, only when there is enough of it to say. */
export function splitSentence(s: SittingSummary): string | null {
  const parts: Array<[string, number]> = [
    ["story and choices", s.narrationMs],
    ["activities", s.activityMs],
    ["fights", s.encounterMs],
  ];
  const shown = parts.filter(([, ms]) => ms >= 60_000).map(([name, ms]) => `${name} ${minutesLabel(ms)}`);
  return shown.length > 1 ? `Mostly: ${shown.join(", ")}.` : null;
}
