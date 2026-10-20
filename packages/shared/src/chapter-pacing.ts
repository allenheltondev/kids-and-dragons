/**
 * Chapter pacing: how long a chapter takes to play, from its shape.
 *
 * `gemfall-authoring.md` §4 sets the bar as the *shortest path to a success
 * ending*: at least 30 scenes, at least 14 of them real decisions. This
 * module measures that path (and a "typical" one), and turns the measurements
 * into a minutes estimate through a small, loudly-uncalibrated model that a
 * real family playtest can fit (`tools/content/pacing.ts`).
 *
 * Definitions, all on a path from `entry` to a success ending:
 *  - **Edges** are visible choices, a check's two branches, and an
 *    encounter's *victory* branch. Defeat is a setback route, so it is never
 *    on a success path. Choices gated by `requiresSpecies` / `requiresClass` /
 *    `requiresFlag` / `requiresItem` are skipped: a path that needs a
 *    particular species is not the path every table has.
 *  - **Success ending** is a scene with no edges whose `outcome` is not
 *    `"setback"`.
 *  - **Decision** (= vote) is a story/choice_point/rest scene with two or
 *    more visible choices. A one-button beat is not a decision.
 *  - **Check** is a `check` scene; **encounter** an `encounter` scene.
 *  - **Doing checks** are checks whose `CheckKind` is `"doing"`: the
 *    `checkKind` the check sets, else might and quick do, clever and heart
 *    talk (`STAT_CHECK_KIND`).
 *  - **Longest reading run** is the most scenes in a row on the path that ask
 *    the table nothing: not a decision, not a check, not an encounter. One-button
 *    beats and the ending count as reading. A fight breaks a run, because the
 *    table is playing, even though the bar's "asks something" counts only
 *    votes and checks.
 *  - **Words** are what a grown-up reads aloud: scene narration, a check's
 *    prompt, and the narration of the branch actually taken, each *as the
 *    engine composes it* (`composeNarration` + `fillTokens`, so append,
 *    `at: "start"` and `replace` variants behave exactly as at the table).
 *    Choice labels are not counted (the vote seconds cover reading the options).
 *  - **Typical path** is the median, per metric, over `walks` seeded random
 *    walks that each pick uniformly among the edges at every scene and reach
 *    a success ending. Walks that hit a setback or wander past `maxSteps`
 *    are discarded.
 *
 * **Scenarios.** What is read aloud, and which `when` choices exist, depend on
 * the party: how many facets it holds and how many players are seated. A
 * `PacingScenario` fixes both; every metric is computed per scenario and the
 * report shows the min-max across scenarios. The synthetic party holds
 * `facets` distinct `facet_*` items and nothing else, and stays fixed along a
 * path (items granted mid-chapter are not tracked), so a `when` on any other
 * item is false in every scenario.
 *
 * **Flags.** Run flags depend on earlier choices, which a static pass cannot
 * know. For *words*, the flags named by a scene's variants are enumerated in
 * every combination and the scene contributes its shortest and longest
 * composition: `wordsMin` / `words` are sums of those, an outer bound (flag
 * correlations across scenes are ignored). `words` is the upper bound and is
 * what the minutes model uses, the conservative side for "will the evening
 * run long". For *choices*, a `when` that tests a flag is treated like
 * `requiresFlag`: not part of the path metrics.
 */

import { evaluateCondition } from "./chapter-graph.js";
import type { ChoiceParty } from "./chapter-graph.js";
import { composeNarration, fillTokens } from "./narration.js";
import type { Branch, Chapter, CheckKind, CheckScene, Choice, Condition, NarrationVariant, Scene } from "./types/chapter.js";
import type { ResolvedCharacter, StatId } from "./types/domain.js";

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** A party shape the report is computed for. */
export interface PacingScenario {
  id: string;
  /** Distinct `facet_*` items the party holds between them. */
  facets: number;
  /** Seats at the table. */
  partySize: number;
}

