/**
 * The operator's timing tools (docs/mcp-server.md, "Operator tools"; the
 * numbers are docs/session-timing.md): how long real tables take over
 * chapters, mini-games and fights, what is worth acting on, and leaving a
 * sitting that was not a family's evening out of the figures.
 *
 * They read the timing table only. A mark holds a random run id, a chapter, a
 * seq, a server time and a timing note: no household, player, name or anything
 * a child typed. The one free text is the note a grown-up operator typed
 * through the host controls, which the docs ask to keep free of names; it is
 * returned, since it is often the reason a sitting looks odd. So these tools
 * are about the system in aggregate, and need no household-data review (#525).
 *
 * Every figure carries its sample label, and minutes are rounded to a tenth:
 * a tool answer goes into a model's context, so it is kept short and never
 * pretends a median of two is a measurement.
 *
 * With the chapter index the build writes (`../chapter-index.ts`), they know
 * which revision is each chapter's current text, its planned and predicted
 * minutes, its campaign's order, and the games and fights nobody has played
 * yet. Without it they read each chapter's most recently played revision.
 */

import {
  CHAPTER_BUDGET_MINUTES,
  EXCLUSION_REASON_MAX,
  FINDING_THRESHOLDS,
  TIMING_POLICY,
  attemptsOf,
  budgetVerdict,
  cleanNote,
  compareRevisions,
  latestRevisions,
  timingTrends,
  type ChapterAggregate,
  sittingsFromMarks,
  timingFindings,
  timingReportFromMarks,
  type Distribution,
  type TimingReport,
  type TimingSource,
} from "@kad/shared";
import { z } from "zod";
import type { TimingReader } from "../../store/timing-store.ts";
import { currentRevisions, type ChapterIndex, type ChapterIndexEntry } from "../chapter-index.ts";
import type { VerifiedKey } from "../keys.ts";
import type { ToolRegistrar } from "../server.ts";
import { READ, WRITE, ToolError, anyObject, guarded } from "../shared.ts";

export interface TimingToolDeps {
  reader: TimingReader;
  key: VerifiedKey;
  now: () => number;
  index?: ChapterIndex | null;
}

const GAME_KINDS = ["precision", "timing", "tracking", "memory", "balance", "relay", "play", "cooperate", "sequence"] as const;

const source = z.enum(["family", "playtest"]).default("family").describe("Whose play: families on the live game (default), or developers' playtests. Never pooled.");
const since = z.iso.datetime({ offset: true }).optional().describe("Only sittings that began at or after this time (ISO 8601), e.g. since a content deploy.");
const chapter = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).describe("A chapter id, e.g. gemfall-03.");
const limit = (n: number) => z.number().int().min(1).max(200).default(n).describe("Most rows returned.");
const sittingId = z.string().min(3).max(120).regex(/^[A-Za-z0-9_-]+:\d+$/).describe("A sitting's id, runId:seq, as timing_sittings lists it.");

/** Minutes to a tenth, the only precision a reader needs. */
const m = (ms: number | null | undefined): number | null => (ms === null || ms === undefined ? null : Math.round(ms / 6_000) / 10);
const spread = (dist: Distribution | null | undefined) =>
  dist ? { n: dist.n, median: m(dist.median), p25: m(dist.p25), p75: m(dist.p75), max: m(dist.max) } : null;
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

async function report(deps: TimingToolDeps, args: { chapter?: string | undefined; since?: string | undefined }): Promise<TimingReport> {
  const [marks, exclusions] = await Promise.all([
    args.chapter ? deps.reader.chapterMarks(args.chapter) : deps.reader.allMarks(),
    deps.reader.exclusions(),
  ]);
  return timingReportFromMarks(marks, deps.now(), null, { exclusions, ...(args.since ? { since: args.since } : {}) });
}

/** The revision each chapter is read at: its current text when known and played, else the latest played. */
const readAt = (deps: TimingToolDeps, r: TimingReport) => latestRevisions(r.aggregates, currentRevisions(deps.index));
const entry = (deps: TimingToolDeps, id: string): ChapterIndexEntry | undefined => deps.index?.chapters.find((c) => c.id === id);

/** What the chapter claims and what content:pacing predicts, beside what was observed. Never averaged with it. */
function plan(deps: TimingToolDeps, a: Pick<ChapterAggregate, "chapterId" | "revision">) {
  const e = entry(deps, a.chapterId);
  if (!e) return {};
  return {
    title: e.title,
    campaign: e.campaignId,
    position: e.position,
    current_text: e.revision === a.revision,
    planned_min: e.estimatedMinutes,
    predicted_min: e.predictedMinutes,
  };
}

