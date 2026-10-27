/**
 * Family-session timing (#511): how long real tables take over a chapter.
 *
 * `estimatedMinutes` is a planned figure and `content:pacing` a synthetic
 * prediction. Neither says how long a family sat. This module turns what the
 * server already keeps, the run's event log (every committed step has a
 * server-stamped `at` and a seq), into an observed breakdown. Nothing here
 * reads a clock: every number is a pure function of persisted timestamps, so
 * a reload, a reconnect, a restart, a second phone or a duplicated input
 * cannot change it.
 *
 * **What is recorded.** The server annotates events with a small `TimingNote`
 * (`EventRecord.timing`): the chapter starting (with its context), each step
 * (the scene now open), pause, resume, a grown-up's note, the chapter ending,
 * and the room closing or stopping. No names, no chat, no audio; the only
 * party fact is how many were seated.
 *
 * **The clock policy**, in one place so a report can quote it:
 *  1. The clock starts at the commit that presents a chapter's first playable
 *     scene. A chapter that opens on a plate or a "last time" recap says so
 *     (`prefaced`): the screens show it first, but the server cannot see when
 *     it was dismissed, so that time sits in the first scene.
 *  2. Wall-clock is start to the last thing the server saw (or to "now" while
 *     the table is still playing).
 *  3. Between two events, time is *active* up to `IDLE_GAP_CAP_MS` and the
 *     rest is *idle*. A phone that went offline, a table that wandered off,
 *     and a screen left open all look the same to the server: silence. Silence
 *     past the cap is reported as idle, never guessed back into play, and
 *     counted in `idleGaps`.
 *  4. A grown-up's pause excludes everything until the matching resume
 *     (`pausedMs`). Steps taken while paused are counted
 *     (`stepsWhilePaused`) but never add active time. Turning timing off
 *     excludes time the same way, as `unrecordedMs`.
 *  5. `wallMs = activeMs + idleMs + pausedMs + unrecordedMs`, always.
 *  6. A sitting nobody finished or closed, silent for `ABANDON_AFTER_MS`, is
 *     `abandoned`; its last scene is not counted, because when the table left
 *     is unknowable.
 *  7. Timestamps are taken in seq order and never run backwards (a skewed
 *     clock reads as zero elapsed, not negative).
 *
 * **Sittings and attempts.** One chapter played in one room is a sitting.
 * A chapter stopped for today and taken up in another room is a chain of
 * sittings that is still one attempt; a chapter the household had already
 * finished is a revisit. The report keeps the three apart.
 *
 * Small samples are labelled as such (`sampleLabel`): a median of two is not a
 * measurement of a chapter, and nothing here infers engagement from elapsed
 * time.
 */

import type { SceneType } from "./types/chapter.js";

/** Silence longer than this between two events stops counting as play. */
export const IDLE_GAP_CAP_MS = 5 * 60_000;
/** An unfinished sitting this long silent is abandoned. */
export const ABANDON_AFTER_MS = 6 * 60 * 60_000;
/** The intended length of a chapter sitting, in minutes (CLAUDE.md, "Story shape"). */
export const CHAPTER_BUDGET_MINUTES = 30;
/** Fewer attempts than this are "too few"; fewer than `ENOUGH_SAMPLE` are "preliminary". */
export const FEW_SAMPLE = 3;
export const ENOUGH_SAMPLE = 8;
/** Longest grown-up note, in characters. */
export const TIMING_NOTE_MAX = 140;

export type TimingSource = "family" | "playtest";
export type TimingBucket = "narration" | "activity" | "encounter";
export type StepResult = "success" | "recovery" | "assisted";
export type AttemptKind = "fresh" | "revisit" | "resumed";

