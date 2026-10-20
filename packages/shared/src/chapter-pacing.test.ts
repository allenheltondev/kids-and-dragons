import { describe, expect, it } from "vitest";
import {
  CALIBRATION_SCENARIO_ID,
  checkKind,
  composedWordRange,
  DEFAULT_SCENARIO_IDS,
  fitModel,
  isGatedFor,
  longestReadingRun,
  metricRange,
  PACING_FACET_IDS,
  PACING_SCENARIOS,
  scenarioById,
  scenarioParty,
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
      doingChecks: 1, // a might check
      encounters: 1,
      longestReadingRun: 1, // start, short and win each stand alone between things to do
      // start 3 + vote 2 + short 1 + roll prompt 2 + taken branch 3 + win 2
      words: 3 + 2 + 1 + 2 + 3 + 2,
      wordsMin: 3 + 2 + 1 + 2 + 3 + 2,
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
    expect(r.scenarios).toHaveLength(PACING_SCENARIOS.length);
    for (const s of r.scenarios) expect(s.shortest?.scenes).toBe(6);
  });

  it("returns null paths when no success ending is reachable", () => {
    const stuck: Chapter = { ...chapter, entry: "bad" };
    expect(shortestSuccessPath(stuck)).toBeNull();
    expect(typicalMetrics(stuck).metrics).toBeNull();
  });
});

describe("pacing model", () => {
  const m = { scenes: 10, decisions: 3, checks: 2, encounters: 1, words: 260, wordsMin: 260 };

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
      { scenes: 10, decisions: 3, checks: 2, encounters: 1, words: 260, wordsMin: 260 },
      { scenes: 30, decisions: 14, checks: 5, encounters: 0, words: 1500, wordsMin: 1500 },
      { scenes: 35, decisions: 12, checks: 9, encounters: 1, words: 1900, wordsMin: 1900 },
      { scenes: 20, decisions: 4, checks: 1, encounters: 2, words: 900, wordsMin: 900 },
      { scenes: 40, decisions: 18, checks: 3, encounters: 0, words: 2300, wordsMin: 2300 },
      { scenes: 33, decisions: 9, checks: 8, encounters: 1, words: 1200, wordsMin: 1200 },
      { scenes: 28, decisions: 15, checks: 2, encounters: 2, words: 1700, wordsMin: 1700 },
      { scenes: 25, decisions: 6, checks: 7, encounters: 0, words: 800, wordsMin: 800 },
    ].map((metrics) => ({ metrics, minutes: predictMinutes(metrics, truth) }));
    const fit = fitModel(rows);
    expect(fit?.method).toBe("nnls");
    for (const r of rows) expect(predictMinutes(r.metrics, fit?.model)).toBeCloseTo(r.minutes, 1);
  });
});

// ---------------------------------------------------------------------------
// Scenario-aware words and choices
// ---------------------------------------------------------------------------