function chapterRows(r: TimingReport, src: TimingSource, deps: TimingToolDeps) {
  const latest = readAt(deps, r);
  return r.aggregates
    .filter((a) => a.source === src)
    .map((a) => ({
      chapter: a.chapterId,
      revision: a.revision,
      latest: latest.get(`${a.source}\u0000${a.chapterId}`) === a.revision,
      ...plan(deps, a),
      last_played: a.lastPlayedAt,
      verdict: budgetVerdict(a),
      sample: a.sampleLabel,
      fresh_active_min: spread(a.freshActiveMs),
      minutes_by_kind: { story: m(a.bucketMedianMs.narration), mini_games: m(a.bucketMedianMs.activity), fights: m(a.bucketMedianMs.encounter) },
      attempts: a.attempts,
      completed: a.completed,
      left_unfinished: a.abandoned,
      kinds: a.kinds,
      setbacks: a.outcomes.setback,
      played_across_an_edit: a.crossRevision,
    }));
}

function gameRows(r: TimingReport, src: TimingSource, filter: (row: { chapterId: string; revision: string }) => boolean) {
  return (r.activities?.games ?? [])
    .filter((g) => g.source === src && filter(g))
    .map((g) => ({
      chapter: g.chapterId,
      revision: g.revision,
      scene: g.scene,
      game: g.game,
      sample: g.sampleLabel,
      active_min: spread(g.activeMs),
      ready_min: m(g.readyMs.median),
      play_min: spread(g.playMs),
      result_min: m(g.afterMs.median),
      attempts_median: g.attempts.median,
      retried_pct: pct(g.retried, g.n),
      outcomes: g.outcomes,
      relaxed: g.relaxed,
      revisits_kept_out: g.revisits,
      unfinished_kept_out: g.unfinished,
    }));
}

function fightRows(r: TimingReport, src: TimingSource, filter: (row: { chapterId: string; revision: string }) => boolean) {
  return (r.activities?.fights ?? [])
    .filter((f) => f.source === src && filter(f))
    .map((f) => ({
      chapter: f.chapterId,
      revision: f.revision,
      scene: f.scene,
      foes: f.foes,
      foe_kinds: f.foeKinds,
      sample: f.sampleLabel,
      active_min: spread(f.activeMs),
      ready_up_min: m(f.setupMs.median),
      fight_min: spread(f.fightMs),
      rounds: spread(f.rounds) && { n: f.rounds.n, median: f.rounds.median, max: f.rounds.max },
      min_per_round: m(f.msPerRound),
      outcomes: f.outcomes,
      by_heroes: Object.fromEntries(Object.entries(f.byHeroes ?? {}).map(([k, v]) => [k, { n: v.n, fight_min: m(v.fightMs), rounds: v.rounds }])),
      revisits_kept_out: f.revisits,
      unfinished_kept_out: f.unfinished,
    }));
}

function rollups(r: TimingReport, src: TimingSource) {
  return {
    game_kinds: (r.activities?.gameKinds ?? [])
      .filter((k) => k.source === src)
      .map((k) => ({
        game: k.game,
        scenes: k.scenes,
        sample: k.sampleLabel,
        play_min: spread(k.playMs),
        ready_min: m(k.readyMs.median),
        attempts_per_visit: Math.round(k.attemptsPerVisit * 10) / 10,
        retried_pct: Math.round(k.retryRate * 100),
        failed_pct: Math.round(k.failureRate * 100),
        assisted_pct: Math.round(k.assistedRate * 100),
      })),
    fights: (r.activities?.fightTotals ?? [])
      .filter((t) => t.source === src)
      .map((t) => ({
        scenes: t.scenes,
        sample: t.sampleLabel,
        fight_min: spread(t.fightMs),
        ready_up_min: m(t.setupMs.median),
        rounds: { median: t.rounds.median, max: t.rounds.max },
        min_per_round: m(t.msPerRound),
        lost_pct: Math.round(t.defeatRate * 100),
      }))[0] ?? null,
    scene_types: (r.activities?.sceneTypes ?? [])
      .filter((t) => t.source === src)
      .map((t) => ({
        type: t.type,
        sample: t.sampleLabel,
        per_visit_min: spread(t.perVisitMs),
        share_pct: Math.round(t.share * 100),
        stalled_pct: Math.round(t.stallRate * 100),
      })),
  };
}

