import { describe, expect, it } from "vitest";
import {
  ABANDON_AFTER_MS,
  aggregateTimings,
  attemptsOf,
  budgetVerdict,
  cleanNote,
  IDLE_GAP_CAP_MS,
  sampleLabel,
  sittingsFromEvents,
  sittingsFromMarks,
  timingReportFromMarks,
  type TimingMark,
  timingCsv,
  type TimingEvent,
  type TimingNote,
} from "./session-timing.js";

const T0 = Date.parse("2026-10-27T18:00:00.000Z");
const MIN = 60_000;
const at = (ms: number): string => new Date(T0 + ms).toISOString();

const start = (over: Partial<Extract<TimingNote, { kind: "start" }>> = {}): TimingNote => ({
  kind: "start",
  source: "family",
  chapterId: "riftlight-01",
  campaignId: "riftlight",
  revision: "aaaa",
  partySize: 2,
  prefaced: false,
  revisit: false,
  scene: "s1",
  type: "story",
  ...over,
});

function log(...entries: Array<[number, TimingNote]>): TimingEvent[] {
  return entries.map(([ms, timing], i) => ({ seq: i + 1, at: at(ms), timing }));
}

const one = (events: TimingEvent[], now = T0 + 24 * 60 * MIN) => {
  const [first] = sittingsFromEvents("run1", events, now);
  if (!first) throw new Error("no sitting");
  return first;
};

