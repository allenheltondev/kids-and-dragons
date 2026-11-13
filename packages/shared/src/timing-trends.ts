/**
 * Observed timing over time, and one revision of a chapter against another
 * (docs/session-timing.md, "Trends and comparisons"). The questions a big UX
 * change is judged by: is play getting longer or shorter week by week, are
 * more tables finishing, and did this edit to this chapter move its minutes.
 *
 * Both read sittings and aggregates `session-timing.ts` already makes, under
 * the same clock policy, and say how big each sample is. A comparison never
 * calls a change real unless the middle halves stop overlapping, and never on
 * fewer than `FEW_SAMPLE` attempts a side.
 */

import { distribution, FEW_SAMPLE, sampleLabel, type ChapterAggregate, type SittingSummary, type TimingSource } from "./session-timing.js";
import type { ActivityReport } from "./play-timing.js";

export type TrendBucketSize = "day" | "week";

export interface TrendBucket {
  /** Inclusive start and exclusive end, ISO, UTC. Weeks start on Monday. */
  from: string;
  to: string;
  /** Sittings begun in the bucket, by kind. */
  started: number;
  fresh: number;
  revisits: number;
  resumed: number;
  completed: number;
  setbacks: number;
  /** Closed, or abandoned: the table left without finishing or saving. */
  leftUnfinished: number;
  /** Completed of those that ended (completed, closed, abandoned); null when none did. */
  completionRate: number | null;
  /** Median active minutes of completed fresh sittings begun in the bucket. */
  freshActiveMs: number | null;
  freshCompleted: number;
  games: number;
  medianGamePlayMs: number | null;
  /** Share of game visits that failed or were assisted. */
  gameHardRate: number | null;
  fights: number;
  medianFightMs: number | null;
  medianFightRounds: number | null;
  /** Silences past the idle cap, per sitting. */
  idleGapsPerSitting: number;
  partySizes: Record<string, number>;
}

const DAY_MS = 86_400_000;

function bucketStart(ms: number, size: TrendBucketSize): number {
  const day = Math.floor(ms / DAY_MS) * DAY_MS;
  if (size === "day") return day;
  // 1970-01-01 was a Thursday; Monday-based weeks.
  const weekday = (Math.floor(ms / DAY_MS) + 3) % 7;
  return day - weekday * DAY_MS;
}

/**
 * Sittings bucketed by the day or week they began, oldest first, empty buckets
 * included between the first and the last so a gap reads as a gap.
 */