/** What a committed event says about timing. Stored on the event, never on the run state. */
export type TimingNote =
  | {
      kind: "start";
      source: TimingSource;
      chapterId: string;
      campaignId: string | null;
      /** A short hash of the chapter's content, so measurements never mix versions. */
      revision: string;
      partySize: number;
      /** The chapter opens on a plate or a recap the server cannot see dismissed. */
      prefaced: boolean;
      /** The household had already finished this chapter. */
      revisit: boolean;
      /** The sitting this one picks up (`runId:seq`), when a stopped game was resumed. */
      resumedFrom?: string;
      scene: string;
      type: SceneType;
    }
  | { kind: "step"; scene: string; type: SceneType; result?: StepResult }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "off" }
  | { kind: "on" }
  | { kind: "note"; text: string }
  | { kind: "end"; outcome: "success" | "setback"; routes: string[] }
  | { kind: "close" }
  | { kind: "stop" };

/** The slice of an event the timing reads. */
export interface TimingEvent {
  seq: number;
  at: string;
  timing?: TimingNote;
}

export type SittingStatus = "in_progress" | "completed" | "closed" | "saved" | "abandoned";

export interface SceneTiming {
  scene: string;
  type: SceneType;
  bucket: TimingBucket;
  activeMs: number;
  visits: number;
}

export interface SittingSummary {
  /** `runId:seq` of the start. */
  id: string;
  source: TimingSource;
  chapterId: string;
  campaignId: string | null;
  revision: string;
  kind: AttemptKind;
  resumedFrom: string | null;
  partySize: number;
  prefaced: boolean;
  status: SittingStatus;
  outcome: "success" | "setback" | null;
  startedAt: string;
  endedAt: string;
  wallMs: number;
  activeMs: number;
  idleMs: number;
  pausedMs: number;
  unrecordedMs: number;
  narrationMs: number;
  activityMs: number;
  encounterMs: number;
  idleGaps: number;
  pauses: number;
  stepsWhilePaused: number;
  steps: number;
  recoveries: number;
  assisted: number;
  routes: string[];
  note: string | null;
  scenes: SceneTiming[];
}

export function timingBucket(type: SceneType): TimingBucket {
  if (type === "interaction") return "activity";
  if (type === "encounter") return "encounter";
  return "narration";
}

/** A grown-up's note, trimmed to what the log keeps; null when nothing is left. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, TIMING_NOTE_MAX).trim();
  return text.length > 0 ? text : null;
}

/** The timing events of one run, in seq order, one per seq, with `at` never going backwards. */
export function orderedTimingEvents(events: readonly TimingEvent[]): Array<{ seq: number; ms: number; note: TimingNote }> {
  const bySeq = new Map<number, TimingEvent>();
  for (const e of events) if (e.timing && !bySeq.has(e.seq)) bySeq.set(e.seq, e);
  const out: Array<{ seq: number; ms: number; note: TimingNote }> = [];
  let last = -Infinity;
  for (const e of [...bySeq.values()].sort((a, b) => a.seq - b.seq)) {
    const parsed = Date.parse(e.at);
    if (!Number.isFinite(parsed)) continue;
    const ms = Math.max(parsed, last);
    last = ms;
    out.push({ seq: e.seq, ms, note: e.timing as TimingNote });
  }
  return out;
}

/**
 * Every sitting in one run's event log. `nowMs` only matters to a sitting
 * still open: it decides between "in progress" and "abandoned" and bounds the
 * tail of the one in progress.
 */
export function sittingsFromEvents(runId: string, events: readonly TimingEvent[], nowMs: number): SittingSummary[] {
  const ordered = orderedTimingEvents(events);
  const groups: Array<typeof ordered> = [];
  for (const entry of ordered) {
    if (entry.note.kind === "start") groups.push([entry]);
    else groups[groups.length - 1]?.push(entry);
  }
  return groups.map((group) => summarize(runId, group, nowMs));
}

