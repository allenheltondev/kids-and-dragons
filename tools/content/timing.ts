#!/usr/bin/env node
/**
 * Observed chapter timing:
 * `npm run content:timing -- <export.json> [--include-playtest] [--scenes N] [--findings N] [--json]`.
 *
 * The export is what the game gives a household: `GET /api/timing` (JSON), or
 * a developer's dev server with `KAD_TIMING=family` while a real family plays.
 * Reads, never gates. See docs/session-timing.md for the clock policy.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import type { TimingReport } from "@kad/shared";
import { loadContent } from "../../packages/server/src/content/loader.ts";
import { chapterRevision } from "../../packages/server/src/handlers/timing.ts";
import { renderTimingReport, type PlannedChapter } from "./timing-lib.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !["--scenes", "--findings"].includes(args[args.indexOf(a) - 1] ?? ""));
const asJson = args.includes("--json");
const sceneAt = args.indexOf("--scenes");
const scenes = sceneAt >= 0 ? Number(args[sceneAt + 1]) : 5;
const findingsAt = args.indexOf("--findings");
const findings = findingsAt >= 0 ? Number(args[findingsAt + 1]) : 10;

if (!file) {
  console.error("usage: npm run content:timing -- <export.json> [--include-playtest] [--scenes N] [--findings N] [--json]");
  process.exit(2);
}
const report = JSON.parse(fs.readFileSync(file, "utf8")) as TimingReport;
if (!Array.isArray(report.aggregates)) {
  console.error(`${file} is not a timing export (no "aggregates").`);
  process.exit(2);
}

// Hashed as the server hashes it: the loaded chapter (enemies resolved from the bestiary), not the
// raw file, or every chapter with a fight reads as "an older text".
const content = await loadContent(path.join(ROOT, "content"));
const planned: PlannedChapter[] = content
  .chapterIds()
  .map((id) => content.chapter(id))
  .filter((c) => c !== null)
  .map((c) => ({ id: c.id, title: c.title, estimatedMinutes: c.estimatedMinutes, revision: chapterRevision(c) }));

const out = asJson
  ? JSON.stringify({ aggregates: report.aggregates, activities: report.activities ?? null, planned }, null, 2)
  : renderTimingReport(report, planned, { includePlaytest: args.includes("--include-playtest"), scenes, findings });
await new Promise<void>((done) => process.stdout.write(`${out}\n`, () => done()));
