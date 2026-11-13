/**
 * Observed timing of mini-games and fights, and the findings an operator acts
 * on (docs/session-timing.md, "Mini-games and fights" and "Findings").
 *
 * A sitting's summary (`session-timing.ts`) already splits each mini-game
 * visit into the ready screen, play and the result, and each fight into the
 * ready-up and the fight, under the same clock policy as the chapter. This
 * groups those visits by scene (and chapter revision, and source) and rolls
 * them up by kind of game and across fights, so "which games run long" and
 * "which fights drag" can be asked across every chapter at once.
 *
 * **Which visits count.** A visit the table went on from (`finished`), in any
 * sitting that is not a revisit: a fresh evening or a resumed one plays the
 * game for real either way, while a revisit's kids may know the answer.
 * Revisits and unfinished visits are counted beside each row and kept out of
 * its numbers. Sittings recorded before games and fights were marked have no
 * rows here; their minutes still count in the chapter's buckets.
 *
 * **Findings** are a ranked reading list, never a verdict: a threshold crossed
 * on a real sample, the evidence, and the first thing to try. Nothing below
 * `FEW_SAMPLE` is reported, and below `ENOUGH_SAMPLE` a finding is "look", not
 * "act". Elapsed time does not say a game is fun or dull.
 */

import {
  CHAPTER_BUDGET_MINUTES,
  distribution,
  ENOUGH_SAMPLE,
  FEW_SAMPLE,
  sampleLabel,
  sampleSize,
  type ChapterAggregate,
  type Distribution,
  type FightOutcome,
  type FightTiming,
  type GameKind,
  type GameTiming,
  type SampleSize,
  type SittingSummary,
  type TimingSource,
} from "./session-timing.js";
import type { SceneType } from "./types/chapter.js";

export interface GameAggregate {
  source: TimingSource;
  chapterId: string;
  revision: string;
  scene: string;
  game: GameKind;
  /** Finished visits counted below. */
  n: number;
  /** Finished visits in revisits, kept out. */
  revisits: number;
  /** Visits a sitting stopped inside, kept out. */
  unfinished: number;
  activeMs: Distribution;
  readyMs: Distribution;
  playMs: Distribution;
  afterMs: Distribution;
  /** Attempts per visit. */
  attempts: Distribution;
  /** Visits that took more than one attempt. */
  retried: number;
  outcomes: Record<"success" | "failure" | "assisted", number>;
  relaxed: number;
  sample: SampleSize;
  sampleLabel: string;
}

export interface FightAggregate {
  source: TimingSource;
  chapterId: string;
  revision: string;
  scene: string;
  /** Foes on the board, as last seen; null when no begin was marked. */
  foes: number | null;
  foeKinds: string[];
  n: number;
  revisits: number;
  unfinished: number;
  activeMs: Distribution;
  setupMs: Distribution;
  fightMs: Distribution;
  rounds: Distribution;
  /** Median of each fight's minutes per round. */
  msPerRound: number | null;
  outcomes: Record<FightOutcome, number>;
  /** By heroes on the board ("1".."4"): fights, median fight minutes, median rounds. */
  byHeroes: Record<string, { n: number; fightMs: number; rounds: number }>;
  sample: SampleSize;
  sampleLabel: string;
}

/**
 * One kind of screen across every chapter: how long a visit to a story scene,
 * a vote, a check, a rest, a mini-game or a fight takes. The question a UX
 * change to one kind of screen is judged by.
 */
export interface SceneTypeAggregate {
  source: TimingSource;
  type: SceneType;
  /** Scene visits read: completed sittings that are not revisits. */
  visits: number;
  /** Active time per visit. */
  perVisitMs: Distribution;
  /** Share of all active time in those sittings. */
  share: number;
  /** Share of visits where the table went silent past the idle cap. */
  stallRate: number;
  sample: SampleSize;
  sampleLabel: string;
}

