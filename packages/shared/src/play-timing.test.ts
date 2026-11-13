import { describe, expect, it } from "vitest";
import { aggregateActivities, FINDING_THRESHOLDS, timingFindings } from "./play-timing.js";
import {
  aggregateTimings,
  applyExclusions,
  IDLE_GAP_CAP_MS,
  sittingsFromEvents,
  timingReportFromMarks,
  type SittingSummary,
  type TimingEvent,
  type TimingMark,
  type TimingNote,
} from "./session-timing.js";

const T0 = Date.parse("2026-11-01T18:00:00.000Z");
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

const sitting = (events: TimingEvent[], id = "run1", now = T0 + 24 * 60 * MIN): SittingSummary => {
  const [first] = sittingsFromEvents(id, events, now);
  if (!first) throw new Error("no sitting");
  return first;
};

/** A sitting that plays one mini-game and one fight, with the minutes given. */
function evening(id: string, o: { ready?: number; play?: number; after?: number; retry?: boolean; outcome?: "success" | "failure" | "assisted"; setup?: number; rounds?: number; fight?: number; lost?: boolean; revisit?: boolean; revision?: string; source?: "family" | "playtest"; startAt?: number } = {}): SittingSummary {
  const t0 = o.startAt ?? 0;
  let t = t0 + MIN;
  const events: Array<[number, TimingNote]> = [[t0, start({ revisit: o.revisit ?? false, revision: o.revision ?? "aaaa", source: o.source ?? "family" })]];
  events.push([t, { kind: "step", scene: "game", type: "interaction", game: "timing" }]);
  t += (o.ready ?? 1) * MIN;
  events.push([t, { kind: "game", scene: "game", phase: "play", attempt: 0 }]);
  if (o.retry) {
    t += MIN;
    events.push([t, { kind: "game", scene: "game", phase: "result", attempt: 0, outcome: "failure" }]);
    events.push([t, { kind: "game", scene: "game", phase: "retry", attempt: 1 }]);
    t += MIN / 2;
    events.push([t, { kind: "game", scene: "game", phase: "play", attempt: 1, relaxed: true }]);
  }
  t += (o.play ?? 2) * MIN;
  events.push([t, { kind: "game", scene: "game", phase: "result", attempt: o.retry ? 1 : 0, outcome: o.outcome ?? "success" }]);
  t += (o.after ?? 0.5) * MIN;
  events.push([t, { kind: "step", scene: "fight", type: "encounter", result: o.outcome === "failure" ? "recovery" : "success" }]);
  t += (o.setup ?? 1) * MIN;
  events.push([t, { kind: "fight", scene: "fight", phase: "begin", round: 1, heroes: 2, foes: 3, foeKinds: ["bramblewisp"] }]);
  const rounds = o.rounds ?? 4;
  const each = ((o.fight ?? 6) * MIN) / rounds;
  for (let r = 2; r <= rounds; r++) {
    t += each;
    events.push([t, { kind: "fight", scene: "fight", phase: "round", round: r }]);
  }
  t += each;
  events.push([t, { kind: "step", scene: "after", type: "story", result: o.lost ? "recovery" : "success", fight: { outcome: o.lost ? "defeat" : "victory", round: rounds } }]);
  t += MIN;
  events.push([t, { kind: "end", outcome: "success", routes: [] }]);
  return sitting(log(...events), id);
}

describe("a mini-game's clock", () => {
  it("splits the scene into the ready screen, play and the result, and the parts add up", () => {
    const s = evening("r", { ready: 1, play: 2, after: 0.5 });
    expect(s.games).toHaveLength(1);
    const g = s.games[0]!;
    expect(g).toMatchObject({ scene: "game", game: "timing", attempts: 1, outcome: "success", finished: true, relaxed: false });
    expect([g.readyMs, g.playMs, g.afterMs].map((ms) => ms / MIN)).toEqual([1, 2, 0.5]);
    expect(g.activeMs).toBe(g.readyMs + g.playMs + g.afterMs);
    expect(g.activeMs).toBe(s.scenes.find((x) => x.scene === "game")!.activeMs);
  });

  it("counts a retry as a second attempt, the waiting before it as ready, and keeps the last outcome", () => {
    const g = evening("r", { retry: true, outcome: "success" }).games[0]!;
    expect(g).toMatchObject({ attempts: 2, outcome: "success", relaxed: true });
    expect(g.readyMs).toBe(1.5 * MIN);
    expect(g.playMs).toBe(3 * MIN);
  });

  it("caps a silence inside a game like any other, and leaves a pause out", () => {
    const s = sitting(
      log(
        [0, start({ scene: "game", type: "interaction", game: "memory" })],
        [MIN, { kind: "game", scene: "game", phase: "play", attempt: 0 }],
        [2 * MIN, { kind: "pause" }],
        [30 * MIN, { kind: "resume" }],
        [50 * MIN, { kind: "game", scene: "game", phase: "result", attempt: 0, outcome: "failure" }],
        [51 * MIN, { kind: "step", scene: "next", type: "story", result: "recovery" }],
      ),
    );
    const g = s.games[0]!;
    expect(g.playMs).toBe(MIN + IDLE_GAP_CAP_MS);
    expect(g).toMatchObject({ outcome: "failure", finished: true, game: "memory" });
  });

  it("reads the outcome off the step when the result was never marked", () => {
    const s = sitting(
      log([0, start()], [MIN, { kind: "step", scene: "g", type: "interaction", game: "relay" }], [3 * MIN, { kind: "step", scene: "n", type: "story", result: "assisted" }]),
    );
    expect(s.games[0]).toMatchObject({ outcome: "assisted", readyMs: 2 * MIN, playMs: 0 });
  });

  it("keeps a game the sitting stopped inside as unfinished, and names where it stopped", () => {
    const s = sitting(log([0, start()], [MIN, { kind: "step", scene: "g", type: "interaction", game: "balance" }], [2 * MIN, { kind: "stop" }]));
    expect(s.games[0]).toMatchObject({ finished: false });
    expect(s.lastScene).toBe("g");
  });

  it("has no rows for a sitting recorded before games and fights were marked", () => {
    const s = sitting(
      log([0, start()], [MIN, { kind: "step", scene: "g", type: "interaction" }], [2 * MIN, { kind: "step", scene: "f", type: "encounter" }], [9 * MIN, { kind: "step", scene: "n", type: "story", result: "success" }]),
    );
    expect([s.games, s.fights]).toEqual([[], []]);
    expect([s.activityMs, s.encounterMs]).toEqual([MIN, 5 * MIN]);
  });
});

