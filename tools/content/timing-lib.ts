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

import type { ChapterAggregate, Distribution, SceneAggregate, TimingReport } from "@kad/shared";
import { budgetVerdict, CHAPTER_BUDGET_MINUTES, sampleLabel } from "@kad/shared";

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

export function renderTimingReport(
  report: Pick<TimingReport, "aggregates" | "generatedAt" | "truncated" | "policy"> & Partial<Pick<TimingReport, "crossRevision">>,
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
