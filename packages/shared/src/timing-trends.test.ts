import { describe, expect, it } from "vitest";
import { aggregateActivities, aggregateSceneTypes, timingFindings } from "./play-timing.js";
import { aggregateTimings, sittingsFromEvents, type SittingSummary, type TimingNote } from "./session-timing.js";
import { compareRevisions, judgeChange, timingTrends } from "./timing-trends.js";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
// A Wednesday.
const T0 = Date.parse("2026-11-04T18:00:00.000Z");

/** A completed sitting: a story scene, then `game` minutes in a memory game, then `rest` minutes of story. */
function sitting(id: string, o: { at?: number; revision?: string; party?: number; story?: number; game?: number; stall?: boolean; status?: "end" | "close" } = {}): SittingSummary {
  const at = o.at ?? T0;
  const story = o.story ?? 10;
  const notes: Array<[number, TimingNote]> = [
    [0, { kind: "start", source: "family", chapterId: "c1", campaignId: "camp", revision: o.revision ?? "a", partySize: o.party ?? 2, prefaced: false, revisit: false, scene: "s1", type: "story" }],
    [story, { kind: "step", scene: "g", type: "interaction", game: "memory" }],
    [story + 1, { kind: "game", scene: "g", phase: "play", attempt: 0 }],
    [story + 1 + (o.game ?? 2), { kind: "game", scene: "g", phase: "result", attempt: 0, outcome: "success" }],
  ];
  let t = story + 2 + (o.game ?? 2);
  notes.push([t, { kind: "step", scene: "vote", type: "choice_point", result: "success" }]);
  t += o.stall ? 12 : 2;
  if (o.status === "close") notes.push([t, { kind: "close" }]);
  else {
    notes.push([t, { kind: "step", scene: "s9", type: "story" }]);
    notes.push([t + 5, { kind: "end", outcome: "success", routes: [] }]);
  }
  const events = notes.map(([min, timing], i) => ({ seq: i + 1, at: new Date(at + min * MIN).toISOString(), timing }));
  return sittingsFromEvents(id, events, at + 400 * DAY)[0]!;
}

describe("stalls, party sizes and kinds of screen", () => {
  it("counts a silence past the cap against the scene that was open", () => {
    const s = sitting("x", { stall: true });
    expect(s.scenes.find((x) => x.scene === "vote")).toMatchObject({ idleGaps: 1 });
    expect(s.scenes.find((x) => x.scene === "s1")).toMatchObject({ idleGaps: 1 });
  });

  it("finds where tables go quiet, on the chapter's own attempts", () => {
    const rows = [sitting("a", { stall: true, story: 4 }), sitting("b", { stall: true, story: 4 }), sitting("c", { story: 4 })];
    const agg = aggregateTimings(rows)[0]!;
    expect(agg.scenes.find((s) => s.scene === "vote")).toMatchObject({ stalls: 2 });
    const found = timingFindings({ aggregates: aggregateTimings(rows), activities: aggregateActivities(rows) });
    expect(found.find((f) => f.kind === "stalls_here")).toMatchObject({ scene: "vote", severity: "look" });
  });

  it("splits a chapter's minutes by party size", () => {
    const rows = [sitting("a", { party: 2, story: 3 }), sitting("b", { party: 4, story: 4 }), sitting("c", { party: 4, story: 5 })];
    expect(aggregateTimings(rows)[0]!.byPartySize).toEqual({ "2": { n: 1, medianMs: 14 * MIN }, "4": { n: 2, medianMs: 15.5 * MIN } });
  });

  it("rolls every kind of screen up across chapters, per visit", () => {
    const types = aggregateSceneTypes([sitting("a"), sitting("b", { stall: true }), sitting("c", { status: "close" })]);
    const vote = types.find((t) => t.type === "choice_point")!;
    expect(vote).toMatchObject({ visits: 2, stallRate: 0.5 });
    expect(vote.perVisitMs.median).toBe(3.5 * MIN);
    expect(types.find((t) => t.type === "interaction")).toMatchObject({ visits: 2 });
  });
});

describe("timingTrends", () => {
  it("buckets by Monday weeks, oldest first, keeping an empty week as a gap", () => {
    const rows = [sitting("a", { at: T0 }), sitting("b", { at: T0 + DAY, game: 4 }), sitting("c", { at: T0 + 14 * DAY, status: "close" })];
    const weeks = timingTrends(rows);
    expect(weeks.map((w) => [w.from.slice(0, 10), w.started])).toEqual([["2026-11-02", 2], ["2026-11-09", 0], ["2026-11-16", 1]]);
    expect(weeks[0]).toMatchObject({ completed: 2, completionRate: 1, freshCompleted: 2, games: 2, medianGamePlayMs: 3 * MIN });
    expect(weeks[2]).toMatchObject({ completed: 0, leftUnfinished: 1, completionRate: 0, freshActiveMs: null });
    expect(timingTrends(rows, { bucket: "day" })).toHaveLength(15);
    expect(timingTrends(rows, { chapterId: "nope" })).toEqual([]);
  });
});

describe("compareRevisions", () => {
  const report = (rows: SittingSummary[]) => ({ aggregates: aggregateTimings(rows), activities: aggregateActivities(rows) });

  it("calls a change only when both samples are real and the middle halves part", () => {
    const old = [10, 11, 12, 13].map((n, i) => sitting(`o${String(i)}`, { revision: "a", story: n * 2 }));
    const shorter = [3, 4, 5].map((n, i) => sitting(`n${String(i)}`, { revision: "b", story: n, game: 1 }));
    const c = compareRevisions(report([...old, ...shorter]), "c1", "a", "b")!;
    expect(c.chapter.verdict).toBe("shorter");
    expect(c.chapter.deltaMs).toBeLessThan(0);
    expect(c.scenes[0]).toMatchObject({ scene: "s1", n: [4, 3] });
    expect(c.games).toEqual([expect.objectContaining({ scene: "g", game: "memory", beforePlayMs: 2 * MIN, afterPlayMs: MIN })]);
    expect(compareRevisions(report(old), "c1", "a", "b")).toBeNull();
    const few = compareRevisions(report([...old, ...shorter.slice(0, 2)]), "c1", "a", "b")!;
    expect(few.chapter.verdict).toBe("too_few");
  });

  it("says no clear change inside the spread", () => {
    const d = (median: number, p25: number, p75: number) => ({ n: 5, min: p25, p25, median, p75, max: p75 });
    expect(judgeChange(d(30, 25, 35), d(28, 24, 33)).verdict).toBe("no_clear_change");
    expect(judgeChange(d(30, 25, 35), d(40, 36, 44)).verdict).toBe("longer");
  });
});
