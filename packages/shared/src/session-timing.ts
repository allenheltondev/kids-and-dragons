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
 * (the scene now open), pause, resume, a operator's note, the chapter ending,
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
 *  4. A operator's pause excludes everything until the matching resume
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

import type { InteractionSpec } from "./interactions.js";
import { aggregateActivities, type ActivityReport } from "./play-timing.js";
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
/** Longest operator note, in characters. */
export const TIMING_NOTE_MAX = 140;

export type TimingSource = "family" | "playtest";
export type TimingBucket = "narration" | "activity" | "encounter";
export type StepResult = "success" | "recovery" | "assisted";
export type AttemptKind = "fresh" | "revisit" | "resumed";
/** Which mini-game an interaction scene plays (`InteractionSpec.kind`). */
export type GameKind = InteractionSpec["kind"];
export type GameOutcome = "success" | "failure" | "assisted";
/** How a fight ended, as the run's `lastEncounter` says it. */
export type FightOutcome = "victory" | "defeat" | "escaped" | "timedOut";
/** A fight that ended in the same commit that left its scene: how, and in which round. */
export interface FightEnd {
  outcome: FightOutcome;
  round: number;
}

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
      /** The first scene is a mini-game: which one. */
      game?: GameKind;
      /** A resume picked up with the board already up: the clock starts in the fight, not its ready-up. */
      fighting?: true;
    }
  | {
      kind: "step";
      scene: string;
      type: SceneType;
      result?: StepResult;
      /** The scene now open is a mini-game: which one. */
      game?: GameKind;
      /** The scene just left was a fight, and this commit ended it. */
      fight?: FightEnd;
    }
  /**
   * A mini-game moved without the scene changing: `play` when the acting hero
   * pressed start, `result` when it came out, `retry` when they went again.
   * `attempt` is 0-based, as the prompt counts it.
   */
  | { kind: "game"; scene: string; phase: "play" | "result" | "retry"; attempt: number; relaxed?: boolean; outcome?: GameOutcome }
  /**
   * A fight moved without the scene changing: `begin` when the board went up
   * after the ready-up, `round` when a new round began. Counts only: how many
   * heroes, how many foes and which kinds (content ids), never names.
   */
  | { kind: "fight"; scene: string; phase: "begin" | "round"; round: number; heroes?: number; foes?: number; foeKinds?: string[] }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "off" }
  | { kind: "on" }
  | { kind: "note"; text: string }
  | { kind: "end"; outcome: "success" | "setback"; routes: string[]; fight?: FightEnd }
  | { kind: "close" }
  | { kind: "stop" };

/** The slice of an event the timing reads. */
export interface TimingEvent {
  seq: number;
  at: string;
  timing?: TimingNote;
}

/**
 * One timing note as the timing table keeps it: the event it came from
 * (`runId`, `seq`, `at`), the chapter the run was in, and the note itself.
 */
export interface TimingMark extends TimingEvent {
  runId: string;
  chapterId: string;
  timing: TimingNote;
}

export type SittingStatus = "in_progress" | "completed" | "closed" | "saved" | "abandoned";

export interface SceneTiming {
  scene: string;
  type: SceneType;
  bucket: TimingBucket;
  activeMs: number;
  visits: number;
  /** Silences past the idle cap while this scene was open: the table stopped here. */
  idleGaps: number;
}

/**
 * One visit to a mini-game scene, split by what the table was doing. Active
 * time only, under the same cap and pauses as the sitting's.
 */
export interface GameTiming {
  scene: string;
  game: GameKind;
  /** On the ready screen: hearing the cue and getting ready, every attempt. */
  readyMs: number;
  /** From the acting hero's start to the result. */
  playMs: number;
  /** On the result, before going on or trying again. */
  afterMs: number;
  activeMs: number;
  /** Attempts started; a retry is a second. 0 when the game was assisted from the ready screen. */
  attempts: number;
  /** Any attempt was played relaxed. */
  relaxed: boolean;
  outcome: GameOutcome | null;
  /** The table went on from the scene (or the chapter ended there). False when the sitting stopped inside it. */
  finished: boolean;
}