describe("a sitting's clock", () => {
  it("splits wall into active, idle, paused and unrecorded, and the parts always sum", () => {
    const s = one(
      log(
        [0, start()],
        [2 * MIN, { kind: "step", scene: "s2", type: "check" }],
        [3 * MIN, { kind: "pause" }],
        [33 * MIN, { kind: "resume" }],
        [40 * MIN, { kind: "step", scene: "s3", type: "interaction" }],
        [41 * MIN, { kind: "off" }],
        [50 * MIN, { kind: "on" }],
        [52 * MIN, { kind: "end", outcome: "success", routes: ["road_a"] }],
      ),
    );
    expect(s.status).toBe("completed");
    expect(s.pausedMs).toBe(30 * MIN);
    expect(s.unrecordedMs).toBe(9 * MIN);
    // 2 + 1 min active before the pause; the 7 min after resume is capped at 5; then 1 and 2.
    expect(s.activeMs).toBe((2 + 1 + 5 + 1 + 2) * MIN);
    expect(s.idleMs).toBe(2 * MIN);
    expect(s.idleGaps).toBe(1);
    expect(s.wallMs).toBe(s.activeMs + s.idleMs + s.pausedMs + s.unrecordedMs);
    expect(s.wallMs).toBe(52 * MIN);
    expect(s.routes).toEqual(["road_a"]);
    expect(s.outcome).toBe("success");
  });

  it("attributes active time to the scene that was open, by bucket", () => {
    const s = one(
      log(
        [0, start()],
        [1 * MIN, { kind: "step", scene: "fight", type: "encounter" }],
        [4 * MIN, { kind: "step", scene: "make", type: "interaction" }],
        [6 * MIN, { kind: "step", scene: "talk", type: "story" }],
        [7 * MIN, { kind: "end", outcome: "success", routes: [] }],
      ),
    );
    expect(s.narrationMs).toBe(2 * MIN);
    expect(s.encounterMs).toBe(3 * MIN);
    expect(s.activityMs).toBe(2 * MIN);
    expect(s.scenes.map((x) => [x.scene, x.activeMs / MIN])).toEqual([["s1", 1], ["fight", 3], ["make", 2], ["talk", 1]]);
  });

  it("counts a reload's duplicate event once, and never runs backwards on a skewed clock", () => {
    const events = log(
      [0, start()],
      [2 * MIN, { kind: "step", scene: "s2", type: "story" }],
      [1 * MIN, { kind: "step", scene: "s3", type: "story" }], // skewed: earlier than its predecessor
      [4 * MIN, { kind: "end", outcome: "success", routes: [] }],
    );
    const dup: TimingEvent[] = [...events, { ...events[1] as TimingEvent }];
    const s = one(dup);
    expect(s.steps).toBe(2);
    expect(s.activeMs).toBe(4 * MIN);
    expect(s.wallMs).toBe(4 * MIN);
  });

  it("is the same however many phones or how many times it is read", () => {
    const events = log([0, start()], [MIN, { kind: "step", scene: "s2", type: "story" }], [2 * MIN, { kind: "end", outcome: "success", routes: [] }]);
    expect(one(events, T0 + 99 * MIN)).toEqual(one(events, T0 + 5 * 24 * 60 * MIN));
  });

  it("ignores a repeated pause and a repeated end", () => {
    const s = one(
      log(
        [0, start()],
        [MIN, { kind: "pause" }],
        [2 * MIN, { kind: "pause" }],
        [10 * MIN, { kind: "resume" }],
        [11 * MIN, { kind: "resume" }],
        [12 * MIN, { kind: "end", outcome: "success", routes: [] }],
        [20 * MIN, { kind: "end", outcome: "success", routes: [] }],
      ),
    );
    expect(s.pauses).toBe(1);
    expect(s.pausedMs).toBe(9 * MIN);
    expect(s.wallMs).toBe(12 * MIN);
  });

  it("counts steps taken while paused but gives them no active time", () => {
    const s = one(
      log(
        [0, start()],
        [MIN, { kind: "pause" }],
        [2 * MIN, { kind: "step", scene: "s2", type: "story" }],
        [3 * MIN, { kind: "resume" }],
        [4 * MIN, { kind: "end", outcome: "success", routes: [] }],
      ),
    );
    expect(s.stepsWhilePaused).toBe(1);
    expect(s.pausedMs).toBe(2 * MIN);
    expect(s.activeMs).toBe(2 * MIN);
  });

  it("reports silence past the cap as idle, not play", () => {
    const s = one(
      log([0, start()], [3 * 60 * MIN, { kind: "step", scene: "s2", type: "story" }], [3 * 60 * MIN + MIN, { kind: "end", outcome: "success", routes: [] }]),
    );
    expect(s.activeMs).toBe(IDLE_GAP_CAP_MS + MIN);
    expect(s.idleMs).toBe(3 * 60 * MIN - IDLE_GAP_CAP_MS);
    expect(s.idleGaps).toBe(1);
  });

  it("keeps an abandoned sitting's unknowable last scene out of the numbers", () => {
    const events = log([0, start()], [4 * MIN, { kind: "step", scene: "s2", type: "story" }]);
    const gone = one(events, T0 + 4 * MIN + ABANDON_AFTER_MS);
    expect(gone.status).toBe("abandoned");
    expect(gone.wallMs).toBe(4 * MIN);
    const live = one(events, T0 + 6 * MIN);
    expect(live.status).toBe("in_progress");
    expect(live.activeMs).toBe(6 * MIN);
  });

  it("marks closed and stopped sittings, and a lone pause tail stays paused", () => {
    expect(one(log([0, start()], [MIN, { kind: "close" }])).status).toBe("closed");
    expect(one(log([0, start()], [MIN, { kind: "stop" }])).status).toBe("saved");
    const s = one(log([0, start()], [MIN, { kind: "pause" }]), T0 + 20 * MIN);
    expect(s.pausedMs).toBe(19 * MIN);
    expect(s.activeMs).toBe(MIN);
  });

  it("starts a second sitting for a second chapter in the same room", () => {
    const events = log(
      [0, start()],
      [MIN, { kind: "end", outcome: "success", routes: [] }],
      [5 * MIN, start({ chapterId: "riftlight-02", scene: "t1" })],
      [6 * MIN, { kind: "end", outcome: "setback", routes: [] }],
    );
    const all = sittingsFromEvents("run1", events, T0 + 60 * MIN);
    expect(all.map((x) => [x.chapterId, x.outcome, x.wallMs / MIN])).toEqual([["riftlight-01", "success", 1], ["riftlight-02", "setback", 1]]);
  });

  it("keeps the latest note, and counts recoveries and assisted steps", () => {
    const s = one(
      log(
        [0, start()],
        [MIN, { kind: "step", scene: "s2", type: "interaction", result: "assisted" }],
        [2 * MIN, { kind: "step", scene: "s3", type: "check", result: "recovery" }],
        [3 * MIN, { kind: "note", text: "needed help with the clue" }],
        [4 * MIN, { kind: "note", text: "wanted another turn" }],
        [5 * MIN, { kind: "end", outcome: "success", routes: [] }],
      ),
    );
    expect(s.note).toBe("wanted another turn");
    expect([s.assisted, s.recoveries]).toEqual([1, 1]);
  });
});

describe("cleanNote", () => {
  it("trims, flattens and caps, and refuses nothing", () => {
    expect(cleanNote("  needed\n help  ")).toBe("needed help");
    expect(cleanNote("x".repeat(500))?.length).toBe(140);
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(7)).toBeNull();
  });
});