describe("a fight's clock", () => {
  it("splits the ready-up from the fight, counts rounds and keeps how it ended", () => {
    const f = evening("r", { setup: 1.5, rounds: 5, fight: 7.5, lost: true }).fights[0]!;
    expect(f).toMatchObject({ scene: "fight", rounds: 5, heroes: 2, foes: 3, foeKinds: ["bramblewisp"], outcome: "defeat", finished: true });
    expect([f.setupMs, f.fightMs].map((ms) => ms / MIN)).toEqual([1.5, 7.5]);
  });

  it("takes a fight that ended with the chapter from the end note", () => {
    const s = sitting(
      log(
        [0, start({ scene: "boss", type: "encounter" })],
        [MIN, { kind: "fight", scene: "boss", phase: "begin", round: 1 }],
        [4 * MIN, { kind: "end", outcome: "success", routes: [], fight: { outcome: "victory", round: 3 } }],
      ),
    );
    expect(s.fights[0]).toMatchObject({ outcome: "victory", rounds: 3, setupMs: MIN, fightMs: 3 * MIN, finished: true });
  });

  it("starts a resume picked up mid-fight in the fight, not its ready-up", () => {
    const s = sitting(
      log([0, start({ scene: "boss", type: "encounter", fighting: true, resumedFrom: "x:1" })], [2 * MIN, { kind: "step", scene: "n", type: "story", fight: { outcome: "escaped", round: 2 } }]),
    );
    expect(s.fights[0]).toMatchObject({ setupMs: 0, fightMs: 2 * MIN, outcome: "escaped" });
  });
});

describe("activities across sittings", () => {
  it("groups by scene and revision, keeping revisits, unfinished visits and playtests apart", () => {
    const rows = [
      evening("a"),
      evening("b", { play: 4 }),
      evening("c", { revisit: true }),
      evening("d", { revision: "bbbb" }),
      evening("e", { source: "playtest" }),
      sitting(log([0, start()], [MIN, { kind: "step", scene: "game", type: "interaction", game: "timing" }], [2 * MIN, { kind: "close" }]), "f"),
    ];
    const acts = aggregateActivities(rows);
    const game = acts.games.find((g) => g.source === "family" && g.revision === "aaaa")!;
    expect(game).toMatchObject({ n: 2, revisits: 1, unfinished: 1, game: "timing" });
    expect(game.playMs.median).toBe(3 * MIN);
    expect(acts.games.filter((g) => g.scene === "game")).toHaveLength(3);
    const fight = acts.fights.find((f) => f.source === "family" && f.revision === "aaaa")!;
    expect(fight).toMatchObject({ n: 2, revisits: 1, foes: 3, outcomes: { victory: 2, defeat: 0, escaped: 0, timedOut: 0 } });
    expect(fight.msPerRound).toBe(1.5 * MIN);
    const kind = acts.gameKinds.find((k) => k.source === "family" && k.game === "timing")!;
    expect(kind).toMatchObject({ n: 3, scenes: 1 });
    expect(acts.fightTotals.find((t) => t.source === "family")).toMatchObject({ n: 3, defeatRate: 0 });
  });
});