/** One kind of mini-game across every chapter and revision it appears in. */
export interface GameKindAggregate {
  source: TimingSource;
  game: GameKind;
  /** Distinct chapter scenes playing it. */
  scenes: number;
  n: number;
  activeMs: Distribution;
  readyMs: Distribution;
  playMs: Distribution;
  attemptsPerVisit: number;
  retryRate: number;
  failureRate: number;
  assistedRate: number;
  sample: SampleSize;
  sampleLabel: string;
}

/** Every fight of one source, pooled. */
export interface FightTotals {
  source: TimingSource;
  scenes: number;
  n: number;
  activeMs: Distribution;
  setupMs: Distribution;
  fightMs: Distribution;
  rounds: Distribution;
  msPerRound: number | null;
  /** Lost, or out of time: not won and not escaped by choice. */
  defeatRate: number;
  sample: SampleSize;
  sampleLabel: string;
}

export interface ActivityReport {
  /** Per scene, slowest median first. */
  games: GameAggregate[];
  fights: FightAggregate[];
  /** Per kind of game, slowest median play first. */
  gameKinds: GameKindAggregate[];
  fightTotals: FightTotals[];
  /** Per kind of screen, slowest median visit first. Absent on reports made before it was. */
  sceneTypes?: SceneTypeAggregate[];
}

const d = (values: readonly number[]): Distribution => distribution(values) as Distribution;
const rate = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

interface Bucket<R> {
  source: TimingSource;
  chapterId: string;
  revision: string;
  scene: string;
  rows: R[];
  revisits: number;
  unfinished: number;
}

function collect<R extends { scene: string; finished: boolean }>(
  sittings: readonly SittingSummary[],
  pick: (s: SittingSummary) => readonly R[],
): Array<Bucket<R>> {
  const out = new Map<string, Bucket<R>>();
  for (const s of sittings) {
    for (const row of pick(s)) {
      const key = [s.source, s.chapterId, s.revision, row.scene].join("\u0000");
      const b = out.get(key) ?? { source: s.source, chapterId: s.chapterId, revision: s.revision, scene: row.scene, rows: [], revisits: 0, unfinished: 0 };
      if (!row.finished) b.unfinished += 1;
      else if (s.kind === "revisit") b.revisits += 1;
      else b.rows.push(row);
      out.set(key, b);
    }
  }
  return [...out.values()];
}

function perRound(rows: readonly FightTiming[]): number | null {
  return distribution(rows.filter((r) => r.rounds > 0).map((r) => r.fightMs / r.rounds))?.median ?? null;
}