/** Every scenario: facet buckets (none, a few, a full collection) x (solo, three players). */
export const PACING_SCENARIOS: readonly PacingScenario[] = [
  { id: "empty-solo", facets: 0, partySize: 1 },
  { id: "empty-3p", facets: 0, partySize: 3 },
  { id: "few-solo", facets: 3, partySize: 1 },
  { id: "few-3p", facets: 3, partySize: 3 },
  { id: "collection-solo", facets: 9, partySize: 1 },
  { id: "collection-3p", facets: 9, partySize: 3 },
];

/** The small default set: the three facet buckets at a full table, plus a solo player. */
export const DEFAULT_SCENARIO_IDS: readonly string[] = ["empty-3p", "few-3p", "collection-3p", "few-solo"];

/** The scenario the calibration fitter (and `pathMetrics`' default) uses: a typical family table. */
export const CALIBRATION_SCENARIO_ID = "few-3p";

export function scenarioById(id: string): PacingScenario | undefined {
  return PACING_SCENARIOS.find((s) => s.id === id);
}

export const CALIBRATION_SCENARIO: PacingScenario = scenarioById(CALIBRATION_SCENARIO_ID) as PacingScenario;

/**
 * The real facet ids, in the order a party is most likely to pick them up, so
 * a scenario holding N facets holds the first N. Real ids, not synthetic ones:
 * content can list exact facets (`count.of: ["facet_ember", ...]`, as
 * gemfall-08's `ending_collectors` does to leave out the Keystone), and a
 * synthetic id would never match that list. The Keystone comes last, because
 * only the finale's last choice can grant it. A test keeps this list in step
 * with `content/items.json`.
 */
export const PACING_FACET_IDS: readonly string[] = [
  "facet_ember",
  "facet_harvest",
  "facet_ford",
  "facet_pride",
  "facet_glade",
  "facet_table",
  "facet_caravan",
  "facet_barge",
  "facet_clerks",
  "facet_unassigned",
  "facet_depot",
  "facet_drakes_rate",
  "facet_confiscated",
  "facet_keystone",
];

/** The synthetic party for a scenario: N seats, the first N real facets in the first seat's quest items. */
export function scenarioParty(scenario: PacingScenario, flags: Record<string, boolean> = {}): ChoiceParty {
  if (scenario.facets > PACING_FACET_IDS.length) {
    throw new Error(`scenario ${scenario.id} holds ${String(scenario.facets)} facets; only ${String(PACING_FACET_IDS.length)} exist`);
  }
  const members = Array.from({ length: Math.max(1, scenario.partySize) }, (_, i) => ({
    id: `pacing_${String(i + 1)}`,
    inventory: [],
    questItems: i === 0 ? PACING_FACET_IDS.slice(0, scenario.facets) : ([] as string[]),
  })) as unknown as ResolvedCharacter[];
  return { members, flags };
}

function conditionFlags(cond: Condition | undefined): string[] {
  return [cond?.flag, cond?.notFlag].filter((f): f is string => f !== undefined);
}

/** Cap on enumerated flag combinations per scene (2^8); beyond it only all-off / all-on are tried. */
const MAX_FLAG_BITS = 8;

/**
 * Shortest and longest read-aloud length of `base` + `variants` in a scenario,
 * composed by the engine's own `composeNarration` over every combination of
 * the flags the variants test.
 */
export function composedWordRange(
  base: string | undefined,
  variants: readonly NarrationVariant[] | undefined,
  scenario: PacingScenario,
): { min: number; max: number } {
  const flagNames = [...new Set((variants ?? []).flatMap((v) => conditionFlags(v.when)))];
  const combos: Record<string, boolean>[] = [];
  if (flagNames.length <= MAX_FLAG_BITS) {
    for (let mask = 0; mask < 1 << flagNames.length; mask++) {
      combos.push(Object.fromEntries(flagNames.map((f, i) => [f, (mask & (1 << i)) !== 0])));
    }
  } else {
    combos.push({}, Object.fromEntries(flagNames.map((f) => [f, true])));
  }
  let min = Infinity;
  let max = 0;
  for (const flags of combos) {
    const party = scenarioParty(scenario, flags);
    const n = countWords(fillTokens(composeNarration(base ?? "", variants, party), party));
    min = Math.min(min, n);
    max = Math.max(max, n);
  }
  return { min: min === Infinity ? 0 : min, max };
}

