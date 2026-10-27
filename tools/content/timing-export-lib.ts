/**
 * Operator export of session timing across every household (#511).
 *
 * The game's own `GET /api/timing` is one household's, behind a device token.
 * This reads the table itself: every event that carries a timing note, from
 * every run, grouped back into sittings with the same pure code the server
 * uses. It is read-only, and it is for whoever holds AWS credentials for the
 * stack; the output has no household ids, player ids or names (run ids only,
 * which are random).
 */

import {
  aggregateTimings,
  sittingsFromEvents,
  TIMING_POLICY,
  type SittingSummary,
  type TimingEvent,
  type TimingReport,
} from "@kad/shared";

/** The attributes a scan returns for one timed event (`PK`, `SK`, and `data.{seq,at,timing}`). */
export interface TimedEventItem {
  PK: string;
  SK: string;
  data?: { seq?: number; at?: string; timing?: TimingEvent["timing"] };
}

/** Sittings from scanned events, newest first. Items that are not timed run events are ignored. */
export function sittingsFromItems(items: readonly TimedEventItem[], nowMs: number): SittingSummary[] {
  const byRun = new Map<string, TimingEvent[]>();
  for (const item of items) {
    const { data } = item;
    if (!item.PK.startsWith("RUN#") || !item.SK.startsWith("EVT#") || !data?.timing) continue;
    if (typeof data.seq !== "number" || typeof data.at !== "string") continue;
    const runId = item.PK.slice("RUN#".length);
    byRun.set(runId, [...(byRun.get(runId) ?? []), { seq: data.seq, at: data.at, timing: data.timing }]);
  }
  const sittings = [...byRun].flatMap(([runId, events]) => sittingsFromEvents(runId, events, nowMs));
  return sittings.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The same shape `GET /api/timing` answers, so `content:timing` reads either. */
export function exportReport(items: readonly TimedEventItem[], nowMs: number): TimingReport {
  const sittings = sittingsFromItems(items, nowMs);
  return {
    enabled: true,
    source: null,
    policy: TIMING_POLICY,
    generatedAt: new Date(nowMs).toISOString(),
    sittings,
    aggregates: aggregateTimings(sittings),
    truncated: false,
  };
}