function summarize(runId: string, group: Array<{ seq: number; ms: number; note: TimingNote }>, nowMs: number): SittingSummary {
  const first = group[0] as (typeof group)[number] & { note: Extract<TimingNote, { kind: "start" }> };
  const start = first.note;
  const scenes = new Map<string, SceneTiming>();
  const s: SittingSummary = {
    id: `${runId}:${first.seq}`,
    source: start.source,
    chapterId: start.chapterId,
    campaignId: start.campaignId,
    revision: start.revision,
    kind: start.resumedFrom ? "resumed" : start.revisit ? "revisit" : "fresh",
    resumedFrom: start.resumedFrom ?? null,
    partySize: start.partySize,
    prefaced: start.prefaced,
    status: "in_progress",
    outcome: null,
    startedAt: new Date(first.ms).toISOString(),
    endedAt: new Date(first.ms).toISOString(),
    wallMs: 0,
    activeMs: 0,
    idleMs: 0,
    pausedMs: 0,
    unrecordedMs: 0,
    narrationMs: 0,
    activityMs: 0,
    encounterMs: 0,
    idleGaps: 0,
    pauses: 0,
    stepsWhilePaused: 0,
    steps: 0,
    recoveries: 0,
    assisted: 0,
    routes: [],
    note: null,
    scenes: [],
  };
  let paused = false;
  let off = false;
  let current: { scene: string; type: SceneType } = { scene: start.scene, type: start.type };
  const visit = (scene: string, type: SceneType): void => {
    const row = scenes.get(scene) ?? { scene, type, bucket: timingBucket(type), activeMs: 0, visits: 0 };
    row.visits += 1;
    scenes.set(scene, row);
  };
  visit(start.scene, start.type);

  /** Spends `[from, to]` under the state the table was in. */
  const spend = (from: number, to: number): void => {
    const dur = Math.max(0, to - from);
    if (off) s.unrecordedMs += dur;
    else if (paused) s.pausedMs += dur;
    else {
      const active = Math.min(dur, IDLE_GAP_CAP_MS);
      if (dur > IDLE_GAP_CAP_MS) s.idleGaps += 1;
      s.activeMs += active;
      s.idleMs += dur - active;
      const row = scenes.get(current.scene);
      if (row) row.activeMs += active;
      const bucket = timingBucket(current.type);
      if (bucket === "activity") s.activityMs += active;
      else if (bucket === "encounter") s.encounterMs += active;
      else s.narrationMs += active;
    }
  };

  let cursor = first.ms;
  let ended: SittingStatus | null = null;
  for (const { ms, note } of group.slice(1)) {
    spend(cursor, ms);
    cursor = ms;
    switch (note.kind) {
      case "step":
        s.steps += 1;
        if (paused) s.stepsWhilePaused += 1;
        current = { scene: note.scene, type: note.type };
        visit(note.scene, note.type);
        if (note.result === "recovery") s.recoveries += 1;
        if (note.result === "assisted") s.assisted += 1;
        break;
      case "pause":
        if (!paused) s.pauses += 1;
        paused = true;
        break;
      case "resume":
        paused = false;
        break;
      case "off":
        off = true;
        break;
      case "on":
        off = false;
        break;
      case "note":
        s.note = note.text;
        break;
      case "end":
        s.outcome = note.outcome;
        s.routes = [...note.routes];
        ended = "completed";
        break;
      case "close":
        ended = "closed";
        break;
      case "stop":
        ended = "saved";
        break;
      case "start":
        break;
    }
    if (ended) break;
  }
  if (ended) {
    s.status = ended;
  } else if (nowMs - cursor >= ABANDON_AFTER_MS) {
    // When the table left is unknowable: the last scene's time is not counted.
    s.status = "abandoned";
  } else {
    // Still open: the tail runs to now, under the same cap.
    spend(cursor, Math.max(cursor, nowMs));
    cursor = Math.max(cursor, nowMs);
  }
  s.endedAt = new Date(cursor).toISOString();
  s.wallMs = s.activeMs + s.idleMs + s.pausedMs + s.unrecordedMs;
  s.scenes = [...scenes.values()];
  return s;
}

// ---------------------------------------------------------------------------
// Aggregation