/** Mini-games and fights from a set of sittings: per scene, per kind of game, and every fight pooled. */
export function aggregateActivities(sittings: readonly SittingSummary[]): ActivityReport {
  const games: GameAggregate[] = collect(sittings, (s) => s.games ?? [])
    .filter((b) => b.rows.length > 0)
    .map((b) => {
      const rows = b.rows as GameTiming[];
      const count = (o: GameTiming["outcome"]): number => rows.filter((r) => r.outcome === o).length;
      return {
        source: b.source,
        chapterId: b.chapterId,
        revision: b.revision,
        scene: b.scene,
        game: (rows[rows.length - 1] as GameTiming).game,
        n: rows.length,
        revisits: b.revisits,
        unfinished: b.unfinished,
        activeMs: d(rows.map((r) => r.activeMs)),
        readyMs: d(rows.map((r) => r.readyMs)),
        playMs: d(rows.map((r) => r.playMs)),
        afterMs: d(rows.map((r) => r.afterMs)),
        attempts: d(rows.map((r) => r.attempts)),
        retried: rows.filter((r) => r.attempts > 1).length,
        outcomes: { success: count("success"), failure: count("failure"), assisted: count("assisted") },
        relaxed: rows.filter((r) => r.relaxed).length,
        sample: sampleSize(rows.length),
        sampleLabel: sampleLabel(rows.length),
      };
    })
    .sort((a, b) => b.activeMs.median - a.activeMs.median);

  const fights: FightAggregate[] = collect(sittings, (s) => s.fights ?? [])
    .filter((b) => b.rows.length > 0)
    .map((b) => {
      const rows = b.rows as FightTiming[];
      const count = (o: FightOutcome): number => rows.filter((r) => r.outcome === o).length;
      const last = [...rows].reverse().find((r) => r.foes !== null);
      return {
        source: b.source,
        chapterId: b.chapterId,
        revision: b.revision,
        scene: b.scene,
        foes: last?.foes ?? null,
        foeKinds: last?.foeKinds ?? [],
        n: rows.length,
        revisits: b.revisits,
        unfinished: b.unfinished,
        activeMs: d(rows.map((r) => r.activeMs)),
        setupMs: d(rows.map((r) => r.setupMs)),
        fightMs: d(rows.map((r) => r.fightMs)),
        rounds: d(rows.map((r) => r.rounds)),
        msPerRound: perRound(rows),
        outcomes: { victory: count("victory"), defeat: count("defeat"), escaped: count("escaped"), timedOut: count("timedOut") },
        byHeroes: byHeroes(rows),
        sample: sampleSize(rows.length),
        sampleLabel: sampleLabel(rows.length),
      };
    })
    .sort((a, b) => b.activeMs.median - a.activeMs.median);

  const kinds = new Map<string, { source: TimingSource; game: GameKind; scenes: Set<string>; rows: GameTiming[] }>();
  for (const b of collect(sittings, (s) => s.games ?? [])) {
    for (const row of b.rows as GameTiming[]) {
      const key = `${b.source}\u0000${row.game}`;
      const k = kinds.get(key) ?? { source: b.source, game: row.game, scenes: new Set<string>(), rows: [] };
      k.scenes.add(`${b.chapterId}/${b.scene}`);
      k.rows.push(row);
      kinds.set(key, k);
    }
  }
  const gameKinds: GameKindAggregate[] = [...kinds.values()]
    .map((k) => ({
      source: k.source,
      game: k.game,
      scenes: k.scenes.size,
      n: k.rows.length,
      activeMs: d(k.rows.map((r) => r.activeMs)),
      readyMs: d(k.rows.map((r) => r.readyMs)),
      playMs: d(k.rows.map((r) => r.playMs)),
      attemptsPerVisit: k.rows.reduce((t, r) => t + r.attempts, 0) / k.rows.length,
      retryRate: rate(k.rows.filter((r) => r.attempts > 1).length, k.rows.length),
      failureRate: rate(k.rows.filter((r) => r.outcome === "failure").length, k.rows.length),
      assistedRate: rate(k.rows.filter((r) => r.outcome === "assisted").length, k.rows.length),
      sample: sampleSize(k.rows.length),
      sampleLabel: sampleLabel(k.rows.length),
    }))
    .sort((a, b) => b.playMs.median - a.playMs.median);

  const pooled = new Map<TimingSource, { scenes: Set<string>; rows: FightTiming[] }>();
  for (const b of collect(sittings, (s) => s.fights ?? [])) {
    const p = pooled.get(b.source) ?? { scenes: new Set<string>(), rows: [] };
    if (b.rows.length > 0) p.scenes.add(`${b.chapterId}/${b.scene}`);
    p.rows.push(...(b.rows as FightTiming[]));
    pooled.set(b.source, p);
  }
  const fightTotals: FightTotals[] = [...pooled]
    .filter(([, p]) => p.rows.length > 0)
    .map(([source, p]) => ({
      source,
      scenes: p.scenes.size,
      n: p.rows.length,
      activeMs: d(p.rows.map((r) => r.activeMs)),
      setupMs: d(p.rows.map((r) => r.setupMs)),
      fightMs: d(p.rows.map((r) => r.fightMs)),
      rounds: d(p.rows.map((r) => r.rounds)),
      msPerRound: perRound(p.rows),
      defeatRate: rate(p.rows.filter((r) => r.outcome === "defeat" || r.outcome === "timedOut").length, p.rows.length),
      sample: sampleSize(p.rows.length),
      sampleLabel: sampleLabel(p.rows.length),
    }));

  return { games, fights, gameKinds, fightTotals, sceneTypes: aggregateSceneTypes(sittings) };
}

