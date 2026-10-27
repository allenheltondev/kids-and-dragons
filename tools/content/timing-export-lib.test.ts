import { describe, expect, it } from "vitest";
import { exportReport, sittingsFromItems, type TimedEventItem } from "./timing-export-lib.ts";

const T0 = Date.parse("2026-10-27T18:00:00.000Z");
const MIN = 60_000;
const item = (run: string, seq: number, ms: number, timing: unknown): TimedEventItem => ({
  PK: `RUN#${run}`,
  SK: `EVT#${String(seq).padStart(9, "0")}`,
  data: { seq, at: new Date(T0 + ms).toISOString(), timing: timing as never },
});
const start = { kind: "start", source: "family", chapterId: "c1", campaignId: "k", revision: "r1", partySize: 3, prefaced: false, revisit: false, scene: "a", type: "story" };

describe("operator timing export", () => {
  const items = [
    item("A", 1, 0, start),
    item("A", 2, 2 * MIN, { kind: "step", scene: "b", type: "check" }),
    item("A", 3, 6 * MIN, { kind: "end", outcome: "success", routes: [] }),
    item("B", 1, 10 * MIN, { ...start, partySize: 1 }),
    // Not timed run events: ignored, never an error.
    { PK: "HH#h", SK: "META" },
    { PK: "RUN#A", SK: "STATE", data: {} },
    { PK: "RUN#A", SK: "EVT#000000009", data: { seq: 9, at: "x" } },
  ] satisfies TimedEventItem[];

  it("rebuilds each run's sittings and ignores everything else", () => {
    const sittings = sittingsFromItems(items, T0 + 60 * MIN);
    expect(sittings.map((s) => [s.id, s.status, s.partySize])).toEqual([["B:1", "in_progress", 1], ["A:1", "completed", 3]]);
  });

  it("answers in the shape content:timing reads, with no household or player ids", () => {
    const report = exportReport(items, T0 + 60 * MIN);
    expect(report.aggregates[0]).toMatchObject({ chapterId: "c1", revision: "r1", attempts: 2, completed: 1 });
    expect(JSON.stringify(report)).not.toMatch(/HH#|h_test|playerId|householdId/);
  });
});
