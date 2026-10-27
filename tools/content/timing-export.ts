#!/usr/bin/env node
/**
 * Pull observed session timing from a deployed stack:
 * `npm run timing:export -- --stage prod [--region us-east-1] [--table kad-prod] [--out timing.json] [--csv]`
 *
 * Uses the caller's AWS credentials (the CLI's profile or environment), reads
 * the table `kad-<stage>` with a projected, paginated scan, and writes the
 * report as JSON (stdout, or `--out`). Feed the JSON to
 * `npm run content:timing -- timing.json`. `--csv` writes one row per sitting
 * instead. Read-only. A scan reads the whole table, so run it when you want an
 * answer, not on a loop. See docs/session-timing.md.
 */

import fs from "node:fs";
import process from "node:process";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { timingCsv } from "@kad/shared";
import { exportReport, type TimedEventItem } from "./timing-export-lib.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const stage = flag("stage");
const table = flag("table") ?? (stage ? `kad-${stage}` : undefined);
if (!table) {
  console.error("usage: npm run timing:export -- --stage <dev|staging|prod> [--region R] [--table T] [--out FILE] [--csv]");
  process.exit(2);
}
const region = flag("region") ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
const doc = DynamoDBDocumentClient.from(new DynamoDBClient(region ? { region } : {}));

const items: TimedEventItem[] = [];
let key: Record<string, unknown> | undefined;
do {
  const page = await doc.send(
    new ScanCommand({
      TableName: table,
      FilterExpression: "begins_with(SK, :evt) AND attribute_exists(#d.#t)",
      ProjectionExpression: "PK, SK, #d.#s, #d.#a, #d.#t",
      ExpressionAttributeNames: { "#d": "data", "#t": "timing", "#s": "seq", "#a": "at" },
      ExpressionAttributeValues: { ":evt": "EVT#" },
      ...(key ? { ExclusiveStartKey: key } : {}),
    }),
  );
  items.push(...((page.Items ?? []) as TimedEventItem[]));
  key = page.LastEvaluatedKey;
} while (key);

const report = exportReport(items, Date.now());
const text = args.includes("--csv") ? timingCsv(report.sittings) : `${JSON.stringify(report, null, 2)}\n`;
const out = flag("out");
if (out) {
  fs.writeFileSync(out, text);
  console.error(`${table}: ${String(items.length)} timed events, ${String(report.sittings.length)} sittings -> ${out}`);
} else {
  await new Promise<void>((done) => process.stdout.write(text, () => done()));
}