const POLICY = {
  ...TIMING_POLICY,
  note: "Active minutes count silences up to the idle cap between taps; pauses and longer silences are left out. A sample under 3 is too few to say anything; under 8 is preliminary. Time alone does not say a scene is dull or fun.",
};

export function registerTimingTools(server: ToolRegistrar, deps: TimingToolDeps): void {
  server.registerTool(
    "timing_overview",
    {
      title: "Chapter timing overview",
      description:
        "How long real tables take over each chapter, per content revision, against the 30-minute budget: median active minutes of completed fresh attempts, " +
        "split into story, mini-games and fights, with the sample size, plus every kind of mini-game and all fights rolled up across chapters. " +
        "`latest` marks each chapter's most recently played revision, most likely its current text. Start here; then timing_findings for what to act on.",
      inputSchema: z.object({ source, since, chapter: chapter.optional() }),
      outputSchema: anyObject,
      annotations: READ,
    },
    guarded(async (args: { source: TimingSource; since?: string; chapter?: string }) => {
      const r = await report(deps, args);
      const played = new Set(r.aggregates.filter((a) => a.source === args.source).map((a) => `${a.chapterId}@${a.revision}`));
      const unplayed = (deps.index?.chapters ?? [])
        .filter((c) => (!args.chapter || c.id === args.chapter) && !played.has(`${c.id}@${c.revision}`))
        .map((c) => c.id);
      return {
        generated_at: r.generatedAt,
        policy: POLICY,
        chapter_index: deps.index ? { built_at: deps.index.builtAt, chapters: deps.index.chapters.length } : "absent: `latest` is the most recently played revision, not certainly the current text",
        sittings: r.sittings.filter((x) => x.source === args.source).length,
        excluded: (r.excluded ?? []).length,
        chapters: chapterRows(r, args.source, deps),
        ...rollups(r, args.source),
        ...(deps.index ? { current_text_not_yet_played: unplayed } : {}),
      };
    }),
  );

  server.registerTool(
    "timing_findings",
    {
      title: "Timing findings",
      description:
        "What in the observed timing is worth acting on, most pressing first: chapters over or under budget, one scene holding much of a chapter, " +
        "where unfinished tables leave, mini-games that run long, are hard or are slow to start, fights that drag, are usually lost or are slow to ready up. " +
        "Each says what crossed which threshold, on what sample, and the first thing to try in the chapter's JSON. 'act' is a sample of 8 or more; 'look' is preliminary. " +
        "Only each chapter's latest revision unless all_revisions. A reading list, never a verdict.",
      inputSchema: z.object({
        source,
        since,
        chapter: chapter.optional(),
        all_revisions: z.boolean().default(false).describe("Also older revisions of each chapter."),
        limit: limit(20),
      }),
      outputSchema: anyObject,
      annotations: READ,
    },
    guarded(async (args: { source: TimingSource; since?: string; chapter?: string; all_revisions: boolean; limit: number }) => {
      const r = await report(deps, args);
      const found = timingFindings(r, {
        source: args.source,
        allRevisions: args.all_revisions,
        currentRevisions: currentRevisions(deps.index),
        ...(args.chapter ? { chapterId: args.chapter } : {}),
      });
      return {
        generated_at: r.generatedAt,
        budget_minutes: CHAPTER_BUDGET_MINUTES,
        thresholds: FINDING_THRESHOLDS,
        total: found.length,
        findings: found.slice(0, args.limit).map(({ score, ...f }) => ({ ...f, score: Math.round(score * 100) / 100 })),
        next: "timing_chapter for a chapter's scenes, games and fights; timing_compare after an edit; timing_sittings for the evenings behind a figure; `npm run play:jump -- <chapter> <scene>` to look at a scene.",
      };
    }),
  );

  server.registerTool(
    "timing_chapter",
    {
      title: "One chapter's timing",
      description:
        "One chapter in depth: each revision's figure against the budget, its slowest scenes with their share of the chapter, its mini-games " +
        "(ready screen, play, result, retries, outcomes) and fights (ready-up, fight, rounds, outcomes), where unfinished tables left, attempts played across an edit, " +
        "the operators' notes, and its findings.",
      inputSchema: z.object({
        chapter,
        source,
        since,
        revision: z.string().min(1).max(40).optional().describe("One revision only; default every revision, newest first."),
        scenes: limit(10).describe("Most scenes listed per revision."),
      }),
      outputSchema: anyObject,
      annotations: READ,
    },
    guarded(async (args: { chapter: string; source: TimingSource; since?: string; revision?: string; scenes: number }) => {
      const r = await report(deps, args);
      const rows = r.aggregates
        .filter((a) => a.source === args.source && a.chapterId === args.chapter && (!args.revision || a.revision === args.revision))
        .sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt));
      if (rows.length === 0) {
        throw new ToolError(`No ${args.source} sittings of ${args.chapter}${args.revision ? ` at revision ${args.revision}` : ""}${args.since ? ` since ${args.since}` : ""}. timing_overview lists the chapters played.`);
      }
      const latest = readAt(deps, r);
      const indexed = entry(deps, args.chapter);
      return {
        chapter: args.chapter,
        policy: POLICY,
        ...(indexed
          ? {
              title: indexed.title,
              campaign: indexed.campaignId,
              position: indexed.position,
              current_revision: indexed.revision,
              planned_min: indexed.estimatedMinutes,
              predicted_min: indexed.predictedMinutes,
            }
          : {}),
        revisions: rows.map((a) => {
          const here = (x: { chapterId: string; revision: string }) => x.chapterId === a.chapterId && x.revision === a.revision;
          return {
            revision: a.revision,
            latest: latest.get(`${a.source}\u0000${a.chapterId}`) === a.revision,
            last_played: a.lastPlayedAt,
            verdict: budgetVerdict(a),
            sample: a.sampleLabel,
            fresh_active_min: spread(a.freshActiveMs),
            fresh_wall_min: spread(a.freshWallMs),
            minutes_by_kind: { story: m(a.bucketMedianMs.narration), mini_games: m(a.bucketMedianMs.activity), fights: m(a.bucketMedianMs.encounter) },
            attempts: { total: a.attempts, completed: a.completed, left_unfinished: a.abandoned, ...a.kinds },
            revisit_active_min: spread(a.revisitActiveMs),
            resumed_active_min: spread(a.resumedActiveMs),
            party_sizes: a.partySizes,
            fresh_active_by_party_size: Object.fromEntries(Object.entries(a.byPartySize ?? {}).map(([k, v]) => [k, { n: v.n, median_min: m(v.medianMs) }])),
            outcomes: a.outcomes,
            recoveries_per_attempt: spread(a.recoveries) && { median: a.recoveries?.median ?? null, max: a.recoveries?.max ?? null },
            attempts_with_assisted_route: a.assistedAttempts,
            slowest_scenes: a.scenes.slice(0, args.scenes).map((s) => ({
              scene: s.scene,
              kind: s.bucket === "narration" ? "story" : s.bucket === "activity" ? "mini-game" : "fight",
              median_min: m(s.activeMs.median),
              share_pct: s.share === null ? null : Math.round(s.share * 100),
              stalled_attempts: s.stalls ?? 0,
              sample: `n=${String(s.n)}`,
            })),
            left_at: a.leftAt,
            games: gameRows(r, args.source, here),
            fights: fightRows(r, args.source, here),
            ...(indexed && indexed.revision === a.revision
              ? {
                  games_not_yet_seen: indexed.games.filter((g) => !(r.activities?.games ?? []).some((x) => x.source === args.source && here(x) && x.scene === g.scene)),
                  fights_not_yet_seen: indexed.fights.filter((f) => !(r.activities?.fights ?? []).some((x) => x.source === args.source && here(x) && x.scene === f.scene)),
                }
              : {}),
            notes: a.notes.slice(0, 10),
            played_across_an_edit: a.crossRevision,
          };
        }),
        across_an_edit: (r.crossRevision ?? [])
          .filter((c) => c.source === args.source && c.chapterId === args.chapter)
          .map((c) => ({ id: c.id, revisions: c.revisions, status: c.status, outcome: c.outcome, active_min: m(c.activeMs), sittings: c.sittings })),
        findings: timingFindings(r, { source: args.source, chapterId: args.chapter, allRevisions: true, currentRevisions: currentRevisions(deps.index) }).map(({ score: _s, ...f }) => f),
      };
    }),
  );

  server.registerTool(
    "timing_activities",
    {
      title: "Mini-game and fight timing",
      description:
        "Mini-games and fights across every chapter: per scene, slowest first, and rolled up by kind of mini-game and over all fights. " +
        "A game's minutes split into the ready screen (cue and getting ready), play, and the result; a fight's into the ready-up and the fight, with rounds and how it ended. " +
        "Counts finished visits in fresh and resumed sittings; revisits and visits a sitting stopped inside are counted beside each row and kept out of its numbers.",
      inputSchema: z.object({
        what: z.enum(["both", "games", "fights"]).default("both"),
        source,
        since,
        chapter: chapter.optional(),
        game: z.enum(GAME_KINDS).optional().describe("Only this kind of mini-game."),
        all_revisions: z.boolean().default(false).describe("Also older revisions of each chapter; default only each chapter's latest."),
        limit: limit(25),
      }),
      outputSchema: anyObject,
      annotations: READ,
    },
    guarded(async (args: { what: "both" | "games" | "fights"; source: TimingSource; since?: string; chapter?: string; game?: (typeof GAME_KINDS)[number]; all_revisions: boolean; limit: number }) => {
      const r = await report(deps, args);
      const latest = readAt(deps, r);
      const keep = (x: { chapterId: string; revision: string }) => args.all_revisions || latest.get(`${args.source}\u0000${x.chapterId}`) === x.revision;
      const games = args.what === "fights" ? [] : gameRows(r, args.source, keep).filter((g) => !args.game || g.game === args.game);
      const fights = args.what === "games" || args.game ? [] : fightRows(r, args.source, keep);
      const roll = rollups(r, args.source);
      return {
        generated_at: r.generatedAt,
        policy: POLICY,
        ...(args.what !== "fights" ? { game_kinds: roll.game_kinds.filter((k) => !args.game || k.game === args.game), games: games.slice(0, args.limit), games_total: games.length } : {}),
        ...(args.what !== "games" && !args.game ? { all_fights: roll.fights, fights: fights.slice(0, args.limit), fights_total: fights.length } : {}),
        ...(games.length === 0 && fights.length === 0
          ? { empty: "No mini-game or fight visits recorded yet for this filter. Sittings from before games and fights were marked have none; their minutes are still in timing_overview's minutes_by_kind." }
          : {}),
      };
    }),
  );

  server.registerTool(
    "timing_trends",
    {
      title: "Timing over time",
      description:
        "Sittings by the week (or day) they began, oldest first, empty periods included: how many began (fresh, revisit, resumed), " +
        "finished, ended in a setback or were left unfinished, the completion rate, the median active minutes of completed fresh sittings, " +
        "mini-game play and how often games were failed or assisted, fight minutes and rounds, silences past the idle cap per sitting, and party sizes. " +
        "For 'is it getting better', before and after a UX release. Counts sittings, not households: timing keeps no household.",
      inputSchema: z.object({
        source,
        since,
        chapter: chapter.optional(),
        bucket: z.enum(["week", "day"]).default("week"),
        limit: limit(12).describe("Most recent periods returned."),
      }),
      outputSchema: anyObject,
      annotations: READ,
    },
    guarded(async (args: { source: TimingSource; since?: string; chapter?: string; bucket: "week" | "day"; limit: number }) => {
      const r = await report(deps, args);
      const buckets = timingTrends(r.sittings, { bucket: args.bucket, source: args.source, ...(args.chapter ? { chapterId: args.chapter } : {}) });
      const rate = (x: number | null) => (x === null ? null : Math.round(x * 100));
      return {
        generated_at: r.generatedAt,
        bucket: args.bucket,
        periods_total: buckets.length,
        periods: buckets.slice(-args.limit).map((b) => ({
          from: b.from,
          to: b.to,
          started: b.started,
          kinds: { fresh: b.fresh, revisit: b.revisits, resumed: b.resumed },
          completed: b.completed,
          setbacks: b.setbacks,
          left_unfinished: b.leftUnfinished,
          completion_pct: rate(b.completionRate),
          fresh_active_min: { n: b.freshCompleted, median: m(b.freshActiveMs) },
          games: { n: b.games, play_min: m(b.medianGamePlayMs), failed_or_assisted_pct: rate(b.gameHardRate) },
          fights: { n: b.fights, fight_min: m(b.medianFightMs), rounds: b.medianFightRounds },
          idle_gaps_per_sitting: Math.round(b.idleGapsPerSitting * 100) / 100,
          party_sizes: b.partySizes,
        })),
        note: "A period with few sittings moves a lot on one evening; read the counts beside every median.",
      };
    }),
  );

  server.registerTool(
    "timing_compare",
    {
      title: "Compare two revisions of a chapter",
      description:
        "Did an edit change how a chapter plays? One revision against another: the chapter's minutes (a change is called only when the middle halves " +
        "stop overlapping, on 3 or more completed fresh attempts a side), completion and setback rates, minutes by kind of play, every scene's median side by side " +
        "(biggest change first), and each mini-game's and fight's. Default: the current text (or the latest played) against the revision played before it.",
      inputSchema: z.object({
        chapter,
        source,
        before: z.string().min(1).max(40).optional().describe("The older revision; default the most recently played one before `after`."),
        after: z.string().min(1).max(40).optional().describe("The newer revision; default the current text if played, else the latest played."),
        scenes: limit(15).describe("Most scenes listed."),
      }),
      outputSchema: anyObject,
      annotations: READ,
    },
    guarded(async (args: { chapter: string; source: TimingSource; before?: string; after?: string; scenes: number }) => {
      const r = await report(deps, { chapter: args.chapter });
      const revs = r.aggregates
        .filter((a) => a.source === args.source && a.chapterId === args.chapter)
        .sort((a, b) => b.lastPlayedAt.localeCompare(a.lastPlayedAt));
      const after = args.after ?? readAt(deps, r).get(`${args.source}\u0000${args.chapter}`);
      const before = args.before ?? revs.find((a) => a.revision !== after)?.revision;
      if (!after || !before) {
        throw new ToolError(
          `${args.chapter} has ${String(revs.length)} played revision(s) (${revs.map((a) => a.revision).join(", ") || "none"}); two are needed to compare.`,
        );
      }
      const c = compareRevisions(r, args.chapter, before, after, args.source);
      if (!c) throw new ToolError(`No ${args.source} sittings of ${args.chapter} at ${!revs.some((a) => a.revision === before) ? before : after}. Played: ${revs.map((a) => a.revision).join(", ")}.`);
      const sideOut = (x: typeof c.before) => ({
        revision: x.revision,
        current_text: deps.index ? entry(deps, args.chapter)?.revision === x.revision : null,
        last_played: x.lastPlayedAt,
        sample: x.sample,
        attempts: x.attempts,
        fresh_active_min: x.freshActiveMs && { median: m(x.freshActiveMs.median), p25: m(x.freshActiveMs.p25), p75: m(x.freshActiveMs.p75) },
        completion_pct: x.completionRate === null ? null : Math.round(x.completionRate * 100),
        setback_pct: x.setbackRate === null ? null : Math.round(x.setbackRate * 100),
        minutes_by_kind: { story: m(x.bucketMedianMs.narration), mini_games: m(x.bucketMedianMs.activity), fights: m(x.bucketMedianMs.encounter) },
      });
      const hardPct = (x: number | null) => (x === null ? null : Math.round(x * 100));
      return {
        chapter: args.chapter,
        before: sideOut(c.before),
        after: sideOut(c.after),
        verdict: c.chapter.verdict,
        change: c.chapter.words,
        delta_min: m(c.chapter.deltaMs),
        scenes: c.scenes.slice(0, args.scenes).map((s) => ({ scene: s.scene, before_min: m(s.beforeMs), after_min: m(s.afterMs), delta_min: m(s.deltaMs), n: s.n })),
        games: c.games.map((g) => ({
          scene: g.scene, game: g.game, before_play_min: m(g.beforePlayMs), after_play_min: m(g.afterPlayMs),
          before_failed_or_assisted_pct: hardPct(g.beforeHardRate), after_failed_or_assisted_pct: hardPct(g.afterHardRate), n: g.n,
        })),
        fights: c.fights.map((f) => ({ scene: f.scene, before_fight_min: m(f.beforeFightMs), after_fight_min: m(f.afterFightMs), before_rounds: f.beforeRounds, after_rounds: f.afterRounds, n: f.n })),
        caution: c.caution,
      };
    }),
  );

  server.registerTool(
    "timing_campaign",
    {
      title: "A campaign, chapter by chapter",
      description:
        "Each chapter of a campaign in order: fresh attempts begun and finished, the completion and setback rates, where unfinished tables left most, " +
        "the observed median against the planned and predicted minutes, and how many findings it has. `reach_pct` is fresh attempts at each chapter " +
        "against the first: a rough drop-off by counts (timing keeps no household, so it cannot follow one family). Without `campaign`, every campaign in one line each. " +
        "Needs the chapter index the build writes.",
      inputSchema: z.object({
        campaign: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/).optional().describe("A campaign id, e.g. gemfall. Omit to list campaigns."),
        source,
        since,
      }),
      outputSchema: anyObject,
      annotations: READ,
    },
    guarded(async (args: { campaign?: string; source: TimingSource; since?: string }) => {
      const index = deps.index;
      if (!index) throw new ToolError("This server has no chapter index (infra/build.mjs writes it), so it does not know the campaigns' order. timing_overview still works.");
      const r = await report(deps, args);
      const found = timingFindings(r, { source: args.source, currentRevisions: currentRevisions(index) });
      const latest = readAt(deps, r);
      const perChapter = (id: string) => {
        const aggs = r.aggregates.filter((a) => a.source === args.source && a.chapterId === id);
        const read = aggs.find((a) => latest.get(`${args.source}\u0000${id}`) === a.revision);
        const fresh = aggs.reduce((t, a) => t + a.kinds.fresh, 0);
        const completed = aggs.reduce((t, a) => t + a.completed, 0);
        const left = aggs.reduce((t, a) => t + a.abandoned, 0);
        const setbacks = aggs.reduce((t, a) => t + a.outcomes.setback, 0);
        const leftAt = new Map<string, number>();
        for (const a of aggs) for (const l of a.leftAt ?? []) leftAt.set(l.scene, (leftAt.get(l.scene) ?? 0) + l.attempts);
        const e = entry(deps, id);
        return {
          chapter: id,
          title: e?.title ?? null,
          fresh_attempts: fresh,
          completed,
          completion_pct: completed + left > 0 ? Math.round((completed / (completed + left)) * 100) : null,
          setback_pct: completed > 0 ? Math.round((setbacks / completed) * 100) : null,
          left_most_at: [...leftAt].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([scene, n]) => ({ scene, attempts: n })),
          read_revision: read?.revision ?? null,
          current_text: read ? e?.revision === read.revision : null,
          observed_median_min: m(read?.freshActiveMs?.median),
          sample: read?.sampleLabel ?? "no data",
          planned_min: e?.estimatedMinutes ?? null,
          predicted_typical_min: e?.predictedMinutes.typical ?? null,
          findings: found.filter((f) => f.chapterId === id).length,
        };
      };
      const campaigns = index.campaigns.filter((c) => !args.campaign || c.id === args.campaign);
      if (args.campaign && campaigns.length === 0) throw new ToolError(`No campaign ${args.campaign}. Known: ${index.campaigns.map((c) => c.id).join(", ")}.`);
      if (!args.campaign) {
        return {
          campaigns: campaigns.map((c) => {
            const rows = c.chapters.map(perChapter);
            const first = rows[0]?.fresh_attempts ?? 0;
            const last = rows[rows.length - 1]?.completed ?? 0;
            return {
              campaign: c.id,
              title: c.title,
              mode: c.mode,
              chapters: c.chapters.length,
              chapters_played: rows.filter((x) => x.fresh_attempts > 0).length,
              fresh_attempts: rows.reduce((t, x) => t + x.fresh_attempts, 0),
              first_chapter_fresh_attempts: first,
              last_chapter_completed: last,
              findings: rows.reduce((t, x) => t + x.findings, 0),
            };
          }),
          next: "timing_campaign with a campaign id for its chapters in order.",
        };
      }
      const c = campaigns[0]!;
      const rows = c.chapters.map(perChapter);
      const first = rows[0]?.fresh_attempts ?? 0;
      return {
        campaign: c.id,
        title: c.title,
        mode: c.mode,
        order: c.mode === "graph" ? "listed order: a graph campaign is played in many orders, so reach_pct is only counts" : "play order",
        chapters: rows.map((x) => ({ ...x, reach_pct: first > 0 ? Math.round((x.fresh_attempts / first) * 100) : null })),
        caution: "Counts sittings by chapter, not families: a chapter reached late by few families, or reached again after a restart, shifts reach_pct.",
      };
    }),
  );

  server.registerTool(
    "timing_sittings",
    {
      title: "Recent sittings",
      description:
        "The evenings behind the figures, newest first: one row per sitting (a chapter played in one room), with its kind, how it ended, " +
        "active and idle minutes, mini-games and fights played, and the operator's note. Use it to find a sitting to exclude (timing_exclude) or to read what an outlier was.",
      inputSchema: z.object({
        source,
        since,
        chapter: chapter.optional(),
        status: z.enum(["in_progress", "completed", "closed", "saved", "abandoned"]).optional(),
        excluded: z.boolean().default(false).describe("List the excluded sittings instead."),
        limit: limit(25),
      }),
      outputSchema: anyObject,
      annotations: READ,
    },
    guarded(async (args: { source: TimingSource; since?: string; chapter?: string; status?: string; excluded: boolean; limit: number }) => {
      const [marks, exclusions] = await Promise.all([
        args.chapter ? deps.reader.chapterMarks(args.chapter) : deps.reader.allMarks(),
        deps.reader.exclusions(),
      ]);
      const sinceMs = args.since ? Date.parse(args.since) : -Infinity;
      const all = sittingsFromMarks(marks, deps.now());
      const reasons = new Map(exclusions.map((e) => [e.sittingId, e]));
      // An exclusion takes out the attempt it names: mark every sitting in it.
      const out = new Map<string, (typeof exclusions)[number]>();
      for (const a of attemptsOf(all)) {
        const hit = a.sittings.map((x) => reasons.get(x.id)).find(Boolean);
        if (hit) for (const x of a.sittings) out.set(x.id, hit);
      }
      const rows = all
        .filter((x) => x.source === args.source && Date.parse(x.startedAt) >= sinceMs && (!args.status || x.status === args.status))
        .filter((x) => out.has(x.id) === args.excluded);
      return {
        total: rows.length,
        sittings: rows.slice(0, args.limit).map((x) => ({
          id: x.id,
          chapter: x.chapterId,
          revision: x.revision,
          started: x.startedAt,
          kind: x.kind,
          ...(x.resumedFrom ? { resumed_from: x.resumedFrom } : {}),
          status: x.status,
          outcome: x.outcome,
          party: x.partySize,
          active_min: m(x.activeMs),
          idle_min: m(x.idleMs),
          paused_min: m(x.pausedMs),
          steps: x.steps,
          last_scene: x.lastScene,
          games: x.games.map((g) => ({ scene: g.scene, game: g.game, play_min: m(g.playMs), attempts: g.attempts, outcome: g.outcome })),
          fights: x.fights.map((f) => ({ scene: f.scene, fight_min: m(f.fightMs), rounds: f.rounds, outcome: f.outcome })),
          note: x.note,
          ...(out.has(x.id) ? { excluded: { reason: out.get(x.id)!.reason, by: out.get(x.id)!.by, at: out.get(x.id)!.at } } : {}),
        })),
      };
    }),
  );

  server.registerTool(
    "timing_exclude",
    {
      title: "Exclude a sitting",
      description:
        "Leave a sitting out of every timing figure: a developer's test on the live site, a demo, an evening broken by an outage. " +
        "It takes out the whole attempt the sitting belongs to (a stopped game and its resume). Reversible with timing_include; " +
        "it changes no marks, and expires with them. Give a plain reason with no names.",
      inputSchema: z.object({
        sitting_id: sittingId,
        reason: z.string().min(3).max(EXCLUSION_REASON_MAX).describe("Why, in a few plain words. No names."),
        chapter: chapter.optional().describe("The sitting's chapter, if known: one query instead of a scan."),
      }),
      outputSchema: anyObject,
      annotations: { ...WRITE, idempotentHint: true },
    },
    guarded(async (args: { sitting_id: string; reason: string; chapter?: string }) => {
      const reason = cleanNote(args.reason)?.slice(0, EXCLUSION_REASON_MAX);
      if (!reason) throw new ToolError("Say why in a few words.");
      const marks = args.chapter ? await deps.reader.chapterMarks(args.chapter) : await deps.reader.allMarks();
      const all = sittingsFromMarks(marks, deps.now());
      const attempt = attemptsOf(all).find((a) => a.sittings.some((x) => x.id === args.sitting_id));
      if (!attempt) throw new ToolError(`No sitting ${args.sitting_id}${args.chapter ? ` in ${args.chapter}` : ""}. timing_sittings lists them.`);
      const exclusion = { sittingId: args.sitting_id, reason, by: deps.key.label, at: new Date(deps.now()).toISOString() };
      await deps.reader.exclude(exclusion);
      console.info(JSON.stringify({ msg: "MCP timing exclusion", key: deps.key.label, sitting: args.sitting_id, sittings: attempt.sittings.length }));
      const head = attempt.sittings[0]!;
      return {
        excluded: exclusion,
        takes_out: attempt.sittings.map((x) => ({ id: x.id, chapter: x.chapterId, started: x.startedAt, status: x.status, active_min: m(x.activeMs) })),
        chapter: head.chapterId,
      };
    }),
  );

  server.registerTool(
    "timing_include",
    {
      title: "Count an excluded sitting again",
      description: "Undo timing_exclude: the sitting (and its attempt) counts in the figures again.",
      inputSchema: z.object({ sitting_id: sittingId }),
      outputSchema: anyObject,
      annotations: { ...WRITE, idempotentHint: true },
    },
    guarded(async (args: { sitting_id: string }) => {
      const removed = await deps.reader.include(args.sitting_id);
      if (removed) console.info(JSON.stringify({ msg: "MCP timing inclusion", key: deps.key.label, sitting: args.sitting_id }));
      return { sitting_id: args.sitting_id, included: true, was_excluded: removed };
    }),
  );
}