export interface Distribution {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

export function distribution(values: readonly number[]): Distribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => {
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
  };
  return {
    n: sorted.length,
    min: sorted[0] as number,
    p25: at(0.25),
    median: at(0.5),
    p75: at(0.75),
    max: sorted[sorted.length - 1] as number,
  };
}

export type SampleSize = "none" | "too_few" | "preliminary" | "enough";

export function sampleSize(n: number): SampleSize {
  if (n <= 0) return "none";
  if (n < FEW_SAMPLE) return "too_few";
  if (n < ENOUGH_SAMPLE) return "preliminary";
  return "enough";
}

/** The words a report puts beside a count, so a small sample never reads as proof. */
export function sampleLabel(n: number): string {
  switch (sampleSize(n)) {
    case "none":
      return "no data";
    case "too_few":
      return `n=${n}, too few to say anything about the chapter`;
    case "preliminary":
      return `n=${n}, preliminary`;
    default:
      return `n=${n}`;
  }
}

/** One attempt: a chain of sittings (a stopped game and its resumes) read as one. */
export interface Attempt {
  /** The first sitting's id. */
  id: string;
  kind: AttemptKind;
  sittings: SittingSummary[];
  completed: boolean;
  status: SittingStatus;
  outcome: "success" | "setback" | null;
  activeMs: number;
  wallMs: number;
}

/** Sittings joined by `resumedFrom`; a resume whose origin is missing starts its own chain. */
export function attemptsOf(sittings: readonly SittingSummary[]): Attempt[] {
  const byId = new Map(sittings.map((x) => [x.id, x]));
  const next = new Map<string, SittingSummary>();
  for (const x of sittings) if (x.resumedFrom && byId.has(x.resumedFrom) && !next.has(x.resumedFrom)) next.set(x.resumedFrom, x);
  const hasOrigin = new Set([...next.values()].map((x) => x.id));
  const attempts: Attempt[] = [];
  for (const head of sittings) {
    if (hasOrigin.has(head.id)) continue;
    const chain: SittingSummary[] = [head];
    const seen = new Set([head.id]);
    for (let n = next.get(head.id); n && !seen.has(n.id); n = next.get(n.id)) {
      chain.push(n);
      seen.add(n.id);
    }
    const last = chain[chain.length - 1] as SittingSummary;
    attempts.push({
      id: head.id,
      kind: head.kind === "resumed" ? "resumed" : chain.length > 1 ? "resumed" : head.kind,
      sittings: chain,
      completed: last.status === "completed",
      status: last.status,
      outcome: last.outcome,
      activeMs: chain.reduce((t, x) => t + x.activeMs, 0),
      wallMs: chain.reduce((t, x) => t + x.wallMs, 0),
    });
  }
  return attempts;
}

export interface SceneAggregate {
  scene: string;
  type: SceneType;
  bucket: TimingBucket;
  /** Attempts that visited it. */
  n: number;
  activeMs: Distribution;
  /** Share of the chapter's median active time, 0..1; null when the chapter has no completed attempts. */
  share: number | null;
}

export interface ChapterAggregate {
  chapterId: string;
  revision: string;
  source: TimingSource;
  /** Every attempt seen, whatever became of it. */
  attempts: number;
  completed: number;
  abandoned: number;
  kinds: Record<AttemptKind, number>;
  /** Completed fresh attempts only: the figure to compare with a budget. */
  freshActiveMs: Distribution | null;
  freshWallMs: Distribution | null;
  /** Completed revisits and resumed attempts, kept out of the fresh figure. */
  revisitActiveMs: Distribution | null;
  resumedActiveMs: Distribution | null;
  bucketMedianMs: Record<TimingBucket, number | null>;
  partySizes: Record<string, number>;
  outcomes: { success: number; setback: number };
  recoveries: Distribution | null;
  assistedAttempts: number;
  sample: SampleSize;
  sampleLabel: string;
  /** Slowest scenes by median active time, from completed fresh attempts. */
  scenes: SceneAggregate[];
  notes: string[];
}