/** One visit to a fight scene: the ready-up before the board, then the fight. */
export interface FightTiming {
  scene: string;
  /** Before the board went up: the ready-up, while phones swap to the fight. */
  setupMs: number;
  /** From the board going up to the fight's end. */
  fightMs: number;
  activeMs: number;
  /** The last round seen. */
  rounds: number;
  heroes: number | null;
  foes: number | null;
  foeKinds: string[];
  outcome: FightOutcome | null;
  finished: boolean;
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
  /** The scene open when the sitting ended (for an abandoned one, where the table left). */
  lastScene: string;
  /** Mini-game visits, in the order played. Only sittings recorded since games were marked have them. */
  games: GameTiming[];
  /** Fight visits, in the order played. Only sittings recorded since fights were marked have them. */
  fights: FightTiming[];
}

export function timingBucket(type: SceneType): TimingBucket {
  if (type === "interaction") return "activity";
  if (type === "encounter") return "encounter";
  return "narration";
}

/** A operator's note, trimmed to what the log keeps; null when nothing is left. */
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

/** Sittings from marks read in any order, across runs and chapters, newest first. */
export function sittingsFromMarks(marks: readonly TimingMark[], nowMs: number): SittingSummary[] {
  const byRun = new Map<string, TimingEvent[]>();
  for (const m of marks) byRun.set(m.runId, [...(byRun.get(m.runId) ?? []), { seq: m.seq, at: m.at, timing: m.timing }]);
  return [...byRun]
    .flatMap(([runId, events]) => sittingsFromEvents(runId, events, nowMs))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * An operator's word that a sitting is not a family's evening to count: a
 * developer's test on the live site, a demo, a session broken by an outage.
 * Kept in the timing table beside the marks (`OPS#exclusions`), expiring with
 * them. Excluding a sitting excludes the whole attempt it belongs to, so a
 * resume is never counted without the evening it picked up.
 */
export interface TimingExclusion {
  /** The sitting's id, `runId:seq`. */
  sittingId: string;
  reason: string;
  /** Who said so: the MCP key's label, or "cli". */
  by: string;
  at: string;
}

/** Longest exclusion reason, in characters. */
export const EXCLUSION_REASON_MAX = 200;

/**
 * Drops every attempt that holds an excluded sitting. Returns what is left and
 * the exclusions that matched something, with how many sittings each took out.
 */
export function applyExclusions(
  sittings: readonly SittingSummary[],
  exclusions: readonly TimingExclusion[],
): { kept: SittingSummary[]; excluded: Array<TimingExclusion & { sittings: number }> } {
  if (exclusions.length === 0) return { kept: [...sittings], excluded: [] };
  const wanted = new Map(exclusions.map((e) => [e.sittingId, e]));
  const dropped = new Set<string>();
  const hits = new Map<string, number>();
  for (const attempt of attemptsOf(sittings)) {
    const hit = attempt.sittings.find((x) => wanted.has(x.id));
    if (!hit) continue;
    for (const x of attempt.sittings) dropped.add(x.id);
    hits.set(hit.id, (hits.get(hit.id) ?? 0) + attempt.sittings.length);
  }
  return {
    kept: sittings.filter((x) => !dropped.has(x.id)),
    excluded: exclusions.filter((e) => hits.has(e.sittingId)).map((e) => ({ ...e, sittings: hits.get(e.sittingId) ?? 0 })),
  };
}

export interface TimingReportOptions {
  /** An operator's exclusions, applied attempt by attempt. */
  exclusions?: readonly TimingExclusion[];
  /** Only sittings that began at or after this time (ISO), e.g. since a content deploy. */
  since?: string;
}

/** The report for a set of marks, in the shape the export and the author tool read. */
export function timingReportFromMarks(
  marks: readonly TimingMark[],
  nowMs: number,
  source: TimingSource | null,
  options: TimingReportOptions = {},
): TimingReport {
  const since = options.since ? Date.parse(options.since) : NaN;
  const read = sittingsFromMarks(marks, nowMs).filter((x) => !Number.isFinite(since) || Date.parse(x.startedAt) >= since);
  const { kept: sittings, excluded } = applyExclusions(read, options.exclusions ?? []);
  return {
    enabled: true,
    source,
    policy: TIMING_POLICY,
    generatedAt: new Date(nowMs).toISOString(),
    sittings,
    aggregates: aggregateTimings(sittings),
    crossRevision: crossRevisionAttempts(sittings),
    activities: aggregateActivities(sittings),
    excluded,
    truncated: false,
  };
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
    lastScene: start.scene,
    games: [],
    fights: [],
  };
  let paused = false;
  let off = false;
  let current: { scene: string; type: SceneType } = { scene: start.scene, type: start.type };
  /** The mini-game or fight open now, and which part of it the clock is in. */
  // Cast, not annotated: the closures below reassign these, and an annotated `= null` would narrow to null for good.
  let game = null as { row: GameTiming; part: "readyMs" | "playMs" | "afterMs" } | null;
  let fight = null as { row: FightTiming; part: "setupMs" | "fightMs"; seen: boolean } | null;
  /**
   * Closes the activity open in the scene being left. A fight older marks
   * cannot describe (no begin, no end) is dropped; a game is known from the
   * step that opened it.
   */
  const leave = (finished: boolean, result?: StepResult, ended?: FightEnd): void => {
    if (game) {
      if (finished && !game.row.outcome && result) game.row.outcome = result === "recovery" ? "failure" : result;
      game.row.finished = finished;
      s.games.push(game.row);
    }
    if (fight) {
      if (ended) {
        fight.row.outcome = ended.outcome;
        fight.row.rounds = Math.max(fight.row.rounds, ended.round);
        fight.seen = true;
      }
      fight.row.finished = finished;
      if (fight.seen) s.fights.push(fight.row);
    }
    game = null;
    fight = null;
  };
  const visit = (scene: string, type: SceneType, kind?: GameKind): void => {
    const row = scenes.get(scene) ?? { scene, type, bucket: timingBucket(type), activeMs: 0, visits: 0, idleGaps: 0 };
    row.visits += 1;
    scenes.set(scene, row);
    if (type === "interaction" && kind) {
      game = {
        row: { scene, game: kind, readyMs: 0, playMs: 0, afterMs: 0, activeMs: 0, attempts: 0, relaxed: false, outcome: null, finished: false },
        part: "readyMs",
      };
    } else if (type === "encounter") {
      fight = {
        row: { scene, setupMs: 0, fightMs: 0, activeMs: 0, rounds: 0, heroes: null, foes: null, foeKinds: [], outcome: null, finished: false },
        part: "setupMs",
        seen: false,
      };
    }
  };
  visit(start.scene, start.type, start.game);
  if (start.fighting && fight) {
    fight.part = "fightMs";
    fight.seen = true;
  }

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
      if (row && dur > IDLE_GAP_CAP_MS) row.idleGaps += 1;
      if (game) {
        game.row[game.part] += active;
        game.row.activeMs += active;
      }
      if (fight) {
        fight.row[fight.part] += active;
        fight.row.activeMs += active;
      }
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
        leave(true, note.result, note.fight);
        current = { scene: note.scene, type: note.type };
        visit(note.scene, note.type, note.game);
        if (note.result === "recovery") s.recoveries += 1;
        if (note.result === "assisted") s.assisted += 1;
        break;
      case "game":
        if (game && game.row.scene === note.scene) {
          if (note.phase === "play") {
            game.part = "playMs";
            game.row.attempts = Math.max(game.row.attempts, note.attempt + 1);
            if (note.relaxed) game.row.relaxed = true;
          } else if (note.phase === "result") {
            game.part = "afterMs";
            game.row.outcome = note.outcome ?? game.row.outcome;
          } else {
            game.part = "readyMs";
            game.row.outcome = null;
          }
        }
        break;
      case "fight":
        if (fight && fight.row.scene === note.scene) {
          fight.seen = true;
          fight.part = "fightMs";
          fight.row.rounds = Math.max(fight.row.rounds, note.round);
          if (note.heroes !== undefined) fight.row.heroes = note.heroes;
          if (note.foes !== undefined) fight.row.foes = note.foes;
          if (note.foeKinds) fight.row.foeKinds = [...note.foeKinds];
        }
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
        leave(true, undefined, note.fight);
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
  // A game or fight the sitting stopped inside: kept, but never as finished.
  leave(false);
  s.lastScene = current.scene;
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
  /** Attempts that went silent past the idle cap while this scene was open. */
  stalls: number;
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
  /** Attempts played partly on this revision and partly on another: counted here, in no distribution (see `CrossRevisionAttempt`). */
  crossRevision: number;
  /** Slowest scenes by median active time, from completed fresh attempts. */
  scenes: SceneAggregate[];
  /** Completed fresh attempts' active minutes by how many were seated ("1".."4"). */
  byPartySize: Record<string, { n: number; medianMs: number }>;
  notes: string[];
  /** When the newest sitting on this revision began: the newest revision of a chapter is most likely its current text. */
  lastPlayedAt: string;
  /** Where unfinished attempts were left (the scene open when the sitting ended), most often first. */
  leftAt: Array<{ scene: string; attempts: number }>;
}