function byHeroes(rows: readonly FightTiming[]): Record<string, { n: number; fightMs: number; rounds: number }> {
  const groups = new Map<string, FightTiming[]>();
  for (const r of rows) if (r.heroes !== null) groups.set(String(r.heroes), [...(groups.get(String(r.heroes)) ?? []), r]);
  return Object.fromEntries(
    [...groups].sort().map(([k, g]) => [k, { n: g.length, fightMs: d(g.map((r) => r.fightMs)).median, rounds: d(g.map((r) => r.rounds)).median }]),
  );
}

/** Per kind of screen, from completed sittings that are not revisits. */
export function aggregateSceneTypes(sittings: readonly SittingSummary[]): SceneTypeAggregate[] {
  const bySource = new Map<TimingSource, { total: number; types: Map<SceneType, { values: number[]; stalled: number; ms: number }> }>();
  for (const s of sittings) {
    if (s.status !== "completed" || s.kind === "revisit") continue;
    const src = bySource.get(s.source) ?? { total: 0, types: new Map() };
    for (const sc of s.scenes) {
      if (sc.visits <= 0) continue;
      const t = src.types.get(sc.type) ?? { values: [], stalled: 0, ms: 0 };
      // A scene visited twice in a sitting counts as two visits of its average length.
      for (let i = 0; i < sc.visits; i++) t.values.push(sc.activeMs / sc.visits);
      t.stalled += Math.min(sc.visits, sc.idleGaps ?? 0);
      t.ms += sc.activeMs;
      src.total += sc.activeMs;
      src.types.set(sc.type, t);
    }
    bySource.set(s.source, src);
  }
  const out: SceneTypeAggregate[] = [];
  for (const [source, src] of bySource) {
    for (const [type, t] of src.types) {
      out.push({
        source,
        type,
        visits: t.values.length,
        perVisitMs: d(t.values),
        share: rate(t.ms, src.total),
        stallRate: rate(t.stalled, t.values.length),
        sample: sampleSize(t.values.length),
        sampleLabel: sampleLabel(t.values.length),
      });
    }
  }
  return out.sort((a, b) => b.perVisitMs.median - a.perVisitMs.median);
}

// ---------------------------------------------------------------------------
// Findings

/**
 * Where a finding starts. Each is a line in docs/session-timing.md
 * ("Findings"); change them there too.
 */
export const FINDING_THRESHOLDS = {
  /** A chapter's fresh median over this share of the budget is long, under the second short (as `budgetVerdict`). */
  chapterOver: 1.25,
  chapterUnder: 0.75,
  /** One scene holding this share of the chapter's median. */
  sceneShare: 0.15,
  /** Share of completed attempts that went silent past the idle cap in one scene. */
  stallShare: 0.25,
  /** Unfinished attempts left at one scene: at least this many, and this share of the chapter's attempts. */
  leftAtCount: 2,
  leftAtShare: 0.2,
  /** A mini-game's median play, or a fight's median fight, longer than this. */
  gamePlayMinutes: 4,
  fightMinutes: 8,
  /** Rules §7.1 tunes a fight to about four rounds. */
  fightRounds: 6,
  /** The ready screen, or a fight's ready-up, longer than this at the median. */
  readyMinutes: 2,
  /** Share of visits failed or assisted, or retried; share of fights lost or out of time. */
  gameHardShare: 0.5,
  fightLostShare: 0.5,
  /** The idle cap itself (session-timing.ts), quoted in the stall finding. */
  idleCapMinutes: 5,
} as const;