export function timingTrends(
  sittings: readonly SittingSummary[],
  options: { bucket?: TrendBucketSize; source?: TimingSource; chapterId?: string } = {},
): TrendBucket[] {
  const size = options.bucket ?? "week";
  const source = options.source ?? "family";
  const rows = sittings.filter((s) => s.source === source && (!options.chapterId || s.chapterId === options.chapterId));
  if (rows.length === 0) return [];
  const groups = new Map<number, SittingSummary[]>();
  for (const s of rows) {
    const key = bucketStart(Date.parse(s.startedAt), size);
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const keys = [...groups.keys()].sort((a, b) => a - b);
  const step = size === "day" ? DAY_MS : 7 * DAY_MS;
  const out: TrendBucket[] = [];
  for (let at = keys[0] as number; at <= (keys[keys.length - 1] as number); at += step) {
    const g = groups.get(at) ?? [];
    const ended = g.filter((s) => s.status === "completed" || s.status === "closed" || s.status === "abandoned");
    const completed = g.filter((s) => s.status === "completed");
    const freshDone = completed.filter((s) => s.kind === "fresh");
    const games = g.flatMap((s) => (s.games ?? []).filter((x) => x.finished));
    const fights = g.flatMap((s) => (s.fights ?? []).filter((x) => x.finished));
    const sizes: Record<string, number> = {};
    for (const s of g) sizes[String(s.partySize)] = (sizes[String(s.partySize)] ?? 0) + 1;
    out.push({
      from: new Date(at).toISOString(),
      to: new Date(at + step).toISOString(),
      started: g.length,
      fresh: g.filter((s) => s.kind === "fresh").length,
      revisits: g.filter((s) => s.kind === "revisit").length,
      resumed: g.filter((s) => s.kind === "resumed").length,
      completed: completed.length,
      setbacks: completed.filter((s) => s.outcome === "setback").length,
      leftUnfinished: g.filter((s) => s.status === "closed" || s.status === "abandoned").length,
      completionRate: ended.length > 0 ? completed.length / ended.length : null,
      freshActiveMs: distribution(freshDone.map((s) => s.activeMs))?.median ?? null,
      freshCompleted: freshDone.length,
      games: games.length,
      medianGamePlayMs: distribution(games.map((x) => x.playMs))?.median ?? null,
      gameHardRate: games.length > 0 ? games.filter((x) => x.outcome === "failure" || x.outcome === "assisted").length / games.length : null,
      fights: fights.length,
      medianFightMs: distribution(fights.map((x) => x.fightMs))?.median ?? null,
      medianFightRounds: distribution(fights.map((x) => x.rounds))?.median ?? null,
      idleGapsPerSitting: g.length > 0 ? g.reduce((t, s) => t + s.idleGaps, 0) / g.length : 0,
      partySizes: sizes,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// One revision against another

export type ChangeVerdict = "too_few" | "shorter" | "longer" | "no_clear_change";

export interface Change {
  verdict: ChangeVerdict;
  /** After minus before, at the median; null when either side has none. */
  deltaMs: number | null;
  words: string;
}

export interface SideSummary {
  revision: string;
  sample: string;
  attempts: number;
  freshCompleted: number;
  freshActiveMs: { median: number; p25: number; p75: number } | null;
  completionRate: number | null;
  setbackRate: number | null;
  bucketMedianMs: ChapterAggregate["bucketMedianMs"];
  lastPlayedAt: string;
}

export interface RevisionComparison {
  chapterId: string;
  source: TimingSource;
  before: SideSummary;
  after: SideSummary;
  chapter: Change;
  /** Scenes in both revisions, biggest change first; then scenes only one side has. */
  scenes: Array<{ scene: string; beforeMs: number | null; afterMs: number | null; deltaMs: number | null; n: [number, number] }>;
  games: Array<{ scene: string; game: string; beforePlayMs: number | null; afterPlayMs: number | null; beforeHardRate: number | null; afterHardRate: number | null; n: [number, number] }>;
  fights: Array<{ scene: string; beforeFightMs: number | null; afterFightMs: number | null; beforeRounds: number | null; afterRounds: number | null; n: [number, number] }>;
  caution: string;
}

function side(a: ChapterAggregate): SideSummary {
  const ended = a.completed + a.abandoned;
  return {
    revision: a.revision,
    sample: a.sampleLabel,
    attempts: a.attempts,
    freshCompleted: a.freshActiveMs?.n ?? 0,
    freshActiveMs: a.freshActiveMs ? { median: a.freshActiveMs.median, p25: a.freshActiveMs.p25, p75: a.freshActiveMs.p75 } : null,
    completionRate: ended > 0 ? a.completed / ended : null,
    setbackRate: a.completed > 0 ? a.outcomes.setback / a.completed : null,
    bucketMedianMs: a.bucketMedianMs,
    lastPlayedAt: a.lastPlayedAt,
  };
}

/** Whether `after` moved from `before`: only when both are real samples and their middle halves part. */
export function judgeChange(before: ChapterAggregate["freshActiveMs"], after: ChapterAggregate["freshActiveMs"]): Change {
  const mins = (ms: number): string => `${(ms / 60_000).toFixed(1)} min`;
  if (!before || !after || before.n < FEW_SAMPLE || after.n < FEW_SAMPLE) {
    const delta = before && after ? after.median - before.median : null;
    return {
      verdict: "too_few",
      deltaMs: delta,
      words: `too few completed fresh attempts to compare (${String(before?.n ?? 0)} before, ${String(after?.n ?? 0)} after; ${String(FEW_SAMPLE)} a side at least)`,
    };
  }
  const delta = after.median - before.median;
  const moved = `median ${mins(before.median)} -> ${mins(after.median)} (${delta >= 0 ? "+" : ""}${mins(delta)})`;
  if (after.p75 < before.p25) return { verdict: "shorter", deltaMs: delta, words: `shorter: ${moved}, and the middle halves no longer overlap` };
  if (after.p25 > before.p75) return { verdict: "longer", deltaMs: delta, words: `longer: ${moved}, and the middle halves no longer overlap` };
  return { verdict: "no_clear_change", deltaMs: delta, words: `no clear change: ${moved}, within the spread of both` };
}

/**
 * One revision of a chapter against another, from one report. Both must have
 * been played; scenes, games and fights are matched by scene id, so a scene
 * renamed by the edit reads as one removed and one added.
 */
export function compareRevisions(
  report: { aggregates: readonly ChapterAggregate[]; activities?: ActivityReport | undefined },
  chapterId: string,
  beforeRevision: string,
  afterRevision: string,
  source: TimingSource = "family",
): RevisionComparison | null {
  const find = (rev: string) => report.aggregates.find((a) => a.source === source && a.chapterId === chapterId && a.revision === rev);
  const a = find(beforeRevision);
  const b = find(afterRevision);
  if (!a || !b) return null;
  const sceneIds = [...new Set([...a.scenes.map((s) => s.scene), ...b.scenes.map((s) => s.scene)])];
  const scenes = sceneIds
    .map((scene) => {
      const x = a.scenes.find((s) => s.scene === scene);
      const y = b.scenes.find((s) => s.scene === scene);
      return {
        scene,
        beforeMs: x?.activeMs.median ?? null,
        afterMs: y?.activeMs.median ?? null,
        deltaMs: x && y ? y.activeMs.median - x.activeMs.median : null,
        n: [x?.n ?? 0, y?.n ?? 0] as [number, number],
      };
    })
    .sort((p, q) => (p.deltaMs === null ? 1 : 0) - (q.deltaMs === null ? 1 : 0) || Math.abs(q.deltaMs ?? 0) - Math.abs(p.deltaMs ?? 0));
  const acts = report.activities;
  const on = <T extends { source: TimingSource; chapterId: string; revision: string; scene: string }>(rows: readonly T[] | undefined, rev: string) =>
    (rows ?? []).filter((r) => r.source === source && r.chapterId === chapterId && r.revision === rev);
  const gamesA = on(acts?.games, beforeRevision);
  const gamesB = on(acts?.games, afterRevision);
  const hard = (g: (typeof gamesA)[number] | undefined) => (g ? (g.outcomes.failure + g.outcomes.assisted) / g.n : null);
  const games = [...new Set([...gamesA, ...gamesB].map((g) => g.scene))].map((scene) => {
    const x = gamesA.find((g) => g.scene === scene);
    const y = gamesB.find((g) => g.scene === scene);
    return {
      scene,
      game: (y ?? x)!.game,
      beforePlayMs: x?.playMs.median ?? null,
      afterPlayMs: y?.playMs.median ?? null,
      beforeHardRate: hard(x),
      afterHardRate: hard(y),
      n: [x?.n ?? 0, y?.n ?? 0] as [number, number],
    };
  });
  const fightsA = on(acts?.fights, beforeRevision);
  const fightsB = on(acts?.fights, afterRevision);
  const fights = [...new Set([...fightsA, ...fightsB].map((f) => f.scene))].map((scene) => {
    const x = fightsA.find((f) => f.scene === scene);
    const y = fightsB.find((f) => f.scene === scene);
    return {
      scene,
      beforeFightMs: x?.fightMs.median ?? null,
      afterFightMs: y?.fightMs.median ?? null,
      beforeRounds: x?.rounds.median ?? null,
      afterRounds: y?.rounds.median ?? null,
      n: [x?.n ?? 0, y?.n ?? 0] as [number, number],
    };
  });
  return {
    chapterId,
    source,
    before: side(a),
    after: side(b),
    chapter: judgeChange(a.freshActiveMs, b.freshActiveMs),
    scenes,
    games,
    fights,
    caution: `Different families played each text, at different times; ${sampleLabel(a.freshActiveMs?.n ?? 0)} before and ${sampleLabel(b.freshActiveMs?.n ?? 0)} after. A scene's change is a lead to read, not a measurement.`,
  };
}