/**
 * An attempt whose sittings were played on more than one content revision: a
 * game stopped, the chapter edited, and the game picked up on the new text.
 * No revision's figure describes it, so it is kept out of every revision's
 * distribution, but its total time and fate are kept here and counted on each
 * revision it touched (`ChapterAggregate.crossRevision`).
 */
export interface CrossRevisionAttempt {
  /** The first sitting's id. */
  id: string;
  source: TimingSource;
  chapterId: string;
  /** Every revision it was played on, in the order played. */
  revisions: string[];
  status: SittingStatus;
  completed: boolean;
  outcome: "success" | "setback" | null;
  activeMs: number;
  wallMs: number;
  sittings: number;
}

/**
 * Attempts are chained first, across revisions, because a resume carries the
 * new revision and points back at a sitting on the old one. Then each chain
 * goes to the one revision it was played on, or, when it spans several, to the
 * cross-revision list.
 */
function chainAttempts(sittings: readonly SittingSummary[]): {
  byRevision: Map<string, Attempt[]>;
  crossRevision: CrossRevisionAttempt[];
} {
  const chapters = new Map<string, SittingSummary[]>();
  for (const x of sittings) {
    const key = `${x.source}\u0000${x.chapterId}`;
    chapters.set(key, [...(chapters.get(key) ?? []), x]);
  }
  const byRevision = new Map<string, Attempt[]>();
  const crossRevision: CrossRevisionAttempt[] = [];
  for (const group of chapters.values()) {
    for (const attempt of attemptsOf(group)) {
      const first = attempt.sittings[0] as SittingSummary;
      const revisions = [...new Set(attempt.sittings.map((x) => x.revision))];
      if (revisions.length > 1) {
        crossRevision.push({
          id: attempt.id,
          source: first.source,
          chapterId: first.chapterId,
          revisions,
          status: attempt.status,
          completed: attempt.completed,
          outcome: attempt.outcome,
          activeMs: attempt.activeMs,
          wallMs: attempt.wallMs,
          sittings: attempt.sittings.length,
        });
        continue;
      }
      const key = `${first.source}\u0000${first.chapterId}\u0000${first.revision}`;
      byRevision.set(key, [...(byRevision.get(key) ?? []), attempt]);
    }
  }
  return { byRevision, crossRevision };
}

