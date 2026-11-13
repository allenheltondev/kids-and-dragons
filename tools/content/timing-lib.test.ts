import { describe, expect, it } from "vitest";
import { aggregateActivities, aggregateTimings, sittingsFromEvents, TIMING_POLICY, type TimingEvent, type TimingNote } from "@kad/shared";
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

describe("mini-games, fights and findings", () => {
  /** A sitting with a memory game that takes five minutes of play and an eight-round fight. */
  function played(runId: string) {
    const notes: Array<[number, TimingNote]> = [
      [0, { kind: "start", source: "family", chapterId: "riftlight-01", campaignId: "riftlight", revision: "aaaa", partySize: 2, prefaced: false, revisit: false, scene: "s1", type: "story" }],
      [1, { kind: "step", scene: "jar", type: "interaction", game: "memory" }],
      [2, { kind: "game", scene: "jar", phase: "play", attempt: 0 }],
      [7, { kind: "game", scene: "jar", phase: "result", attempt: 0, outcome: "failure" }],
      [8, { kind: "step", scene: "dragon", type: "encounter", result: "recovery" }],
      [9, { kind: "fight", scene: "dragon", phase: "begin", round: 1, foes: 1, foeKinds: ["dragon"] }],
      ...Array.from({ length: 7 }, (_, i): [number, TimingNote] => [10 + i, { kind: "fight", scene: "dragon", phase: "round", round: i + 2 }]),
      [18, { kind: "step", scene: "after", type: "story", fight: { outcome: "victory", round: 8 } }],
      [20, { kind: "end", outcome: "success", routes: [] }],
    ];
    return sittingsFromEvents(runId, notes.map(([min, timing], i) => ({ seq: i + 1, at: new Date(T0 + min * MIN).toISOString(), timing })), T0 + 60 * MIN);
  }

  it("prints each chapter's games and fights, the roll-up across chapters, and the findings", () => {
    const rows = [...played("a"), ...played("b"), ...played("c")];
    const text = renderTimingReport({ ...report(rows), activities: aggregateActivities(rows) }, planned);
    expect(text).toMatch(/jar\s+memory\s+1\.0 \/ 5\.0 \/ 1\.0, 0 retried, 3 failed/);
    expect(text).toMatch(/dragon\s+1\.0 \/ 9\.0, 8 rounds \(max 8\), 0 lost/);
    expect(text).toContain("== Mini-games and fights across chapters (family) ==");
    expect(text).toContain("[look] The fight at dragon drags");
    expect(text).toContain("[look] The memory game at jar is hard");
    expect(renderTimingReport({ ...report(rows), activities: aggregateActivities(rows) }, planned, { findings: 0 })).not.toContain("== Findings");
  });
});

describe("played across an edit", () => {
  it("lists a stop-and-resume across revisions apart from every figure", () => {
    const base = report(sitting("r1", "family", "aaaa"));
    const text = renderTimingReport(
      { ...base, crossRevision: [{ id: "old:1", source: "family", chapterId: "riftlight-01", revisions: ["aaaa", "bbbb"], status: "completed", completed: true, outcome: "success", activeMs: 25 * MIN, wallMs: 25 * MIN, sittings: 2 }] },
      planned,
    );
    expect(text).toContain("Played across an edit");
    expect(text).toContain("riftlight-01 (family): aaaa -> bbbb; finished, 25.0 min active over 2 sittings");
  });
});