describe("findings", () => {
  const report = (sittings: SittingSummary[]) => ({ aggregates: aggregateTimings(sittings), activities: aggregateActivities(sittings) });
  /** The game and fight findings: these toy chapters are short and lopsided, which the chapter findings rightly say. */
  const played = (found: ReturnType<typeof timingFindings>) => found.filter((f) => /^(game|fight)_/.test(f.kind));

  it("says nothing on fewer than three visits, 'look' on a preliminary sample and 'act' on enough", () => {
    const hard = (n: number) => Array.from({ length: n }, (_, i) => evening(`r${String(i)}`, { outcome: "failure", rounds: 9, fight: 12 }));
    expect(timingFindings(report(hard(2)))).toEqual([]);
    const look = played(timingFindings(report(hard(4))));
    expect(new Set(look.map((f) => f.severity))).toEqual(new Set(["look"]));
    expect(look.map((f) => f.kind).sort()).toEqual(["fight_long", "game_hard"]);
    const act = played(timingFindings(report(hard(8))));
    expect(act.every((f) => f.severity === "act")).toBe(true);
    expect(act.find((f) => f.kind === "fight_long")?.suggestion).toMatch(/four rounds/);
  });

  it("flags a slow ready screen and a slow ready-up", () => {
    const rows = Array.from({ length: 3 }, (_, i) => evening(`r${String(i)}`, { ready: FINDING_THRESHOLDS.readyMinutes + 1, setup: FINDING_THRESHOLDS.readyMinutes + 0.5 }));
    expect(played(timingFindings(report(rows))).map((f) => f.kind).sort()).toEqual(["fight_slow_start", "game_slow_start"]);
  });

  it("finds a long chapter, a heavy scene and where tables leave, on the newest revision only", () => {
    const marks: TimingMark[] = [];
    const add = (runId: string, entries: Array<[number, TimingNote]>) =>
      log(...entries).forEach((e) => marks.push({ runId, chapterId: "riftlight-01", seq: e.seq, at: e.at, timing: e.timing as TimingNote }));
    for (let i = 0; i < 3; i++) {
      // 45 minutes, nearly all of it in one story scene; on the newer revision.
      const s = i * 100 * MIN;
      add(`long${String(i)}`, [
        [s, start({ revision: "new" })],
        ...Array.from({ length: 9 }, (_, k): [number, TimingNote] => [s + (k + 1) * 5 * MIN, { kind: "step", scene: `s${String(k + 2)}`, type: "story" }]),
        [s + 50 * MIN, { kind: "end", outcome: "success", routes: [] }],
      ]);
      add(`left${String(i)}`, [[s, start({ revision: "new" })], [s + MIN, { kind: "step", scene: "bog", type: "story" }], [s + 2 * MIN, { kind: "close" }]]);
      add(`old${String(i)}`, [[s - 9999 * MIN, start({ revision: "old" })], [s - 9900 * MIN, { kind: "end", outcome: "success", routes: [] }]]);
    }
    const r = timingReportFromMarks(marks, T0 + 9999 * MIN, null);
    const found = timingFindings(r);
    expect(found.every((f) => f.revision === "new")).toBe(true);
    expect(found.find((f) => f.kind === "chapter_long")).toMatchObject({ severity: "look", chapterId: "riftlight-01" });
    expect(found.find((f) => f.kind === "left_here")).toMatchObject({ scene: "bog" });
    expect(timingFindings(r, { allRevisions: true }).some((f) => f.revision === "old")).toBe(true);
  });
});

describe("exclusions", () => {
  it("drops the whole attempt an excluded sitting belongs to, and says how many it took", () => {
    const a = sitting(log([0, start()], [4 * MIN, { kind: "stop" }]), "a");
    const b = sitting(log([0, start({ resumedFrom: a.id })], [3 * MIN, { kind: "end", outcome: "success", routes: [] }]), "b");
    const c = sitting(log([0, start()], [3 * MIN, { kind: "end", outcome: "success", routes: [] }]), "c");
    const { kept, excluded } = applyExclusions([a, b, c], [
      { sittingId: b.id, reason: "a developer's test", by: "cli", at: at(0) },
      { sittingId: "nope:1", reason: "gone", by: "cli", at: at(0) },
    ]);
    expect(kept.map((x) => x.id)).toEqual([c.id]);
    expect(excluded).toEqual([expect.objectContaining({ sittingId: b.id, sittings: 2 })]);
  });

  it("leaves an excluded sitting out of every figure in a report", () => {
    const marks: TimingMark[] = log([0, start()], [3 * MIN, { kind: "end", outcome: "success", routes: [] }]).map((e) => ({
      runId: "x",
      chapterId: "riftlight-01",
      seq: e.seq,
      at: e.at,
      timing: e.timing as TimingNote,
    }));
    const r = timingReportFromMarks(marks, T0 + 99 * MIN, null, { exclusions: [{ sittingId: "x:1", reason: "demo", by: "ops", at: at(0) }] });
    expect(timingReportFromMarks(marks, T0 + 99 * MIN, null, { since: at(MIN) }).sittings).toEqual([]);
    expect(timingReportFromMarks(marks, T0 + 99 * MIN, null, { since: at(0) }).sittings).toHaveLength(1);
    expect([r.sittings, r.aggregates, r.activities?.games]).toEqual([[], [], []]);
    expect(r.excluded).toHaveLength(1);
  });
});
