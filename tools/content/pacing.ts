#!/usr/bin/env node
/**
 * The pacing report:
 * `npm run content:pacing [-- --json] [--chapter <prefix>] [--scenarios] [--detail]`.
 *
 * Per chapter: the shortest and a typical path to a success ending, the real
 * decisions, checks, encounters and words read aloud on it, the minutes the
 * (uncalibrated) model predicts, and the `estimatedMinutes` the chapter
 * claims. The metrics and the model live in `packages/shared/src/chapter-pacing.ts`;
 * the definitions ("typical" = per-metric median of 500 seeded random walks)
 * are in that file's header.
 *
 * **Scenario-aware.** Narration variants and `when`-gated choices depend on
 * the party, so every number is computed for a synthetic party (N distinct
 * facets, M seats) with the engine's own `composeNarration` / `evaluateCondition`.
 * The default table shows the min-max across four scenarios: empty/3p
 * (0 facets), few/3p (3), collection/3p (9) and few/solo. `--scenarios` uses
 * all six (adds empty/solo and collection/solo); `--detail` adds one row per
 * scenario; `--json` always carries every scenario. Flags can't be known
 * statically: words are a min-max over every combination of the flags a
 * scene's variants test (see the header of chapter-pacing.ts), and a `when`
 * choice that tests a flag is left off the path.
 *
 * **Reports and never gates**, like `content:balance`: whether an evening is
 * the right length is a judgement for a person with a stopwatch.
 *
 * Calibration: record measured table minutes in
 * `docs/review/playtest-timings.json` (copy
 * `docs/review/playtest-timings-template.json`). When that file exists the
 * tool fits the model constants to it, against the **few/3p** scenario (3
 * facets, three players; the upper word bound), and prints the fitted
 * constants and a second prediction column. Without it, the defaults are
 * guesses and the output says so.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  CALIBRATION_SCENARIO_ID,
  DEFAULT_SCENARIO_IDS,
  fitModel,
  metricRange,
  pacingReport,
  PACING_SCENARIOS,
  predictMinutes,
  UNCALIBRATED_MODEL,
} from "@kad/shared";
import type { Chapter, Fit, PacingModel, PacingReport, PathMetrics, Timing } from "@kad/shared";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TIMINGS = path.join(ROOT, "docs", "review", "playtest-timings.json");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const allScenarios = args.includes("--scenarios");
const detail = args.includes("--detail");
const filterAt = args.indexOf("--chapter");
const prefix = filterAt >= 0 ? (args[filterAt + 1] ?? "") : "gemfall-";

const chapterDir = path.join(ROOT, "content", "chapters");
const chapters = fs
  .readdirSync(chapterDir)
  .filter((n) => n.endsWith(".json") && n.startsWith(prefix))
  .sort()
  .map((n) => JSON.parse(fs.readFileSync(path.join(chapterDir, n), "utf8")) as Chapter);

// Always computed for every scenario: --json carries all of them and the
// calibration scenario must exist whatever the table shows.
const reports: PacingReport[] = chapters.map((c) => pacingReport(c));
const shown = new Set<string>(allScenarios ? PACING_SCENARIOS.map((s) => s.id) : DEFAULT_SCENARIO_IDS);
const shownOf = (r: PacingReport): PacingReport => ({ ...r, scenarios: r.scenarios.filter((s) => shown.has(s.scenario.id)) });

function readTimings(): Timing[] {
  if (!fs.existsSync(TIMINGS)) return [];
  const raw = JSON.parse(fs.readFileSync(TIMINGS, "utf8")) as { timings?: Timing[] };
  return (raw.timings ?? []).filter((t) => typeof t.minutes === "number" && t.minutes > 0);
}

const timings = readTimings();
const calibrationOf = (r: PacingReport | undefined, which: "shortest" | "typical"): PathMetrics | null | undefined =>
  r?.scenarios.find((s) => s.scenario.id === CALIBRATION_SCENARIO_ID)?.[which];
const fitRows = timings.flatMap((t) => {
  const r = reports.find((x) => x.chapterId === t.chapter);
  const metrics = calibrationOf(r, t.path === "shortest" ? "shortest" : "typical");
  return metrics ? [{ metrics, minutes: t.minutes }] : [];
});
const fit: Fit | null = fitModel(fitRows);

const mins = (m: PathMetrics | null | undefined, model: PacingModel): number | null =>
  m ? Math.round(predictMinutes(m, model) * 10) / 10 : null;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        model: { calibrated: fit !== null, calibrationScenario: CALIBRATION_SCENARIO_ID, defaults: UNCALIBRATED_MODEL, fitted: fit },
        defaultScenarios: DEFAULT_SCENARIO_IDS,
        chapters: reports.map((r) => ({
          chapterId: r.chapterId,
          estimatedMinutes: r.estimatedMinutes,
          ranges: { shortest: metricRange(shownOf(r), "shortest"), typical: metricRange(shownOf(r), "typical") },
          scenarios: r.scenarios.map((s) => ({
            ...s,
            predictedMinutes: {
              shortest: mins(s.shortest, UNCALIBRATED_MODEL),
              typical: mins(s.typical, UNCALIBRATED_MODEL),
              typicalFitted: fit ? mins(s.typical, fit.model) : null,
            },
          })),
          measuredMinutes: timings.filter((t) => t.chapter === r.chapterId).map((t) => t.minutes),
        })),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const range = (lo: number | null, hi: number | null): string => {
  if (lo === null || hi === null) return "-";
  return lo === hi ? String(lo) : `${String(lo)}-${String(hi)}`;
};
const cell = (v: string | number | null, w: number): string => String(v ?? "-").padStart(w);
const minsRange = (ms: PathMetrics[], model: PacingModel): string => {
  const v = ms.map((m) => mins(m, model) as number);
  return range(v.length ? Math.min(...v) : null, v.length ? Math.max(...v) : null);
};

const header = [
  "chapter".padEnd(11),
  "path".padEnd(8),
  "scenario".padEnd(17),
  ...["scenes", "votes", "checks", "fights"].map((h) => h.padStart(6)),
  "words".padStart(11),
  "predMin".padStart(10),
  "estMin".padStart(6),
  fit ? "fitMin".padStart(10) : "",
  timings.length ? "measured".padStart(8) : "",
].join(" ");
console.log("Pacing: paths to a success ending (visible choices; defeat excluded), min-max across scenarios");
console.log(header);
for (const full of reports) {
  const r = shownOf(full);
  for (const label of ["shortest", "typical"] as const) {
    const ms = r.scenarios.flatMap((s) => (s[label] ? [s[label]] : []));
    const measured = timings.filter((t) => t.chapter === r.chapterId && (t.path ?? "typical") === label).map((t) => t.minutes);
    const row = (name: string, group: PathMetrics[], rg: ReturnType<typeof metricRange>): string => {
      const g = (k: "scenes" | "decisions" | "checks" | "encounters"): string => range(rg?.[k].min ?? null, rg?.[k].max ?? null);
      return [
        r.chapterId.padEnd(11),
        label.padEnd(8),
        name.padEnd(17),
        cell(g("scenes"), 6),
        cell(g("decisions"), 6),
        cell(g("checks"), 6),
        cell(g("encounters"), 6),
        cell(range(rg?.wordsMin.min ?? null, rg?.words.max ?? null), 11),
        cell(minsRange(group, UNCALIBRATED_MODEL), 10),
        cell(label === "typical" ? r.estimatedMinutes : "", 6),
        fit ? cell(minsRange(group, fit.model), 10) : "",
        timings.length ? cell(measured.join(",") || "", 8) : "",
      ].join(" ");
    };
    console.log(row("range", ms as PathMetrics[], metricRange(r, label)));
    if (detail) {
      for (const s of r.scenarios) {
        const m = s[label];
        if (m) console.log(row(`  ${s.scenario.id}`, [m], metricRange({ ...r, scenarios: [s] }, label)));
      }
    }
  }
}
console.log("");
console.log(`Scenarios shown: ${[...shown].join(", ")} (--scenarios for all six, --detail for one row each, --json for everything).`);
console.log("A scenario is a synthetic party: facets = distinct facet_* items held (empty 0, few 3, collection 9), solo = 1 seat, 3p = 3 seats.");
console.log("Variants are composed with the engine's composeNarration, so append / at:start / replace read as at the table.");
console.log("words = lowest..highest over run-flag combinations a scene's variants test (flags are unknowable statically); predMin uses the upper bound.");
console.log("votes = scenes with 2+ visible choices (one-button beats and species/flag/item-gated choices do not count; a `when` choice counts in scenarios where it holds).");
console.log("typical = median of seeded random walks. The authoring bar counts votes + checks: shortest path needs scenes >= 30 and votes + checks >= 14.");
const d = UNCALIBRATED_MODEL;
if (fit) {
  const f = fit.model;
  console.log(
    `Fitted (${fit.method}, ${String(fit.samples)} timings, against the ${CALIBRATION_SCENARIO_ID} scenario): ${f.wordsPerMinute.toFixed(0)} wpm, ${f.secondsPerDecision.toFixed(0)}s/vote, ${f.secondsPerCheck.toFixed(0)}s/check, ${f.secondsPerEncounter.toFixed(0)}s/fight, ${f.secondsPerScene.toFixed(1)}s/scene.`,
  );
  console.log("predMin uses the uncalibrated defaults; fitMin the fitted constants.");
} else {
  console.log(
    `UNCALIBRATED DEFAULTS (guesses, not measurements): ${String(d.wordsPerMinute)} wpm, ${String(d.secondsPerDecision)}s/vote, ${String(d.secondsPerCheck)}s/check, ${String(d.secondsPerEncounter)}s/fight, ${String(d.secondsPerScene)}s/scene.`,
  );
  console.log(`Record real timings in docs/review/playtest-timings.json (template alongside); they are fitted against the ${CALIBRATION_SCENARIO_ID} scenario, so note the party size and facets held.`);
}