describe("attempts and aggregates", () => {
  const sit = (id: string, over: Record<string, unknown> = {}) => {
    const events = log(
      [0, start(over as Partial<Extract<TimingNote, { kind: "start" }>>)],
      [3 * MIN, { kind: "step", scene: "s2", type: "story" }],
      [8 * MIN, { kind: "end", outcome: "success", routes: [] }],
    );
    return sittingsFromEvents(id, events, T0 + 60 * MIN)[0]!;
  };

  it("chains a stopped game and its resume into one attempt", () => {
    const a = sittingsFromEvents("a", log([0, start()], [4 * MIN, { kind: "stop" }]), T0 + 99 * MIN)[0]!;
    const b = sittingsFromEvents("b", log([0, start({ resumedFrom: a.id })], [3 * MIN, { kind: "end", outcome: "success", routes: [] }]), T0 + 99 * MIN)[0]!;
    const attempts = attemptsOf([a, b]);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ kind: "resumed", completed: true, activeMs: 7 * MIN });
  });

  it("never mixes revisions, sources, revisits or resumes into the fresh figure", () => {
    const rows = [sit("1"), sit("2"), sit("3"), sit("4", { revisit: true }), sit("5", { revision: "bbbb" }), sit("6", { source: "playtest" })];
    const aggs = aggregateTimings(rows);
    expect(aggs).toHaveLength(3);
    const main = aggs.find((x) => x.revision === "aaaa" && x.source === "family")!;
    expect(main.attempts).toBe(4);
    expect(main.kinds).toEqual({ fresh: 3, revisit: 1, resumed: 0 });
    expect(main.freshActiveMs?.n).toBe(3);
    expect(main.revisitActiveMs?.n).toBe(1);
    expect(main.scenes[0]?.scene).toBe("s2");
    expect(aggs.find((x) => x.source === "playtest")?.attempts).toBe(1);
  });

  it("labels small samples and does not call them proof", () => {
    expect(sampleLabel(0)).toBe("no data");
    expect(sampleLabel(2)).toContain("too few");
    expect(sampleLabel(5)).toContain("preliminary");
    expect(sampleLabel(9)).toBe("n=9");
    const agg = aggregateTimings([sit("1"), sit("2")])[0]!;
    expect(agg.sample).toBe("too_few");
    expect(budgetVerdict(agg)).toContain("not evidence yet");
    expect(budgetVerdict({ freshActiveMs: null, sample: "none" })).toBe("no completed fresh attempts yet");
  });
});

describe("timingCsv", () => {
  it("writes one row per sitting and neutralises a formula in a note", () => {
    const s = one(log([0, start()], [MIN, { kind: "note", text: '=HYPERLINK("x"), hi' }], [2 * MIN, { kind: "end", outcome: "success", routes: ["a", "b"] }]));
    const [head, row] = timingCsv([s]).trim().split("\n");
    expect(head?.split(",")).toHaveLength(27);
    expect(row).toContain('"\'=HYPERLINK(""x""), hi"');
    expect(row).toContain("a b");
  });
});

describe("marks from a table", () => {
  const mark = (runId: string, seq: number, ms: number, timing: TimingNote): TimingMark => ({ runId, chapterId: "riftlight-01", seq, at: at(ms), timing });

  it("rebuilds each run's sittings from marks in any order, across runs", () => {
    const marks = [
      mark("B", 2, 10 * MIN, { kind: "end", outcome: "success", routes: [] }),
      mark("A", 1, 0, start()),
      mark("B", 1, 5 * MIN, start({ partySize: 1 })),
      mark("A", 2, 3 * MIN, { kind: "end", outcome: "setback", routes: [] }),
    ];
    const sittings = sittingsFromMarks(marks, T0 + 60 * MIN);
    expect(sittings.map((s) => [s.id, s.partySize, s.outcome])).toEqual([["B:1", 1, "success"], ["A:1", 2, "setback"]]);
  });

  it("answers in the shape the export and the author tool read", () => {
    const report = timingReportFromMarks([mark("A", 1, 0, start())], T0 + MIN, "family");
    expect(report).toMatchObject({ enabled: true, source: "family", truncated: false });
    expect(report.aggregates[0]).toMatchObject({ chapterId: "riftlight-01", attempts: 1 });
    expect(JSON.stringify(report)).not.toMatch(/household|player/i);
  });
});