/**
 * Groups sittings by chapter and content revision (never mixing the two) and
 * source (family observations are never pooled with playtests). Distributions
 * are over completed fresh attempts; the others are counted and kept apart.
 */
export function aggregateTimings(sittings: readonly SittingSummary[]): ChapterAggregate[] {
  const groups = new Map<string, SittingSummary[]>();
  for (const x of sittings) {
    const key = `${x.source}\u0000${x.chapterId}\u0000${x.revision}`;
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  const out: ChapterAggregate[] = [];
  for (const group of groups.values()) {
    const head = group[0] as SittingSummary;
    const attempts = attemptsOf(group);
    const done = (kind: AttemptKind): Attempt[] => attempts.filter((a) => a.completed && a.kind === kind);
    const fresh = done("fresh");
    const perScene = new Map<string, { type: SceneType; bucket: TimingBucket; values: number[] }>();
    for (const a of fresh) {
      const total = new Map<string, number>();
      const meta = new Map<string, SceneTiming>();
      for (const sit of a.sittings) {
        for (const sc of sit.scenes) {
          total.set(sc.scene, (total.get(sc.scene) ?? 0) + sc.activeMs);
          meta.set(sc.scene, sc);
        }
      }
      for (const [scene, ms] of total) {
        const m = meta.get(scene) as SceneTiming;
        const row = perScene.get(scene) ?? { type: m.type, bucket: m.bucket, values: [] };
        row.values.push(ms);
        perScene.set(scene, row);
      }
    }
    const freshActive = distribution(fresh.map((a) => a.activeMs));
    const scenes: SceneAggregate[] = [...perScene.entries()]
      .map(([scene, row]) => {
        const d = distribution(row.values) as Distribution;
        return {
          scene,
          type: row.type,
          bucket: row.bucket,
          n: d.n,
          activeMs: d,
          share: freshActive && freshActive.median > 0 ? d.median / freshActive.median : null,
        };
      })
      .sort((a, b) => b.activeMs.median - a.activeMs.median);
    const bucketMedian = (pick: (x: SittingSummary) => number): number | null =>
      distribution(fresh.map((a) => a.sittings.reduce((t, x) => t + pick(x), 0)))?.median ?? null;
    const partySizes: Record<string, number> = {};
    for (const a of attempts) {
      const size = String(a.sittings[0]?.partySize ?? 0);
      partySizes[size] = (partySizes[size] ?? 0) + 1;
    }
    const finished = attempts.filter((a) => a.completed);
    out.push({
      chapterId: head.chapterId,
      revision: head.revision,
      source: head.source,
      attempts: attempts.length,
      completed: finished.length,
      abandoned: attempts.filter((a) => a.status === "abandoned" || a.status === "closed").length,
      kinds: {
        fresh: attempts.filter((a) => a.kind === "fresh").length,
        revisit: attempts.filter((a) => a.kind === "revisit").length,
        resumed: attempts.filter((a) => a.kind === "resumed").length,
      },
      freshActiveMs: freshActive,
      freshWallMs: distribution(fresh.map((a) => a.wallMs)),
      revisitActiveMs: distribution(done("revisit").map((a) => a.activeMs)),
      resumedActiveMs: distribution(done("resumed").map((a) => a.activeMs)),
      bucketMedianMs: {
        narration: bucketMedian((x) => x.narrationMs),
        activity: bucketMedian((x) => x.activityMs),
        encounter: bucketMedian((x) => x.encounterMs),
      },
      partySizes,
      outcomes: {
        success: finished.filter((a) => a.outcome === "success").length,
        setback: finished.filter((a) => a.outcome === "setback").length,
      },
      recoveries: distribution(fresh.map((a) => a.sittings.reduce((t, x) => t + x.recoveries, 0))),
      assistedAttempts: attempts.filter((a) => a.sittings.some((x) => x.assisted > 0)).length,
      sample: sampleSize(fresh.length),
      sampleLabel: sampleLabel(fresh.length),
      scenes,
      notes: group.flatMap((x) => (x.note ? [x.note] : [])),
    });
  }
  return out.sort((a, b) => a.chapterId.localeCompare(b.chapterId) || a.revision.localeCompare(b.revision));
}

/** The intended budget against an observed median, in words that do not overclaim. */
export function budgetVerdict(agg: Pick<ChapterAggregate, "freshActiveMs" | "sample">, budgetMinutes = CHAPTER_BUDGET_MINUTES): string {
  if (!agg.freshActiveMs) return "no completed fresh attempts yet";
  const minutes = agg.freshActiveMs.median / 60_000;
  const rel = minutes > budgetMinutes * 1.25 ? "over" : minutes < budgetMinutes * 0.75 ? "under" : "near";
  const base = `median ${minutes.toFixed(1)} min active, ${rel} the ${budgetMinutes}-minute budget`;
  return agg.sample === "enough" ? base : `${base} (${sampleLabel(agg.freshActiveMs.n)}; not evidence yet)`;
}

// ---------------------------------------------------------------------------
// Export

export const TIMING_CSV_COLUMNS = [
  "id",
  "source",
  "chapter",
  "revision",
  "kind",
  "resumed_from",
  "status",
  "outcome",
  "party_size",
  "prefaced",
  "started_at",
  "wall_s",
  "active_s",
  "idle_s",
  "paused_s",
  "unrecorded_s",
  "narration_s",
  "activity_s",
  "encounter_s",
  "idle_gaps",
  "pauses",
  "steps",
  "steps_while_paused",
  "recoveries",
  "assisted",
  "routes",
  "note",
] as const;

function csvCell(v: string | number | boolean | null): string {
  const text = v === null ? "" : String(v);
  // A leading = + - @ would be a formula to a spreadsheet; the note is typed by a person.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One row per sitting, seconds rounded, for a spreadsheet. */
export function timingCsv(sittings: readonly SittingSummary[]): string {
  const s = (ms: number): number => Math.round(ms / 1000);
  const rows = sittings.map((x) =>
    [
      x.id, x.source, x.chapterId, x.revision, x.kind, x.resumedFrom, x.status, x.outcome, x.partySize, x.prefaced,
      x.startedAt, s(x.wallMs), s(x.activeMs), s(x.idleMs), s(x.pausedMs), s(x.unrecordedMs), s(x.narrationMs),
      s(x.activityMs), s(x.encounterMs), x.idleGaps, x.pauses, x.steps, x.stepsWhilePaused, x.recoveries,
      x.assisted, x.routes.join(" "), x.note,
    ].map(csvCell).join(","),
  );
  return [TIMING_CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// The report, as the server answers and a screen or a tool reads it

/** The policy a report was made under, so a printout can quote it. */
export const TIMING_POLICY = {
  idleGapCapMinutes: IDLE_GAP_CAP_MS / 60_000,
  abandonedAfterHours: ABANDON_AFTER_MS / 3_600_000,
  budgetMinutes: CHAPTER_BUDGET_MINUTES,
  tooFewBelow: FEW_SAMPLE,
  enoughFrom: ENOUGH_SAMPLE,
  doc: "docs/session-timing.md",
} as const;

export interface TimingReport {
  /** This server is keeping session timing. False: nothing below is new, and the controls hide. */
  enabled: boolean;
  /** Whose play it keeps: `family` on the deployed game, `playtest` on a developer's machine. */
  source: TimingSource | null;
  policy: typeof TIMING_POLICY;
  generatedAt: string;
  /** Every sitting read, newest first. Family observations and playtests carry their own `source`. */
  sittings: SittingSummary[];
  /** Per chapter and content revision; never mixes revisions or sources. */
  aggregates: ChapterAggregate[];
  /** True when the household has more runs than a report reads. */
  truncated: boolean;
}