export type FindingKind =
  | "chapter_long"
  | "chapter_short"
  | "scene_heavy"
  | "stalls_here"
  | "left_here"
  | "game_long"
  | "game_hard"
  | "game_slow_start"
  | "fight_long"
  | "fight_hard"
  | "fight_slow_start";

export interface TimingFinding {
  /** "act": crossed on a sample of `ENOUGH_SAMPLE` or more. "look": a preliminary sample. */
  severity: "act" | "look";
  kind: FindingKind;
  source: TimingSource;
  chapterId: string;
  revision: string;
  scene: string | null;
  title: string;
  evidence: string;
  sampleLabel: string;
  /** The first thing to try, in the chapter's own terms. */
  suggestion: string;
  /** How far past the threshold, for ranking: 1 is at it. */
  score: number;
}

export interface FindingOptions {
  /** Family only unless asked. */
  source?: TimingSource;
  /** Only each chapter's most recently played revision (the default), or every revision. */
  allRevisions?: boolean;
  budgetMinutes?: number;
  chapterId?: string;
  /**
   * The revision each chapter's text has now (the MCP server's chapter index,
   * or the content on disk). When a chapter has sittings on it, findings read
   * that revision; otherwise its most recently played one.
   */
  currentRevisions?: ReadonlyMap<string, string>;
}

const mins = (ms: number): string => `${(ms / 60_000).toFixed(1)} min`;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

/**
 * The revision of each chapter to read, keyed `source\u0000chapterId`: the
 * current text when it is known and has been played, else the most recently
 * played revision.
 */
export function latestRevisions(aggregates: readonly ChapterAggregate[], current?: ReadonlyMap<string, string>): Map<string, string> {
  const best = new Map<string, ChapterAggregate>();
  for (const a of aggregates) {
    const key = `${a.source}\u0000${a.chapterId}`;
    const seen = best.get(key);
    const isCurrent = current?.get(a.chapterId) === a.revision;
    const seenCurrent = seen ? current?.get(seen.chapterId) === seen.revision : false;
    if (!seen || (isCurrent && !seenCurrent) || (isCurrent === seenCurrent && (a.lastPlayedAt ?? "") > (seen.lastPlayedAt ?? ""))) best.set(key, a);
  }
  return new Map([...best].map(([key, a]) => [key, a.revision]));
}

/**
 * What in a report is worth acting on, most pressing first. A reading list:
 * each finding says what crossed which line, on how big a sample, and the
 * first thing to try.
 */