describe("pacing scenarios", () => {
  const sc = (id: string) => scenarioById(id) as NonNullable<ReturnType<typeof scenarioById>>;
  const facets = (min: number) => ({ count: { of: "facet_*", min } });

  /*
   * "hub" mixes every variant kind over a 3-word base:
   *  - append (default) 2 words when the party holds 3+ facets
   *  - at:"start" 4 words when one player is seated
   *  - replace 8 words when it holds 9+ facets (the base is dropped)
   *  - append 5 words behind a run flag (unknowable statically)
   * and offers a plain choice plus a `when` choice that needs 3+ facets.
   */
  const hub = {
    type: "story",
    narration: "one two three",
    variants: [
      { when: facets(3), text: "app one" },
      { when: { partySize: { max: 1 } }, text: "solo start words here", at: "start" },
      { when: facets(9), text: "a b c d e f g h", replace: true },
      { when: { flag: "met" }, text: "flag one two three four" },
    ],
    choices: [go("plain", "mid"), { ...go("bonus", "mid"), when: facets(3) }],
  };
  const synthetic: Chapter = {
    ...makeChapter(),
    entry: "hub",
    scenes: {
      hub,
      mid: {
        type: "check",
        stat: "might",
        tn: 8,
        prompt: "Roll now",
        onSuccess: {
          goto: "end",
          narration: "Well done",
          variants: [{ when: { partySize: { min: 3 } }, text: "Cheers from all of you" }],
        },
        onFailure: { goto: "end" },
      },
      end: { type: "story", narration: "The end", choices: [] },
    } as unknown as Record<string, Scene>,
  };

  it("defines six scenarios, a small default set, and a calibration scenario among them", () => {
    expect(PACING_SCENARIOS).toHaveLength(6);
    for (const id of DEFAULT_SCENARIO_IDS) expect(scenarioById(id)).toBeDefined();
    expect(scenarioById(CALIBRATION_SCENARIO_ID)).toMatchObject({ facets: 3, partySize: 3 });
  });

  it("composes append, at:start and replace variants as the engine does", () => {
    const words = (id: string) => composedWordRange(hub.narration, hub.variants as never, sc(id));
    // No flag variant: min is the composition without it, max with it (+5).
    expect(words("empty-3p")).toEqual({ min: 3, max: 3 + 5 }); // base only
    expect(words("few-3p")).toEqual({ min: 3 + 2, max: 3 + 2 + 5 }); // append
    expect(words("few-solo")).toEqual({ min: 4 + 3 + 2, max: 4 + 3 + 2 + 5 }); // start + base + append
    expect(words("collection-3p")).toEqual({ min: 8 + 2, max: 8 + 2 + 5 }); // replace drops the base, append stays
    expect(words("collection-solo")).toEqual({ min: 4 + 8 + 2, max: 4 + 8 + 2 + 5 });
  });

  it("a variant with no flag condition gives an exact count (min equals max)", () => {
    const only = [{ when: facets(3), text: "app one" }];
    expect(composedWordRange("one two three", only, sc("few-3p"))).toEqual({ min: 5, max: 5 });
    expect(composedWordRange("one two three", only, sc("empty-3p"))).toEqual({ min: 3, max: 3 });
    expect(composedWordRange("one two three", undefined, sc("few-3p"))).toEqual({ min: 3, max: 3 });
  });

  it("matches an exact list of real facet ids, not only a prefix", () => {
    // gemfall-08's ending_collectors lists real ids to leave out the Keystone.
    const list = PACING_FACET_IDS.filter((id) => id !== "facet_keystone");
    const variants = [
      { when: { count: { of: list, max: 0 } }, text: "empty hands" },
      { when: { count: { of: list, min: 5 } }, text: "a heavy haul indeed" },
    ];
    expect(composedWordRange("base", variants, sc("empty-3p"))).toEqual({ min: 1 + 2, max: 1 + 2 });
    expect(composedWordRange("base", variants, sc("collection-3p"))).toEqual({ min: 1 + 4, max: 1 + 4 });
  });

  it("seats real facets: N distinct ids, never the Keystone in a scenario", () => {
    for (const scenario of PACING_SCENARIOS) {
      const held = scenarioParty(scenario).members.flatMap((m) => m.questItems);
      expect(new Set(held).size).toBe(scenario.facets);
      expect(held).not.toContain("facet_keystone");
    }
  });

  it("counts filled tokens by the words they become", () => {
    expect(composedWordRange("{party} go", undefined, sc("few-solo"))).toEqual({ min: 2, max: 2 });
    expect(composedWordRange("{party} go", undefined, sc("few-3p"))).toEqual({ min: 5, max: 5 });
  });

  it("measures a path per scenario, including branch variants and flag ranges", () => {
    const path = ["hub", "mid", "end"];
    const few = pathMetrics(synthetic, path, sc("few-3p"));
    // hub 5 (+5 flag) + check prompt 2 + branch "Well done" 2 + 3-seat variant 5 + end 2
    expect(few.words).toBe(5 + 5 + 2 + 2 + 5 + 2);
    expect(few.wordsMin).toBe(5 + 2 + 2 + 5 + 2);
    const solo = pathMetrics(synthetic, path, sc("few-solo"));
    // seat variant on the branch does not apply to one player
    expect(solo.wordsMin).toBe(9 + 2 + 2 + 2);
    const empty = pathMetrics(synthetic, path, sc("empty-3p"));
    expect(empty.wordsMin).toBe(3 + 2 + 2 + 5 + 2);
    // The variants made the old (base-only) count an undercount.
    expect(few.wordsMin).toBeGreaterThan(empty.wordsMin);
  });

  it("makes `when` choices and decisions scenario-aware; flag-dependent ones are excluded", () => {
    const bonus = hub.choices[1] as never;
    expect(isGatedFor(bonus, sc("empty-3p"))).toBe(true);
    expect(isGatedFor(bonus, sc("few-3p"))).toBe(false);
    expect(isGatedFor({ ...go("f", "x"), when: { flag: "met" } }, sc("collection-3p"))).toBe(true);
    expect(isGatedFor({ ...go("s", "x"), requiresSpecies: "fox" } as never, sc("collection-3p"))).toBe(true);
    expect(isGatedFor({ ...go("c", "x"), requiresClass: "starweaver" } as never, sc("collection-3p"))).toBe(true);
    const path = ["hub", "mid", "end"];
    expect(pathMetrics(synthetic, path, sc("empty-3p")).decisions).toBe(0); // one visible choice
    expect(pathMetrics(synthetic, path, sc("few-3p")).decisions).toBe(1); // bonus is a real option
  });

  it("reports the min-max across scenarios", () => {
    const r = pacingReport(synthetic, PACING_SCENARIOS, 20);
    const range = metricRange(r, "shortest");
    expect(range?.decisions).toEqual({ min: 0, max: 1 });
    expect(range?.scenes).toEqual({ min: 3, max: 3 });
    expect(range?.wordsMin.min).toBe(4 + 3 + 2 + 2 + 2); // empty-solo: start variant, no branch seat variant
    expect(range?.words.max).toBeGreaterThan(range?.wordsMin.min ?? 0);
  });
});