/** Attempts that spanned a content revision, apart from every revision's figures. */
export function crossRevisionAttempts(sittings: readonly SittingSummary[]): CrossRevisionAttempt[] {
  return chainAttempts(sittings).crossRevision;
}

/**
 * Groups attempts by chapter and content revision (never mixing the two) and
 * source (family observations are never pooled with playtests). Attempts are
 * chained before they are grouped, so a stop and a resume across an edit are
 * one attempt, reported as cross-revision rather than split or dropped.
 * Distributions are over completed fresh attempts; the others are counted and
 * kept apart.
 */
export function aggregateTimings(sittings: readonly SittingSummary[]): ChapterAggregate[] {
  const { byRevision, crossRevision } = chainAttempts(sittings);
  const out: ChapterAggregate[] = [];
  for (const attempts of byRevision.values()) {
    const head = (attempts[0] as Attempt).sittings[0] as SittingSummary;
    const done = (kind: AttemptKind): Attempt[] => attempts.filter((a) => a.completed && a.kind === kind);
    const fresh = done("fresh");
    const perScene = new Map<string, { type: SceneType; bucket: TimingBucket; values: number[]; stalls: number }>();
    for (const a of fresh) {
      const total = new Map<string, number>();
      const gaps = new Map<string, number>();
      const meta = new Map<string, SceneTiming>();
      for (const sit of a.sittings) {
        for (const sc of sit.scenes) {
          total.set(sc.scene, (total.get(sc.scene) ?? 0) + sc.activeMs);
          gaps.set(sc.scene, (gaps.get(sc.scene) ?? 0) + (sc.idleGaps ?? 0));
          meta.set(sc.scene, sc);
        }
      }
      for (const [scene, ms] of total) {
        const m = meta.get(scene) as SceneTiming;
        const row = perScene.get(scene) ?? { type: m.type, bucket: m.bucket, values: [], stalls: 0 };
        row.values.push(ms);
        if ((gaps.get(scene) ?? 0) > 0) row.stalls += 1;
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
          stalls: row.stalls,
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
      byPartySize: bySize(fresh),
      outcomes: {
        success: finished.filter((a) => a.outcome === "success").length,
        setback: finished.filter((a) => a.outcome === "setback").length,
      },
      recoveries: distribution(fresh.map((a) => a.sittings.reduce((t, x) => t + x.recoveries, 0))),
      assistedAttempts: attempts.filter((a) => a.sittings.some((x) => x.assisted > 0)).length,
      sample: sampleSize(fresh.length),
      sampleLabel: sampleLabel(fresh.length),
      scenes,
      crossRevision: crossRevision.filter(
        (c) => c.source === head.source && c.chapterId === head.chapterId && c.revisions.includes(head.revision),
      ).length,
      notes: attempts.flatMap((a) => a.sittings.flatMap((x) => (x.note ? [x.note] : []))),
      lastPlayedAt: attempts.flatMap((a) => a.sittings.map((x) => x.startedAt)).sort().pop() ?? head.startedAt,
      leftAt: leftAt(attempts),
    });
  }
  return out.sort((a, b) => a.chapterId.localeCompare(b.chapterId) || a.revision.localeCompare(b.revision));
}

