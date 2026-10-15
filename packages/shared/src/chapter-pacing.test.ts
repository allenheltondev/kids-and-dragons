import { describe, expect, it } from "vitest";
import {
  fitModel,
  pacingReport,
  pathMetrics,
  predictMinutes,
  shortestSuccessPath,
  typicalMetrics,
  UNCALIBRATED_MODEL,
} from "./chapter-pacing.js";
import type { Chapter, Scene } from "./types/chapter.js";
import { makeChapter } from "./test-fixtures.js";

const go = (id: string, goto: string) => ({ id, label: id, icon: "arrow", goto });

/*
 * start (one button) -> vote (3 choices, one gated) -> short -> roll (check)
 *                                                   \-> long1 -> long2 -/
 * roll -> fight -> win (success ending); roll failure and fight defeat -> bad
 * (setback). `gated` is a shortcut to win that the metrics must not take.
 */
const scenes = {
  start: { type: "story", narration: "one two three", choices: [go("on", "vote")] },
  vote: {
    type: "choice_point",
    narration: "four five",
    choices: [go("a", "long1"), go("b", "short"), { ...go("c", "gated"), requiresFlag: "x" }],
  },
  gated: { type: "story", narration: "skipped", choices: [go("on", "win")] },
  short: { type: "story", narration: "six", choices: [go("on", "roll")] },
  long1: { type: "story", narration: "seven eight", choices: [go("on", "long2")] },
  long2: { type: "story", narration: "nine", choices: [go("on", "roll")] },
  roll: {
    type: "check",
    stat: "might",
    tn: 8,
    prompt: "Roll now",
    onSuccess: { goto: "fight", narration: "It works well" },
    onFailure: { goto: "bad" },
  },
  fight: {
    type: "encounter",
    map: "m",
    enemies: [],
    onVictory: { goto: "win" },
    onDefeat: { goto: "bad", narration: "never counted" },
  },
  win: { type: "story", narration: "The end", choices: [] },
  bad: { type: "story", narration: "Oh no", choices: [], outcome: "setback" },
} as unknown as Record<string, Scene>;

const chapter: Chapter = { ...makeChapter(), entry: "start", estimatedMinutes: 30, scenes };

describe("chapter pacing metrics", () => {
  it("finds the shortest success path, skipping gated choices and defeat", () => {
    expect(shortestSuccessPath(chapter)).toEqual(["start", "vote", "short", "roll", "fight", "win"]);
  });

  it("counts decisions, checks, encounters and words read aloud on it", () => {
    const m = pathMetrics(chapter, ["start", "vote", "short", "roll", "fight", "win"]);
    expect(m).toEqual({
      scenes: 6,
      decisions: 1, // vote only: start and short are one-button beats
      checks: 1,
      encounters: 1,
      // start 3 + vote 2 + short 1 + roll prompt 2 + taken branch 3 + win 2
      words: 3 + 2 + 1 + 2 + 3 + 2,
    });
  });

  it("takes the typical path from seeded walks that never end in a setback", () => {
    const a = typicalMetrics(chapter);
    expect(a).toEqual(typicalMetrics(chapter));
    expect(a.used).toBeGreaterThan(0);
    expect(a.metrics).toMatchObject({ decisions: 1, checks: 1, encounters: 1 });
    expect(a.metrics?.scenes).toBeGreaterThanOrEqual(6);
    expect(a.metrics?.scenes).toBeLessThanOrEqual(7);
  });

  it("reports estimatedMinutes alongside the metrics", () => {
    const r = pacingReport(chapter);
    expect(r.estimatedMinutes).toBe(30);
    expect(r.shortest?.scenes).toBe(6);
  });

  it("returns null paths when no success ending is reachable", () => {
    const stuck: Chapter = { ...chapter, entry: "bad" };
    expect(shortestSuccessPath(stuck)).toBeNull();
    expect(typicalMetrics(stuck).metrics).toBeNull();
  });
});

describe("pacing model", () => {
  const m = { scenes: 10, decisions: 3, checks: 2, encounters: 1, words: 260 };

  it("sums read-aloud time and per-event costs", () => {
    const d = UNCALIBRATED_MODEL;
    const seconds =
      (260 / d.wordsPerMinute) * 60 +
      3 * d.secondsPerDecision +
      2 * d.secondsPerCheck +
      d.secondsPerEncounter +
      10 * d.secondsPerScene;
    expect(predictMinutes(m)).toBeCloseTo(seconds / 60, 5);
  });

  it("rescales the defaults from a single timing", () => {
    const fit = fitModel([{ metrics: m, minutes: predictMinutes(m) * 2 }]);
    expect(fit?.method).toBe("scale");
    expect(fit && predictMinutes(m, fit.model)).toBeCloseTo(predictMinutes(m) * 2, 5);
  });

  it("recovers known constants from enough timings", () => {
    const truth = { ...UNCALIBRATED_MODEL, wordsPerMinute: 100, secondsPerDecision: 60 };
    const rows = [
      { scenes: 10, decisions: 3, checks: 2, encounters: 1, words: 260 },
      { scenes: 30, decisions: 14, checks: 5, encounters: 0, words: 1500 },
      { scenes: 35, decisions: 12, checks: 9, encounters: 1, words: 1900 },
      { scenes: 20, decisions: 4, checks: 1, encounters: 2, words: 900 },
      { scenes: 40, decisions: 18, checks: 3, encounters: 0, words: 2300 },
      { scenes: 33, decisions: 9, checks: 8, encounters: 1, words: 1200 },
      { scenes: 28, decisions: 15, checks: 2, encounters: 2, words: 1700 },
      { scenes: 25, decisions: 6, checks: 7, encounters: 0, words: 800 },
    ].map((metrics) => ({ metrics, minutes: predictMinutes(metrics, truth) }));
    const fit = fitModel(rows);
    expect(fit?.method).toBe("nnls");
    for (const r of rows) expect(predictMinutes(r.metrics, fit?.model)).toBeCloseTo(r.minutes, 1);
  });
});