/**
 * Is this choice off the path metrics in this scenario? Species/flag/item
 * requirements always are (see header). A `when` is checked against the
 * scenario's party, except one that tests a flag, which is unknowable here.
 */
export function isGatedFor(choice: Choice, scenario: PacingScenario): boolean {
  if (
    choice.requiresSpecies !== undefined ||
    choice.requiresClass !== undefined ||
    choice.requiresFlag !== undefined ||
    choice.requiresItem !== undefined
  ) {
    return true;
  }
  if (choice.when === undefined) return false;
  if (conditionFlags(choice.when).length > 0) return true;
  return !evaluateCondition(choice.when, scenarioParty(scenario));
}

/** What a check's stat implies it asks of the table (see `CheckKind`). */
export const STAT_CHECK_KIND: Readonly<Record<StatId, CheckKind>> = {
  might: "doing",
  quick: "doing",
  clever: "talking",
  heart: "talking",
};

/** A check's kind: its own `checkKind`, else what its stat implies. */
export function checkKind(scene: CheckScene): CheckKind {
  return scene.checkKind ?? STAT_CHECK_KIND[scene.stat];
}

export interface PathMetrics {
  /** Scenes visited, entry and ending included. */
  scenes: number;
  /** Scenes with 2+ ungated choices. Each is one vote at the table. */
  decisions: number;
  checks: number;
  /** Checks whose kind is "doing" (see `checkKind`); the rest of `checks` are talking. */
  doingChecks: number;
  encounters: number;
  /** Most scenes in a row that ask nothing: no decision, check or encounter. */
  longestReadingRun: number;
  /**
   * Words read aloud: narration, check prompts, taken-branch narration, with
   * variants composed for the scenario. Upper bound over flag combinations.
   */
  words: number;
  /** Lower bound over flag combinations (equal to `words` when no variant tests a flag). */
  wordsMin: number;
}

/** Both paths for one scenario. */
export interface ScenarioPacing {
  scenario: PacingScenario;
  shortest: PathMetrics | null;
  typical: PathMetrics | null;
  /** Random walks that reached a success ending. */
  walksUsed: number;
}

export interface PacingReport {
  chapterId: string;
  scenarios: ScenarioPacing[];
  estimatedMinutes: number;
}

interface PacingEdge {
  to: string;
  /** Branch narration read when this edge is taken. */
  narration?: string;
  variants?: NarrationVariant[];
}

