#!/usr/bin/env node
/**
 * Kids & Dragons — e2e shards balanced by how long each test takes.
 *
 * Playwright's own `--shard` deals tests out by count, in file order, so the
 * eight layout-fit walks (8 minutes) land in one shard and the two-second
 * install cards fill another: the slowest shard ran nine minutes while the
 * quickest ran two. This lists the suite, weighs every test by its last
 * measured duration (e2e/timings.json), and deals them longest-first onto the
 * lightest shard, so every shard carries about a tenth of the minutes. Tests
 * that share a line (a `for` loop of sizes) stay together, because a
 * `file:line` filter cannot tell them apart.
 *
 * A test the timings file has not met weighs the median of those it has; the
 * plan still runs it, it is just placed blind until the next refresh.
 *
 * Usage:
 *     node tools/ci/e2e-shard.mjs 3/10 [playwright args]   # run shard 3 of 10
 *     node tools/ci/e2e-shard.mjs --plan 10                # print the deal
 *     node tools/ci/e2e-shard.mjs --timings report.json... # refresh e2e/timings.json
 *
 * Refreshing: each CI shard writes test-results/report.json (playwright.config.ts)
 * and uploads it as the `e2e-timings-<shard>` artifact; download a green run's
 * ten and pass them all. Only tests the reports saw are updated.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TIMINGS = join(ROOT, "e2e", "timings.json");
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

/** @param {string} file @param {string[]} titles */
export const keyOf = (file, titles) => `${file} › ${titles.join(" › ")}`;

/**
 * Every test in a Playwright JSON report (or `--list --reporter=json`
 * output), with its file, line, title path and, when it ran, its seconds.
 * @param {any} report
 * @returns {{ file: string, line: number, key: string, seconds?: number }[]}
 */
export function testsOf(report) {
  const out = [];
  /** @param {any} suite @param {string[]} titles */
  const walk = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      const key = keyOf(spec.file, [...titles, spec.title]);
      const results = (spec.tests ?? []).flatMap(t => t.results ?? []);
      const last = results.at(-1);
      out.push({ file: spec.file, line: spec.line, key, ...(last ? { seconds: last.duration / 1000 } : {}) });
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
  };
  // The root suites are the files; their titles are file names, not test titles.
  for (const file of report.suites ?? []) walk(file, []);
  return out;
}

/**
 * The deal: locations grouped by `file:line`, weighed, longest first onto the
 * lightest shard. Deterministic, so every shard of a run computes the same
 * plan from the same list.
 * @param {{ file: string, line: number, key: string }[]} tests
 * @param {Record<string, number>} timings seconds by key
 * @param {number} count shards
 * @returns {{ locations: string[], seconds: number }[]}
 */
export function plan(tests, timings, count) {
  const known = Object.values(timings).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 30;
  /** @type {Map<string, number>} */
  const groups = new Map();
  for (const t of tests) {
    const loc = `${t.file}:${t.line}`;
    groups.set(loc, (groups.get(loc) ?? 0) + (timings[t.key] ?? median));
  }
  const order = [...groups].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const shards = Array.from({ length: count }, () => ({ locations: /** @type {string[]} */ ([]), seconds: 0 }));
  for (const [loc, seconds] of order) {
    const lightest = shards.reduce((best, s) => (s.seconds < best.seconds ? s : best), shards[0]);
    lightest.locations.push(loc);
    lightest.seconds += seconds;
  }
  for (const s of shards) s.locations.sort();
  return shards;
}

/** @param {string[]} reports paths @param {Record<string, number>} timings */
export function merge(reports, timings) {
  const next = { ...timings };
  for (const path of reports) {
    for (const t of testsOf(JSON.parse(readFileSync(path, "utf8")))) {
      if (t.seconds !== undefined) next[t.key] = Math.round(t.seconds * 10) / 10;
    }
  }
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
}

const readTimings = () => /** @type {Record<string, number>} */ (JSON.parse(readFileSync(TIMINGS, "utf8")));

/** @param {string[]} args extra playwright args (a config, a grep) */
function listTests(args) {
  const out = execFileSync(NPX, ["playwright", "test", "--list", "--reporter=json", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: "", PLAYWRIGHT_JSON_OUTPUT_FILE: "" },
  });
  return testsOf(JSON.parse(out));
}

const minutes = (/** @type {number} */ s) => `${(s / 60).toFixed(1)}m`;

function main(/** @type {string[]} */ argv) {
  const [mode, ...rest] = argv;
  if (mode === "--timings") {
    if (!rest.length) throw new Error("--timings needs at least one Playwright JSON report");
    const merged = merge(rest, readTimings());
    writeFileSync(TIMINGS, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`e2e/timings.json: ${Object.keys(merged).length} tests`);
    return 0;
  }
  if (mode === "--plan") {
    const count = Number(rest[0] ?? 10);
    for (const [i, s] of plan(listTests(rest.slice(1)), readTimings(), count).entries()) {
      console.log(`shard ${i + 1}/${count}: ${minutes(s.seconds)} in ${s.locations.length} locations`);
      for (const loc of s.locations) console.log(`  ${loc}`);
    }
    return 0;
  }
  const m = /^(\d+)\/(\d+)$/.exec(mode ?? "");
  if (!m) throw new Error("usage: e2e-shard.mjs <k>/<n> | --plan <n> | --timings <report.json>...");
  const [index, count] = [Number(m[1]), Number(m[2])];
  if (index < 1 || index > count) throw new Error(`shard ${mode} is out of range`);
  const shard = plan(listTests(rest), readTimings(), count)[index - 1];
  console.log(`shard ${mode}: ${shard.locations.length} locations, about ${minutes(shard.seconds)} by last measure`);
  if (!shard.locations.length) return 0;
  const run = spawnSync(NPX, ["playwright", "test", ...rest, ...shard.locations.map(l => join("e2e", l))], {
    cwd: ROOT,
    stdio: "inherit",
  });
  return run.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
