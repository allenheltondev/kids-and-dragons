/**
 * The author's view of observed chapter timing (#511): what families' sittings
 * say against the intended thirty-minute budget, and which scenes to look at.
 *
 * It reads a timing report as the game exports it (`GET /api/timing`), never
 * a prediction. `content:pacing` is where planned and predicted minutes live;
 * the two are printed in separate columns and never averaged, and a family
 * observation is never pooled with a playtest. A small sample is said to be
 * small: this is a reading list for revision, not a verdict on a chapter.
 */

import type { ActivityReport, ChapterAggregate, Distribution, SceneAggregate, TimingReport } from "@kad/shared";
import { budgetVerdict, CHAPTER_BUDGET_MINUTES, sampleLabel, timingFindings } from "@kad/shared";

export interface PlannedChapter {
  id: string;
  title?: string;
  estimatedMinutes: number;
  /** The revision of the chapter file as it stands (handlers/timing.ts `chapterRevision`). */
  revision: string;
}

export interface TimingRenderOptions {
  /** Also print the playtest runs, under their own heading. Family observations always print. */
  includePlaytest?: boolean;
  /** Most scenes listed per chapter. */
  scenes?: number;
  budgetMinutes?: number;
  /** Most findings printed per source (default 10; 0 for none). */
  findings?: number;
}

const min = (ms: number | null | undefined): string => (ms === null || ms === undefined ? "-" : (ms / 60_000).toFixed(1));

function spread(d: Distribution | null): string {
  if (!d) return "-";
  return d.n >= 3 ? `${min(d.p25)}-${min(d.p75)} (min ${min(d.min)}, max ${min(d.max)})` : `${min(d.min)}-${min(d.max)}`;
}

/** Scenes worth a look: the longest few, with the sample behind each. */
export function slowScenes(agg: Pick<ChapterAggregate, "scenes">, limit = 5): SceneAggregate[] {
  return agg.scenes.slice(0, limit);
}

/** A chapter revision's mini-games and fights, one line each. */
function activityLines(acts: ActivityReport | undefined, agg: ChapterAggregate): string[] {
  const here = (x: { source: string; chapterId: string; revision: string }) =>
    x.source === agg.source && x.chapterId === agg.chapterId && x.revision === agg.revision;
  const games = (acts?.games ?? []).filter(here);
  const fights = (acts?.fights ?? []).filter(here);
  const lines: string[] = [];
  if (games.length > 0) {
    lines.push("  mini-games (median min: ready screen / play / result; finished fresh and resumed visits):");
    for (const g of games) {
      lines.push(
        `    ${g.scene.padEnd(34)} ${g.game.padEnd(10)} ${min(g.readyMs.median)} / ${min(g.playMs.median)} / ${min(g.afterMs.median)}, ${String(g.retried)} retried, ${String(g.outcomes.failure)} failed, ${String(g.outcomes.assisted)} assisted, ${sampleLabel(g.n)}`,
      );
    }
  }
  if (fights.length > 0) {
    lines.push("  fights (median min: ready-up / fight; rounds):");
    for (const f of fights) {
      const lost = f.outcomes.defeat + f.outcomes.timedOut;
      lines.push(
        `    ${f.scene.padEnd(34)} ${min(f.setupMs.median)} / ${min(f.fightMs.median)}, ${String(f.rounds.median)} rounds (max ${String(f.rounds.max)}), ${String(lost)} lost, ${sampleLabel(f.n)}`,
      );
    }
  }
  return lines;
}

