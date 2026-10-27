import { describe, expect, it } from "vitest";
import { aggregateTimings, sittingsFromEvents, TIMING_POLICY, type TimingEvent, type TimingNote } from "@kad/shared";
import { renderTimingReport } from "./timing-lib.ts";

const T0 = Date.parse("2026-10-27T18:00:00.000Z");
const MIN = 60_000;

function sitting(runId: string, source: "family" | "playtest", revision = "aaaa") {
  const start: TimingNote = { kind: "start", source, chapterId: "riftlight-01", campaignId: "riftlight", revision, partySize: 2, prefaced: false, revisit: false, scene: "s1", type: "story" };
  const events: TimingEvent[] = [
    { seq: 1, at: new Date(T0).toISOString(), timing: start },
    { seq: 2, at: new Date(T0 + 4 * MIN).toISOString(), timing: { kind: "step", scene: "dragon", type: "encounter" } },
    { seq: 3, at: new Date(T0 + 9 * MIN).toISOString(), timing: { kind: "note", text: "wanted another turn" } },
    { seq: 4, at: new Date(T0 + 12 * MIN).toISOString(), timing: { kind: "end", outcome: "success", routes: [] } },
  ];
  return sittingsFromEvents(runId, events, T0 + 60 * MIN);
}

const report = (rows: ReturnType<typeof sitting>) => ({ aggregates: aggregateTimings(rows), generatedAt: "2026-10-27T20:00:00Z", truncated: false, policy: TIMING_POLICY });
const planned = [{ id: "riftlight-01", estimatedMinutes: 30, revision: "aaaa" }];

describe("renderTimingReport", () => {
  it("says a tiny sample is tiny and keeps planned minutes in their own column", () => {
    const text = renderTimingReport(report(sitting("r1", "family")), planned);
    expect(text).toContain("planned: 30 min   budget: 30 min");
    expect(text).toContain("n=1, too few to say anything about the chapter");
    expect(text).toContain("not evidence yet");
    expect(text).toContain("dragon");
    expect(text).toContain("wanted another turn");
    expect(text).toContain("(current text)");
  });

  it("never prints a playtest as a family observation, and only prints it when asked", () => {
    const rows = [...sitting("r1", "family"), ...sitting("r2", "playtest")];
    const families = renderTimingReport(report(rows), planned);
    expect(families).not.toContain("Playtests");
    expect(families.match(/riftlight-01 @/g)).toHaveLength(1);
    const both = renderTimingReport(report(rows), planned, { includePlaytest: true });
    expect(both.indexOf("== Family observations ==")).toBeLessThan(both.indexOf("== Playtests"));
    expect(both.match(/riftlight-01 @/g)).toHaveLength(2);
  });

  it("marks a revision that is no longer the chapter on disk, and never merges revisions", () => {
    const rows = [...sitting("r1", "family", "aaaa"), ...sitting("r2", "family", "bbbb")];
    const text = renderTimingReport(report(rows), [{ ...planned[0]!, revision: "bbbb" }]);
    expect(text).toContain("riftlight-01 @ aaaa (an older text of this chapter)");
    expect(text).toContain("riftlight-01 @ bbbb (current text)");
  });

  it("says plainly when there is nothing yet", () => {
    expect(renderTimingReport(report([]), planned)).toContain("none yet");
  });
});