function bySize(attempts: readonly Attempt[]): Record<string, { n: number; medianMs: number }> {
  const groups = new Map<string, number[]>();
  for (const a of attempts) {
    const size = String(a.sittings[0]?.partySize ?? 0);
    groups.set(size, [...(groups.get(size) ?? []), a.activeMs]);
  }
  return Object.fromEntries([...groups].sort().map(([size, values]) => [size, { n: values.length, medianMs: (distribution(values) as Distribution).median }]));
}

function leftAt(attempts: readonly Attempt[]): Array<{ scene: string; attempts: number }> {
  const counts = new Map<string, number>();
  for (const a of attempts) {
    if (a.status !== "abandoned" && a.status !== "closed") continue;
    const last = a.sittings[a.sittings.length - 1] as SittingSummary;
    counts.set(last.lastScene, (counts.get(last.lastScene) ?? 0) + 1);
  }
  return [...counts].map(([scene, n]) => ({ scene, attempts: n })).sort((a, b) => b.attempts - a.attempts || a.scene.localeCompare(b.scene));
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
  "games",
  "game_attempts",
  "game_play_s",
  "fights",
  "fight_rounds",
  "fight_s",
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
      x.games.length, x.games.reduce((t, g) => t + g.attempts, 0), s(x.games.reduce((t, g) => t + g.playMs, 0)),
      x.fights.length, x.fights.reduce((t, f) => t + f.rounds, 0), s(x.fights.reduce((t, f) => t + f.fightMs, 0)),
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
  /** Attempts played across a content revision, kept out of every aggregate's distribution. */
  crossRevision: CrossRevisionAttempt[];
  /** Mini-games and fights, per scene and rolled up (play-timing.ts). Absent on a report exported before they were. */
  activities?: ActivityReport;
  /** Sittings an operator excluded, and how many each took out. Already gone from every figure above. */
  excluded?: Array<TimingExclusion & { sittings: number }>;
  /** True when the household has more runs than a report reads. */
  truncated: boolean;
}