export function renderTimingReport(
  report: Pick<TimingReport, "aggregates" | "generatedAt" | "truncated" | "policy"> & Partial<Pick<TimingReport, "crossRevision" | "activities" | "excluded">>,
  planned: readonly PlannedChapter[],
  options: TimingRenderOptions = {},
): string {
  const budget = options.budgetMinutes ?? CHAPTER_BUDGET_MINUTES;
  const lines: string[] = [];
  const sources: Array<"family" | "playtest"> = options.includePlaytest ? ["family", "playtest"] : ["family"];
  lines.push(`Observed chapter timing, exported ${report.generatedAt}.`);
  lines.push(
    `Active time counts silences up to ${String(report.policy.idleGapCapMinutes)} minutes between taps; pauses and longer silences are left out (${report.policy.doc}).`,
  );
  lines.push("Planned minutes are what the chapter claims; they are not an observation, and neither is content:pacing's prediction.");
  if (report.truncated) lines.push("Only the household's most recent runs were read.");
  if (report.excluded && report.excluded.length > 0) {
    lines.push(`${String(report.excluded.length)} sittings an operator excluded are left out of every figure (${report.excluded.map((e) => e.reason).slice(0, 3).join("; ")}).`);
  }

  for (const source of sources) {
    const rows = report.aggregates.filter((a) => a.source === source);
    lines.push("", source === "family" ? "== Family observations ==" : "== Playtests (a developer's own runs; not families) ==");
    if (rows.length === 0) {
      lines.push("  none yet");
      continue;
    }
    for (const agg of rows) {
      const plan = planned.find((p) => p.id === agg.chapterId);
      const current = plan ? (plan.revision === agg.revision ? "current text" : "an older text of this chapter") : "chapter not found";
      lines.push(
        "",
        `${agg.chapterId} @ ${agg.revision} (${current})`,
        `  planned: ${plan ? String(plan.estimatedMinutes) : "-"} min   budget: ${String(budget)} min`,
        `  observed, fresh completed: ${sampleLabel(agg.freshActiveMs?.n ?? 0)}`,
        `    active min: median ${min(agg.freshActiveMs?.median)}, middle half ${spread(agg.freshActiveMs)}`,
        `    wall min:   median ${min(agg.freshWallMs?.median)}`,
        `    ${budgetVerdict(agg, budget)}`,
        ...(agg.crossRevision > 0
          ? [`  ${String(agg.crossRevision)} more played partly on another text of this chapter: kept out of every figure here, listed below`]
          : []),
        `  attempts ${String(agg.attempts)}: fresh ${String(agg.kinds.fresh)}, revisit ${String(agg.kinds.revisit)}, resumed ${String(agg.kinds.resumed)}; completed ${String(agg.completed)}, left unfinished ${String(agg.abandoned)}`,
        `  revisits kept apart: median ${min(agg.revisitActiveMs?.median)} min (n=${String(agg.revisitActiveMs?.n ?? 0)}); resumed: median ${min(agg.resumedActiveMs?.median)} min (n=${String(agg.resumedActiveMs?.n ?? 0)})`,
        `  median minutes by kind of play: story and choices ${min(agg.bucketMedianMs.narration)}, activities ${min(agg.bucketMedianMs.activity)}, fights ${min(agg.bucketMedianMs.encounter)}`,
        `  party sizes: ${Object.entries(agg.partySizes).map(([n, c]) => `${n}p x${String(c)}`).join(", ") || "-"}; setbacks ${String(agg.outcomes.setback)}; attempts with an assisted route ${String(agg.assistedAttempts)}`,
      );
      lines.push(...activityLines(report.activities, agg));
      const scenes = slowScenes(agg, options.scenes ?? 5);
      if (scenes.length > 0) {
        lines.push("  longest scenes (a reading list, not evidence of a problem; time alone does not say a scene is dull or fun):");
        for (const s of scenes) {
          lines.push(
            `    ${s.scene.padEnd(34)} ${s.bucket.padEnd(9)} median ${min(s.activeMs.median).padStart(5)} min, ${s.share === null ? "-" : `${Math.round(s.share * 100)}%`} of the chapter, ${sampleLabel(s.n)}`,
          );
        }
      }
      if (agg.notes.length > 0) {
        lines.push("  grown-up notes:");
        for (const note of agg.notes.slice(0, 8)) lines.push(`    - ${note}`);
      }
    }
  }
  for (const source of sources) {
    const kinds = (report.activities?.gameKinds ?? []).filter((k) => k.source === source);
    const fights = (report.activities?.fightTotals ?? []).find((t) => t.source === source);
    if (kinds.length === 0 && !fights) continue;
    lines.push("", `== Mini-games and fights across chapters (${source}) ==`);
    for (const k of kinds) {
      lines.push(
        `  ${k.game.padEnd(10)} play median ${min(k.playMs.median)} min (ready ${min(k.readyMs.median)}), ${k.attemptsPerVisit.toFixed(1)} attempts a visit, ${String(Math.round(k.failureRate * 100))}% failed, ${String(Math.round(k.assistedRate * 100))}% assisted, over ${String(k.scenes)} scenes, ${sampleLabel(k.n)}`,
      );
    }
    if (fights) {
      lines.push(
        `  fights     fight median ${min(fights.fightMs.median)} min (ready-up ${min(fights.setupMs.median)}), ${String(fights.rounds.median)} rounds, ${min(fights.msPerRound)} min a round, ${String(Math.round(fights.defeatRate * 100))}% lost, over ${String(fights.scenes)} scenes, ${sampleLabel(fights.n)}`,
      );
    }
  }
  const limit = options.findings ?? 10;
  for (const source of limit > 0 ? sources : []) {
    const found = timingFindings(report, { source, budgetMinutes: budget, currentRevisions: new Map(planned.map((p) => [p.id, p.revision])) });
    if (found.length === 0) continue;
    lines.push("", `== Findings (${source}; each chapter's current text, or its latest played if that has no sittings; a reading list, not a verdict) ==`);
    for (const f of found.slice(0, limit)) {
      lines.push(`  [${f.severity}] ${f.title}: ${f.evidence} (${f.sampleLabel})`, `        try: ${f.suggestion}`);
    }
    if (found.length > limit) lines.push(`  ... ${String(found.length - limit)} more (--findings N)`);
  }
  const spanned = (report.crossRevision ?? []).filter((c) => sources.includes(c.source));
  if (spanned.length > 0) {
    lines.push("", "== Played across an edit (stopped on one text of the chapter, finished on another) ==");
    lines.push("  Counted in no revision's figures. Total time and fate only; the revisions are in the order played.");
    for (const c of spanned) {
      lines.push(
        `  ${c.chapterId} (${c.source}): ${c.revisions.join(" -> ")}; ${c.completed ? `finished${c.outcome === "setback" ? " (setback)" : ""}` : c.status.replace("_", " ")}, ${min(c.activeMs)} min active over ${String(c.sittings)} sittings`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