describe("interactivity", () => {
  const beat = (next: string) => ({ type: "story", narration: "words", choices: [go("on", next)] });
  const check = (stat: string, next: string, extra: object = {}) => ({
    type: "check",
    stat,
    tn: 8,
    prompt: "Roll",
    onSuccess: { goto: next },
    onFailure: { goto: next },
    ...extra,
  });
  /*
   * open -> b1 -> b2 -> b3 -> lift (might) -> b4 -> fight -> b5 -> b6 -> talk (heart)
   * -> jam (heart, checkKind doing) -> stare (clever, checkKind talking) -> pick -> end.
   * `pick` has a second way only behind a flag-`when`, so it is a beat in every scenario.
   * Reading runs: open..b3 = 4, b4 = 1, b5..b6 = 2, pick..end = 2.
   */
  const lineScenes = {
    open: beat("b1"),
    b1: beat("b2"),
    b2: beat("b3"),
    b3: beat("lift"),
    lift: check("might", "b4"),
    b4: beat("fight"),
    fight: { type: "encounter", map: "m", enemies: [], onVictory: { goto: "b5" }, onDefeat: { goto: "b5" } },
    b5: beat("b6"),
    b6: beat("talk"),
    talk: check("heart", "jam"),
    jam: check("heart", "stare", { checkKind: "doing" }),
    stare: check("clever", "pick", { checkKind: "talking" }),
    pick: { type: "story", narration: "words", choices: [go("a", "end"), { ...go("b", "end"), when: { flag: "met" } }] },
    end: { type: "story", narration: "The end", choices: [] },
  } as unknown as Record<string, Scene>;
  const line: Chapter = { ...makeChapter(), entry: "open", estimatedMinutes: 30, scenes: lineScenes };
  const path = ["open", "b1", "b2", "b3", "lift", "b4", "fight", "b5", "b6", "talk", "jam", "stare", "pick", "end"];

  it("reads a check's kind from its stat unless the check overrides it", () => {
    const stats = ["might", "quick", "clever", "heart"].map((stat) => checkKind(check(stat, "x") as never));
    expect(stats).toEqual(["doing", "doing", "doing", "talking"]);
    const overridden = ["jam", "stare"].map((id) => checkKind(lineScenes[id] as never));
    expect(overridden).toEqual(["doing", "talking"]);
  });

  it("counts doing checks and the longest stretch with nothing to decide on a path", () => {
    const m = pathMetrics(line, path);
    expect(m.checks).toBe(4);
    expect(m.doingChecks).toBe(2); // lift, and jam by override; stare talks by override
    expect(m.longestReadingRun).toBe(4);
    expect(longestReadingRun(line, path)).toEqual({ from: "open", length: 4 });
  });

  it("lets a vote, a check or a fight break a run, but not a one-button beat", () => {
    expect(longestReadingRun(line, ["b4", "fight", "b5"])).toEqual({ from: "b4", length: 1 });
    expect(longestReadingRun(line, ["b5", "b6", "talk", "jam"])).toEqual({ from: "b5", length: 2 });
    expect(longestReadingRun(line, ["stare", "pick", "end"])).toEqual({ from: "pick", length: 2 });
    expect(longestReadingRun(line, ["lift", "talk"])).toBeNull();
    expect(longestReadingRun(chapter, ["start", "vote", "short"])).toEqual({ from: "start", length: 1 });
  });

  it("carries both numbers into the shortest and typical paths and their ranges", () => {
    const r = pacingReport(line, PACING_SCENARIOS, 20);
    for (const s of r.scenarios) {
      expect(s.shortest).toMatchObject({ doingChecks: 2, longestReadingRun: 4 });
      expect(s.typical).toMatchObject({ doingChecks: 2, longestReadingRun: 4 });
    }
    expect(metricRange(r, "shortest")?.longestReadingRun).toEqual({ min: 4, max: 4 });
    expect(metricRange(r, "typical")?.doingChecks).toEqual({ min: 2, max: 2 });
  });
});
