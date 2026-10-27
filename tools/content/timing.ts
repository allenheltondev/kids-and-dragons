#!/usr/bin/env node
/**
 * Observed chapter timing:
 * `npm run content:timing -- <export.json> [--include-playtest] [--scenes N] [--json]`.
 *
 * The export is what the game gives a household: `GET /api/timing` (JSON), or
 * a developer's dev server with `KAD_TIMING=family` while a real family plays.
 * Reads, never gates. See docs/session-timing.md for the clock policy.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import type { Chapter, TimingReport } from "@kad/shared";
import { chapterRevision } from "../../packages/server/src/handlers/timing.ts";
import { renderTimingReport, type PlannedChapter } from "./timing-lib.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--scenes");
const asJson = args.includes("--json");
const sceneAt = args.indexOf("--scenes");
const scenes = sceneAt >= 0 ? Number(args[sceneAt + 1]) : 5;

if (!file) {
  console.error("usage: npm run content:timing -- <export.json> [--include-playtest] [--scenes N] [--json]");
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(file, "utf8")) as TimingReport;
if (!Array.isArray(report.aggregates)) {
  console.error(`${file} is not a timing export (no "aggregates").`);
  process.exit(2);
}

const chapterDir = path.join(ROOT, "content", "chapters");
const planned: PlannedChapter[] = fs
  .readdirSync(chapterDir)
  .filter((n) => n.endsWith(".json"))
  .map((n) => JSON.parse(fs.readFileSync(path.join(chapterDir, n), "utf8")) as Chapter)
  .map((c) => ({ id: c.id, title: c.title, estimatedMinutes: c.estimatedMinutes, revision: chapterRevision(c) }));

const out = asJson
  ? JSON.stringify({ aggregates: report.aggregates, planned }, null, 2)
  : renderTimingReport(report, planned, { includePlaytest: args.includes("--include-playtest"), scenes });
await new Promise<void>((done) => process.stdout.write(`${out}\n`, () => done()));