export function timingFindings(
  report: { aggregates: readonly ChapterAggregate[]; activities?: ActivityReport | undefined },
  options: FindingOptions = {},
): TimingFinding[] {
  const T = FINDING_THRESHOLDS;
  const source = options.source ?? "family";
  const budget = options.budgetMinutes ?? CHAPTER_BUDGET_MINUTES;
  const latest = latestRevisions(report.aggregates, options.currentRevisions);
  const wanted = (r: { source: TimingSource; chapterId: string; revision: string }): boolean =>
    r.source === source &&
    (!options.chapterId || r.chapterId === options.chapterId) &&
    (options.allRevisions || latest.get(`${r.source}\u0000${r.chapterId}`) === r.revision);
  const out: TimingFinding[] = [];
  const add = (n: number, f: Omit<TimingFinding, "severity" | "sampleLabel" | "source">): void => {
    if (n < FEW_SAMPLE) return;
    out.push({ ...f, source, severity: n >= ENOUGH_SAMPLE ? "act" : "look", sampleLabel: sampleLabel(n) });
  };

  for (const a of report.aggregates.filter(wanted)) {
    const base = { chapterId: a.chapterId, revision: a.revision };
    const med = a.freshActiveMs?.median ?? null;
    const n = a.freshActiveMs?.n ?? 0;
    if (med !== null) {
      const ratio = med / (budget * 60_000);
      const slow = a.scenes.slice(0, 3).map((s) => s.scene).join(", ");
      if (ratio > T.chapterOver) {
        add(n, {
          ...base, kind: "chapter_long", scene: null, score: ratio / T.chapterOver,
          title: `${a.chapterId} runs long`,
          evidence: `median ${mins(med)} active against a ${String(budget)}-minute budget`,
          suggestion: `Tighten the slowest scenes (${slow || "see the chapter's scenes"}): shorter narration, fewer one-button beats in a row. Keep the spine at 30 scenes and 14 asks; trim words, not choices.`,
        });
      } else if (ratio < T.chapterUnder) {
        add(n, {
          ...base, kind: "chapter_short", scene: null, score: T.chapterUnder / Math.max(ratio, 0.01),
          title: `${a.chapterId} runs short`,
          evidence: `median ${mins(med)} active against a ${String(budget)}-minute budget`,
          suggestion: "Add material on the spine every path walks (a check, a vote or a game), not on a detour a party can skip.",
        });
      }
    }
    for (const s of a.scenes) {
      if (s.share === null || s.share < T.sceneShare) continue;
      add(s.n, {
        ...base, kind: "scene_heavy", scene: s.scene, score: s.share / T.sceneShare,
        title: `${s.scene} holds ${pct(s.share)} of ${a.chapterId}`,
        evidence: `median ${mins(s.activeMs.median)} active in one ${s.bucket === "narration" ? "story" : s.bucket === "activity" ? "mini-game" : "fight"} scene`,
        suggestion:
          s.bucket === "encounter"
            ? "See the fight's own findings: rounds, ready-up and losses say where its minutes go."
            : s.bucket === "activity"
              ? "See the mini-game's own findings: ready screen, play and retries say where its minutes go."
              : "Read it aloud: long narration, a vote that stalls, or a choice whose options read alike.",
      });
    }
    const completed = a.freshActiveMs?.n ?? 0;
    for (const s of a.scenes) {
      const share = rate(s.stalls ?? 0, completed);
      if (share < T.stallShare || (s.stalls ?? 0) < 2) continue;
      add(completed, {
        ...base, kind: "stalls_here", scene: s.scene, score: share / T.stallShare,
        title: `Tables go quiet at ${s.scene}`,
        evidence: `${String(s.stalls)} of ${String(completed)} completed attempts sat silent over ${String(T.idleCapMinutes)} minutes with this ${s.bucket === "narration" ? s.type.replace("_", " ") : s.bucket === "activity" ? "mini-game" : "fight"} open`,
        suggestion: "A silence that long is a table stuck or gone: an unclear next tap, a vote waiting on someone, a phone that dropped. Play to it and watch who the screen is waiting on.",
      });
    }
    for (const left of a.leftAt ?? []) {
      const share = left.attempts / Math.max(1, a.attempts);
      if (left.attempts < T.leftAtCount || share < T.leftAtShare) continue;
      add(a.attempts, {
        ...base, kind: "left_here", scene: left.scene, score: share / T.leftAtShare,
        title: `Tables leave ${a.chapterId} at ${left.scene}`,
        evidence: `${String(left.attempts)} of ${String(a.attempts)} attempts ended unfinished with this scene open`,
        suggestion: "Play to it with `npm run play:jump` and look for a dead end, a confusing screen or a wait nobody can answer; it may also simply be where bedtime falls.",
      });
    }
  }

  const acts = report.activities;
  for (const g of (acts?.games ?? []).filter(wanted)) {
    const base = { chapterId: g.chapterId, revision: g.revision, scene: g.scene };
    const play = g.playMs.median;
    if (play > T.gamePlayMinutes * 60_000) {
      add(g.n, {
        ...base, kind: "game_long", score: play / (T.gamePlayMinutes * 60_000),
        title: `The ${g.game} game at ${g.scene} plays long`,
        evidence: `median ${mins(play)} of play (${mins(g.activeMs.median)} in the scene), ${g.attempts.median.toFixed(1)} attempts`,
        suggestion: "Shorten the game itself: fewer steps in an answer, a shorter `periodMs`/`stepMs` cycle, or fewer stages.",
      });
    }
    const hard = rate(g.outcomes.failure + g.outcomes.assisted, g.n);
    const retried = rate(g.retried, g.n);
    if (hard >= T.gameHardShare || retried >= T.gameHardShare) {
      add(g.n, {
        ...base, kind: "game_hard", score: Math.max(hard, retried) / T.gameHardShare,
        title: `The ${g.game} game at ${g.scene} is hard`,
        evidence: `${pct(hard)} failed or assisted, ${pct(retried)} retried, ${String(g.relaxed)} of ${String(g.n)} played relaxed`,
        suggestion: "Make it kinder: a wider `width`, a slower cycle, a shorter `answer`, or clearer clues. Check the failure road is a real story, not a retry.",
      });
    }
    if (g.readyMs.median > T.readyMinutes * 60_000) {
      add(g.n, {
        ...base, kind: "game_slow_start", score: g.readyMs.median / (T.readyMinutes * 60_000),
        title: `Tables wait on the ready screen at ${g.scene}`,
        evidence: `median ${mins(g.readyMs.median)} before the game starts`,
        suggestion: "The cue or the narration before it may be long, or nobody knows whose turn it is to press start. Check the `cue`, the scene's `hint` and who acts.",
      });
    }
  }
  for (const f of (acts?.fights ?? []).filter(wanted)) {
    const base = { chapterId: f.chapterId, revision: f.revision, scene: f.scene };
    const fight = f.fightMs.median;
    const rounds = f.rounds.median;
    if (fight > T.fightMinutes * 60_000 || rounds > T.fightRounds) {
      add(f.n, {
        ...base, kind: "fight_long", score: Math.max(fight / (T.fightMinutes * 60_000), rounds / T.fightRounds),
        title: `The fight at ${f.scene} drags`,
        evidence: `median ${mins(fight)} over ${rounds.toFixed(1)} rounds${f.msPerRound !== null ? ` (${mins(f.msPerRound)} a round)` : ""}${f.foes !== null ? `, ${String(f.foes)} foes (${f.foeKinds.join(", ")})` : ""}`,
        suggestion:
          rounds > T.fightRounds
            ? "Too many rounds: fewer foes, foes with fewer hearts, or an objective that ends it. Rules §7.1 tunes a fight to about four rounds."
            : "Rounds are slow, not many: turns stall. Look at how many choices a turn offers and whether a phone shows whose turn it is.",
      });
    }
    const lost = rate(f.outcomes.defeat + f.outcomes.timedOut, f.n);
    if (lost >= T.fightLostShare) {
      add(f.n, {
        ...base, kind: "fight_hard", score: lost / T.fightLostShare,
        title: `The fight at ${f.scene} is usually lost`,
        evidence: `${pct(lost)} lost or out of time (${String(f.outcomes.victory)} won, ${String(f.outcomes.escaped)} escaped)`,
        suggestion: "Make sure that is meant: a lost fight should rob, rescue or reroute, never be the usual road. Otherwise ease the foes or give the party an edge.",
      });
    }
    if (f.setupMs.median > T.readyMinutes * 60_000) {
      add(f.n, {
        ...base, kind: "fight_slow_start", score: f.setupMs.median / (T.readyMinutes * 60_000),
        title: `The ready-up before the fight at ${f.scene} is slow`,
        evidence: `median ${mins(f.setupMs.median)} before the board goes up`,
        suggestion: "Every phone has to ready up. Check the narration before it is not long, and that the TV says who has not readied.",
      });
    }
  }

  return out.sort((a, b) => (a.severity === b.severity ? b.score - a.score : a.severity === "act" ? -1 : 1));
}
