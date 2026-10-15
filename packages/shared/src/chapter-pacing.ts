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
 *  - **Edges** are ungated choices, a check's two branches, and an
 *    encounter's *victory* branch. Defeat is a setback route, so it is never
 *    on a success path. Gated choices are skipped: a path that needs a
 *    particular species is not the path every table has.
 *  - **Success ending** is a scene with no edges whose `outcome` is not
 *    `"setback"`.
 *  - **Decision** (= vote) is a story/choice_point/rest scene with two or
 *    more ungated choices. A one-button beat is not a decision.
 *  - **Check** is a `check` scene; **encounter** an `encounter` scene.
 *  - **Words** are what a grown-up reads aloud: scene narration, a check's
 *    prompt, and the narration of the branch actually taken. Choice labels
 *    are not counted (the vote seconds cover reading the options).
 *  - **Typical path** is the median, per metric, over `walks` seeded random
 *    walks that each pick uniformly among the edges at every scene and reach
 *    a success ending. Walks that hit a setback or wander past `maxSteps`
 *    are discarded.
 */

import { isGated } from "./chapter-graph.js";
import type { Branch, Chapter, Scene } from "./types/chapter.js";

export interface PathMetrics {
  /** Scenes visited, entry and ending included. */
  scenes: number;
  /** Scenes with 2+ ungated choices. Each is one vote at the table. */
  decisions: number;
  checks: number;
  encounters: number;
  /** Words read aloud: narration, check prompts, taken-branch narration. */
  words: number;
}

export interface PacingReport {
  chapterId: string;
  shortest: PathMetrics | null;
  typical: PathMetrics | null;
  /** Random walks that reached a success ending. */
  walksUsed: number;
  estimatedMinutes: number;
}

interface PacingEdge {
  to: string;
  /** Branch narration read when this edge is taken. */
  narration?: string;
}

export function countWords(text: string | undefined): number {
  const t = (text ?? "").trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

function branchEdge(branch: Branch | undefined): PacingEdge[] {
  return branch ? [{ to: branch.goto, narration: branch.narration }] : [];
}

/** Success-path edges out of a scene (see module header). */
export function pacingEdges(scene: Scene): PacingEdge[] {
  switch (scene.type) {
    case "story":
    case "choice_point":
    case "rest":
      return scene.choices.filter((c) => !isGated(c)).map((c) => ({ to: c.goto }));
    case "check":
      return [...branchEdge(scene.onSuccess), ...branchEdge(scene.onFailure)];
    case "encounter":
      return branchEdge(scene.onVictory);
    default:
      return [];
  }
}

function isDecision(scene: Scene): boolean {
  return (
    (scene.type === "story" || scene.type === "choice_point" || scene.type === "rest") &&
    scene.choices.filter((c) => !isGated(c)).length >= 2
  );
}

function sceneWords(scene: Scene): number {
  return countWords(scene.type === "check" ? `${scene.narration ?? ""} ${scene.prompt}` : scene.narration);
}

/** True for an ending that counts as a success. */
function isSuccessEnding(scene: Scene): boolean {
  if (pacingEdges(scene).length > 0) return false;
  return !("outcome" in scene && scene.outcome === "setback");
}

/** Metrics for an explicit path: scene ids in order, so edge i leads to path[i+1]. */
export function pathMetrics(chapter: Chapter, path: readonly string[]): PathMetrics {
  const m: PathMetrics = { scenes: 0, decisions: 0, checks: 0, encounters: 0, words: 0 };
  path.forEach((id, i) => {
    const scene = chapter.scenes[id];
    if (!scene) return;
    m.scenes += 1;
    if (isDecision(scene)) m.decisions += 1;
    if (scene.type === "check") m.checks += 1;
    if (scene.type === "encounter") m.encounters += 1;
    m.words += sceneWords(scene);
    const next = path[i + 1];
    if (next !== undefined) {
      m.words += countWords(pacingEdges(scene).find((e) => e.to === next)?.narration);
    }
  });
  return m;
}

/** Fewest-scenes path to a success ending (breadth-first, so ties go to authored order). */
export function shortestSuccessPath(chapter: Chapter): string[] | null {
  const prev = new Map<string, string | null>([[chapter.entry, null]]);
  const queue = [chapter.entry];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head] as string;
    const scene = chapter.scenes[id];
    if (!scene) continue;
    if (isSuccessEnding(scene)) {
      const path: string[] = [];
      for (let at: string | null | undefined = id; at != null; at = prev.get(at)) path.push(at);
      return path.reverse();
    }
    for (const e of pacingEdges(scene)) {
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
): { metrics: PathMetrics | null; used: number } {
  const rand = seededRandom(seed);
  const samples: PathMetrics[] = [];
  for (let w = 0; w < walks; w++) {
    const path = [chapter.entry];
    let id = chapter.entry;
    for (let step = 0; step < maxSteps; step++) {
      const scene = chapter.scenes[id];
      if (!scene) break;
      const edges = pacingEdges(scene).filter((e) => chapter.scenes[e.to]);
      if (edges.length === 0) {
        if (isSuccessEnding(scene)) samples.push(pathMetrics(chapter, path));
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
      encounters: pick("encounters"),
      words: pick("words"),
    },
    used: samples.length,
  };
}

export function pacingReport(chapter: Chapter, walks = DEFAULT_WALKS, seed = DEFAULT_SEED): PacingReport {
  const shortestPath = shortestSuccessPath(chapter);
  const typical = typicalMetrics(chapter, walks, seed);
  return {
    chapterId: chapter.id,
    shortest: shortestPath ? pathMetrics(chapter, shortestPath) : null,
    typical: typical.metrics,
    walksUsed: typical.used,
    estimatedMinutes: chapter.estimatedMinutes,
  };
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

export function predictMinutes(m: PathMetrics, model: PacingModel = UNCALIBRATED_MODEL): number {
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
export function fitModel(rows: { metrics: PathMetrics; minutes: number }[]): Fit | null {
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