export function countWords(text: string | undefined): number {
  const t = (text ?? "").trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

function branchEdge(branch: Branch | undefined): PacingEdge[] {
  return branch ? [{ to: branch.goto, narration: branch.narration, variants: branch.variants }] : [];
}

/** Success-path edges out of a scene in a scenario (see module header). */
export function pacingEdges(scene: Scene, scenario: PacingScenario = CALIBRATION_SCENARIO): PacingEdge[] {
  switch (scene.type) {
    case "story":
    case "choice_point":
    case "rest":
      return scene.choices.filter((c) => !isGatedFor(c, scenario)).map((c) => ({ to: c.goto }));
    case "check":
      return [...branchEdge(scene.onSuccess), ...branchEdge(scene.onFailure)];
    case "encounter":
      return branchEdge(scene.onVictory);
    default:
      return [];
  }
}

function isDecision(scene: Scene, scenario: PacingScenario): boolean {
  return (
    (scene.type === "story" || scene.type === "choice_point" || scene.type === "rest") &&
    scene.choices.filter((c) => !isGatedFor(c, scenario)).length >= 2
  );
}

/** Does this scene give the table something to do: a vote, a roll or a fight? */
function asksSomething(scene: Scene, scenario: PacingScenario): boolean {
  return scene.type === "check" || scene.type === "encounter" || isDecision(scene, scenario);
}

/** One stretch of scenes in a row that ask the table nothing. */
export interface ReadingRun {
  /** The first scene of the stretch. */
  from: string;
  /** Scenes in it. */
  length: number;
}

/** The longest reading run on a path (the first, on a tie); null when every scene asks something. */
export function longestReadingRun(
  chapter: Chapter,
  path: readonly string[],
  scenario: PacingScenario = CALIBRATION_SCENARIO,
): ReadingRun | null {
  let best: ReadingRun | null = null;
  let from = "";
  let length = 0;
  for (const id of path) {
    const scene = chapter.scenes[id];
    if (!scene) continue;
    if (asksSomething(scene, scenario)) {
      length = 0;
      continue;
    }
    if (length === 0) from = id;
    length += 1;
    if (!best || length > best.length) best = { from, length };
  }
  return best;
}

function sceneWords(scene: Scene, scenario: PacingScenario): { min: number; max: number } {
  const own = composedWordRange(scene.narration, "variants" in scene ? scene.variants : undefined, scenario);
  if (scene.type !== "check") return own;
  const prompt = countWords(fillTokens(scene.prompt, scenarioParty(scenario)));
  return { min: own.min + prompt, max: own.max + prompt };
}

/** True for an ending that counts as a success. */
function isSuccessEnding(scene: Scene, scenario: PacingScenario): boolean {
  if (pacingEdges(scene, scenario).length > 0) return false;
  return !("outcome" in scene && scene.outcome === "setback");
}

/** Metrics for an explicit path: scene ids in order, so edge i leads to path[i+1]. */
export function pathMetrics(
  chapter: Chapter,
  path: readonly string[],
  scenario: PacingScenario = CALIBRATION_SCENARIO,
): PathMetrics {
  const m: PathMetrics = {
    scenes: 0,
    decisions: 0,
    checks: 0,
    doingChecks: 0,
    encounters: 0,
    longestReadingRun: longestReadingRun(chapter, path, scenario)?.length ?? 0,
    words: 0,
    wordsMin: 0,
  };
  path.forEach((id, i) => {
    const scene = chapter.scenes[id];
    if (!scene) return;
    m.scenes += 1;
    if (isDecision(scene, scenario)) m.decisions += 1;
    if (scene.type === "check") {
      m.checks += 1;
      if (checkKind(scene) === "doing") m.doingChecks += 1;
    }
    if (scene.type === "encounter") m.encounters += 1;
    const w = sceneWords(scene, scenario);
    m.words += w.max;
    m.wordsMin += w.min;
    const next = path[i + 1];
    if (next !== undefined) {
      const edge = pacingEdges(scene, scenario).find((e) => e.to === next);
      if (edge) {
        const b = composedWordRange(edge.narration, edge.variants, scenario);
        m.words += b.max;
        m.wordsMin += b.min;
      }
    }
  });
  return m;
}

/** Fewest-scenes path to a success ending (breadth-first, so ties go to authored order). */
export function shortestSuccessPath(
  chapter: Chapter,
  scenario: PacingScenario = CALIBRATION_SCENARIO,
): string[] | null {
  const prev = new Map<string, string | null>([[chapter.entry, null]]);
  const queue = [chapter.entry];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head] as string;
    const scene = chapter.scenes[id];
    if (!scene) continue;
    if (isSuccessEnding(scene, scenario)) {
      const path: string[] = [];
      for (let at: string | null | undefined = id; at != null; at = prev.get(at)) path.push(at);
      return path.reverse();
    }
    for (const e of pacingEdges(scene, scenario)) {
      if (!prev.has(e.to) && chapter.scenes[e.to]) {
        prev.set(e.to, id);
        queue.push(e.to);
      }
    }
  }
  return null;
}

