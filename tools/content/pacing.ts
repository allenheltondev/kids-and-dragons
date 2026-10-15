#!/usr/bin/env node
/**
 * The pacing report: `npm run content:pacing [-- --json] [--chapter <prefix>]`.
 *
 * Per chapter: the shortest and a typical path to a success ending, the real
 * decisions, checks, encounters and words read aloud on it, the minutes the
 * (uncalibrated) model predicts, and the `estimatedMinutes` the chapter
 * claims. The metrics and the model live in `packages/shared/src/chapter-pacing.ts`;
 * the definitions ("typical" = per-metric median of 500 seeded random walks)
 * are in that file's header.
 *
 * **Reports and never gates**, like `content:balance`: whether an evening is
 * the right length is a judgement for a person with a stopwatch.
 *
 * Calibration: record measured table minutes in
 * `docs/review/playtest-timings.json` (copy
 * `docs/review/playtest-timings-template.json`). When that file exists the
 * tool fits the model constants to it and prints the fitted constants and a
 * second prediction column. Without it, the defaults are guesses and the
 * output says so.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fitModel, pacingReport, predictMinutes, UNCALIBRATED_MODEL } from "@kad/shared";
import type { Chapter, Fit, PacingModel, PacingReport, PathMetrics, Timing } from "@kad/shared";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TIMINGS = path.join(ROOT, "docs", "review", "playtest-timings.json");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const filterAt = args.indexOf("--chapter");
const prefix = filterAt >= 0 ? (args[filterAt + 1] ?? "") : "gemfall-";

const chapterDir = path.join(ROOT, "content", "chapters");
const chapters = fs
  .readdirSync(chapterDir)
  .filter((n) => n.endsWith(".json") && n.startsWith(prefix))
  .sort()
  .map((n) => JSON.parse(fs.readFileSync(path.join(chapterDir, n), "utf8")) as Chapter);

const reports: PacingReport[] = chapters.map((c) => pacingReport(c));

function readTimings(): Timing[] {
  if (!fs.existsSync(TIMINGS)) return [];
  const raw = JSON.parse(fs.readFileSync(TIMINGS, "utf8")) as { timings?: Timing[] };
  return (raw.timings ?? []).filter((t) => typeof t.minutes === "number" && t.minutes > 0);
}

const timings = readTimings();
const fitRows = timings.flatMap((t) => {
  const r = reports.find((x) => x.chapterId === t.chapter);
  const metrics: PathMetrics | null | undefined = t.path === "shortest" ? r?.shortest : r?.typical;
  return metrics ? [{ metrics, minutes: t.minutes }] : [];
});
const fit: Fit | null = fitModel(fitRows);

const mins = (m: PathMetrics | null, model: PacingModel): number | null =>
  m ? Math.round(predictMinutes(m, model) * 10) / 10 : null;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        model: { calibrated: fit !== null, defaults: UNCALIBRATED_MODEL, fitted: fit },
        chapters: reports.map((r) => ({
          ...r,
          predictedMinutes: {
            shortest: mins(r.shortest, UNCALIBRATED_MODEL),
            typical: mins(r.typical, UNCALIBRATED_MODEL),
            typicalFitted: fit ? mins(r.typical, fit.model) : null,
          },
          measuredMinutes: timings.filter((t) => t.chapter === r.chapterId).map((t) => t.minutes),
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const cell = (v: string | number | null, w: number): string => String(v ?? "-").padStart(w);
const header = [
  "chapter".padEnd(11),
  "path".padEnd(8),
  ...["scenes", "votes", "checks", "fights", "words"].map((h) => h.padStart(6)),
  "predMin".padStart(7),
  "estMin".padStart(6),
  fit ? "fitMin".padStart(6) : "",
  timings.length ? "measured".padStart(8) : "",
].join(" ");
console.log("Pacing: paths to a success ending (ungated choices; defeat excluded)");
console.log(header);
for (const r of reports) {
  for (const [label, m] of [["shortest", r.shortest], ["typical", r.typical]] as const) {
    const measured = timings.filter((t) => t.chapter === r.chapterId && (t.path ?? "typical") === label).map((t) => t.minutes);
    console.log(
      [
        r.chapterId.padEnd(11),
        label.padEnd(8),
        cell(m?.scenes ?? null, 6),
        cell(m?.decisions ?? null, 6),
        cell(m?.checks ?? null, 6),
        cell(m?.encounters ?? null, 6),
        cell(m?.words ?? null, 6),
        cell(mins(m, UNCALIBRATED_MODEL), 7),
        cell(label === "typical" ? r.estimatedMinutes : "", 6),
        fit ? cell(mins(m, fit.model), 6) : "",
        timings.length ? cell(measured.join(",") || "", 8) : "",
      ].join(" "),
    );
  }
}
console.log("");
console.log("votes = scenes with 2+ ungated choices (one-button beats do not count); typical = median of seeded random walks.");
console.log("The authoring bar counts votes + checks: shortest path needs scenes >= 30 and votes + checks >= 14.");
const d = UNCALIBRATED_MODEL;
if (fit) {
  const f = fit.model;
  console.log(
    `Fitted (${fit.method}, ${String(fit.samples)} timings): ${f.wordsPerMinute.toFixed(0)} wpm, ${f.secondsPerDecision.toFixed(0)}s/vote, ${f.secondsPerCheck.toFixed(0)}s/check, ${f.secondsPerEncounter.toFixed(0)}s/fight, ${f.secondsPerScene.toFixed(1)}s/scene.`,
  );
  console.log("predMin uses the uncalibrated defaults; fitMin the fitted constants.");
} else {
  console.log(
    `UNCALIBRATED DEFAULTS (guesses, not measurements): ${String(d.wordsPerMinute)} wpm, ${String(d.secondsPerDecision)}s/vote, ${String(d.secondsPerCheck)}s/check, ${String(d.secondsPerEncounter)}s/fight, ${String(d.secondsPerScene)}s/scene.`,
  );
  console.log("Record real timings in docs/review/playtest-timings.json (template alongside) to fit them.");
}
