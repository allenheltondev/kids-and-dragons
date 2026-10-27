#!/usr/bin/env node
/**
 * Builds the cast voice sheet — `npm run voice:cast` (docs/voice-cast.md).
 *
 * Reads every chapter, the canon individuals and the narration, and writes
 * content/voice/cast.json: the whole cast, each with a Gemini voice and real
 * lines to audition it on. Run it again after writing a chapter: new people
 * are added, everyone's chapters and lines are refreshed, and a voice anybody
 * chose on the cast page (or by hand) is kept.
 *
 *   npm run voice:cast              # build or refresh the sheet
 *   npm run voice:cast -- --check   # report only; exit 1 on a voice clash
 *   npm run voice:cast -- --review  # the approvals and rejections so far, as Markdown
 *   npm run voice:cast -- --review --out review.json
 *
 * Then `npm run voice:bakeoff -- --serve` and open /cast to listen.
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { reviewJson, reviewMarkdown } from "./review.ts";
import { buildSheet, voiceClashes, type CastSheet } from "./sheet.ts";
import { loadSources, SHEET_COMMENT, writeSheet } from "./sources.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
export const SHEET = path.join(ROOT, "content", "voice", "cast.json");

const { values } = parseArgs({ options: { check: { type: "boolean", default: false }, review: { type: "boolean", default: false }, out: { type: "string" } } });

// `--review`: the approvals and rejections so far, as Markdown (or JSON when --out ends in .json). Changes nothing.
if (values.review) {
  if (!fs.existsSync(SHEET)) {
    console.error("No cast sheet yet: run `npm run voice:cast` first.");
    process.exit(2);
  }
  const sheet = JSON.parse(fs.readFileSync(SHEET, "utf8")) as CastSheet;
  const text = values.out?.endsWith(".json") ? `${JSON.stringify(reviewJson(sheet), null, 2)}\n` : reviewMarkdown(sheet);
  if (values.out) {
    fs.writeFileSync(values.out, text);
    console.log(`Wrote ${values.out}.`);
  } else {
    process.stdout.write(text);
  }
  process.exit(0);
}

const previous = fs.existsSync(SHEET) ? (JSON.parse(fs.readFileSync(SHEET, "utf8")) as CastSheet) : null;
const sheet = buildSheet(loadSources(ROOT), previous);
const out: CastSheet = { $comment: SHEET_COMMENT, accent: sheet.accent, speakers: sheet.speakers };

const entries = Object.values(out.speakers);
const clashes = voiceClashes(out);
const silent = entries.filter((e) => e.kind !== "narrator" && e.kind !== "party" && e.speaks && e.lines.length === 0);
console.log(`${String(entries.length)} speakers: ${String(entries.filter((e) => e.status === "approved").length)} approved, ${String(entries.filter((e) => e.status === "provisional").length)} provisional.`);
console.log(`${String(entries.filter((e) => e.lines.length > 0).length)} have lines from the game to audition; ${String(silent.length)} speak but have none found yet.`);
const used = new Map<string, number>();
for (const e of entries) used.set(e.gemini.voice, (used.get(e.gemini.voice) ?? 0) + 1);
console.log(`Voices: ${[...used].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${String(n)}`).join(", ")}`);
if (clashes.length > 0) {
  console.log(`\n${String(clashes.length)} chapters have two speakers on one voice:`);
  for (const clash of clashes.slice(0, 20)) console.log(`  ${clash.chapter}: ${clash.voice} — ${clash.speakers.join(", ")}`);
} else {
  console.log("No chapter has two speakers on one voice.");
}

if (values.check) {
  process.exit(clashes.length > 0 ? 1 : 0);
}
writeSheet(SHEET, out);
console.log(`\nWrote ${path.relative(ROOT, SHEET)}.`);