/** Small seeded PRNG (mulberry32) so the report is reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_SEED = 172;
export const DEFAULT_WALKS = 500;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Per-metric median over seeded random walks; null when no walk finishes. */
export function typicalMetrics(
  chapter: Chapter,
  walks = DEFAULT_WALKS,
  seed = DEFAULT_SEED,
  maxSteps = 400,
  scenario: PacingScenario = CALIBRATION_SCENARIO,
): { metrics: PathMetrics | null; used: number } {
  const rand = seededRandom(seed);
  const samples: PathMetrics[] = [];
  for (let w = 0; w < walks; w++) {
    const path = [chapter.entry];
    let id = chapter.entry;
    for (let step = 0; step < maxSteps; step++) {
      const scene = chapter.scenes[id];
      if (!scene) break;
      const edges = pacingEdges(scene, scenario).filter((e) => chapter.scenes[e.to]);
      if (edges.length === 0) {
        if (isSuccessEnding(scene, scenario)) samples.push(pathMetrics(chapter, path, scenario));
        break;
      }
      id = (edges[Math.floor(rand() * edges.length)] as PacingEdge).to;
      path.push(id);
    }
  }
  if (samples.length === 0) return { metrics: null, used: 0 };
  const pick = (k: keyof PathMetrics): number => Math.round(median(samples.map((s) => s[k])));
  return {
    metrics: {
      scenes: pick("scenes"),
      decisions: pick("decisions"),
      checks: pick("checks"),
      doingChecks: pick("doingChecks"),
      encounters: pick("encounters"),
      longestReadingRun: pick("longestReadingRun"),
      words: pick("words"),
      wordsMin: pick("wordsMin"),
    },
    used: samples.length,
  };
}

export function pacingReport(
  chapter: Chapter,
  scenarios: readonly PacingScenario[] = PACING_SCENARIOS,
  walks = DEFAULT_WALKS,
  seed = DEFAULT_SEED,
): PacingReport {
  return {
    chapterId: chapter.id,
    estimatedMinutes: chapter.estimatedMinutes,
    scenarios: scenarios.map((scenario) => {
      const shortestPath = shortestSuccessPath(chapter, scenario);
      const typical = typicalMetrics(chapter, walks, seed, 400, scenario);
      return {
        scenario,
        shortest: shortestPath ? pathMetrics(chapter, shortestPath, scenario) : null,
        typical: typical.metrics,
        walksUsed: typical.used,
      };
    }),
  };
}

/** Min-max of each metric across the scenarios that have the path (null if none do). */
export function metricRange(
  report: PacingReport,
  which: "shortest" | "typical",
): Record<keyof PathMetrics, { min: number; max: number }> | null {
  const all = report.scenarios.flatMap((s) => {
    const m = s[which];
    return m ? [m] : [];
  });
  if (all.length === 0) return null;
  const keys = [
    "scenes",
    "decisions",
    "checks",
    "doingChecks",
    "encounters",
    "longestReadingRun",
    "words",
    "wordsMin",
  ] as const;
  return Object.fromEntries(
    keys.map((k) => [k, { min: Math.min(...all.map((m) => m[k])), max: Math.max(...all.map((m) => m[k])) }]),
  ) as Record<keyof PathMetrics, { min: number; max: number }>;
}

// ---------------------------------------------------------------------------
// Calibration model
// ---------------------------------------------------------------------------

/**
 * Seconds-per-unit constants. **UNCALIBRATED DEFAULTS**: educated guesses,
 * not measurements. Replace them by recording real timings in
 * `docs/review/playtest-timings.json` and running `npm run content:pacing`,
 * which fits them. All the constants live here and nowhere else.
 */
export interface PacingModel {
  /** Read-aloud speed, words per minute (adult reading to children, with pauses). */
  wordsPerMinute: number;
  /** Seconds a table takes over one vote: hear options, discuss, tap. */
  secondsPerDecision: number;
  /** Seconds per check: choose roller, roll, react. */
  secondsPerCheck: number;
  /** Seconds per encounter: a short fight on the board. */
  secondsPerEncounter: number;
  /** Seconds of tap/transition overhead per scene. */
  secondsPerScene: number;
}

