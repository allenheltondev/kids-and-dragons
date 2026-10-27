#!/usr/bin/env node
/**
 * Pull observed session timing from a deployed stack:
 * `npm run timing:export -- --stage prod [--chapter ID] [--region R] [--table T] [--out FILE] [--csv]`
 *
 * Uses the caller's AWS credentials (the CLI's profile or environment) and
 * reads the stack's own timing table, `kad-timing-<stage>`, never the game's.
 * With `--chapter` it is one query on that chapter's partition; without, a scan
 * of the timing table, which holds only telemetry and expires after 180 days.
 * Writes the report as JSON (stdout, or `--out`) in the shape
 * `npm run content:timing -- <file>` reads; `--csv` writes one row per sitting.
 * Read-only. The rows hold no household, player or name. See
 * docs/session-timing.md.
 */

import fs from "node:fs";
import process from "node:process";
import { timingCsv, timingReportFromMarks } from "@kad/shared";
import { DynamoTimingStore } from "../../packages/server/src/store/timing-store.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const stage = flag("stage");
const table = flag("table") ?? (stage ? `kad-timing-${stage}` : undefined);
if (!table) {
  console.error("usage: npm run timing:export -- --stage <dev|staging|prod> [--chapter ID] [--region R] [--table T] [--out FILE] [--csv]");
  process.exit(2);
}
const region = flag("region") ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
if (region) process.env.AWS_REGION = region;

const store = new DynamoTimingStore({ tableName: table });
const chapter = flag("chapter");
const marks = chapter ? await store.chapterMarks(chapter) : await store.allMarks();
const report = timingReportFromMarks(marks, Date.now(), null);

const text = args.includes("--csv") ? timingCsv(report.sittings) : `${JSON.stringify(report, null, 2)}\n`;
const out = flag("out");
if (out) {
  fs.writeFileSync(out, text);
  console.error(`${table}: ${String(marks.length)} marks, ${String(report.sittings.length)} sittings -> ${out}`);
} else {
  await new Promise<void>((done) => process.stdout.write(text, () => done()));
}