export const UNCALIBRATED_MODEL: PacingModel = {
  wordsPerMinute: 130,
  secondsPerDecision: 40,
  secondsPerCheck: 30,
  secondsPerEncounter: 240,
  secondsPerScene: 4,
};

/** What the minutes model reads off a path. */
export type TimedMetrics = Pick<PathMetrics, "scenes" | "decisions" | "checks" | "encounters" | "words">;

export function predictMinutes(m: TimedMetrics, model: PacingModel = UNCALIBRATED_MODEL): number {
  const seconds =
    (m.words / model.wordsPerMinute) * 60 +
    m.decisions * model.secondsPerDecision +
    m.checks * model.secondsPerCheck +
    m.encounters * model.secondsPerEncounter +
    m.scenes * model.secondsPerScene;
  return seconds / 60;
}

/** One recorded playtest: measured table minutes for a chapter. */
export interface Timing {
  chapter: string;
  minutes: number;
  /** Which path the table took; picks the metrics fitted against. Default "typical". */
  path?: "shortest" | "typical";
}

export interface Fit {
  model: PacingModel;
  /** "scale" with too few timings (one multiplier on the defaults), "nnls" otherwise. */
  method: "scale" | "nnls";
  samples: number;
}

const FEATURES = ["words", "decisions", "checks", "encounters", "scenes"] as const;

/**
 * Fits the model to recorded timings. With fewer than `FEATURES.length + 2`
 * timings there is not enough to separate the constants, so the defaults are
 * scaled by one factor; with more, a non-negative least-squares fit of the
 * five per-unit costs (in minutes) is solved by coordinate descent.
 */
export function fitModel(rows: { metrics: TimedMetrics; minutes: number }[]): Fit | null {
  if (rows.length === 0) return null;
  if (rows.length < FEATURES.length + 2) {
    const pred = rows.map((r) => predictMinutes(r.metrics));
    const num = rows.reduce((s, r, i) => s + r.minutes * (pred[i] as number), 0);
    const den = pred.reduce((s, p) => s + p * p, 0);
    const k = den === 0 ? 1 : num / den;
    const d = UNCALIBRATED_MODEL;
    return {
      method: "scale",
      samples: rows.length,
      model: {
        wordsPerMinute: d.wordsPerMinute / k,
        secondsPerDecision: d.secondsPerDecision * k,
        secondsPerCheck: d.secondsPerCheck * k,
        secondsPerEncounter: d.secondsPerEncounter * k,
        secondsPerScene: d.secondsPerScene * k,
      },
    };
  }
  const X = rows.map((r) => FEATURES.map((k) => r.metrics[k]));
  const y = rows.map((r) => r.minutes);
  const n = FEATURES.length;
  const w = new Array<number>(n).fill(0);
  for (let iter = 0; iter < 5000; iter++) {
    for (let j = 0; j < n; j++) {
      let num = 0;
      let den = 0;
      for (let i = 0; i < X.length; i++) {
        const row = X[i] as number[];
        let rest = y[i] as number;
        for (let k = 0; k < n; k++) if (k !== j) rest -= (row[k] as number) * (w[k] as number);
        num += (row[j] as number) * rest;
        den += (row[j] as number) ** 2;
      }
      w[j] = den === 0 ? 0 : Math.max(0, num / den);
    }
  }
  const [perWord, perDecision, perCheck, perEncounter, perScene] = w as [number, number, number, number, number];
  return {
    method: "nnls",
    samples: rows.length,
    model: {
      wordsPerMinute: perWord > 0 ? 1 / perWord : Infinity,
      secondsPerDecision: perDecision * 60,
      secondsPerCheck: perCheck * 60,
      secondsPerEncounter: perEncounter * 60,
      secondsPerScene: perScene * 60,
    },
  };
}
